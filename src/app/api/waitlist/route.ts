import { randomInt } from "node:crypto";

import { verifyMessage } from "ethers";

import { supabaseAdmin, isAdminConfigured } from "@/lib/supabase/serverClient";
import { getClosedXTasks } from "@/lib/waitlist/xCap";
import {
  swapVolumeStanding,
  walletSwapVolumeUsd,
} from "@/lib/waitlist/swapVolume";
import type { Season1Balance, WaitlistStatus } from "@/lib/waitlist/status";
import {
  PER_REFERRAL,
  X_HOLD_MS,
  X_TASK_POINTS,
  eligibleTaskPoints,
  topUpOwed,
  topUpRow,
} from "@/lib/waitlist/eligible";

/**
 * The Arc waitlist API.
 *
 * POST registers a wallet (after verifying it signed the join message) and
 * attributes a referral; GET returns a wallet's standing. Points here are
 * PENDING and live only in the `waitlist` table — see the migration for why they
 * are kept out of the Season 1 ledger until a wallet is active on mainnet.
 *
 * Service-role only: like the points tables, the browser never writes this, it
 * asks this route, which holds the key. ethers needs the Node runtime.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WELCOME = 100;
// PER_REFERRAL, X_TASK_POINTS and X_HOLD_MS come from lib/waitlist/eligible —
// the one task-points table the card, the activation credit and the background
// sync all read, so the card and the leaderboard cannot differ by definition.

// Referral codes: 8 chars from a lowercase, unambiguous base32 alphabet (no
// 0/1/l/o) — short, case-insensitively shareable, and stored lowercase to match
// the lookup below. Deliberately NOT the wallet: a referral link is shared
// publicly, so a random slug keeps the sharer's address out of it. (#189 had
// briefly used the wallet as the code; this restores generated codes, which the
// X-first flow also needs since an X-only user has no wallet to use as an id.)
// 32^8 ≈ 1e12, so the rare collision is caught by the insert retry, not avoided
// by length alone.
const REF_ALPHABET = "23456789abcdefghijkmnpqrstuvwxyz";
const genRefCode = (len = 8): string => {
  let out = "";
  for (let i = 0; i < len; i++)
    out += REF_ALPHABET[randomInt(REF_ALPHABET.length)];
  return out;
};

/** The exact string the client signs. Rebuilt here from the posted address. */
const joinMessage = (address: string) =>
  `Join the Kaleido Pre-Season 1 Arc waitlist.\nWallet: ${address}`;

const isAddress = (a: unknown): a is string =>
  typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);

/** A single X task's state for the UI: whether it's done, its 5h hold, and —
 *  for the capped self-attested tasks — whether the task has closed at the cap
 *  (see lib/waitlist/xCap). `closed` never applies to a task this wallet has
 *  already done; the lock only blocks new claimants. */
function xTaskState(at: string | null, now: number, closed = false) {
  if (!at)
    return { done: false, counted: false, countsAt: null as string | null, closed };
  const countsAtMs = new Date(at).getTime() + X_HOLD_MS;
  return {
    done: true,
    counted: now >= countsAtMs,
    countsAt: new Date(countsAtMs).toISOString(),
    closed: false,
  };
}

/**
 * Activated wallets can earn additional referrals or X tasks after their first
 * waitlist credit. Reconcile the positive delta into the canonical Season 1
 * ledger so the waitlist card and leaderboard cannot drift apart.
 */
async function reconcileWaitlistPoints(
  wallet: string,
  eligible: number,
  activated: boolean,
) {
  const admin = supabaseAdmin!;
  const { data, error } = await admin
    .from("point_actions")
    .select("points")
    .eq("wallet", wallet)
    .eq("source_slug", "waitlist")
    .eq("season", 1);
  if (error) return;
  const credited = (data ?? []).reduce(
    (sum, row) => sum + Number(row.points ?? 0),
    0,
  );
  // Bulk credits can predate activated_at. Once a wallet already has a
  // waitlist ledger row, reconcile later task/referral deltas even if that
  // legacy flag was never stamped. Same rule the background sync applies.
  const delta = topUpOwed({ eligible, credited, activated });
  if (delta <= 0) return;

  await admin
    .from("point_actions")
    .insert(topUpRow(wallet, eligible, delta, new Date().toISOString()));
}

/**
 * The wallet's Season 1 balance — the SAME number the leaderboard shows
 * (point_balances.total, which the leaderboard view ranks on) — split by where
 * it came from. Read with the service role, after the reconcile above, so it
 * already includes any top-up that call just wrote and never lags a replica.
 * Null when the wallet has no Season 1 balance yet (not activated).
 */
