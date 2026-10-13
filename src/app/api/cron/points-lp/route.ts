import { ethers } from "ethers";
import { providerForChain } from "@/config/provider";
import { retryRpc } from "@/lib/dex/rpcRetry";
import { dexTokenPrices } from "@/lib/swap/dexPrices";
import { supabaseAdmin } from "@/lib/supabase/serverClient";
import {
  positionUsd,
  usdByOwner,
  type RawPosition,
  type PoolState,
} from "@/lib/points/lpSnapshot";
import { accrueInterval, type Snapshot } from "@/lib/points/accrual";
import {
  loadRate,
  loadCampaignMultiplier,
  withCampaignBoost,
} from "@/lib/points/credit";

/**
 * Accrues the time-based `lp` points for liquidity held IN-RANGE in our Arc V3
 * pools.
 *
 * `lp` rewards liquidity that is doing work, per USD per day — not the act of
 * adding it — so this is a snapshot job, not an event indexer: each run reads
 * every open position from our NonfungiblePositionManager, values the in-range
 * ones at the pool's current price, sums per owner, and writes a `point_snapshots`
 * row. Between a wallet's previous snapshot and this one, `accrueInterval` credits
 * min(then, now) × elapsed — the anti-gaming rule that pays only for liquidity
 * demonstrably held across the whole interval, so deposit-before / withdraw-after
 * earns nothing. Epochs land in `point_epochs`, idempotent on (wallet, source,
 * epoch_start); snapshots idempotent on (wallet, source, block_number).
 *
 * The campaign boost (point_campaigns) rides in the rate multiplier, so an `lp`
 * campaign can reward liquidity more heavily than the swap campaign does — the
 * whole point of a liquidity program.
 *
 * Armed like the other crons (`Authorization: Bearer $CRON_SECRET`); inert with
 * no secret or no position manager.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ARC = 5042;
const SEASON = 1;

const POSITION_MANAGER = (
  process.env.POINTS_LP_POSITION_MANAGER ??
  "0x55879358eC7eDA609f2264b0348D1915ee8307e1"
).toLowerCase();
const FACTORY = (
  process.env.POINTS_LP_FACTORY ??
  "0xbB74f2319494461B2591F8fbF126654Dd4c2a649"
).toLowerCase();

/** Operator/treasury wallets whose seeded liquidity is not rewarded. */
const EXCLUDE = new Set(
  (process.env.POINTS_LP_EXCLUDE ?? "")
    .split(",")
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean),
);

/**
 * Prices the DEX router cannot quote, but which we know. Arc's wrapped-native
 * (0x8c6c — the wrapped form of the USDC gas token, and the quote asset of both
 * our pools) is not routable on KyberSwap, so without this every position's
 * wrapped-native leg would value at $0 and LP would be undercounted by ~half. It
 * is $1 by construction (wrapped USDC), matching the pool-seed oracle override.
 */
const KNOWN_USD: Record<string, number> = {
  "0x8c6c0a4c5500c2bc196383b4d85feb7f08a5c75b": 1,
};

/** Cap on positions read per run — bounds RPC load inside the 60s budget. */
const MAX_POSITIONS = Number(process.env.POINTS_LP_MAX_POSITIONS ?? 500);
const DELAY_MS = Number(process.env.POINTS_LP_DELAY_MS ?? 100);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PM_ABI = [
  "function totalSupply() view returns (uint256)",
  "function tokenByIndex(uint256) view returns (uint256)",
  "function ownerOf(uint256) view returns (address)",
  "function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 f0, uint256 f1, uint128 o0, uint128 o1)",
];
const FACTORY_ABI = ["function getPool(address,address,uint24) view returns (address)"];
const POOL_ABI = ["function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 obsIndex, uint16 obsCard, uint16 obsCardNext, uint8 feeProtocol, bool unlocked)"];
const ERC20_DECIMALS_ABI = ["function decimals() view returns (uint8)"];

const decimalsCache = new Map<string, number>();
async function tokenDecimals(provider: ethers.Provider, token: string): Promise<number | null> {
  const key = token.toLowerCase();
  const hit = decimalsCache.get(key);
  if (hit !== undefined) return hit;
  try {
    const c = new ethers.Contract(token, ERC20_DECIMALS_ABI, provider);
    const d = Number(await retryRpc(() => c.decimals()));
    if (!Number.isInteger(d) || d < 0 || d > 36) return null;
    decimalsCache.set(key, d);
    return d;
  } catch {
    return null;
  }
}

