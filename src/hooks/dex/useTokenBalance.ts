"use client";

import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import { useQuery } from "@tanstack/react-query";
import { ethers } from "ethers";
import { IToken } from "@/constants/types/dex";
import { providerForChain } from "@/config/provider";
import { isNativeSentinel } from "@/constants/registry";
import { retryRpc } from "@/lib/dex/rpcRetry";
import { MOCK_DATA, mockBalance } from "@/lib/mock";

const ERC20_ABI = [
  "function balanceOf(address account) external view returns (uint256)",
];

/**
 * One token's balance for the connected wallet.
 *
 * NOW A react-query READ, and that is the fix for a specific waste rather than a
 * rewrite for its own sake. The hook still does exactly what its docstring below
 * describes — the chain-awareness and the unread-not-zero discipline are the
 * point and are unchanged — but it used to drive its own `setInterval(…, 10s)`
 * per instance, and the token picker, both swap wells, /stake, /pool/new and the
 * deposit modal all mount it at once. Ten-plus timers, each re-reading the same
 * few balances on its own clock, on RPCs this app has measured throttling on.
 * Keyed by (chainId, token, wallet), react-query collapses every instance
 * reading the same balance into one poll and one cache entry, and `staleTime`
 * keeps a re-render from refiring it. The return shape is unchanged, so no caller
 * moved.
 *
 * WHY THE READ PROVIDER AND NOT `window.ethereum`
 *
 * The read goes through `providerForChain(token.chainId)`, never
 * `new ethers.BrowserProvider(window.ethereum)`. Two failures came from the
 * injected provider: it is absent for WalletConnect, the in-app wallet and every
 * phone browser (so a connected wallet holding funds read empty), and when
 * present it answers for one chain while the picker's rows span several (so a Base
 * row read at Base's address against Sepolia came back zero, or another token's
 * balance under this one's name). `providerForChain` dials the chain the token is
 * actually on — the (chainId, address) identity the registry enforces.
 *
 * A FAILED READ IS `unread`, NOT ZERO
 *
 * A read that throws leaves `unread` true and the last good balance in place,
 * rather than claiming the wallet holds none — the two are indistinguishable to a
 * user, and one is a lie. `retryRpc` first gives a throttled endpoint the few
 * retries it needs (a rate limit arrives as "missing revert data"; see
 * lib/dex/rpcRetry.ts). A chain with no endpoint, or a token with no declared
 * decimals, resolves to `unread` without a guess.
 *
 * DECIMALS ARE DECLARED, NEVER GUESSED
 *
 * `IToken.decimals` is required and the registry always sets it. The guess is not
 * a rounding matter: BSC's USDC is 18 decimals where every other chain's is 6, so
 * 18 in place of 6 overstates a balance by 10^12. A token that somehow arrives
 * without declared decimals is `unread` rather than formatted at a guessed scale.
 */
export const useTokenBalance = (token: IToken | null) => {
  const { address, chainId: connectedChainId } = useWalletV2();

  /* The token's own chain, falling back to the wallet's only when the token does
     not say. Not a `?? READ_ONLY_CHAIN_ID`: answering with Sepolia's balance for
     a wallet on Base is the confidently-wrong-chain bug providerForChain is about. */
  const chainId = token?.chainId ?? connectedChainId;

  const query = useQuery({
    queryKey: ["tokenBalance", chainId, token?.address ?? null, address ?? null],
    enabled: Boolean(token && address),
    /* The 10s cadence this hook always had, now shared: every mount of the same
       (chain, token, wallet) reads on one timer instead of its own. */
    refetchInterval: 10_000,
    queryFn: async (): Promise<string | null> => {
      /* enabled gates these, but the queryFn signature cannot see that. */
      if (!token || !address) return null;

      if (MOCK_DATA) return mockBalance(token);

      const provider = providerForChain(chainId);
      if (!provider || !Number.isInteger(token.decimals)) {
        /* No endpoint for this chain, or no declared decimals to format with.
           A resolved null — nothing was read, nothing is claimed, and there is
           nothing to retry. Surfaces as `unread` below. */
        return null;
      }

      const isNative =
        token.isNative ||
        isNativeSentinel(token.address, "dex") ||
        isNativeSentinel(token.address, "lending");

      /* Thrown on failure, not caught to a zero: a throw is what lets react-query
         retry a throttle and keep the last good value while it does. retryRpc
         handles the rate-limit-as-"missing revert data" case first. */
      const raw: bigint = isNative
        ? await retryRpc(() => provider.getBalance(address))
        : await retryRpc(() =>
            new ethers.Contract(token.address, ERC20_ABI, provider).balanceOf(
              address,
            ),
          );

      return ethers.formatUnits(raw, token.decimals);
    },
  });

  const enabled = Boolean(token && address);

  return {
    /* Last good value, or "0" before one exists. The `unread` flag beside it is
       what a caller shows instead when this number is not a fact. */
    balance: query.data ?? "0",
    /* Only the first load, so a background re-poll does not flip every well to a
       spinner. */
    loading: query.isLoading,
    /* Not a fact when: the read errored (stale value kept underneath), or it
       resolved to null (no endpoint / no decimals). Never while still loading,
       and never when there is simply no wallet or token to read. */
    unread:
      enabled &&
      !query.isLoading &&
      (query.isError || query.data === null),
    refetch: () => {
      query.refetch();
    },
  };
};
