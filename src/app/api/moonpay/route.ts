import { NextResponse } from "next/server";
import crypto from "crypto";
import { ethers } from "ethers";

/**
 * Builds and signs MoonPay widget URLs for the Buy (on-ramp) and Sell
 * (off-ramp) tabs.
 *
 * This has to be a server route. MoonPay requires the widget URL to be signed
 * with HMAC-SHA256 using the secret key, and that key must never reach the
 * browser — anyone holding it could mint signed URLs against your account.
 * So the client sends what it wants, this route validates it, and only then
 * signs.
 *
 * The signature covers the query string, so validation must happen *before*
 * signing: signing whatever arrives would just authenticate a tampered
 * request. Hence the address check and the currency allowlist below.
 *
 * NOTE: the exact signature has not been verified against MoonPay's sandbox
 * from this environment. The algorithm follows their documented spec —
 * HMAC-SHA256 over the query string including the leading "?", base64, passed
 * as `signature` — but confirm one sandbox transaction end-to-end before
 * going live.
 */

const BUY_BASE =
  process.env.MOONPAY_ENV === "live"
    ? "https://buy.moonpay.com"
    : "https://buy-sandbox.moonpay.com";

const SELL_BASE =
  process.env.MOONPAY_ENV === "live"
    ? "https://sell.moonpay.com"
    : "https://sell-sandbox.moonpay.com";

/**
 * Currency codes we will sign for, keyed by MoonPay's own identifiers.
 *
 * An allowlist rather than passthrough: this endpoint signs on your account's
 * behalf, so it should only ever vouch for assets you actually support.
 */
const ALLOWED_BUY = new Set([
  "eth",
  "eth_base",
  "eth_arbitrum",
  "usdc",
  "usdc_base",
  "usdc_arbitrum",
  "usdt",
  "bnb_bsc",
]);

const ALLOWED_SELL = new Set(["eth", "eth_base", "usdc", "usdc_base", "usdt"]);

function sign(url: string, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(new URL(url).search)
    .digest("base64");
}

export async function POST(req: Request) {
  const apiKey = process.env.NEXT_PUBLIC_MOONPAY_API_KEY;
  const secret = process.env.MOONPAY_SECRET_KEY;

  if (!apiKey || !secret) {
    return NextResponse.json(
      {
        error:
          "MoonPay is not configured. Set NEXT_PUBLIC_MOONPAY_API_KEY and MOONPAY_SECRET_KEY.",
      },
      { status: 503 },
    );
  }

  let body: {
    mode?: string;
    walletAddress?: string;
    currencyCode?: string;
    amount?: string;
    redirectURL?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const mode = body.mode === "sell" ? "sell" : "buy";
  const currencyCode = String(body.currencyCode ?? "").toLowerCase();
  const allowed = mode === "sell" ? ALLOWED_SELL : ALLOWED_BUY;

  if (!allowed.has(currencyCode)) {
    return NextResponse.json(
      {
        error: `Unsupported currency for ${mode}: ${currencyCode || "(none)"}`,
      },
      { status: 400 },
    );
  }

  const walletAddress = String(body.walletAddress ?? "");
  if (!ethers.isAddress(walletAddress)) {
    return NextResponse.json(
      { error: "A valid wallet address is required" },
      { status: 400 },
    );
  }

  const params = new URLSearchParams({ apiKey });

  if (mode === "buy") {
    params.set("currencyCode", currencyCode);
    params.set("walletAddress", walletAddress);
    // Amount is optional — MoonPay shows its own entry step when omitted.
    const amt = Number(body.amount);
    if (Number.isFinite(amt) && amt > 0) {
      params.set("baseCurrencyAmount", String(amt));
    }
  } else {
    params.set("defaultCurrencyCode", currencyCode);
    params.set("refundWalletAddress", walletAddress);
    const amt = Number(body.amount);
    if (Number.isFinite(amt) && amt > 0) {
      params.set("baseCurrencyAmount", String(amt));
    }
  }

  // Only accept a same-origin redirect. An open redirect here would let a
  // caller bounce users to an arbitrary site from a URL that looks like ours.
  if (body.redirectURL) {
    try {
      const origin = new URL(req.url).origin;
      const target = new URL(body.redirectURL, origin);
      if (target.origin === origin)
        params.set("redirectURL", target.toString());
    } catch {
      // Malformed redirect is simply dropped.
    }
  }

  const base = mode === "sell" ? SELL_BASE : BUY_BASE;
  const unsigned = `${base}?${params.toString()}`;
  const signature = sign(unsigned, secret);

  return NextResponse.json({
    url: `${unsigned}&signature=${encodeURIComponent(signature)}`,
    mode,
    sandbox: process.env.MOONPAY_ENV !== "live",
  });
}
