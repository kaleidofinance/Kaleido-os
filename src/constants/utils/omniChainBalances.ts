import { ethers } from "ethers";
import { providerForChain } from "@/config/provider";
import { CHAINS_BY_ID } from "@/constants/chains";
import {
  getTokens,
  nativeTokenOf,
  ownTokens,
  resolveUserToken,
  type TokenEntry,
} from "@/constants/registry";

/**
 * Provider per chain, from the canonical registry.
 *
 * Was a local cache plus `if (chainId === 11124 || chainId === 2741) return
 * readOnlyProvider` and a `if (!meta) return readOnlyProvider` default. Both
 * returned one chain's node for another chain's query, and since the result is
 * labelled with the *requested* chain further down, the balance came back
 * attributed to a chain it was never read from. See providerForChain's docstring
 * for why null is the right answer instead.
 */
export const getOmniProvider = providerForChain;

export interface ChainBalance {
  chainId: number;
  chainName: string;
  balance: string;
}

export interface OmniPortfolioItem {
  token: string;
  totalBalance: string;
  chains: ChainBalance[];
}

/**
 * One symbol, resolved on one chain — the whole correctness of this module.
 *
 * REPLACES a module-level `TOKEN_CONFIG` that mapped four symbols to ONE address
 * and ONE decimals each, all four of them Abstract-testnet literals, and then
 * applied that single answer to all thirteen chains this indexer queries. Three
 * separate ways that was wrong:
 *
 *   1. **Wrong address.** USDC on Ethereum is not USDC on Base is not USDC on
 *      Abstract. `balanceOf` at the Abstract address on Base hits either no code
 *      (revert → caught → reported "0") or, worse, an unrelated contract. The
 *      mock tokens on our five testnets were deployed by one key at adjacent
 *      nonces, so identical CREATE addresses across chains are a live
 *      possibility, not a theoretical one — and a hit there would be a real
 *      number for the wrong token, labelled with the right one.
 *   2. **Wrong decimals.** The table said USDC/USDT are 6. On BSC they are 18
 *      (see the TOKENS comment in constants/registry.ts). A balance formatted at
 *      6 when the token reports 18 overstates it by 10^12.
 *   3. **Wrong asset entirely.** `token === "ETH"` took the native balance on
 *      every chain, so "how much ETH do I have" answered with BNB on BSC and
 *      POL on Polygon, both labelled ETH.
 *
 * Now every (chain, symbol) pair is resolved against the registry, which is the
 * only structure that holds the per-chain address AND the per-chain decimals as
 * declared data. `resolveUserToken` checks the chain's own native symbol first,
 * so "ETH" is native on Ethereum and Base, and is *not* found on BSC — and "USDC"
 * on Arc correctly resolves to Arc's native 18-decimal USDC rather than to the
 * 6-decimal ERC20 shape it has elsewhere.
 *
 * `ownTokens` is the fallback because kfUSD/kafUSD/KLD/stKLD are ours: they come
 * from DEPLOYMENTS, not from the canonical third-party TOKENS list.
 *
 * Returning undefined means "this asset is not issued on this chain", which is a
 * different fact from "the wallet holds none of it" — see the call site.
 */
const assetOnChain = (
  chainId: number,
  symbol: string,
): TokenEntry | undefined => {
  const s = symbol.toLowerCase();
  return (
    resolveUserToken(CHAINS_BY_ID[chainId], symbol, "dex") ??
    ownTokens(chainId).find((t) => t.symbol.toLowerCase() === s)
  );
};

const resolveChainName = (chainId: number) =>
  CHAINS_BY_ID[chainId]?.name ?? "Unknown";

/**
 * Every symbol this indexer can actually resolve on at least one of `chainIds`.
 *
 * Exists so no caller has to keep a second hand-written list in step with the
 * registry. `readTools.ts` had one — `["ETH","USDC","USDT","USDR","kfUSD"]` — and
 * it had already drifted: USDR was removed from the registry with no deployment
 * record on any of the five chains, so the AI advertised a cross-chain balance for
 * an asset that does not exist, and would answer "0 everywhere" rather than "not
 * indexed". Deriving the list from the same resolver the read itself uses makes
 * that class of drift impossible.
 */
export const indexedAssets = (chainIds: number[]): string[] => {
  /* Keyed lowercase so ETH/eth collapse, valued with the registry's own casing
     so "kfUSD" is advertised the way it is written everywhere else. */
  const bySymbol = new Map<string, string>();

  for (const chainId of chainIds) {
    const native = nativeTokenOf(CHAINS_BY_ID[chainId], "dex");
    for (const t of [
      ...(native ? [native] : []),
      ...getTokens(chainId),
      ...ownTokens(chainId),
    ]) {
      bySymbol.set(t.symbol.toLowerCase(), t.symbol);
    }
  }

  return [...bySymbol.values()].sort((a, b) => a.localeCompare(b));
};

export const fetchOmniAssetBalance = async (
  address: string,
  token: string,
  chainIds: number[],
): Promise<OmniPortfolioItem> => {
  const balances = await Promise.all(
    chainIds.map(async (chainId) => {
      try {
        const provider = getOmniProvider(chainId);
        /* No provider means chains.ts carries no RPC for this chain, so there is
           nothing to read. Reporting "0" would be a claim — that the wallet holds
           none of this token there — which we have not checked and cannot. The
           row is dropped below by the same > 0 filter that drops genuine zeroes,
           so an unreachable chain is absent rather than asserted empty. */
        if (!provider) return null;

        /* Not issued on this chain. Same reasoning as above, one step earlier:
           there is no contract to ask, so there is no zero to report. This is
           also what keeps "ETH" from being answered with BNB — the old code
           read the native balance of whatever chain it was pointed at. */
        const asset = assetOnChain(chainId, token);
        if (!asset) return null;

        if (asset.isNative) {
          const bal = await provider.getBalance(address);
          return {
            chainId,
            chainName: resolveChainName(chainId),
            /* formatUnits, not formatEther: Arc's native asset is 18 decimals
               like ETH, but nothing guarantees the next chain's is, and the
               registry already carries the declared value. */
            balance: parseFloat(
              ethers.formatUnits(bal, asset.decimals),
            ).toFixed(4),
          };
        }

        const contract = new ethers.Contract(
          asset.address,
          ["function balanceOf(address owner) view returns (uint256)"],
          provider,
        );

        const bal = await contract.balanceOf(address);
        return {
          chainId,
          chainName: resolveChainName(chainId),
          balance: ethers.formatUnits(bal, asset.decimals),
        };
      } catch {
        /* The read was attempted and failed — a dead RPC, a throttled endpoint.
           "0" here is dropped by the filter below exactly like the nulls above,
           so one bad endpoint degrades a single row rather than the whole read. */
        return { chainId, chainName: resolveChainName(chainId), balance: "0" };
      }
    }),
  );

  const total = balances.reduce(
    (acc, curr) => acc + parseFloat(curr?.balance ?? "0"),
    0,
  );

  return {
    token,
    totalBalance: total.toString(),
    chains: balances.filter(
      (b): b is ChainBalance => b !== null && parseFloat(b.balance) > 0,
    ),
  };
};
