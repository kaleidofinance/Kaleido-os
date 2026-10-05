import { NextResponse, type NextRequest } from "next/server";
import { ethers } from "ethers";
import { verifyWalletSignature } from "@/lib/auth/verifyWalletSignature";
import { supabaseAdmin } from "@/lib/supabase/serverClient";
import { normalizeCode, redeemMessage } from "@/lib/rewards/redeem";

export const dynamic = "force-dynamic";

const MESSAGES: Record<string, string> = {
  invalid: "That code isn't valid.",
  expired: "That code has expired.",
  exhausted: "That code has been fully claimed.",
  already: "This wallet already redeemed that code.",
};

/**
 * Redeem a points code. Body: { address, code, signature } over
 * redeemMessage(address, code). Only wallets with a Season 1 balance (active
 * on Arc) can redeem — the bar every credited task has. Validation, the usage
 * cap and the credit run in one locked DB function (redeem_points_code).
 */
export async function POST(request: NextRequest) {
  if (!supabaseAdmin) return NextResponse.json({ error: "not configured" }, { status: 503 });
  const body = (await request.json().catch(() => null)) as
    | { address?: string; code?: string; signature?: string }
    | null;
  const address = body?.address?.trim() ?? "";
  const code = normalizeCode(body?.code ?? "");
  const signature = body?.signature ?? "";
  if (!ethers.isAddress(address) || !code || !signature)
    return NextResponse.json({ error: "Enter a code and sign to redeem." }, { status: 400 });

  const wallet = address.toLowerCase();
  if (!(await verifyWalletSignature(wallet, redeemMessage(wallet, code), signature)))
    return NextResponse.json({ error: "Signature doesn't match this wallet." }, { status: 401 });

  const { data: bal } = await supabaseAdmin
    .from("point_balances")
    .select("wallet")
    .eq("wallet", wallet)
    .eq("season", 1)
    .maybeSingle();
  if (!bal)
    return NextResponse.json(
      { error: "Codes unlock once your wallet is active on Arc." },
      { status: 403 },
    );

  const { data, error } = await supabaseAdmin.rpc("redeem_points_code", {
    p_code: code,
    p_wallet: wallet,
  });
  if (error) {
    console.error("redeem failed:", error);
    return NextResponse.json({ error: "Couldn't redeem — try again." }, { status: 500 });
  }
  const res = data as { status: string; points?: number };
  if (res.status !== "claimed")
    return NextResponse.json({ error: MESSAGES[res.status] ?? "Couldn't redeem." }, { status: 409 });
  return NextResponse.json({ ok: true, points: res.points });
}
