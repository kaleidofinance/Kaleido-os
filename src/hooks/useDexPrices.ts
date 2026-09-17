"use client";

import { useEffect, useMemo, useState } from "react";

export interface DexPriceRequest {
  chainId: number;
  address: string;
  decimals: number;
}

/**
 * USD prices for tokens the spot feed can't carry — Arc's ecosystem — from
 * `/api/prices/dex`, which quotes them on the KyberSwap aggregator.
 *
 * Pass the holdings that came back unpriced from spot; get back a lookup by
 * (chain, address). The portfolio uses it as the fallback under `priceOf`, so a
 * wallet of EURC/cirBTC/meme tokens shows dollar values instead of dashes. An
 * empty request list makes no call; a token that doesn't route is simply absent.
 */
export function useDexPrices(
  tokens: DexPriceRequest[],
): (chainId: number, address: string) => number | null {
  const [prices, setPrices] = useState<Record<string, number>>({});

  /* A stable key so the effect only refetches when the SET of tokens changes,
     not on every render (the caller rebuilds the array each time). */
  const key = useMemo(
    () =>
      tokens
        .map((t) => `${t.chainId}:${t.address.toLowerCase()}:${t.decimals}`)
        .sort()
        .join(","),
    [tokens],
  );

  useEffect(() => {
    if (!key) {
      setPrices({});
      return;
    }
    let cancelled = false;

    const byChain = new Map<number, DexPriceRequest[]>();
    for (const t of tokens) {
      const list = byChain.get(t.chainId) ?? [];
      list.push(t);
      byChain.set(t.chainId, list);
    }

    void (async () => {
      const merged: Record<string, number> = {};
      await Promise.all(
        [...byChain.entries()].map(async ([chainId, list]) => {
          const qs = new URLSearchParams({
            chainId: String(chainId),
            tokens: list.map((t) => `${t.address}:${t.decimals}`).join(","),
          });
          try {
            const res = await fetch(`/api/prices/dex?${qs}`);
            if (!res.ok) return;
            const body = (await res.json()) as {
              prices?: Record<string, number>;
            };
            for (const [addr, usd] of Object.entries(body.prices ?? {})) {
              merged[`${chainId}:${addr.toLowerCase()}`] = usd;
            }
          } catch {
            /* Leave these tokens unpriced — a dash, not a wrong number. */
          }
        }),
      );
      if (!cancelled) setPrices(merged);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (chainId, address) =>
    prices[`${chainId}:${address.toLowerCase()}`] ?? null;
}
