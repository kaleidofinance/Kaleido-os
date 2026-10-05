"use client";

/**
 * Announces limit-order fills — including the ones that happened while the
 * user was away.
 *
 * Polls the maker's stored orders (the keeper records `fills` as it observes
 * them) on every chain with an orders contract, and diffs each order's fill
 * count against what this browser last announced (localStorage, per wallet +
 * chain). A count that went up is a fill to announce; the first ever read for a
 * wallet only sets the baseline (see `newFills`). So a fill is reported on the
 * next visit even if the tab was closed when it landed — no backend push needed.
 */
import { useEffect } from "react";
import { visibleInterval } from "@/lib/visibleInterval";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import { useTestnetMode } from "@/hooks/v2/useTestnetMode";
import { CHAINS_BY_ID } from "@/constants/chains";
import { getContracts } from "@/constants/registry";
import { chainTokenByAddress } from "@/constants/tokens";
import { fetchOrders } from "@/lib/dex/orders";
import { newFills, type SeenFills } from "@/lib/notifications/activity";
import { sendOrderFilledNotification } from "@/lib/notifications/emit";

/* 5 min, visible tabs only (was 60s in every tab — the top request source). */
const POLL_MS = 5 * 60_000;
const key = (wallet: string, chainId: number) =>
  `kaleido_order_fills:${chainId}:${wallet.toLowerCase()}`;

function loadSeen(k: string): SeenFills | null {
  try {
    const raw = localStorage.getItem(k);
    return raw ? (JSON.parse(raw) as SeenFills) : null;
  } catch {
    return null;
  }
}

function saveSeen(k: string, seen: SeenFills): void {
  try {
    localStorage.setItem(k, JSON.stringify(seen));
  } catch {
    /* storage blocked — worst case a fill is announced again next visit */
  }
}

export default function useOrderFills(): void {
  const { address } = useWalletV2();
  const { showTestnets } = useTestnetMode();

  useEffect(() => {
    if (!address) return;
    const chains = Object.values(CHAINS_BY_ID)
      .filter((c) => showTestnets || c.network === "mainnet")
      .map((c) => c.id)
      .filter((id) => !!getContracts(id).orders);
    if (chains.length === 0) return;

    let cancelled = false;
    const check = async () => {
      for (const chainId of chains) {
        try {
          const rows = await fetchOrders(address, chainId);
          if (cancelled) return;
          const k = key(address, chainId);
          const { filled, next } = newFills(
            rows.map((r) => ({
              hash: r.hash,
              fills: Number(r.fills ?? 0),
              tokenIn: r.order.tokenIn,
              tokenOut: r.order.tokenOut,
              interval: Number(r.order.interval ?? 0),
            })),
            loadSeen(k),
          );
          saveSeen(k, next);
          for (const f of filled) {
            const sym = (a: string) =>
              chainTokenByAddress(chainId, a)?.symbol ?? "token";
            sendOrderFilledNotification(
              `${sym(f.tokenIn)} → ${sym(f.tokenOut)}`,
              f.interval > 0,
            );
          }
        } catch {
          /* orders API or chain unreachable — try again next poll */
        }
      }
    };

    void check();
    const stop = visibleInterval(() => void check(), POLL_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, [address, showTestnets]);
}
