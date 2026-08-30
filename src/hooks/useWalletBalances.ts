"use client";

import { useCallback, useEffect, useState } from "react";
import { ethers } from "ethers";
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react";

import { CHAINS_BY_ID } from "@/constants/chains";
import { nativeTokenOf, registeredTokens } from "@/constants/registry";
import { providerForChain } from "@/config/provider";
import { retryRpc } from "@/lib/dex/rpcRetry";
import { MOCK_DATA } from "@/lib/mock";
import { mockBalanceOf } from "@/lib/mock/balances";

/**
 * Every registered token the wallet holds on the chain it is connected to.
 *
 * /portfolio's first group is "Wallet", and nothing in the app could answer it.
 * `useTokenBalance` reads ONE token per hook instance and polls it every ten
 * seconds, so a group of N tokens would mean N hook instances and N intervals —
 * a dozen timers hammering the endpoint for a panel nobody is watching. This
 * sweeps the whole registry in one pass instead, with no interval at all: a
 * portfolio is read when the page opens and when the user asks, and `refresh` is
 * exported for the latter.
 *
 * WHY THE READ PROVIDER AND NOT `window.ethereum`
 *
 * `providerForChain(chainId)` dials the chain's own endpoint from chains.ts, and
 * returns null for a chain chains.ts does not carry rather than falling back to
 * the read chain — a fallback would report Sepolia's balances under whatever
 * network the wallet had switched to. A null provider means the sweep is skipped
 * and `unread` says so. The wallet's injected provider would work too, but it is
 * the wallet's rate limit and the wallet's node, and one balance sweep should not
 * depend on which extension is installed.
 *
 * DECIMALS ARE READ, NEVER GUESSED
 *
 * `TokenEntry.decimals` is always explicit (registry.ts rule 2), so no `?? 18`
 * appears here. That matters more than it looks: BSC's USDC is 18 decimals and
 * every other chain's is 6, so a guess is a 10^12 error in a dollar figure — not
 * a rounding difference, a twelve-orders-of-magnitude one.
 *
 * A REVERTING TOKEN IS `unread`, NOT ZERO
 *
 * Each read is wrapped in `retryRpc`, because a throttled endpoint returns its
 * refusal as HTTP 200 + a JSON-RPC error that ethers converts to "missing revert
 * data" — indistinguishable from an empty answer at the call site (see
 * lib/dex/rpcRetry.ts's header). After the retries are exhausted the symbol goes
 * into `unread` and produces no row, so a portfolio total is never quietly
 * missing a holding it failed to read. Zero balances are dropped too, but for the
 * opposite reason: they were measured, and a wallet does not need forty rows of
 * "0.0".
 */

export interface WalletHolding {
  /** The token's address on `chainId`. Sentinel value for the native asset. */
  address: string;
  symbol: string;
  decimals: number;
  /** Base units, as text. */
  raw: string;
  /** `formatUnits` output — what the balance is in human units. */
  amount: string;
  /** Same as `amount` as a number, for pricing. Finite by construction. */
  value: number;
  isNative: boolean;
}

export interface WalletBalances {
  /** Non-zero holdings only, largest declared decimals first is NOT implied —
   *  order follows the registry, and a caller that wants USD order must sort. */
  holdings: WalletHolding[];
  /** Symbols whose balance could not be read. Rendered as a caveat, not a row. */
  unread: string[];
  /** True until the sweep settles. False with no wallet. */
  loading: boolean;
  /** The chain every address above belongs to. Undefined with no wallet. */
  chainId: number | undefined;
  refresh: () => void;
}

const ERC20_BALANCE_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
];

const EMPTY: { holdings: WalletHolding[]; unread: string[] } = {
  holdings: [],
  unread: [],
};

export function useWalletBalances(): WalletBalances {
  const address = useActiveAccount()?.address;
  const chainId = useActiveWalletChain()?.id;
  const [state, setState] = useState(EMPTY);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!address || !chainId) {
      setState(EMPTY);
      setLoading(false);
      return;
    }

    /* The registry's own answer to "what exists here", plus the native asset,
       which `registeredTokens` deliberately does not carry — it has no ERC20
       contract to enumerate. `"lending"` picks the lending sentinel; either
       protocol's sentinel would do, since nothing below dereferences it, but a
       consumer resolving the address against the lending registry gets a
       recognisable one. */
    const native = nativeTokenOf(CHAINS_BY_ID[chainId], "lending");
    const tokens = registeredTokens(chainId);

    /* Demo mode, after the wallet check so the disconnected empty state still
       behaves. Keyed by symbol, matching the fixture's own shape — see
       lib/mock/balances.ts's header for why that simplification is safe there.
       Nothing is `unread`: a fixture that could not be read would be a fixture
       nobody could explain. Delete with src/lib/mock. */
    if (MOCK_DATA) {
      const rows = [...(native ? [native] : []), ...tokens].flatMap((t) => {
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
          },
        ];
      });
      setState({ holdings: rows, unread: [] });
      setLoading(false);
      return;
    }

    const provider = providerForChain(chainId);
    if (!provider) {
      /* An unregistered chain has no endpoint here, so every symbol is unread
         rather than zero. The native symbol is unknown too in that case, which
         is why the caveat names the chain instead. */
      setState({ holdings: [], unread: [`chain ${chainId}`] });
      setLoading(false);
      return;
    }

    let live = true;
    setLoading(true);

    const readNative = async (): Promise<WalletHolding | string | null> => {
      if (!native) return null;
      try {
        const raw = await retryRpc(() => provider.getBalance(address));
        const amount = ethers.formatUnits(raw, native.decimals);
        return {
          address: native.address,
          symbol: native.symbol,
          decimals: native.decimals,
          raw: raw.toString(),
          amount,
          value: Number(amount),
          isNative: true,
        };
      } catch {
        return native.symbol;
      }
    };

    const readErc20 = async (
      token: (typeof tokens)[number],
    ): Promise<WalletHolding | string> => {
      try {
        const contract = new ethers.Contract(
          token.address,
          ERC20_BALANCE_ABI,
          provider,
        );
        const raw: bigint = await retryRpc(() => contract.balanceOf(address));
        const amount = ethers.formatUnits(raw, token.decimals);
        return {
          address: token.address,
          symbol: token.symbol,
          decimals: token.decimals,
          raw: raw.toString(),
          amount,
          value: Number(amount),
          isNative: false,
        };
      } catch {
        /* A token address that carries no code on this chain reverts here, and
           so does a throttled endpoint after its retries. Both are "we do not
           know", and the symbol is returned in place of a row. */
        return token.symbol;
      }
    };

    void Promise.all([
      readNative(),
      ...tokens.map((t) => readErc20(t)),
    ]).then((results) => {
      if (!live) return;

      const holdings: WalletHolding[] = [];
      const unread: string[] = [];
      for (const r of results) {
        if (r === null) continue;
        if (typeof r === "string") {
          unread.push(r);
          continue;
        }
        /* Measured zeros are dropped; a non-finite one cannot be (a balance so
           large that formatUnits' output overflows a double is not a real
           balance, but it is also not something to sum silently). */
        if (!Number.isFinite(r.value)) {
          unread.push(r.symbol);
          continue;
        }
        if (r.value <= 0) continue;
        holdings.push(r);
      }

      setState({ holdings, unread });
      setLoading(false);
    });

    return () => {
      live = false;
    };
  }, [address, chainId, nonce]);

  return {
    holdings: state.holdings,
    unread: state.unread,
    loading,
    chainId,
    refresh,
  };
}

export default useWalletBalances;
