import { formatUnits, parseUnits } from "ethers";

import { READ_ONLY_CHAIN_ID } from "@/config/provider";
import type { IToken, ITradingPair } from "@/constants/types/dex";
import type { PoolTxn, PoolTxnKind } from "@/hooks/dex/usePoolTransactions";

/**
 * Demo V2 pools, shaped exactly as `usePoolData` returns them.
 *
 * ADDRESSES ARE DELIBERATELY FAKE, and lowercase. Nothing is deployed, so there
 * is no real pair to name. Lowercase because `ethers.getAddress` accepts an
 * unchecksummed address and throws on a mixed-case one whose checksum does not
 * match — a hand-typed checksum is the one part of a fixture that can crash a
 * page. An explorer link built from these will not resolve, which is correct:
 * there is nothing to resolve.
 *
 * TOKEN ORDER IS NOT COSMETIC. `KaleidoSwapPair` sorts its legs, so token0's
 * address is always the lower of the two. The suffixes below are picked so that
 * lexicographic order gives each pair the orientation a reader expects
 * (KLD/USDC, not USDC/KLD), and every `reserves` entry follows that same order.
 *
 * THE FIGURES ARE INTERNALLY CONSISTENT, because the table derives one from
 * another and a reader comparing two columns will notice if they disagree:
 *
 *   price     = reserve1 / reserve0, in display units    (usePoolData.ts:272)
 *   value0/1  = that leg's reserve × its spot price       (usePoolData.ts:296)
 *   liquidity = value0 + value1, or whichever is known × 2
 *   fees24h   = volume24h × feeBps / 10000               (usePoolData.ts:372)
 *   apr       = fees24h × 365 / liquidity × 100          (usePoolData.ts:379)
 *
 * Prices assumed: WETH 3,400, WBTC 62,000, and 1.00 for USDC/USDT/DAI/kfUSD.
 * KLD and stKLD are unpriced, which is not a gap in the fixture — KLD has no
 * market before TGE, and `lib/market/spot.ts` documents an absent symbol as a
 * normal condition a caller must render as unknown. So the KLD/stKLD pool below
 * reports null liquidity, volume, fees and APR while still reporting a price:
 * the pool knows its own ratio without anyone knowing what either leg is worth.
 *
 * `volumeWindowSec` is identical on every row on purpose. The block window is
 * read once per refresh and shared by every pair (usePoolData.ts:227), so a
 * per-pool value is a shape the real hook cannot produce.
 */

/** `0xc0de…000N`. See the note above on why these are fake and lowercase. */
const tokenAddress = (n: number) =>
  `0x${"c0de".repeat(9)}${String(n).padStart(4, "0")}`;

/** `0xda1a…000N`, kept visibly distinct from the token addresses. */
const pairAddress = (n: number) =>
  `0x${"da1a".repeat(9)}${String(n).padStart(4, "0")}`;

/*
 * `verified: true` matches what the real hook produces for a registered token:
 * usePoolData resolves each leg through `chainTokenByAddress` first, and only
 * falls back to an on-chain `symbol()`/`decimals()` read — which is where
 * `verified: false` comes from — for a token the registry does not know.
 *
 * No `chainId`. It is optional on IToken, and pinning one here would go stale
 * the moment the read chain moves, which is an env value now.
 */
const token = (
  n: number,
  symbol: string,
  name: string,
  decimals: number,
): IToken => ({
  address: tokenAddress(n),
  name,
  symbol,
  decimals,
  verified: true,
});

/**
 * The demo pools' legs.
 *
 * Suffixes encode the ordering constraint from the header: KLD < WBTC < kfUSD <
 * USDT < DAI < WETH < USDC < stKLD, which is what makes every pair below read
 * the right way round.
 *
 * Every symbol here draws a real logo — see the ICONS/ALIASES/RASTER tables in
 * components/v2/TokenIcon.tsx — so no demo row renders the three-letter
 * monogram that stands in for an unknown asset. That is a deliberate choice
 * about legibility, not a claim that the monogram path is broken.
 */
