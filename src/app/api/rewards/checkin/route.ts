import { NextResponse, type NextRequest } from "next/server";
import { ethers, verifyMessage } from "ethers";
import { supabaseAdmin } from "@/lib/supabase/serverClient";
import {
  CHECKIN_CHAIN_ID,
  CHECKIN_POINTS,
  CHECKIN_SOURCE,
  STREAK_BONUS,
  STREAK_LENGTH,
  checkinMessage,
  checkinTxHash,
  currentStreak,
  dayOfCheckinHash,
  earnsStreakBonus,
  streakBonusTxHash,
  streakEndingOn,
  utcDay,
} from "@/lib/rewards/checkin";

export const dynamic = "force-dynamic";

const SEASON = 1;

/** The UTC days this wallet has checked in (bonus rows excluded). */
async function checkinDays(wallet: string): Promise<string[] | null> {
  const { data, error } = await supabaseAdmin!
    .from("point_actions")
    .select("tx_hash")
    .eq("wallet", wallet)
    .eq("source_slug", CHECKIN_SOURCE)
    .eq("season", SEASON);
  if (error) return null;
  return (data ?? [])
    .map((r) => dayOfCheckinHash(String(r.tx_hash)))
    .filter((d): d is string => d !== null);
}

/** Has this wallet checked in today, its streak, and total days. */
export async function GET(request: NextRequest) {
  const address = new URL(request.url).searchParams.get("address")?.trim() ?? "";
  if (!ethers.isAddress(address))
    return NextResponse.json({ error: "A wallet address is required." }, { status: 400 });
  if (!supabaseAdmin) return NextResponse.json({ error: "not configured" }, { status: 503 });

  const wallet = address.toLowerCase();
  const days = await checkinDays(wallet);
  if (!days) return NextResponse.json({ error: "Couldn't read check-ins." }, { status: 500 });

  const today = utcDay();
  return NextResponse.json({
    checkedInToday: days.includes(today),
    days: days.length,
    streak: currentStreak(days, today),
    points: CHECKIN_POINTS,
    streakLength: STREAK_LENGTH,
    streakBonus: STREAK_BONUS,
  });
}

/**
 * Check in for today. Body: { address, signature } over checkinMessage(address,
 * today). Only wallets with a Season 1 balance (active on Arc) can check in —
 * the same bar every other credited task has, so fresh wallets can't farm it.
 */
export async function POST(request: NextRequest) {
  if (!supabaseAdmin) return NextResponse.json({ error: "not configured" }, { status: 503 });
  const body = (await request.json().catch(() => null)) as
    | { address?: string; signature?: string }
    | null;
  const address = body?.address?.trim() ?? "";
  const signature = body?.signature ?? "";
  if (!ethers.isAddress(address) || !signature)
    return NextResponse.json({ error: "Address and signature are required." }, { status: 400 });

  const wallet = address.toLowerCase();
  const day = utcDay();
  let recovered = "";
  try {
    recovered = verifyMessage(checkinMessage(wallet, day), signature).toLowerCase();
  } catch {
    /* fall through to the mismatch below */
  }
  if (recovered !== wallet)
    return NextResponse.json({ error: "Signature doesn't match this wallet." }, { status: 401 });

  const { data: bal } = await supabaseAdmin
    .from("point_balances")
    .select("wallet")
    .eq("wallet", wallet)
    .eq("season", SEASON)
    .maybeSingle();
  if (!bal)
    return NextResponse.json(
      { error: "Check-in unlocks once your wallet is active on Arc." },
      { status: 403 },
    );

  const { error } = await supabaseAdmin.from("point_actions").insert({
    wallet,
    source_slug: CHECKIN_SOURCE,
    season: SEASON,
    tx_hash: checkinTxHash(wallet, day),
    chain_id: CHECKIN_CHAIN_ID,
    usd_value: 0,
    multiplier_applied: 1.0,
    points: CHECKIN_POINTS,
    is_agent_initiated: false,
    occurred_at: new Date().toISOString(),
  });
  if (error?.code === "23505")
    return NextResponse.json({ ok: true, alreadyCheckedIn: true });
  if (error) {
    console.error("checkin insert failed:", error);
    return NextResponse.json({ error: "Couldn't check in — try again." }, { status: 500 });
  }

  /* Streak bonus: today completes a run of 7, 14, 21… consecutive days. Its
     own unique tx_hash, so it pays once even if this request is replayed. A
     failure here never undoes the check-in itself. */
  let bonus = 0;
  const days = await checkinDays(wallet);
  const streak = days ? streakEndingOn(days, day) : 0;
  if (earnsStreakBonus(streak)) {
    const { error: bErr } = await supabaseAdmin.from("point_actions").insert({
      wallet,
      source_slug: CHECKIN_SOURCE,
      season: SEASON,
      tx_hash: streakBonusTxHash(wallet, day),
      chain_id: CHECKIN_CHAIN_ID,
      usd_value: 0,
      multiplier_applied: 1.0,
      points: STREAK_BONUS,
      is_agent_initiated: false,
      occurred_at: new Date().toISOString(),
    });
    if (!bErr) bonus = STREAK_BONUS;
  }
  return NextResponse.json({ ok: true, points: CHECKIN_POINTS, bonus, streak });
}
