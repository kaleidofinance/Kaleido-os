import { timingSafeEqual } from "node:crypto";

import { hasArcActivity, ARC_MAINNET_CHAIN_ID } from "@/lib/waitlist/arcMainnet";
import { supabaseAdmin, isAdminConfigured } from "@/lib/supabase/serverClient";
import {
  swapVolumePoints,
  walletSwapVolumeUsd,
} from "@/lib/waitlist/swapVolume";

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
// The scan probes each pending wallet on Arc mainnet; with bounded-
// concurrency probing (see below) even a 500-wallet batch finishes well
// inside this budget, and 60s is the Hobby-plan ceiling the keeper route
// already relies on.
export const maxDuration = 60;

// Must match the pending-points maths in api/waitlist/route.ts.
const PER_REFERRAL = 50;
// Per-task kPoint: comment is 50, the rest 100. Must match X_TASK_POINTS in
// api/waitlist/route.ts.
const X_TASK_POINTS = {
  linked: 100,
  followed: 100,
  retweeted: 100,
  commented: 50,
  launch: 100,
  bitget: 100,
} as const;
const ARC_TX_POINTS = 300;
const AGENT_TX_POINTS = 500;
const BRIDGE_TX_POINTS = 500;
const SEASON = 1; // Season 1 — pre-TGE (see point_seasons seed)
const SOURCE = "waitlist";

// How many pending wallets to check per invocation, bounding RPC load. A cron can
// call this repeatedly; ?limit overrides (1..500).
const DEFAULT_LIMIT = 50;

