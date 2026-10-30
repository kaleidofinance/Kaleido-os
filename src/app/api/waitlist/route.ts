import { randomInt } from "node:crypto";

import { verifyWalletSignature } from "@/lib/auth/verifyWalletSignature";

import { supabaseAdmin, isAdminConfigured } from "@/lib/supabase/serverClient";
import { X_TASK_CAPS } from "@/lib/waitlist/xCap";
import { readRewardFacts } from "@/lib/waitlist/readFacts";
import { swapVolumeStanding, taskVolumeTotal } from "@/lib/waitlist/swapVolume";
import type { WaitlistStatus } from "@/lib/waitlist/status";
import {
  PER_REFERRAL,
  X_HOLD_MS,
  X_TASK_POINTS,
  eligibleTaskPoints,
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
    return {
      done: false,
      counted: false,
      countsAt: null as string | null,
      closed,
    };
  const countsAtMs = new Date(at).getTime() + X_HOLD_MS;
  return {
    done: true,
    counted: now >= countsAtMs,
    countsAt: new Date(countsAtMs).toISOString(),
    closed: false,
  };
}

async function standing(wallet: string): Promise<WaitlistStatus | null> {
  const facts = await readRewardFacts(supabaseAdmin!, wallet);
  if (!facts) return null;
  const { row, referral: lb } = facts;

  const referrals = Number(lb?.referrals ?? 0);
  const activeReferrals = Number(lb?.active_referrals ?? 0);
  const pendingReferrals = Number(lb?.pending_referrals ?? 0);
  const referralPoints = PER_REFERRAL * activeReferrals;
  const pendingReferralPoints = PER_REFERRAL * pendingReferrals;

  const now = Date.now();
  const closedX = Object.fromEntries(
    Object.entries(X_TASK_CAPS).map(([key, cap]) => [
      key,
      Number(facts.taskCounts[key] ?? 0) >= cap,
    ]),
  );
  const xTasks = {
    linked: xTaskState(row.x_linked_at as string | null, now),
    followed: xTaskState(row.x_followed_at as string | null, now),
    retweeted: xTaskState(row.x_retweeted_at as string | null, now),
    commented: xTaskState(
      row.x_commented_at as string | null,
      now,
      closedX.commented,
    ),
    launch: xTaskState(row.x_launch_at as string | null, now),
    llama: xTaskState(row.x_llama_at as string | null, now),
    argus: xTaskState(row.x_argus_at as string | null, now, closedX.argus),
    argus2: xTaskState(row.x_argus2_at as string | null, now, closedX.argus2),
    absexit: xTaskState(
      row.x_absexit_at as string | null,
      now,
      closedX.absexit,
    ),
    argusIntegration: xTaskState(
      row.x_argus_integration_at as string | null,
      now,
      closedX.argusIntegration,
    ),
    robinhoodIntegration: xTaskState(
      row.x_robinhood_integration_at as string | null,
      now,
      closedX.robinhoodIntegration,
    ),
    robinhoodIntegrationComment: xTaskState(
      row.x_robinhood_integration_comment_at as string | null,
      now,
      closedX.robinhoodIntegrationComment,
    ),
    lucaModelIntegration: xTaskState(
      row.x_luca_model_integration_at as string | null,
      now,
      closedX.lucaModelIntegration,
    ),
    lucaModelIntegrationComment: xTaskState(
      row.x_luca_model_integration_comment_at as string | null,
      now,
      closedX.lucaModelIntegrationComment,
    ),
    argusIntegrationComment: xTaskState(
      row.x_argus_integration_comment_at as string | null,
      now,
      closedX.argusIntegrationComment,
    ),
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
  // The shared snapshot includes all ledger swaps and latest held collateral.
  // The background job credits new volume tiers without blocking this read.
  const swapVolume = swapVolumeStanding(
    taskVolumeTotal(facts.volume?.swaps_usd, facts.volume?.collateral_usd),
  );
  const eligiblePoints = eligibleTaskPoints({
    row: row as Parameters<typeof eligibleTaskPoints>[0]["row"],
    referrals: activeReferrals,
    swapVolumeUsd: swapVolume.volumeUsd,
    now,
  });
  // The existing activation/sync clock credits matured tasks. Page reads never
  // scan or write the ledger; the RPC reads its current settled balance.
  const season1 = facts.season1;
  return {
    asOf: facts.asOf,
    stale: Date.now() - Date.parse(facts.asOf) > 180_000,
    wallet,
    refCode: row.ref_code as string,
    referrals,
    activeReferrals,
    pendingReferrals,
    rank: lb?.rank ?? null,
    // The displayed balance: welcome + referral + X-task kPoint that has cleared
    // its hold. heldPoints is the X-task kPoint still counting down.
    points: eligiblePoints,
    heldPoints,
    welcomePoints,
    referralPoints,
    pendingReferralPoints,
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
  let s: WaitlistStatus | null;
  try {
    s = await standing(wallet.toLowerCase());
  } catch (error) {
    console.error("[waitlist] rewards read failed:", error);
    return Response.json(
      { error: "Rewards data is temporarily unavailable; please retry" },
      {
        status: 503,
        headers: { "Retry-After": "10", "Cache-Control": "no-store" },
      },
    );
  }
  if (s) return Response.json(s, { headers: { "Cache-Control": "no-store" } });

  return Response.json(
    { registered: false },
    { headers: { "Cache-Control": "no-store" } },
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
  if (!(await verifyWalletSignature(address, joinMessage(address), signature)))
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