async function season1Balance(wallet: string): Promise<Season1Balance | null> {
  const admin = supabaseAdmin!;
  const [{ data: bal }, { data: acts }] = await Promise.all([
    admin
      .from("point_balances")
      .select("total, time_points")
      .eq("wallet", wallet)
      .eq("season", 1)
      .maybeSingle(),
    admin
      .from("point_actions")
      .select("source_slug, points")
      .eq("wallet", wallet)
      .eq("season", 1)
      .in("source_slug", ["waitlist", "swap"]),
  ]);
  if (!bal) return null;
  const sum = (slug: string) =>
    (acts ?? [])
      .filter((a) => a.source_slug === slug)
      .reduce((s, a) => s + Number(a.points ?? 0), 0);
  const total = Number(bal.total ?? 0);
  const tasks = sum("waitlist");
  const trading = sum("swap");
  const liquidity = Number(bal.time_points ?? 0);
  return {
    total,
    tasks,
    trading,
    liquidity,
    other: Math.max(0, total - tasks - trading - liquidity),
  };
}

// Core columns, always present. X-task and transaction columns were added by
// later migrations; the fallback must stay genuinely core-only so an older
// production database can still find an existing wallet instead of attempting a
// duplicate insert and surfacing the misleading generic "insert failed" error.
const BASE_COLS = "ref_code, welcome_points, activated_at";
const TRANSACTION_COLS = "arc_mainnet_tx_at, agent_tx_at, bridge_tx_at";
const X_COLS =
  "x_handle, x_linked_at, x_followed_at, x_retweeted_at, x_commented_at, x_launch_at, x_bitget_at";
const LEGACY_X_COLS =
  "x_handle, x_linked_at, x_followed_at, x_retweeted_at, x_commented_at, x_bitget_at";
const LEGACY_COLS = `${BASE_COLS}, ${LEGACY_X_COLS}`;

async function standing(wallet: string): Promise<WaitlistStatus | null> {
  const admin = supabaseAdmin!;
  let row: Record<string, unknown> | null = null;
  const full = await admin
    .from("waitlist")
    .select(`${BASE_COLS}, ${TRANSACTION_COLS}, ${X_COLS}`)
    .eq("wallet", wallet)
    .single();
  if (!full.error) {
    row = full.data as Record<string, unknown>;
  } else if (full.error.code === "PGRST116") {
    return null; // no such wallet (0 rows), not a schema problem
  } else {
    // A transaction-task migration may be missing while the older X-task
    // columns are already live. Preserve those task points instead of dropping
    // back straight to core columns and making an established wallet look reset.
    const legacy = await admin
      .from("waitlist")
      .select(LEGACY_COLS)
      .eq("wallet", wallet)
      .single();
    if (!legacy.error && legacy.data) {
      row = legacy.data as Record<string, unknown>;
    } else {
      const base = await admin
        .from("waitlist")
        .select(BASE_COLS)
        .eq("wallet", wallet)
        .single();
      if (base.error || !base.data) return null;
      row = base.data as Record<string, unknown>;
    }
  }
  if (!row) return null;

  // referrals + rank come from the leaderboard view (one wallet, so filter it)
  const { data: lb } = await admin
    .from("waitlist_leaderboard")
    .select("referrals, rank")
    .eq("wallet", wallet)
    .single();

  const referrals = Number(lb?.referrals ?? 0);
  const referralPoints = PER_REFERRAL * referrals;

  const now = Date.now();
  // Which capped tasks have closed at the cap, so the UI can grey them out.
  // Only `commented` is capped now; the repost tasks stay open (see xCap.ts).
  const closedX = await getClosedXTasks();
  const xTasks = {
    linked: xTaskState(row.x_linked_at as string | null, now),
    followed: xTaskState(row.x_followed_at as string | null, now),
    retweeted: xTaskState(row.x_retweeted_at as string | null, now),
    commented: xTaskState(row.x_commented_at as string | null, now, closedX.commented),
    launch: xTaskState(row.x_launch_at as string | null, now),
    // Kept in the response for compatibility with an older deployed client;
    // the current UI does not render or claim this disabled task.
    bitget: xTaskState(row.x_bitget_at as string | null, now),
  };
  // Each task's kPoint comes from X_TASK_POINTS by key, so comment (50) counts
  // differently from the 100-point tasks. heldPoints is what is still counting
  // down its hold (the cleared part is inside eligibleTaskPoints).
  const xEntries = Object.entries(xTasks) as [
    keyof typeof X_TASK_POINTS,
    (typeof xTasks)["linked"],
  ][];
  const heldPoints = xEntries.reduce(
    (sum, [k, s]) => sum + (s.done && !s.counted ? X_TASK_POINTS[k] : 0),
    0,
  );

  const welcomePoints = Number(row.welcome_points);
  // Swap-volume milestones, derived live from the wallet's credited `swap`
  // volume. Folded into `eligible` so reconcileWaitlistPoints tops the kPoint up
  // forward-only as the wallet trades higher — no stored column (see swapVolume).
  const swapVolume = swapVolumeStanding(await walletSwapVolumeUsd(admin, wallet));
  const eligiblePoints = eligibleTaskPoints({
    row: row as Parameters<typeof eligibleTaskPoints>[0]["row"],
    referrals,
    swapVolumeUsd: swapVolume.volumeUsd,
    now,
  });
  await reconcileWaitlistPoints(
    wallet,
    eligiblePoints,
    Boolean(row.activated_at),
  );
  const season1 = await season1Balance(wallet);
  return {
    wallet,
    refCode: row.ref_code as string,
    referrals,
    rank: lb?.rank ?? null,
    // The displayed balance: welcome + referral + X-task kPoint that has cleared
    // its hold. heldPoints is the X-task kPoint still counting down.
    points: eligiblePoints,
    heldPoints,
    welcomePoints,
    referralPoints,
    xHandle: (row.x_handle as string | null) ?? null,
    xTasks,
    swapVolume,
    activated: Boolean(row.activated_at),
    season1,
    transactionTasks: {
      // arcMainnet was retired 2026-09-23 (removed from the UI); wallets that
      // already earned it keep the points via transactionTaskPointsFor.
      agent: { done: Boolean(row.agent_tx_at) },
      bridge: { done: Boolean(row.bridge_tx_at) },
    },
  };
}