export const MOCK_TOKENS = {
  KLD: token(1, "KLD", "Kaleido", 18),
  WBTC: token(2, "WBTC", "Wrapped BTC", 8),
  kfUSD: token(3, "kfUSD", "Kaleido Fixed USD", 18),
  USDT: token(4, "USDT", "Tether USD", 6),
  DAI: token(5, "DAI", "Dai Stablecoin", 18),
  WETH: token(6, "WETH", "Wrapped Ether", 18),
  USDC: token(7, "USDC", "USD Coin", 6),
  stKLD: token(8, "stKLD", "Staked KLD", 18),
};

/** Base units, as the pair contract holds them. */
const raw = (amount: string, decimals: number) =>
  parseUnits(amount, decimals).toString();

/** Every pool shares one sampled window — 2h 36m, well over the 600s floor. */
const WINDOW_SEC = 9_413;

/**
 * Every fixture is a V2 pair on the read chain, so `version` and `chainId` are
 * stamped once at the bottom rather than repeated eight times.
 *
 * `version` is not V2 because V3 is unrepresentable — because these eight *are* V2
 * pairs: each one carries `reserves` that a curve is computed from and a
 * `totalSupply` of fungible LP tokens, and neither of those exists on V3.
 * Relabelling any of them would make a fixture that claims a shape its own fields
 * contradict. A V3 fixture would need its own numbers, which is the note in
 * `useV3Pools` about why demo mode returns an empty list for that venue instead.
 *
 * `chainId` is one chain for a different reason: the fixtures exist to make the UI
 * legible without a network, and eight pools spread over five chains would make the
 * chain tag the thing under test rather than the pools. The read chain is the
 * honest single answer — it is the chain a fixture-mode reader would otherwise be
 * looking at.
 */
