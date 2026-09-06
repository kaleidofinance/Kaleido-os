import type { V3Position } from "@/hooks/dex/useV3Positions";

import { MOCK_TOKENS } from "./pools";

/**
 * Demo concentrated-liquidity positions, shaped as `useV3Positions` returns them.
 *
 * Legs are borrowed from `./pools` so a reader who opens /pool and then
 * /pool/positions sees the same tokens with the same decimals in both places.
 *
 * FEE TIERS ARE RESTRICTED TO WHAT THE UI CAN CREATE. `pool/new/page.tsx:35`
 * offers 500, 3000 and 10000 and nothing else, so a fixture on any other tier
 * would describe a position this app cannot mint.
 *
 * TICKS ARE REAL, not decorative. Each is a multiple of its tier's spacing —
 * 10 / 60 / 200 for 500 / 3000 / 10000 (`TICK_SPACINGS`, same file) — because
 * the position manager rejects a boundary that is not, and a fixture that
 * ignored that would teach a reader the wrong shape. Each range also actually
 * brackets (or, for the out-of-range row, actually misses) the current tick
 * implied by that pair's price in `./pools`:
 *
 *   tick ≈ ln(price × 10 ** (decimals0 - decimals1)) / ln(1.0001)
 *
 *   WETH/USDC  at 3,400   → -195,005   inside (-198,000, -192,000)
 *   KLD/USDC   at 0.2074  → -292,071   inside (-294,000, -288,000)
 *   kfUSD/USDC at 0.9988  → -276,332   inside (-276,400, -276,200)
 *   KLD/WETH   at 0.000061 → -74,024   inside ( -76,800,  -71,400)
 *   WBTC/WETH  at 18.25   →  259,296   BELOW  ( 262,000,  266,000) → out of range
 *
 * `liquidity`, `tokensOwed0` and `tokensOwed1` are raw base units in each leg's
 * own decimals, which is what the position manager returns.
 *
 * `uncollectedFees0/1` are the LIVE amount a collect would pay — what the pool's
 * fee accumulators say right now, not the frozen `tokensOwed` checkpoint (see
 * lib/dex/feeGrowth.ts). For a position still earning, the live figure sits ABOVE
 * its checkpoint, so these are set a little higher than `tokensOwed` on the
 * in-range earning rows and equal to it where nothing has accrued since the last
 * touch (the fresh row) or the position cannot earn (out of range, withdrawn).
 *
 * `sqrtPriceX96` is DERIVED from the tick in that list rather than typed in, by
 * `sqrtAt` below. It is the field /portfolio values a position from, so a
 * hand-written one that disagreed with the tick above it would put a dollar
 * figure on the LP group that contradicts the in-range badge on the same row —
 * exactly the kind of two-sources-of-truth split ./market's header is about.
 *
 * The four awkward states a positions table has to handle are each represented
 * once, on purpose: fees owed, nothing owed (Collect must be disabled, not
 * merely a no-op), out of range, and fully-withdrawn liquidity. That last row
 * has `liquidity: "0"` and is the one `usePortfolio`'s Staking & LP group skips — a
 * closed
 * position that still holds uncollected fees is a real state, and the only way
 * to see whether both screens agree about it is to have one in the list.
 */

/**
 * The pool's `sqrtPriceX96` at a given tick, as slot0 reports it.
 *
 * sqrt(1.0001^tick) × 2^96, written with the halved exponent so the intermediate
 * stays inside double range. Double arithmetic, so the last few digits differ
 * from the contracts' exact fixed-point ladder — which does not matter for a
 * fixture whose whole job is to be a plausible price at a stated tick, and is the
 * same accuracy the consumer (lib/dex/positionValue.ts) works to anyway.
 */
const sqrtAt = (tick: number) =>
  BigInt(Math.round(1.0001 ** (tick / 2) * 2 ** 96)).toString();
export const MOCK_V3_POSITIONS: V3Position[] = [
  {
    // The main position: wide range, in range, real fees waiting.
    tokenId: "1842",
    token0: MOCK_TOKENS.WETH.address,
    token1: MOCK_TOKENS.USDC.address,
    fee: 3000,
    tickLower: -198000,
    tickUpper: -192000,
    liquidity: "184203991248872",
    tokensOwed0: "41200000000000000", // 0.0412 WETH
    tokensOwed1: "138420000", // 138.42 USDC
    // Live: earned since the last touch, so above the checkpoint.
    uncollectedFees0: "47380000000000000", // 0.04738 WETH
    uncollectedFees1: "151070000", // 151.07 USDC
    inRange: true,
    sqrtPriceX96: sqrtAt(-195005),
  },
  {
    // Freshly minted: in range, nothing accrued yet, so Collect is disabled.
    tokenId: "1917",
    token0: MOCK_TOKENS.KLD.address,
    token1: MOCK_TOKENS.USDC.address,
    fee: 3000,
    tickLower: -294000,
    tickUpper: -288000,
    liquidity: "8420119377421155",
    tokensOwed0: "0",
    tokensOwed1: "0",
    // Nothing accrued since mint, so the live figure equals the checkpoint.
    uncollectedFees0: "0",
    uncollectedFees1: "0",
    inRange: true,
    sqrtPriceX96: sqrtAt(-292071),
  },
  {
    // Price walked below the range. Earning nothing, and says so.
    tokenId: "2033",
    token0: MOCK_TOKENS.WBTC.address,
    token1: MOCK_TOKENS.WETH.address,
    fee: 10000,
    tickLower: 262000,
    tickUpper: 266000,
    liquidity: "1204880091337",
    tokensOwed0: "18450", // 0.0001845 WBTC (8 decimals)
    tokensOwed1: "9120000000000000", // 0.00912 WETH
    // Out of range: earns nothing, so live equals the checkpoint.
    uncollectedFees0: "18450",
    uncollectedFees1: "9120000000000000",
    inRange: false,
    /* Below the range, so the position is entirely WBTC — the one fixture that
       exercises positionValue's clamp rather than its in-range branch. */
    sqrtPriceX96: sqrtAt(259296),
  },
  {
    // Tight stable range on the 5 bps tier: high liquidity, thin fees.
    tokenId: "2104",
    token0: MOCK_TOKENS.kfUSD.address,
    token1: MOCK_TOKENS.USDC.address,
    fee: 500,
    tickLower: -276400,
    tickUpper: -276200,
    liquidity: "42019887334120993",
    tokensOwed0: "2140000000000000000", // 2.14 kfUSD
    tokensOwed1: "2190000", // 2.19 USDC
    // Live: thin but positive accrual above the checkpoint.
    uncollectedFees0: "2380000000000000000", // 2.38 kfUSD
    uncollectedFees1: "2440000", // 2.44 USDC
    inRange: true,
    sqrtPriceX96: sqrtAt(-276332),
  },
  {
    // Liquidity fully removed, fees not yet collected. See the header note.
    tokenId: "1755",
    token0: MOCK_TOKENS.KLD.address,
    token1: MOCK_TOKENS.WETH.address,
    fee: 3000,
    tickLower: -76800,
    tickUpper: -71400,
    liquidity: "0",
    tokensOwed0: "1840000000000000000000", // 1,840 KLD
    tokensOwed1: "112000000000000000", // 0.112 WETH
    // Withdrawn (liquidity 0): can accrue nothing more, so live equals owed.
    uncollectedFees0: "1840000000000000000000",
    uncollectedFees1: "112000000000000000",
    inRange: true,
    sqrtPriceX96: sqrtAt(-74024),
  },
];