export async function GET(req: Request) {
  if (!isAdminConfigured || !supabaseAdmin)
    return Response.json({ error: "unconfigured" }, { status: 503 });
  const wallet = new URL(req.url).searchParams.get("wallet");
  if (!isAddress(wallet))
    return Response.json({ error: "bad wallet" }, { status: 400 });
  const s = await standing(wallet.toLowerCase());
  if (s) return Response.json(s);

  // `standing()` intentionally collapses the legacy-column fallbacks into a
  // null result, but a database outage must not look like a new wallet. Probe
  // the core row once more so the client can distinguish “not registered” from
  // “could not read the waitlist” and never offers an opt-in that will fail.
  const { data, error } = await supabaseAdmin
    .from("waitlist")
    .select("wallet")
    .eq("wallet", wallet.toLowerCase())
    .maybeSingle();
  if (error)
    return Response.json(
      { error: "Could not read waitlist status" },
      { status: 503 },
    );
  return Response.json(
    data ? { error: "Could not load waitlist status" } : { registered: false },
  );
}

export async function POST(req: Request) {
  if (!isAdminConfigured || !supabaseAdmin)
    return Response.json({ error: "unconfigured" }, { status: 503 });

  let body: { address?: string; signature?: string; ref?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad body" }, { status: 400 });
  }
  const { address, signature, ref } = body;
  if (!isAddress(address) || typeof signature !== "string")
    return Response.json({ error: "bad input" }, { status: 400 });

  // Prove control of the wallet: the signature must recover to the address.
  let recovered: string;
  try {
    recovered = verifyMessage(joinMessage(address), signature);
  } catch {
    return Response.json({ error: "bad signature" }, { status: 401 });
  }
  if (recovered.toLowerCase() !== address.toLowerCase())
    return Response.json({ error: "signature mismatch" }, { status: 401 });

  const wallet = address.toLowerCase();
  const admin = supabaseAdmin;

  // Already registered → idempotent, return current standing unchanged.
  const existing = await standing(wallet);
  if (existing) return Response.json({ ...existing, new: false });

  // Resolve the referrer. `ref` is the referrer's ref_code — a generated slug on
  // current links, or a wallet on links shared during the brief #189 window when
  // the wallet was the code; both are stored as ref_code and resolve here.
  // Lowercased so either form matches the stored (lowercased) value. Must exist
  // and not be this wallet.
  let referredBy: string | null = null;
  if (typeof ref === "string" && ref.trim().length > 0) {
    const { data: r } = await admin
      .from("waitlist")
      .select("wallet, ref_code")
      .eq("ref_code", ref.trim().toLowerCase())
      .single();
    if (r && r.wallet !== wallet) referredBy = r.ref_code as string;
  }

  // Insert with a freshly minted code. A 23505 is either a slug collision (remint
  // and retry) or a concurrent same-wallet insert (the wallet PK) — in the latter
  // the wallet now exists, so return its standing. The existence check up top makes
  // the wallet race rare; the slug retry makes a code collision a non-event.
  let insertedOk = false;
  for (let attempt = 0; attempt < 6; attempt++) {
    const { error: insErr } = await admin
      .from("waitlist")
      .insert({ wallet, ref_code: genRefCode(), referred_by: referredBy });
    if (!insErr) {
      insertedOk = true;
      break;
    }
    if (insErr.code !== "23505")
      return Response.json({ error: "insert failed" }, { status: 500 });
    const raced = await standing(wallet);
    if (raced) return Response.json({ ...raced, new: false });
  }
  if (!insertedOk)
    return Response.json({ error: "insert failed" }, { status: 500 });

  const s = await standing(wallet);
  return Response.json({ ...(s ?? { wallet }), new: true });
}
