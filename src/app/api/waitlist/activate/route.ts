import { timingSafeEqual } from "node:crypto";

import { hasArcActivity, ARC_MAINNET_CHAIN_ID } from "@/lib/waitlist/arcMainnet";
import { supabaseAdmin, isAdminConfigured } from "@/lib/supabase/serverClient";

/**
 * The waitlist activation reader.
 *
 * Pending waitlist points (welcome + referral) are a number on a page until the
 * wallet proves it is a real, active user. This job walks not-yet-activated
 * waitlist rows, checks each wallet on Arc mainnet, and for the ones that have
 * transacted there it:
 *
 *   1. writes the canonical, append-only credit as a `point_actions` row
 *      (source `waitlist`, Season 1, chain 5042) — see the migration
 *      20260914020000_waitlist_activation for why the registry rows exist and why
 *      this, not a point_balances write, is the record of truth; and
 *   2. stamps `waitlist.activated_at` so the wallet is not re-scanned.
 *
 * Idempotent: the credit's `tx_hash` is synthetic and stable per wallet
 * (`waitlist:<wallet>`), so the `unique (chain_id, tx_hash)` constraint means a
 * wallet can be credited at most once no matter how often this runs.
 *
 * Scope note (v1): the credited referral total is a snapshot taken at activation.
 * Referrals earned *after* a wallet activates are not topped up by this reader;
 * that reconciliation is a deliberate follow-up, not part of the first cut.
 *
 * Auth: `Authorization: Bearer $CRON_SECRET` (the header Vercel Cron sends on its
 * own), or `X-Cron-Secret`. With no CRON_SECRET set the route refuses everything —
 * a route that writes to the points ledger must stay inert until it is armed.
 * Node runtime: ethers + the service-role client both need it.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Must match the pending-points maths in api/waitlist/route.ts.
const PER_REFERRAL = 50;
const REFERRAL_CAP = 5000;
const X_TASK = 100; // kPoint per completed X task (link, follow, retweet)
const SEASON = 1; // Season 1 — pre-TGE (see point_seasons seed)
const SOURCE = "waitlist";

// How many pending wallets to check per invocation, bounding RPC load. A cron can
// call this repeatedly; ?limit overrides (1..500).
const DEFAULT_LIMIT = 50;

function secretMatches(offered: string | null, expected: string): boolean {
  if (!offered) return false;
  const a = Buffer.from(offered);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    timingSafeEqual(b, b); // keep the compare constant-time w.r.t. a wrong byte
    return false;
  }
  return timingSafeEqual(a, b);
}

function authorised(req: Request, secret: string): boolean {
  const header = req.headers.get("authorization");
  const bearer = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
  if (secretMatches(bearer, secret)) return true;
  return secretMatches(req.headers.get("x-cron-secret"), secret);
}

async function handle(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn(
      "[waitlist/activate] CRON_SECRET is not set — refusing, as configured. " +
        "The activation reader stays inert until it is armed.",
    );
    return Response.json({ error: "not enabled" }, { status: 503 });
  }
  if (!authorised(req, secret))
    return Response.json({ error: "unauthorised" }, { status: 401 });

  if (!isAdminConfigured || !supabaseAdmin)
    return Response.json({ error: "unconfigured" }, { status: 503 });
  const admin = supabaseAdmin;

  const url = new URL(req.url);
  const rawLimit = Number(url.searchParams.get("limit"));
  const limit =
    Number.isInteger(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, 500)
      : DEFAULT_LIMIT;

  // Oldest pending signups first, so the queue drains fairly across runs.
  // x_*_at are the completed X tasks (link/follow/retweet), each worth X_TASK;
  // they are credited in full here regardless of the app-side 24h display hold.
  // (Requires the 20260914030000 X-tasks migration to be applied.)
  const { data: pending, error: pendErr } = await admin
    .from("waitlist")
    .select(
      "wallet, welcome_points, x_linked_at, x_followed_at, x_retweeted_at",
    )
    .is("activated_at", null)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (pendErr)
    return Response.json({ error: "query failed" }, { status: 500 });

  const now = new Date().toISOString();
  let checked = 0;
  let activated = 0;
  const errors: string[] = [];

  for (const row of pending ?? []) {
    const wallet = row.wallet as string;
    checked++;

    let active = false;
    try {
      active = await hasArcActivity(wallet);
    } catch {
      // RPC hiccup: leave the wallet pending, it is picked up next run.
      errors.push(`rpc:${wallet}`);
      continue;
    }
    if (!active) continue;

    // Referral count → capped bonus, snapshotted now.
    const { data: lb } = await admin
      .from("waitlist_leaderboard")
      .select("referrals")
      .eq("wallet", wallet)
      .single();
    const referrals = Number(lb?.referrals ?? 0);
    const referralPoints = Math.min(PER_REFERRAL * referrals, REFERRAL_CAP);
    const xTaskPoints =
      X_TASK *
      [row.x_linked_at, row.x_followed_at, row.x_retweeted_at].filter(Boolean)
        .length;
    const points = Number(row.welcome_points) + referralPoints + xTaskPoints;

    // 1) Canonical credit. Synthetic, stable tx_hash → credited at most once.
    const { error: actErr } = await admin.from("point_actions").insert({
      wallet,
      source_slug: SOURCE,
      season: SEASON,
      tx_hash: `waitlist:${wallet}`,
      chain_id: ARC_MAINNET_CHAIN_ID,
      usd_value: 0,
      multiplier_applied: 1.0,
      points,
      is_agent_initiated: false,
      occurred_at: now,
    });
    // 23505 = already credited by an earlier run; fall through to stamp the flag.
    if (actErr && actErr.code !== "23505") {
      errors.push(`insert:${wallet}`);
      continue;
    }

    // 2) Stamp activated_at so it is not re-scanned (guarded on still-pending).
    const { error: updErr } = await admin
      .from("waitlist")
      .update({ activated_at: now })
      .eq("wallet", wallet)
      .is("activated_at", null);
    if (updErr) {
      errors.push(`stamp:${wallet}`);
      continue;
    }
    activated++;
  }

  return Response.json({
    ok: true,
    scanned: checked,
    activated,
    remainingChecked: (pending ?? []).length,
    limit,
    errors,
  });
}

// POST is the intended trigger; GET is accepted so a plain Vercel Cron entry
// (which issues GET) can drive it too. Both require the secret.
export const POST = handle;
export const GET = handle;
