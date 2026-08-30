import type { IToken } from "@/constants/types/dex";

import { MOCK_STABLE_BALANCES } from "./stable";
import { MOCK_STAKE } from "./stake";

/**
 * What the demo wallet holds.
 *
 * `useTokenBalance` is the most-used read in the app — both wells of the swap
 * card, both sides of /pool/new, the KLD row on /stake, and every row of the
 * token selector call it — and without a fixture all of them render 0, which
 * disables Max, disables the quick-percentage buttons and marks every amount as
 * insufficient. So this is the seam that decides whether the trade surfaces are
 * walkable at all.
 *
 * KEYED BY SYMBOL, NOT BY (chainId, address). That is a deliberate simplification
 * and worth naming, because registry.ts's rule 1 says the opposite: identity is
 * (chainId, address), and Base ETH is not Ethereum ETH. The reason it is safe
 * here is that nothing derives identity from this map — it produces a display
 * string and nothing else, and the token it was asked about was already resolved
 * by the caller. The reason it is desirable is that the alternative is forty-odd
 * entries, most of which never render, and a wallet that appears empty on
 * whichever chain got missed. The cost is that switching networks shows the same
 * holdings, which is the one thing this fixture cannot demonstrate.
 *
 * FIGURES ARE SHARED WITH THE OTHER FIXTURES WHEREVER BOTH SPEAK ABOUT THE SAME
 * BALANCE, by import rather than by copying. `/stable` reads its USDC balance
 * through `useStablecoin` and the swap card reads the same wallet's USDC through
 * this file; two different numbers would be the app contradicting itself between
 * two tabs. stKLD is the same quantity `useStakeV2` publishes as `stakedBalance`
 * ("stKLD the user holds", useStakeV2.ts:28), so it comes from there.
 *
 * EVERY VALUE IS `formatUnits` OUTPUT, which is what the hook returns — hence
 * "0.0" and "1250.0" rather than "0" and "1250". A round figure written without
 * the trailing ".0" is a shape ethers never emits, and the same rule is why
 * ./stable's balances carry it. Decimals are respected too: WBTC and cbBTC are
 * 8-decimal tokens, so a 4-decimal figure is representable; a 10-decimal one
 * would not be.
 *
 * AN UNLISTED SYMBOL READS "0", and that is the answer, not a gap. A wallet does
 * not hold every token, and the zero path is load-bearing UI — Max disabled, the
 * quick buttons disabled, "Insufficient balance" on the CTA. BTCB is listed at
 * "0.0" on purpose so that path is reachable on a chain whose other assets are
 * funded, rather than only on tokens nobody looks at.
 */
const HOLDINGS: Record<string, string> = {
  /* Native assets, per chains.ts. Arc's native is USDC — it shares the USDC
     entry below, at 18 decimals rather than 6, which is fine for both. */
  ETH: "4.182",
  BNB: "12.4",
  tBNB: "50.0",
  POL: "3104.5",
  HYPE: "212.06",

  /* Wrapped natives. Deliberately smaller than the native leg: a wallet that
     holds more WETH than ETH cannot pay for gas, and the swap card's first
     seeded pair is native → stable. */
  WETH: "2.5",
  WBNB: "6.2",
  WPOL: "1450.0",

  /* Stablecoins. The first three come from ./stable so /stable's balance rows
     and every token picker agree about the same wallet. */
  USDC: MOCK_STABLE_BALANCES.USDC,
  USDT: MOCK_STABLE_BALANCES.USDT,
  USDe: MOCK_STABLE_BALANCES.USDe,
  DAI: "1904.11",

  /* Wrapped BTC, three chains' worth. BTCB is the zero — see the header. */
  WBTC: "0.1842",
  cbBTC: "0.0412",
  BTCB: "0.0",

  /* Ours. Absent from every picker today, because `ownTokens()` has no address
     to hand back until DEPLOYMENTS is populated (registry.ts:577) — so these
     four are unreachable rather than wrong, and they populate the moment a
     chain's contracts are recorded. kfUSD and kafUSD come from ./stable and
     stKLD from ./stake for the same agreement reason as above. */
  KLD: "84200.5",
  stKLD: MOCK_STAKE.stakedBalance,
  kfUSD: MOCK_STABLE_BALANCES.kfUSD,
  kafUSD: MOCK_STABLE_BALANCES.kafUSD,
};

/**
 * The demo wallet's balance of one token, as `formatUnits` would report it.
 *
 * Exact symbol match, not case-insensitive: every token that reaches this comes
 * from the registry, where the casing is declared ("stKLD", "kfUSD"), and a
 * fuzzy match would quietly answer for a token read off-chain that merely shares
 * a ticker.
 */
export function mockBalance(token: IToken): string {
  return mockBalanceOf(token.symbol);
}

/**
 * The same lookup by symbol alone.
 *
 * `useWalletBalances` sweeps `registeredTokens()`, which produces `TokenEntry`
 * rather than `IToken` — two shapes that agree on `symbol` and differ elsewhere.
 * The symbol is all this map has ever keyed on (see the header), so taking it
 * directly is honest where casting a TokenEntry to IToken to reach the same field
 * would not be.
 */
export function mockBalanceOf(symbol: string): string {
  return HOLDINGS[symbol] ?? "0";
}