function authorised(req: Request, secret: string): boolean {
  const header = req.headers.get("authorization");
  const bearer = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
  return bearer === secret || req.headers.get("x-cron-secret") === secret;
}

/** Latest lp snapshot per wallet, so an interval can be closed against it. */
async function previousSnapshots(): Promise<Map<string, Snapshot>> {
  const out = new Map<string, Snapshot>();
  if (!supabaseAdmin) return out;
  const { data } = await supabaseAdmin
    .from("point_snapshots")
    .select("wallet, usd_value, block_number, taken_at")
    .eq("chain_id", ARC)
    .eq("source_slug", "lp")
    .order("taken_at", { ascending: false })
    .limit(5000);
  for (const r of data ?? []) {
    const w = String(r.wallet).toLowerCase();
    if (out.has(w)) continue; // rows are newest-first, so the first is the latest
    out.set(w, {
      wallet: w,
      chainId: ARC,
      sourceSlug: "lp",
      usdValue: Number(r.usd_value),
      blockNumber: Number(r.block_number),
      takenAt: new Date(r.taken_at),
    });
  }
  return out;
}

async function handle(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return Response.json({ error: "not enabled" }, { status: 503 });
  if (!authorised(req, secret))
    return Response.json({ error: "unauthorised" }, { status: 401 });
  if (!supabaseAdmin)
    return Response.json({ skipped: "no-admin-client" });

  const provider = providerForChain(ARC);
  if (!provider) return Response.json({ skipped: "no-provider" });
  if (!ethers.isAddress(POSITION_MANAGER) || !ethers.isAddress(FACTORY))
    return Response.json({ skipped: "no-position-manager" });

  const pm = new ethers.Contract(POSITION_MANAGER, PM_ABI, provider);
  const factory = new ethers.Contract(FACTORY, FACTORY_ABI, provider);

  // The lp rate, boosted by any active lp campaign (so a liquidity campaign can
  // out-reward the swap campaign).
  const baseRate = await loadRate("lp", SEASON);
  if (!baseRate) return Response.json({ skipped: "no-lp-rate" });
  const nowIso = new Date().toISOString();
  const boost = await loadCampaignMultiplier("lp", SEASON, nowIso);
  const rate = withCampaignBoost(baseRate, boost);

  let positionsRead = 0;
  let snapshotsWritten = 0;
  let epochsWritten = 0;
  let pointsAccrued = 0;
  const skips: Record<string, number> = {};
  const bump = (r: string) => (skips[r] = (skips[r] ?? 0) + 1);

  try {
    const head = await retryRpc(() => provider.getBlockNumber());
    const block = await retryRpc(() => provider.getBlock(head));
    const takenAt = new Date((block?.timestamp ?? Math.floor(Date.now() / 1000)) * 1000);

    const total = Number(await retryRpc(() => pm.totalSupply()));
    const count = Math.min(total, MAX_POSITIONS);

    // Pass 1: read positions + pool prices, collect the tokens to price.
    const positions: Array<{ p: RawPosition; poolAddr: string }> = [];
    const poolStates = new Map<string, PoolState | null>();
    const tokenDecs = new Map<string, number>();

    for (let i = 0; i < count; i++) {
      try {
        const tokenId: bigint = await retryRpc(() => pm.tokenByIndex(i));
        const p = await retryRpc(() => pm.positions(tokenId));
        if ((p.liquidity as bigint) <= 0n) continue;
        const owner = String(await retryRpc(() => pm.ownerOf(tokenId))).toLowerCase();
        if (EXCLUDE.has(owner)) {
          bump("excluded");
          continue;
        }
        const token0 = String(p.token0).toLowerCase();
        const token1 = String(p.token1).toLowerCase();
        const [dec0, dec1] = await Promise.all([
          tokenDecimals(provider, token0),
          tokenDecimals(provider, token1),
        ]);
        if (dec0 === null || dec1 === null) {
          bump("no-decimals");
          continue;
        }
        tokenDecs.set(token0, dec0);
        tokenDecs.set(token1, dec1);

        // Pool state for this pair/fee, once per pool.
        const poolAddr = String(
          await retryRpc(() => factory.getPool(token0, token1, p.fee)),
        ).toLowerCase();
        if (!poolStates.has(poolAddr)) {
          try {
            const pool = new ethers.Contract(poolAddr, POOL_ABI, provider);
            const s = await retryRpc(() => pool.slot0());
            poolStates.set(poolAddr, {
              tick: Number(s.tick),
              sqrtPriceX96: s.sqrtPriceX96 as bigint,
            });
          } catch {
            poolStates.set(poolAddr, null);
          }
        }
        const poolState = poolStates.get(poolAddr);
        if (!poolState) {
          bump("no-pool");
          continue;
        }

        positions.push({
          p: {
            tokenId,
            owner,
            token0,
            token1,
            decimals0: dec0,
            decimals1: dec1,
            tickLower: Number(p.tickLower),
            tickUpper: Number(p.tickUpper),
            liquidity: p.liquidity as bigint,
          },
          poolAddr,
        });
        positionsRead++;
        if (DELAY_MS) await sleep(DELAY_MS);
      } catch {
        bump("read-error");
      }
    }

    // Price every token involved, once.
    const uniqueTokens = [...tokenDecs.entries()].map(([address, decimals]) => ({
      address,
      decimals,
    }));
    const prices = await dexTokenPrices(ARC, uniqueTokens);

    // Pass 2: value each in-range position, aggregate per owner.
    const valued: Array<{ owner: string; usd: number }> = positions.map(({ p, poolAddr }) => {
      const poolState = poolStates.get(poolAddr)!;
      const usd = positionUsd({
        position: p,
        pool: poolState,
        price0: prices[p.token0] ?? KNOWN_USD[p.token0] ?? null,
        price1: prices[p.token1] ?? KNOWN_USD[p.token1] ?? null,
      });
      return { owner: p.owner, usd };
    });
    const currentUsd = usdByOwner(valued);

    // Snapshot + accrue. Union current LP wallets with any that had a prior
    // snapshot, so a wallet that fully withdrew gets a 0-snapshot closing its
    // interval rather than a stale one that would over-credit on re-deposit.
    const prev = await previousSnapshots();
    const wallets = new Set<string>([...currentUsd.keys(), ...prev.keys()]);

    for (const wallet of wallets) {
      const usd = currentUsd.get(wallet) ?? 0;
      const current: Snapshot = {
        wallet,
        chainId: ARC,
        sourceSlug: "lp",
        usdValue: usd,
        blockNumber: head,
        takenAt,
      };

      const previous = prev.get(wallet);
      if (previous) {
        const epoch = accrueInterval(previous, current, rate, SEASON);
        if (epoch) {
          const { error } = await supabaseAdmin.from("point_epochs").insert({
            wallet: epoch.wallet,
            chain_id: epoch.chainId,
            source_slug: epoch.sourceSlug,
            season: epoch.season,
            epoch_start: epoch.epochStart.toISOString(),
            epoch_end: epoch.epochEnd.toISOString(),
            usd_seconds: epoch.usdSeconds,
            points: epoch.points,
          });
          if (!error) {
            epochsWritten++;
            pointsAccrued += epoch.points;
          } else if (error.code !== "23505") {
            bump(`epoch:${error.code}`);
          }
        }
      }

      // Only store a fresh snapshot when there is liquidity now, or there was a
      // prior one to close — never a lone 0 for a wallet we have never seen.
      if (usd > 0 || previous) {
        const { error } = await supabaseAdmin.from("point_snapshots").insert({
          wallet,
          chain_id: ARC,
          source_slug: "lp",
          usd_value: usd,
          block_number: head,
          taken_at: takenAt.toISOString(),
        });
        if (!error) snapshotsWritten++;
        else if (error.code !== "23505") bump(`snapshot:${error.code}`);
      }
    }
  } catch (err) {
    return Response.json(
      { error: "accrual-failed", detail: String((err as Error)?.message ?? err).slice(0, 140) },
      { status: 502 },
    );
  }

  return Response.json({
    positionsRead,
    snapshotsWritten,
    epochsWritten,
    pointsAccrued: Math.round(pointsAccrued),
    boost,
    skips,
  });
}

export const GET = handle;
export const POST = handle;
