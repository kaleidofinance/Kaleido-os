import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runLiquidations } from "@/lib/keeper/liquidator";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/* A read of each chain's serviced loans, then one simulate + send + bounded
   confirmation per liquidation. The default limit keeps a run inside this. */
export const maxDuration = 60;

/**
 * GET|POST /api/keeper/liquidate — liquidate overdue or unhealthy lending loans
 * with the keeper key. The reasoning lives in `lib/keeper/liquidator.ts`.
 *
 * The same door as `/api/keeper/push` and `/api/keeper/cctp`:
 * `Authorization: Bearer $CRON_SECRET` (or `X-Keeper-Secret`), compared with
 * `timingSafeEqual`, never accepted from the query string. With no CRON_SECRET
 * set it refuses everything — this route spends the keeper's gas.
 *
 * Parameters:
 *   ?chainId=N     one or more (repeated or comma-separated); default: every
 *                  chain with a lending diamond.
 *   ?dryRun=1      simulate every candidate and report what WOULD be liquidated.
 *   ?limit=N       liquidations per chain per run (1–25, default 5).
 *
 * The clock is scripts/keeper-cron/keeper-cron-worker.js on its two-minute
 * trigger: a position can go from healthy to underwater within one price move,
 * and every minute it waits the collateral covers less of the lender's debt.
 */

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

function secretMatches(offered: string | null, expected: string): boolean {
  if (!offered) return false;
  const a = Buffer.from(offered);
  const b = Buffer.from(expected);
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

function parseChainIds(params: URLSearchParams): number[] | { error: string } {
  const raw = params.getAll("chainId").flatMap((v) => v.split(","));
  const ids: number[] = [];
  for (const r of raw) {
    const t = r.trim();
    if (!t) continue;
    const n = Number(t);
    if (!Number.isInteger(n) || n <= 0) return { error: `Bad chainId: ${t}` };
    ids.push(n);
  }
  return ids;
}

async function handle(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.warn("[keeper/liquidate] CRON_SECRET is not set — refusing, as configured.");
    return json({ error: "The keeper route is not enabled." }, 503);
  }
  if (!authorised(request, secret)) return json({ error: "Unauthorized" }, 401);

  const params = request.nextUrl.searchParams;
  const chainIds = parseChainIds(params);
  if (!Array.isArray(chainIds)) return json(chainIds, 400);
  const dryRun = ["1", "true"].includes((params.get("dryRun") ?? "").toLowerCase());
  const limitRaw = Number(params.get("limit") ?? "5");
  const limit = Number.isInteger(limitRaw) ? limitRaw : 5;

  const startedAt = Date.now();
  const result = await runLiquidations({ chainIds, dryRun, limit });
  const ms = Date.now() - startedAt;
  const line =
    `[keeper/liquidate] ${dryRun ? "dry-run " : ""}chains=${result.chains.length} ` +
    `liquidated=${result.liquidated} wouldLiquidate=${result.wouldLiquidate} ` +
    `failed=${result.failed} ${ms}ms` + (result.error ? ` error=${result.error}` : "");
  (result.ok ? console.info : console.error)(line);
  for (const c of result.chains) {
    if (c.error) console.warn(`[keeper/liquidate] chain ${c.chainId}: ${c.error}`);
    for (const f of c.failed) console.warn(`[keeper/liquidate] chain ${c.chainId} #${f.requestId}: ${f.error}`);
  }
  // 503 only when the keeper itself cannot run; a chain read error is reported per chain.
  return json({ ...result, ms }, result.keeper ? 200 : 503);
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