const V2_MOCK_POOLS: Omit<ITradingPair, "version" | "chainId">[] = [
  {
    // 615 WETH ⇄ 2,091,000 USDC — the deepest book, both legs priced.
    address: pairAddress(1),
    token0: MOCK_TOKENS.WETH,
    token1: MOCK_TOKENS.USDC,
    reserves: { reserve0: raw("615", 18), reserve1: raw("2091000", 6) },
    price: 3400,
    totalSupply: "35861000000000000",
    volume24h: 1_204_551.2,
    volumeWindowSec: WINDOW_SEC,
    liquidity: 4_182_000,
    value0: 2_091_000,
    value1: 2_091_000,
    fees24h: 3613.65,
    apr: 31.54,
    feeBps: 30,
  },
  {
    // KLD is unpriced, so liquidity is the USDC leg doubled: 643,000 × 2.
    address: pairAddress(2),
    token0: MOCK_TOKENS.KLD,
    token1: MOCK_TOKENS.USDC,
    reserves: { reserve0: raw("3100000", 18), reserve1: raw("643000", 6) },
    price: 0.20741935483870968,
    totalSupply: "1411800000000000000",
    volume24h: 486_220.44,
    volumeWindowSec: WINDOW_SEC,
    liquidity: 1_286_000,
    value0: null,
    value1: 643_000,
    fees24h: 1458.66,
    apr: 41.39,
    feeBps: 30,
  },
  {
    // Same doubling, this time off the WETH leg: 76.25 × 3,400 × 2.
    address: pairAddress(3),
    token0: MOCK_TOKENS.KLD,
    token1: MOCK_TOKENS.WETH,
    reserves: { reserve0: raw("1250000", 18), reserve1: raw("76.25", 18) },
    price: 0.000061,
    totalSupply: "9762900000000000000000",
    volume24h: 148_300.5,
    volumeWindowSec: WINDOW_SEC,
    liquidity: 518_500,
    value0: null,
    value1: 259_250,
    fees24h: 444.9,
    apr: 31.32,
    feeBps: 30,
  },
  {
    // kfUSD trading a shade under par, on the 5 bps tier stables belong on.
    address: pairAddress(4),
    token0: MOCK_TOKENS.kfUSD,
    token1: MOCK_TOKENS.USDC,
    reserves: { reserve0: raw("1228400", 18), reserve1: raw("1226900", 6) },
    price: 0.9987788994464018,
    totalSupply: "1227600000000000000",
    volume24h: 730_118.62,
    volumeWindowSec: WINDOW_SEC,
    liquidity: 2_455_300,
    value0: 1_228_400,
    value1: 1_226_900,
    fees24h: 365.06,
    apr: 5.43,
    feeBps: 5,
  },
  {
    address: pairAddress(5),
    token0: MOCK_TOKENS.USDT,
    token1: MOCK_TOKENS.USDC,
    reserves: { reserve0: raw("952300", 6), reserve1: raw("952470", 6) },
    price: 1.0001785151527882,
    totalSupply: "952385000000",
    volume24h: 512_330.9,
    volumeWindowSec: WINDOW_SEC,
    liquidity: 1_904_770,
    value0: 952_300,
    value1: 952_470,
    fees24h: 256.17,
    apr: 4.91,
    feeBps: 5,
  },
  {
    // 8-decimal token0, so the ratio is large and the reserves look small.
    address: pairAddress(6),
    token0: MOCK_TOKENS.WBTC,
    token1: MOCK_TOKENS.WETH,
    reserves: { reserve0: raw("25", 8), reserve1: raw("456.25", 18) },
    price: 18.25,
    totalSupply: "1068000000000000",
    volume24h: 96_447.1,
    volumeWindowSec: WINDOW_SEC,
    liquidity: 3_101_250,
    value0: 1_550_000,
    value1: 1_551_250,
    fees24h: 289.34,
    apr: 3.41,
    feeBps: 30,
  },
  {
    /*
     * Neither leg has a USD price, so every dollar figure is null and only the
     * pool's own ratio survives. This is the row that proves the em dash path:
     * an unpriceable pool must not render as an empty one, which is the bug
     * usePoolData's header describes fixing.
     */
    address: pairAddress(7),
    token0: MOCK_TOKENS.KLD,
    token1: MOCK_TOKENS.stKLD,
    reserves: { reserve0: raw("410000", 18), reserve1: raw("402300", 18) },
    price: 0.9812195121951219,
    totalSupply: "406130000000000000000000",
    volume24h: null,
    volumeWindowSec: WINDOW_SEC,
    liquidity: null,
    value0: null,
    value1: null,
    fees24h: null,
    apr: null,
    feeBps: 30,
  },
  {
    /*
     * `swapFee()` unreadable — the pair predates the getter, or the call
     * reverted. Fee, fees24h and APR are all null in consequence: the hook
     * cannot compute a fee take without the rate, and will not guess 30 bps.
     * Liquidity and volume are unaffected, because neither needs the fee.
     */
    address: pairAddress(8),
    token0: MOCK_TOKENS.DAI,
    token1: MOCK_TOKENS.USDC,
    reserves: { reserve0: raw("159200", 18), reserve1: raw("159240", 6) },
    price: 1.0002512562814071,
    totalSupply: "159220000000000000",
    volume24h: 44_201.55,
    volumeWindowSec: WINDOW_SEC,
    liquidity: 318_440,
    value0: 159_200,
    value1: 159_240,
    fees24h: null,
    apr: null,
    feeBps: null,
  },
];

export const MOCK_POOLS: ITradingPair[] = V2_MOCK_POOLS.map((p) => ({
  ...p,
  chainId: READ_ONLY_CHAIN_ID,
  version: "v2" as const,
}));

/**
 * Recent activity for the detail page's transactions table.
 *
 * FIXED INSTANT, LIKE EVERY OTHER TIMESTAMP HERE. `Date.UTC` evaluates to a
 * constant — it does not read the clock — so the rows are identical in the
 * server pass and in the browser. The cost is that they age: they read as
 * minutes and hours on the day below and as a date some months later. That is
 * the right way round, because a fixture that re-based itself to "now" would be
 * the one thing the SSR rule forbids.
 */
