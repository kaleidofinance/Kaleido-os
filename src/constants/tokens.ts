import type { IToken } from "./types/dex";
import { getChainMeta } from "./chains";
import {
  isNativeSentinel,
  nativeTokenOf,
  registeredTokens,
  resolveUserToken,
  type Protocol,
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
 * per-chain data. That data is now populated with canonical third-party tokens
 * (WETH/USDC/USDT/DAI/WBTC and each chain's native asset), which are real
 * deployed contracts today and have nothing to do with whether Kaleido's own
 * Diamond is live. Conflating those two was a mistake worth naming: `TOKENS`
 * was left empty on the reasoning that "nothing is deployed", and every token
 * picker in the app consequently rendered an empty state on every chain, which
 * made the UI unbuildable and told the user something untrue.
 *
 * Kaleido's own tokens (KLD, kfUSD, kafUSD, stKLD) come from `OWN_TOKENS`, and
 * the stablecoins each chain records (USDC, USDT, USDe) from `DEPLOYED_TOKENS`.
 * Both appear here through `registeredTokens()`. They are described
 * independently of any chain because their identity is known while their
 * addresses are not, and each one's address is read from `DEPLOYMENTS` at call
 * time. So a chain gains them the moment its contracts are recorded, with no
 * second list to remember to update — kfUSD, kafUSD, USDT and USDe are on all
 * five deployed testnets today, and USDC on all five as well.
 *
 * That is still separate from whether an action can be *sent*, which stays
 * `DEPLOYMENTS`' job: read a token list to render, read `isDeployed()` to decide
 * whether a button submits.
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

/**
 * Every known token on one chain: the native asset, then the ERC20s, then ours.
 *
 * The native asset is derived from chains.ts, not from the registry, so it is
 * present on every registered chain whether or not anything is deployed there —
 * a chain always has a gas token. That is what stops a chain with no ERC20
 * entries (Arc, Robinhood, Abstract) from rendering as "no tokens at all",
 * which was never true.
 *
 * The ERC20s come from `registeredTokens`, which is the union of the declared
 * third-party table, the stablecoins recorded for the chain, and ours — in that
 * order, because the third-party entries are contracts that already exist and are
 * liquid, so they are what a picker should offer first. This function used to
 * concatenate that union itself, which is exactly how it came apart from
 * `findTokenBySymbol`: the pickers offered kfUSD and kafUSD while the resolver
 * behind the swap box and the AI path could not resolve either.
 *
 * `protocol` picks which native sentinel the entry carries, and the caller must
 * choose it, because the correct magic value depends on the contract about to
 * be called: the V3 router expects 0xEeee…, the lending facet expects
 * ADDRESS_1. Defaulting to "dex" matches the swap/picker path that most callers
 * are on; borrow and collateral screens pass "lending". Getting this wrong does
 * not fail loudly — it sends value to a contract that reads the field as an
 * ordinary ERC20 address — so it is a required argument in spirit even though
 * it has a default.
 */
export function chainTokens(
  chainId: number | undefined,
  protocol: Protocol = "dex",
): IToken[] {
  const native = nativeTokenOf(getChainMeta(chainId), protocol);
  const erc20s = registeredTokens(chainId);
  return (native ? [native, ...erc20s] : erc20s).map(toIToken);
}

/**
 * Every known token across several chains, for the multichain token picker.
 *
 * A flat list is only safe here because `IToken` carries its own `chainId` and
 * the picker hands the whole object back to its caller, so a selected token
 * never loses the chain it came from. Do not collapse the result to symbols or
 * addresses: nine registered chains call their native asset "ETH", and those
 * are not the same asset. That collapse is exactly what ABSTRACT_TOKENS did.
 *
 * Order follows the chain list passed in, so the caller controls grouping.
 */
export function tokensAcrossChains(chainIds: number[]): IToken[] {
  return chainIds.flatMap((id) => chainTokens(id));
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
  protocol: Protocol = "dex",
): IToken | undefined {
  /* resolveUserToken, not findTokenBySymbol, so the chain's own native asset
     answers first. On Arc "usdc" is the native 18-decimal asset, not the
     6-decimal ERC20 shape that symbol has everywhere else, and the ERC20 list
     would happily hand back the wrong one. */
  const entry = resolveUserToken(getChainMeta(chainId), symbol, protocol);
  return entry ? toIToken(entry) : undefined;
}

/**
 * Exact (chainId, address) lookup. The only safe way to resolve an address.
 *
 * Searches `registeredTokens` — the declared third-party table, the stablecoins
 * this chain records, then ours — and not the TOKENS index alone. `getToken` is
 * that index, and reading it here was a measured hole rather than a style
 * choice: the auditor's `knownToken` calls this to decide whether a plan may
 * touch an address, so on 2026-08-24 it blocked `swap USDC to USDT` on all five
 * deployed chains with "unrecognised output token" against a contract we deployed
 * ourselves, and `symbolForAddress` rendered kfUSD as a truncated hex string.
 *
 * Checks both native sentinels after the ERC20s. A sentinel is not in any token
 * table — it is not a contract — but it does flow back through here from any
 * component that was handed a native token and later asks what it is holding,
 * so returning undefined would make native value display as an unknown address.
 */
export function chainTokenByAddress(
  chainId: number | undefined,
  address: string | undefined,
): IToken | undefined {
  if (!address) return undefined;
  const a = address.toLowerCase();
  const entry = registeredTokens(chainId).find(
    (t) => t.address.toLowerCase() === a,
  );
  if (entry) return toIToken(entry);
  for (const protocol of ["dex", "lending"] as Protocol[]) {
    if (isNativeSentinel(address, protocol)) {
      const native = nativeTokenOf(getChainMeta(chainId), protocol);
      if (native) return toIToken(native);
    }
  }
  return undefined;
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
