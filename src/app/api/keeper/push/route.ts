import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

import {
  pushSelfHostedFeeds,
  SELF_HOSTING_CANDIDATE_CHAINS,
} from "@/lib/keeper/pushFeeds";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/**
 * A push is several RPC round trips plus an outbound price fetch plus a receipt.
 * The platform clamps this to whatever the plan allows, so it is a ceiling asked
 * for rather than one granted — a run that needs longer than the plan permits
 * should be narrowed with `?chainId=`, not left to be cut off mid-transaction.
 */
export const maxDuration = 60;

/**
 * GET|POST /api/keeper/push — publish fresh prices to the feeds we run ourselves.
 *
 * The scheduler-facing half of `lib/keeper/pushFeeds.ts`. All the reasoning about
 * what gets pushed, what does not, and why lives there; this file is the door.
 *
 * ── Why an HTTP endpoint for a keeper ───────────────────────────────────────
 *
 * Because the committed GitHub Actions keeper is correct and still cannot hold
 * the bound. Measured 2026-09-01: a 20-minute cron delivered 47 runs in 152
 * hours, one per ~3.2 h, against a 3600s bound on Robinhood's ETH feed. GitHub
 * drops scheduled runs under load and does not make them up. Nothing in the
 * script can fix that, so the fix is to let something else call it — and once
 * the push is an HTTP request, "something else" can be a platform cron, a free
 * third-party pinger, a self-hosted cron, or all three at once, without the
 * push logic knowing which.
 *
 * The two keepers do not conflict. A second push arriving seconds after the
 * first is refused by the feed itself (`observedAt` must be strictly newer than
 * the stored answer), and this checks that off-chain before spending gas, so the
 * overlap costs a read rather than a transaction.
 *
 * ── Authentication, which is not optional here ──────────────────────────────
 *
 * This route spends the keeper's gas. Left open, anyone could drain it by
 * calling in a loop — not by stealing anything, just by making it work until
 * the balance is gone, which is exactly the outage it exists to prevent.
 *
 * So: `Authorization: Bearer $CRON_SECRET`, which is the header Vercel Cron
 * sends of its own accord when CRON_SECRET is set, or `X-Keeper-Secret` for a
 * scheduler that reserves the Authorization header for its own use. Compared with
 * `timingSafeEqual`, and never accepted from the query string — a secret in a URL
 * lands in access logs, referrers and browser history.
 *
 * With no CRON_SECRET set the route refuses everything. That is the deliberate
 * default rather than a misconfiguration: unset means "this has not been armed",
 * and a spending endpoint that runs while unarmed is the one failure mode there
 * is no recovering from. `/api/gas-drip` makes the same choice about its own key.
 *
 * ── Parameters ──────────────────────────────────────────────────────────────
 *
 *   ?chainId=46630      one chain, or repeated / comma-separated for several.
 *                       Default: every chain in the registry whose oracle is an
 *                       AggregatorPriceOracle. Narrowing is a latency choice, not
 *                       a safety one — a chain with no feed of ours is a few reads
 *                       and no transaction.
 *   ?symbols=ETH,USDC   limit to feeds carrying these symbols.
 *   ?onlyStale=1        push only feeds already over their bound. Off by default:
 *                       a scheduler wants the feed never to go stale, and waiting
 *                       until it has means it is stale for part of every interval.
 *   ?dryRun=1           do every read and check every guard, send no transaction.
 *                       What a new scheduler should be pointed at first.
 *
 * ── The status code is for the monitor ──────────────────────────────────────
 *
 * 200 when nothing failed, 500 when something did, mirroring the hardhat
 * keeper's exit code. A cron monitor watches the status and a human reads the
 * body, so "every feed skipped because the source published nothing new" is a
 * 200 — that run was a success that cost no gas.
 */

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

/** Constant-time compare that does not leak length through an early return. */
function secretMatches(offered: string | null, expected: string): boolean {
  if (!offered) return false;
  const a = Buffer.from(offered);
  const b = Buffer.from(expected);
  /* timingSafeEqual throws on a length mismatch, so equal-length buffers are
     compared and the lengths themselves are compared separately. A wrong length
     is already distinguishable by anyone who can time the request; a wrong byte
     must not be. */
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

function authorised(request: NextRequest, secret: string): boolean {
  const header = request.headers.get("authorization");
  const bearer = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
  if (secretMatches(bearer, secret)) return true;
  return secretMatches(request.headers.get("x-keeper-secret"), secret);
}

/** `?chainId=46630&chainId=97` and `?chainId=46630,97` both work. */
function parseChainIds(request: NextRequest): number[] | "invalid" {
  const raw = request.nextUrl.searchParams.getAll("chainId").join(",");
  if (!raw.trim()) return [];

  const out: number[] = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n <= 0) return "invalid";
    out.push(n);
  }
  return out;
}

async function handle(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn(
      "[keeper/push] CRON_SECRET is not set — refusing, as configured. The " +
        "keeper route stays inert until it is armed.",
    );
    return json({ error: "The keeper route is not enabled." }, 503);
  }
  if (!authorised(request, secret)) {
    /* No detail: an unauthenticated caller learns nothing about which header was
       wrong, or whether a keeper key exists. */
    return json({ error: "Unauthorized." }, 401);
  }

  const chainIds = parseChainIds(request);
  if (chainIds === "invalid") {
    return json({ error: "chainId must be one or more positive integers." }, 400);
  }
  const unknown = chainIds.filter(
    (id) => !SELF_HOSTING_CANDIDATE_CHAINS.includes(id),
  );
  if (unknown.length > 0) {
    /* Named rather than silently dropped: asking for a chain that cannot be
       pushed and getting a clean 200 with an empty report is how a scheduler ends
       up pointed at nothing for a week. */
    return json(
      {
        error: `no AggregatorPriceOracle is deployed on chain(s) ${unknown.join(", ")}`,
        pushable: SELF_HOSTING_CANDIDATE_CHAINS,
      },
      400,
    );
  }

  const symbols = (request.nextUrl.searchParams.get("symbols") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const onlyStale = request.nextUrl.searchParams.get("onlyStale") === "1";
  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";

  try {
    const result = await pushSelfHostedFeeds({
      chainIds,
      symbols,
      pushAll: !onlyStale,
      dryRun,
    });

    /* One line per run in the platform's log, because the response body goes to
       whatever called this and a cron's response body is usually discarded. */
    console.info(
      `[keeper/push] ${result.pushed} pushed, ${result.wouldPush} would-push, ` +
        `${result.failed} failed across ` +
        result.chains.map((c) => `${c.network}:${c.status}`).join(" "),
    );

    return json(result, result.failed > 0 ? 500 : 200);
  } catch (error) {
    /* pushSelfHostedFeeds reports failure as a status rather than throwing, so
       reaching here means something outside the per-chain work broke. */
    console.error("[keeper/push] failed", error);
    return json({ error: "The keeper run could not be completed." }, 500);
  }
}

/** Vercel Cron issues a GET. */
export async function GET(request: NextRequest) {
  return handle(request);
}

/** Most third-party pingers and a manual curl issue a POST. */
export async function POST(request: NextRequest) {
  return handle(request);
}