const TXN_BASE = Date.UTC(2026, 7, 23, 14, 0, 0);

/**
 * The shape of a pool's recent window: what happened, how long before
 * `TXN_BASE`, and how big as a share of reserve0.
 *
 * Sizes are deliberately small. A window of trades each moving a percent of the
 * pool would contradict the `volume24h` figures above, and the whole point of
 * this file is that two columns a reader can compare do not disagree.
 */
const TXN_SHAPE: ReadonlyArray<{
  kind: PoolTxnKind;
  minutesAgo: number;
  share: number;
}> = [
  { kind: "swap", minutesAgo: 2, share: 0.0012 },
  { kind: "swap", minutesAgo: 7, share: 0.0004 },
  { kind: "add", minutesAgo: 19, share: 0.006 },
  { kind: "swap", minutesAgo: 34, share: 0.0031 },
  { kind: "remove", minutesAgo: 58, share: 0.0018 },
  { kind: "swap", minutesAgo: 96, share: 0.0007 },
  { kind: "swap", minutesAgo: 141, share: 0.0022 },
  { kind: "add", minutesAgo: 203, share: 0.0043 },
];

/** 64 hex characters, fake and traceable back to the pool and row that made it. */
const txHash = (pool: number, row: number) =>
  `0x${"beef".repeat(15)}${String(pool).padStart(2, "0")}${String(row).padStart(2, "0")}`;

/** A plausible head for the read chain, so block numbers descend from one place. */
const HEAD_BLOCK = 9_412_776;

/**
 * Rows built from each pool's own reserves and ratio.
 *
 * Generated rather than hand-written because the constraint is arithmetic: a
 * swap's second leg is its first leg times the pool's price, and a mint or burn
 * moves both legs in the pool's ratio. Typing sixty numbers by hand would put
 * that consistency at the mercy of a typo for no gain — the shape above is still
 * hand-chosen, which is the part a reader learns anything from.
 *
 * KLD/stKLD is left empty on purpose. It is the pool with null volume, so an
 * empty window is what its own figures already say, and it is the row that
 * exercises the "nothing in the last N blocks" state the table has to
 * distinguish from a pool that has never traded.
 */
const buildTxns = (): Record<string, PoolTxn[]> => {
  const out: Record<string, PoolTxn[]> = {};

  MOCK_POOLS.forEach((pool, poolIndex) => {
    if (pool.volume24h === null || pool.price === null) {
      out[pool.address] = [];
      return;
    }

    const reserve0 = Number(
      formatUnits(String(pool.reserves.reserve0), pool.token0.decimals),
    );

    out[pool.address] = TXN_SHAPE.map((shape, row) => {
      const amount0 = reserve0 * shape.share;
      return {
        hash: txHash(poolIndex + 1, row + 1),
        kind: shape.kind,
        blockNumber: HEAD_BLOCK - row * 7 - poolIndex,
        logIndex: (row * 3 + poolIndex) % 7,
        at: TXN_BASE - shape.minutesAgo * 60_000,
        amount0,
        amount1: amount0 * (pool.price as number),
        /* Alternating direction, so the table shows both. A window in which
           every trade went the same way is possible but is not the case worth
           having a fixture for. */
        soldToken0: shape.kind === "swap" ? row % 2 === 0 : null,
      };
    });
  });

  return out;
};

const MOCK_POOL_TXNS = buildTxns();

/**
 * A pool's rows, keyed by pair address.
 *
 * A function rather than the record itself, for the same reason the lending
 * fixtures are: the caller names the pool, and matching is case-insensitive
 * because an address arrives from a URL in whatever case the user pasted while
 * the keys here are lowercase. An unknown address returns no rows rather than
 * throwing — the real hook's answer for a pair with a quiet window.
 */
export const mockPoolTxns = (address: string): PoolTxn[] =>
  MOCK_POOL_TXNS[address.toLowerCase()] ?? [];
