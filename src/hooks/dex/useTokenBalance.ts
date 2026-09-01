"use client";

import { useCallback, useState, useEffect } from "react";
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react";
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
 * WHY THE READ PROVIDER AND NOT `window.ethereum`
 *
 * This read `new ethers.BrowserProvider(window.ethereum)` and reported `"0"` from
 * its catch. Both halves were wrong, and together they produced the failure this
 * hook was rewritten for: every balance in the app rendering as 0.00.
 *
 *   1. **There is often no injected provider.** `window.ethereum` exists when a
 *      browser extension put it there. The app ships six wallet options through
 *      thirdweb — WalletConnect and in-app (email/social) wallets inject nothing,
 *      on any platform, and a phone browser has no extension at all. So on mobile
 *      `new BrowserProvider(undefined)` threw on the first line of the try, for a
 *      wallet that was properly connected and holding funds. Every consumer of
 *      this hook was affected at once: both swap wells, every row of the token
 *      picker, /stake, /pool/new and the deposit modal.
 *   2. **The wallet's node answers for one chain.** An injected provider is
 *      pinned to whatever network the wallet is on, while the token carries its
 *      own `chainId` — and the picker's list spans chains, so a Base row was read
 *      at Base's address against Sepolia. That returns zero (no code there) or,
 *      where a deployer's nonces line up across chains, another token's balance
 *      under this one's name. `providerForChain(token.chainId)` dials the chain
 *      the token is actually on, which is the (chainId, address) identity rule
 *      the registry exists to enforce.
 *
 * A FAILED READ IS `unread`, NOT ZERO
 *
 * `"0"` from a catch is a claim — that the wallet holds none of this token — made
 * from a read that never landed. It disables Max, the percentage chips and the
 * CTA exactly as an empty wallet does, so the user cannot tell the two apart.
 * Failures now set `unread`, and `retryRpc` first gives a throttled endpoint the
 * few retries it needs: Sepolia-class nodes return a rate limit as HTTP 200 with
 * a JSON-RPC error body that ethers surfaces as "missing revert data" (see
 * lib/dex/rpcRetry.ts), which is indistinguishable from an empty answer here.
 *
 * DECIMALS ARE DECLARED, NEVER GUESSED
 *
 * `IToken.decimals` is required and the registry always sets it, so the old
 * `decimals()` call and its `?? 18` fallback are gone — one less round trip per
 * token, and no guess. The guess is not a rounding matter: BSC's USDC is 18
 * decimals where every other chain's is 6, so 18 in place of 6 overstates a
 * balance by 10^12. A token that somehow arrives without declared decimals is
 * `unread` rather than formatted at a guessed scale.
 */
export const useTokenBalance = (token: IToken | null) => {
  const activeAccount = useActiveAccount();
  const connectedChainId = useActiveWalletChain()?.id;
  const [balance, setBalance] = useState("0");
  /** True when the read was attempted and did not land. `balance` is not a fact. */
  const [unread, setUnread] = useState(false);
  const [loading, setLoading] = useState(false);

  /* The token's own chain, falling back to the wallet's only when the token does
     not say. Registry tokens always carry `chainId`, so the fallback is for a
     token assembled elsewhere — and for those the connected chain is the only
     chain the caller could have meant. Not a `?? READ_ONLY_CHAIN_ID`: answering
     with Sepolia's balance for a wallet on Base is the confidently-wrong-chain
     bug providerForChain's docstring is about. */
  const chainId = token?.chainId ?? connectedChainId;

  const fetchBalance = useCallback(async () => {
    if (!activeAccount || !token) {
      setBalance("0");
      setUnread(false);
      return;
    }
    /* Fixture balances, above the read so no provider is ever dialled: on a
       chain with no deployment every call below fails and the wallet reads empty,
       which disables Max, the quick-percentage buttons and every CTA. Placed
       after the guard rather than before it, so it is scoped to a connected
       address for free — a wallet balance without a wallet is not a number this
       should invent. Deleting ./mock deletes these four lines. */
    if (MOCK_DATA) {
      setBalance(mockBalance(token));
      setUnread(false);
      setLoading(false);
      return;
    }

    const provider = providerForChain(chainId);
    if (!provider || !Number.isInteger(token.decimals)) {
      /* No endpoint for this chain, or no declared decimals to format with.
         Nothing was read, so nothing is claimed. */
      setUnread(true);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const isNative =
        token.isNative ||
        isNativeSentinel(token.address, "dex") ||
        isNativeSentinel(token.address, "lending");

      const raw: bigint = isNative
        ? await retryRpc(() => provider.getBalance(activeAccount.address))
        : await retryRpc(() =>
            new ethers.Contract(token.address, ERC20_ABI, provider).balanceOf(
              activeAccount.address,
            ),
          );

      setBalance(ethers.formatUnits(raw, token.decimals));
      setUnread(false);
    } catch (error) {
      /* Kept as a console error because a persistent one is a dead endpoint in
         chains.ts, which is worth seeing. The previous balance is left in place:
         a number read ten seconds ago is closer to the truth than a zero, and
         `unread` is what the UI shows instead of trusting it. */
      console.error("Could not read balance for", token.symbol, error);
      setUnread(true);
    } finally {
      setLoading(false);
    }
  }, [activeAccount, token, chainId]);

  useEffect(() => {
    fetchBalance();
    const interval = setInterval(fetchBalance, 10000); // Poll every 10s
    return () => clearInterval(interval);
  }, [fetchBalance]);

  return { balance, loading, unread, refetch: fetchBalance };
};
