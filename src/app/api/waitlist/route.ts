import { verifyMessage } from "ethers";

import { supabaseAdmin, isAdminConfigured } from "@/lib/supabase/serverClient";

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
const REFERRAL_CAP = 5000; // matches the referral source cap in the points schema

/** The exact string the client signs. Rebuilt here from the posted address. */
const joinMessage = (address: string) =>
  `Join the Kaleido Arc waitlist.\nWallet: ${address}`;

const isAddress = (a: unknown): a is string =>
  typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);

const newCode = () => crypto.randomUUID().replace(/-/g, "").slice(0, 8);

async function standing(wallet: string) {
  const admin = supabaseAdmin!;
  const { data: row } = await admin
    .from("waitlist")
    .select("ref_code, welcome_points, activated_at")
    .eq("wallet", wallet)
    .single();
  if (!row) return null;

  // referrals + rank come from the leaderboard view (one wallet, so filter it)
  const { data: lb } = await admin
    .from("waitlist_leaderboard")
    .select("referrals, rank")
    .eq("wallet", wallet)
    .single();

  const referrals = Number(lb?.referrals ?? 0);
  const referralPoints = Math.min(PER_REFERRAL * referrals, REFERRAL_CAP);
  return {
    wallet,
    refCode: row.ref_code as string,
    referrals,
    rank: lb?.rank ?? null,
    pendingPoints: Number(row.welcome_points) + referralPoints,
    welcomePoints: Number(row.welcome_points),
    referralPoints,
    activated: Boolean(row.activated_at),
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

  // Resolve the referrer by code: must exist and not be this wallet.
  let referredBy: string | null = null;
  if (typeof ref === "string" && ref.length > 0) {
    const { data: r } = await admin
      .from("waitlist")
      .select("wallet, ref_code")
      .eq("ref_code", ref)
      .single();
    if (r && r.wallet !== wallet) referredBy = r.ref_code as string;
  }

  // Insert, retrying only on a ref_code collision.
  for (let attempt = 0; attempt < 4; attempt++) {
    const { error } = await admin
      .from("waitlist")
      .insert({ wallet, ref_code: newCode(), referred_by: referredBy });
    if (!error) break;
    // 23505 = unique_violation. On wallet it means a race registered us; return it.
    if (error.code === "23505" && error.message.includes("wallet")) {
      const s = await standing(wallet);
      if (s) return Response.json({ ...s, new: false });
    }
    if (attempt === 3)
      return Response.json({ error: "insert failed" }, { status: 500 });
  }

  const s = await standing(wallet);
  return Response.json({ ...(s ?? { wallet }), new: true });
}
