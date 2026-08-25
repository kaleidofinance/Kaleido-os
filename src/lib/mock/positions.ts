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
 * The four awkward states a positions table has to handle are each represented
 * once, on purpose: fees owed, nothing owed (Collect must be disabled, not
 * merely a no-op), out of range, and fully-withdrawn liquidity. That last row
 * has `liquidity: "0"` and is the one `usePortfolio.ts:292` skips — a closed
 * position that still holds uncollected fees is a real state, and the only way
 * to see whether both screens agree about it is to have one in the list.
 */
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
    inRange: true,
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
    inRange: true,
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
    inRange: false,
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
    inRange: true,
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
    inRange: true,
  },
];
