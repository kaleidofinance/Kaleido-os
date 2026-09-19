import { randomInt } from "node:crypto";

import { verifyMessage } from "ethers";

import { supabaseAdmin, isAdminConfigured } from "@/lib/supabase/serverClient";
import { transactionTaskPointsFor } from "@/lib/waitlist/transactionTasks";

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
const PER_REFERRAL = 50;
// Per-task kPoint: comment is 50, the rest 100. Must match X_TASK_POINTS in
// api/waitlist/activate/route.ts (both credit the same set of tasks).
const X_TASK_POINTS = {
  linked: 100,
  followed: 100,
  retweeted: 100,
  commented: 50,
  bitget: 100,
} as const;
// X-task kPoint is held this long before it counts toward the balance — a nudge
// to actually do the task, since the tasks are attested, not API-verified.
const X_HOLD_MS = 5 * 60 * 60 * 1000;

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

/** A single X task's state for the UI: whether it's done, and its 5h hold. */
function xTaskState(at: string | null, now: number) {
  if (!at)
    return { done: false, counted: false, countsAt: null as string | null };
  const countsAtMs = new Date(at).getTime() + X_HOLD_MS;
  return {
    done: true,
    counted: now >= countsAtMs,
    countsAt: new Date(countsAtMs).toISOString(),
  };
}

// Core columns, always present. X-task and transaction columns were added by
// later migrations; the fallback must stay genuinely core-only so an older
// production database can still find an existing wallet instead of attempting a
// duplicate insert and surfacing the misleading generic "insert failed" error.
const BASE_COLS = "ref_code, welcome_points, activated_at";
const TRANSACTION_COLS = "arc_mainnet_tx_at, agent_tx_at, bridge_tx_at";
const X_COLS =
  "x_handle, x_linked_at, x_followed_at, x_retweeted_at, x_commented_at, x_bitget_at";
const LEGACY_COLS = `${BASE_COLS}, ${X_COLS}`;

async function standing(wallet: string) {
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
  const xTasks = {
    linked: xTaskState(row.x_linked_at as string | null, now),
    followed: xTaskState(row.x_followed_at as string | null, now),
    retweeted: xTaskState(row.x_retweeted_at as string | null, now),
    commented: xTaskState(row.x_commented_at as string | null, now),
    bitget: xTaskState(row.x_bitget_at as string | null, now),
  };
  // Each task's kPoint comes from X_TASK_POINTS by key, so comment (50) counts
  // differently from the 100-point tasks. countedX is what's cleared its hold;
  // heldPoints is still counting down.
  const xEntries = Object.entries(xTasks) as [
    keyof typeof X_TASK_POINTS,
    (typeof xTasks)["linked"],
  ][];
  const countedX = xEntries.reduce(
    (sum, [k, s]) => sum + (s.counted ? X_TASK_POINTS[k] : 0),
    0,
  );
  const heldPoints = xEntries.reduce(
    (sum, [k, s]) => sum + (s.done && !s.counted ? X_TASK_POINTS[k] : 0),
    0,
  );

  const welcomePoints = Number(row.welcome_points);
  const transactionPoints = transactionTaskPointsFor(row);
  return {
    wallet,
    refCode: row.ref_code as string,
    referrals,
    rank: lb?.rank ?? null,
    // The displayed balance: welcome + referral + X-task kPoint that has cleared
    // its hold. heldPoints is the X-task kPoint still counting down.
    points: welcomePoints + referralPoints + countedX + transactionPoints,
    heldPoints,
    welcomePoints,
    referralPoints,
    xHandle: (row.x_handle as string | null) ?? null,
    xTasks,
    activated: Boolean(row.activated_at),
    transactionTasks: {
      arcMainnet: { done: Boolean(row.arc_mainnet_tx_at) },
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
  return Response.json(s ?? { registered: false });
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