// How many Arc-mainnet nonce probes to run at once. hasArcActivity is a
// single stateless eth_getTransactionCount, safe to run concurrently; this
// bounds the load on the (unofficial) Arc RPC while letting a run clear a
// large batch inside maxDuration instead of one round-trip at a time. Kept low
// because rpc.mainnet.arc.io rate-limits under load — hasArcActivity retries a
// throttled probe (retryRpc), but a gentler concurrency means fewer throttles to
// retry in the first place, which keeps the batch inside maxDuration.
const PROBE_CONCURRENCY = Number(process.env.WAITLIST_PROBE_CONCURRENCY ?? 5);

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
  // Trimmed to match the trimmed bearer — a trailing newline in the Vercel env
  // var would otherwise fail the length check and 401 forever.
  const secret = process.env.CRON_SECRET?.trim();
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

  // Least-recently-checked first (nulls — never probed — ahead of everything),
  // then oldest signup. This rotates the scan through the WHOLE pending set:
  // stamping last_checked_at on every probed wallet (below) means a run never
  // re-checks the same unqualified front of the queue while deeper wallets that
  // have actually transacted wait unseen. Requires 20260916030000.
  // x_*_at are the completed X tasks (link/follow/retweet/comment), each worth
  // its X_TASK_POINTS value; credited in full here regardless of the app-side 5h
  // display hold. (Requires the X-tasks migrations to be applied.)
  const { data: pending, error: pendErr } = await admin
    .from("waitlist")
    .select(
      "wallet, welcome_points, arc_mainnet_tx_at, agent_tx_at, bridge_tx_at, x_linked_at, x_followed_at, x_retweeted_at, x_commented_at, x_launch_at, x_bitget_at",
    )
    .is("activated_at", null)
    // X-verified only, keyed on x_user_id (the UNIQUE column — one real X account
    // per wallet), NOT x_linked_at: a partial/failed OAuth can stamp x_linked_at
    // without ever capturing a real account, which over-counts. Until the
    // on-chain transaction task launches, linking a real X account is the sole
    // task a wallet can complete and have verified, so it is the credit gate — a
    // bare gasless signup has earned nothing provable. Matches the referral gate
    // in waitlist_leaderboard (20260917000000). Widen when the transaction task
    // ships and Arc activity becomes a qualifying task too.
    .not("x_user_id", "is", null)
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true })
    .limit(limit);
  if (pendErr)
    return Response.json({ error: "query failed" }, { status: 500 });

  const rows = pending ?? [];
  const now = new Date().toISOString();
  let activated = 0;
  const errors: string[] = [];

  // Phase 1 — probe every wallet in the batch on Arc mainnet, PROBE_CONCURRENCY
  // at a time. hasArcActivity is a stateless read, so concurrency just overlaps
  // round-trips; the batch either resolves well inside maxDuration or the run
  // ends here having stamped nothing, which is safe — the same rows come back
  // next run.
  const probed: { active: boolean; errored: boolean }[] = new Array(rows.length);
  let cursor = 0;
  async function probeWorker() {
    for (;;) {
      const i = cursor++;
      if (i >= rows.length) return;
      try {
        probed[i] = {
          active: await hasArcActivity(rows[i].wallet as string),
          errored: false,
        };
      } catch {
        probed[i] = { active: false, errored: true };
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(PROBE_CONCURRENCY, rows.length) }, probeWorker),
  );

  // Phase 2 — credit the wallets that have transacted. Sequential: these are the
  // few that qualify and each is a small write. A genuine insert failure is left
  // UNstamped so it is retried next run rather than rotated to the back.
  const toRotate: string[] = []; // probed but not activated → stamp to advance the scan
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const wallet = row.wallet as string;
    const p = probed[i];
    if (p.errored) {
      // RPC hiccup: record it, but still rotate — one bad wallet must not wedge
      // the front of the queue; it is retried on the next rotation.
      errors.push(`rpc:${wallet}`);
      toRotate.push(wallet);
      continue;
    }
    if (!p.active) {
      toRotate.push(wallet);
      continue;
    }

    // Referral count → capped bonus, snapshotted now.
    const { data: lb } = await admin
      .from("waitlist_leaderboard")
      .select("referrals")
      .eq("wallet", wallet)
      .single();
    const referrals = Number(lb?.referrals ?? 0);
    const referralPoints = PER_REFERRAL * referrals;
    const xTaskPoints =
      (row.x_linked_at ? X_TASK_POINTS.linked : 0) +
      (row.x_followed_at ? X_TASK_POINTS.followed : 0) +
      (row.x_retweeted_at ? X_TASK_POINTS.retweeted : 0) +
      (row.x_commented_at ? X_TASK_POINTS.commented : 0) +
      (row.x_launch_at ? X_TASK_POINTS.launch : 0) +
      (row.x_bitget_at ? X_TASK_POINTS.bitget : 0) +
      (row.arc_mainnet_tx_at ? ARC_TX_POINTS : 0) +
      (row.agent_tx_at ? AGENT_TX_POINTS : 0) +
      (row.bridge_tx_at ? BRIDGE_TX_POINTS : 0);
    // Swap-volume milestone (highest reached tier). Derived from the wallet's
    // credited `swap` volume, matching standing() in api/waitlist/route.ts.
    const swapPoints = swapVolumePoints(await walletSwapVolumeUsd(admin, wallet));
    const points =
      Number(row.welcome_points) + referralPoints + xTaskPoints + swapPoints;

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

    // 2) Stamp activated_at (and last_checked_at) so it leaves the pending set.
    const { error: updErr } = await admin
      .from("waitlist")
      .update({ activated_at: now, last_checked_at: now })
      .eq("wallet", wallet)
      .is("activated_at", null);
    if (updErr) {
      errors.push(`stamp:${wallet}`);
      continue;
    }
    activated++;
  }

  // Phase 3 — rotate every probed-but-not-activated wallet to the back by
  // stamping last_checked_at in one write, so the next run advances to the
  // least-recently-checked wallets instead of re-probing this same front.
  if (toRotate.length > 0) {
    const { error: rotErr } = await admin
      .from("waitlist")
      .update({ last_checked_at: now })
      .in("wallet", toRotate)
      .is("activated_at", null);
    if (rotErr) errors.push(`rotate:${rotErr.code ?? "?"}`);
  }

  const checked = rows.length;

  return Response.json({
    ok: true,
    scanned: checked,
    activated,
    remainingChecked: rows.length,
    limit,
    errors,
  });
}

// POST is the intended trigger; GET is accepted so a plain Vercel Cron entry
// (which issues GET) can drive it too. Both require the secret.
export const POST = handle;
export const GET = handle;
