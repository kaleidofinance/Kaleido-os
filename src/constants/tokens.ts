import type { IToken } from "./types/dex";
import {
  getToken,
  getTokens,
  findTokenBySymbol,
  type TokenEntry,
} from "./registry";

/**
 * Chain-scoped token access for UI code.
 *
 * This file used to export ABSTRACT_TOKENS: eight hardcoded Abstract Testnet
 * (11124) addresses from the pre-rewrite deployment, plus ACTIVE_TOKENS, a
 * filtered view of the same array. Both are gone. The contracts were rewritten
 * and are being redeployed from scratch on Arc / Base / Robinhood / BNB /
 * Ethereum, testnet first, so every address in that list was dead — and because
 * the list was a plain module-level array with no chain dimension, code read it
 * on whatever chain the user happened to be connected to.
 *
 * That is the specific failure this module now exists to prevent. A bare
 * address is not an identity; `(chainId, address)` is. Nine registered chains
 * call their native asset "ETH" and they are not the same asset, and Arc's
 * native USDC has 18 decimals where ERC20 USDC has 6 everywhere else. A global
 * token list cannot express any of that, so it silently answers with the wrong
 * chain's data instead of admitting it does not know.
 *
 * Everything here is a thin adapter over `registry.ts`, which holds the real
 * per-chain data and is currently EMPTY BY DESIGN. So these functions return
 * empty arrays and undefined today. That is correct: nothing is deployed, so
 * there are no tokens, and callers should render an empty state rather than a
 * list of addresses that will revert on contact. As each chain deploys,
 * populate `TOKENS` in registry.ts and every call site here fills in at once.
 *
 * Consumers must pass the connected chain id. If you find yourself without one,
 * that is the bug — resolve it at the component boundary from `useWalletV2()`,
 * do not reach for a default.
 */

/**
 * Adapts a registry entry to the UI's IToken shape.
 *
 * `verified: true` is safe because the registry is a curated allow-list — an
 * arbitrary token discovered on-chain never passes through here. Token data
 * read from a contract (see usePoolData) builds its own IToken with
 * `verified: false`, which is the distinction the flag is for.
 */
export function toIToken(t: TokenEntry): IToken {
  return {
    address: t.address,
    name: t.name,
    symbol: t.symbol,
    decimals: t.decimals,
    chainId: t.chainId,
    logoURI: t.logoURI,
    verified: true,
    tags: t.tags,
    isNative: t.isNative,
  };
}

/** Every known token on one chain. Empty until that chain deploys. */
export function chainTokens(chainId: number | undefined): IToken[] {
  return getTokens(chainId).map(toIToken);
}

/**
 * Resolves user-typed input ("swap 500 usdc") to a token on one chain.
 *
 * Only for user input, where a symbol is all we were given. Never use it on an
 * address that came from a contract or an API — see chainTokenByAddress.
 */
export function chainTokenBySymbol(
  chainId: number | undefined,
  symbol: string,
): IToken | undefined {
  const entry = findTokenBySymbol(chainId, symbol);
  return entry ? toIToken(entry) : undefined;
}

/** Exact (chainId, address) lookup. The only safe way to resolve an address. */
export function chainTokenByAddress(
  chainId: number | undefined,
  address: string | undefined,
): IToken | undefined {
  const entry = getToken(chainId, address);
  return entry ? toIToken(entry) : undefined;
}

/**
 * Address → symbol for display, falling back to a truncated address.
 *
 * The fallback is deliberate and already how these call sites behaved: a
 * position or loan row carries a raw address, and showing `0x1234…abcd` is
 * honest when we cannot name it. Never use this to make a decision — only to
 * put text on screen.
 */
export function symbolForAddress(
  chainId: number | undefined,
  address: string | undefined,
): string {
  if (!address) return "Unknown";
  return (
    chainTokenByAddress(chainId, address)?.symbol ??
    `${address.slice(0, 6)}…${address.slice(-4)}`
  );
}

/**
 * Address → decimals, or undefined when unknown.
 *
 * Returns undefined rather than defaulting to 18 on purpose. Decimals are
 * declared data: guessing wrong is not a cosmetic error, it misprices by orders
 * of magnitude (USDC at 6 read as 18 is off by 10^12). Callers that genuinely
 * only need a display approximation may `?? 18`, but doing so at the call site
 * makes the guess visible instead of burying it here.
 */
export function decimalsForAddress(
  chainId: number | undefined,
  address: string | undefined,
): number | undefined {
  return chainTokenByAddress(chainId, address)?.decimals;
}
