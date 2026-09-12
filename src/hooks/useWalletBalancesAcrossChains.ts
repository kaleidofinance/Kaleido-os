"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { useActiveAccount } from "thirdweb/react";

import { CHAINS, CHAINS_BY_ID } from "@/constants/chains";
import { nativeTokenOf, registeredTokens } from "@/constants/registry";
import { providerForChain, READ_ONLY_CHAIN_ID } from "@/config/provider";
import { readContracts, MULTICALL3_ADDRESS } from "@/lib/chain/multicall";
import { MOCK_DATA } from "@/lib/mock";
import { mockBalanceOf } from "@/lib/mock/balances";
import type { WalletHolding } from "@/hooks/useWalletBalances";

/**
 * Every registered token the wallet holds, on EVERY chain at once.
 *
 * The cross-chain twin of `useWalletBalances`, which reads only the connected
 * chain. The portfolio is meant to show everything the address holds, the way
 * the lending book sweeps every chain's rows and the swap prices every chain's
 * tokens — so a wallet parked on one network still sees its balances on all the
 * others, including Robinhood mainnet's tokenised stocks, which exist there with
 * no Diamond deployed.
 *
 * ONE MULTICALL PER CHAIN, NOT ONE READ PER TOKEN. Robinhood mainnet alone
 * registers ~194 stock tokens; a hook-per-token sweep of every chain would be
 * hundreds of round trips. `readContracts` batches each chain's `balanceOf`s and
 * the native `getEthBalance` into a single Multicall3 call (canonical address on
 * every chain), and never throws — a chain that cannot be reached comes back
 * all-unread and is simply skipped, so one dead endpoint never empties the rest.
 *
 * Decimals are read from the registry, never guessed (BSC's USDC is 18 where
 * every other chain's is 6). Measured zeros are dropped; a balance that could not
 * be read becomes an `unread` caveat, never a silent zero — the same rules as the
 * single-chain hook, applied per chain.
 */
export interface ChainWalletHolding extends WalletHolding {
  chainId: number;
}

export interface WalletBalancesAcrossChains {
  holdings: ChainWalletHolding[];
  /** "SYMBOL on <chain>" for each balance that could not be read. */
  unread: string[];
  loading: boolean;
  refresh: () => void;
}

const ERC20 = new ethers.Interface([
  "function balanceOf(address owner) view returns (uint256)",
]);
const MC3 = new ethers.Interface([
  "function getEthBalance(address addr) view returns (uint256)",
]);

export function useWalletBalancesAcrossChains(): WalletBalancesAcrossChains {
  const address = useActiveAccount()?.address;
  const chains = useMemo(() => CHAINS.map((c) => c.id), []);
  const [state, setState] = useState<{
    holdings: ChainWalletHolding[];
    unread: string[];
  }>({ holdings: [], unread: [] });
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!address) {
      setState({ holdings: [], unread: [] });
      setLoading(false);
      return;
    }

    /* Demo mode: the single-chain fixture, tagged with the read chain, so the
       page has holdings to render without a live sweep. Delete with src/lib/mock. */
    if (MOCK_DATA) {
      const native = nativeTokenOf(CHAINS_BY_ID[READ_ONLY_CHAIN_ID], "lending");
      const tokens = registeredTokens(READ_ONLY_CHAIN_ID);
      const rows: ChainWalletHolding[] = [
        ...(native ? [native] : []),
        ...tokens,
      ].flatMap((t) => {
        const amount = mockBalanceOf(t.symbol);
        const value = Number(amount);
        if (!Number.isFinite(value) || value <= 0) return [];
        return [
          {
            address: t.address,
            symbol: t.symbol,
            decimals: t.decimals,
            raw: ethers.parseUnits(amount, t.decimals).toString(),
            amount,
            value,
            isNative: Boolean(t.isNative),
            chainId: READ_ONLY_CHAIN_ID,
          },
        ];
      });
      setState({ holdings: rows, unread: [] });
      setLoading(false);
      return;
    }

    let live = true;
    setLoading(true);

    const sweepChain = async (
      chainId: number,
    ): Promise<{ holdings: ChainWalletHolding[]; unread: string[] }> => {
      if (!providerForChain(chainId)) return { holdings: [], unread: [] };
      const native = nativeTokenOf(CHAINS_BY_ID[chainId], "lending");
      const tokens = registeredTokens(chainId);

      /* Native first (Multicall3's own getEthBalance, batched with the ERC20s),
         then one balanceOf per registered token. */
      const calls = [
        {
          target: MULTICALL3_ADDRESS,
          iface: MC3,
          method: "getEthBalance",
          args: [address] as const,
        },
        ...tokens.map((t) => ({
          target: t.address,
          iface: ERC20,
          method: "balanceOf",
          args: [address] as const,
        })),
      ];

      const results = await readContracts(chainId, calls);
      const holdings: ChainWalletHolding[] = [];
      const unread: string[] = [];
      const shortName = CHAINS_BY_ID[chainId]?.shortName ?? `chain ${chainId}`;

      results.forEach((r, i) => {
        const meta = i === 0 ? native : tokens[i - 1];
        if (!meta) return;
        if (!r.success || r.value === null) {
          unread.push(`${meta.symbol} on ${shortName}`);
          return;
        }
        const raw = r.value as bigint;
        const amount = ethers.formatUnits(raw, meta.decimals);
        const value = Number(amount);
        if (!Number.isFinite(value)) {
          unread.push(`${meta.symbol} on ${shortName}`);
          return;
        }
        if (value <= 0) return;
        holdings.push({
          address: meta.address,
          symbol: meta.symbol,
          decimals: meta.decimals,
          raw: raw.toString(),
          amount,
          value,
          isNative: Boolean(meta.isNative),
          chainId,
        });
      });

      return { holdings, unread };
    };

    void Promise.all(chains.map(sweepChain)).then((perChain) => {
      if (!live) return;
      const holdings: ChainWalletHolding[] = [];
      const unread: string[] = [];
      for (const c of perChain) {
        holdings.push(...c.holdings);
        unread.push(...c.unread);
      }
      setState({ holdings, unread });
      setLoading(false);
    });

    return () => {
      live = false;
    };
  }, [address, chains, nonce]);

  return { holdings: state.holdings, unread: state.unread, loading, refresh };
}

export default useWalletBalancesAcrossChains;
