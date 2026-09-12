"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useActiveAccount } from "thirdweb/react";
import { providerForChain } from "@/config/provider";
import { lendingChains } from "@/lib/lending/chain";
import {
  readBorrowPositions,
  type ChainBorrowPositions,
} from "@/lib/lending/positions";
import { MOCK_DATA } from "@/lib/mock";

/**
 * The wallet's borrow position on EVERY lending chain — collateral, debt and the
 * per-chain health factor, each an isolated market.
 *
 * Replaces the portfolio's single-chain borrowing path (useGetValueAndHealth +
 * useGetActiveRequest, both pinned to one read-chain). It sweeps `lendingChains()`
 * through `readBorrowPositions`, whose scaling is unit-tested in positions.test.ts
 * — the reason a fresh cross-chain reader was safe to write. Each chain fails soft
 * to an empty position, so one dead endpoint never empties the sweep.
 *
 * Health is deliberately NOT aggregated here: markets are isolated (Aave-V3
 * model), so there is one health factor per chain and blending them would be
 * meaningless. The consumer takes the worst (min) for its one-line summary and
 * shows each chain's own on its rows.
 */
export interface BorrowPositionsAcrossChains {
  chains: ChainBorrowPositions[];
  loading: boolean;
  refresh: () => void;
}

export function useBorrowPositionsAcrossChains(): BorrowPositionsAcrossChains {
  const address = useActiveAccount()?.address;
  const chainIds = useMemo(() => lendingChains(), []);
  const [chains, setChains] = useState<ChainBorrowPositions[]>([]);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!address || MOCK_DATA) {
      setChains([]);
      setLoading(false);
      return;
    }

    let live = true;
    setLoading(true);

    void Promise.all(
      chainIds.map(async (c) => {
        const provider = providerForChain(c);
        if (!provider) return null;
        return readBorrowPositions(provider, c, address);
      }),
    ).then((results) => {
      if (!live) return;
      setChains(
        results.filter((r): r is ChainBorrowPositions => r !== null),
      );
      setLoading(false);
    });

    return () => {
      live = false;
    };
  }, [address, chainIds, nonce]);

  return { chains, loading, refresh };
}

export default useBorrowPositionsAcrossChains;
