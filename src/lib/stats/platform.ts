import { supabaseAdmin } from "@/lib/supabase/serverClient";
import { readAggregatorStats, type AggregatorStats } from "./aggregator";

/**
 * Platform-wide cumulative activity, summed across every Kaleido product for the
 * pool page's "Total volume" / "Total fees" strip.
 *
 * WHAT IS COUNTED — the ledgers that exist:
 *
 *   - SWAPS (agent + manual UI): `aggregator_swap_stats`. On Arc every swap the
 *     app or Luca makes routes through the aggregator, which itself routes over
 *     native Kaleido pools AND external liquidity — so this one cumulative figure
 *     already IS "trades through the route and the native pools". Fees are
 *     Kaleido's own fee revenue at the configured rate (external LP fees excluded
 *     on purpose — those are the LPs' money, not the protocol's).
 *   - CCTP BRIDGES: `cctp_transfers`. Each row an on-chain-verified USDC burn,
 *     amount the human USDC figure (~1:1 USD). No per-transfer fee is stored (the
 *     CCTP fast fee is small and unrecorded), so CCTP contributes volume only.
 *   - ROUTE BRIDGES (LI.FI): `route_bridges`. Each row an on-chain-verified
 *     bridge to a known router, notional priced server-side (api/bridge/record).
 *     Our integrator fee is a share (LIFI_FEE) of that volume, derived here.
 *
 * The sources stay separate server-side (a 24h pool sample must never be mistaken
 * for all-time revenue), and this is the ONE place they are summed. `null` only
 * when EVERY source is unavailable — a partial (one mid-migration) still returns
 * a real, if understated, total rather than a blank tile.
 */

export interface BridgeStats {
  volumeUsd: number;
  count: number;
}

export interface PlatformTotals {
  /** Swaps + CCTP bridges + route bridges, of whichever sources answered. */
  volumeUsd: number;
  /** Swap fee revenue + route-bridge integrator fee (LIFI_FEE share). */
  feesUsd: number;
  breakdown: {
    swapVolumeUsd: number | null;
    swapFeesUsd: number | null;
    swapCount: number | null;
    cctpBridgeVolumeUsd: number | null;
    cctpBridgeCount: number | null;
    routeBridgeVolumeUsd: number | null;
    routeBridgeCount: number | null;
    bridgeFeesUsd: number;
  };
}

/** The integrator fee LI.FI attributes to us, as a share of routed volume.
 *  Mirrors swapFeeBps(): the same value the bridge quotes are built with. Unset
 *  or malformed → 0, so a deployment that has not turned the fee on shows no
 *  bridge-fee revenue rather than a fabricated one. */
export function lifiFeeRate(): number {
  const raw = Number(process.env.LIFI_FEE);
  return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 0;
}

/** Sum the human USDC amounts of recorded CCTP burns. Pure, so it is tested
 *  without a database; a non-numeric or non-positive amount contributes 0. */
export function sumBridgeVolume(
  rows: ReadonlyArray<{ amount?: string | null }>,
): number {
  let total = 0;
  for (const row of rows) {
    const n = Number(row?.amount ?? 0);
    if (Number.isFinite(n) && n > 0) total += n;
  }
  return total;
}

/** Sum the priced USD notionals of recorded route bridges. Pure. */
export function sumRouteBridgeVolume(
  rows: ReadonlyArray<{ usd_value?: number | string | null }>,
): number {
  let total = 0;
  for (const row of rows) {
    const n = Number(row?.usd_value ?? 0);
    if (Number.isFinite(n) && n > 0) total += n;
  }
  return total;
}

/** Cumulative CCTP bridge volume from the transfers ledger. Missing table or no
 *  client reads as `null` — unavailable, not a confident zero. */
export async function readBridgeStats(): Promise<BridgeStats | null> {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from("cctp_transfers")
    .select("amount, status")
    .neq("status", "failed")
    .limit(50_000);
  if (error || !data) return null;
  return {
    volumeUsd: sumBridgeVolume(data as { amount?: string | null }[]),
    count: data.length,
  };
}

/** Cumulative aggregator-route (LI.FI) bridge volume from the route ledger. */
export async function readRouteBridgeStats(): Promise<BridgeStats | null> {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from("route_bridges")
    .select("usd_value")
    .limit(50_000);
  if (error || !data) return null;
  return {
    volumeUsd: sumRouteBridgeVolume(
      data as { usd_value?: number | string | null }[],
    ),
    count: data.length,
  };
}

export interface PlatformDeps {
  swaps: () => Promise<AggregatorStats | null>;
  cctpBridge: () => Promise<BridgeStats | null>;
  routeBridge: () => Promise<BridgeStats | null>;
  feeRate: () => number;
}

/** The aggregation, with its readers + the fee rate injectable so the summing is
 *  tested without a database or env. */
export async function readPlatformTotals(
  deps: PlatformDeps = {
    swaps: readAggregatorStats,
    cctpBridge: readBridgeStats,
    routeBridge: readRouteBridgeStats,
    feeRate: lifiFeeRate,
  },
): Promise<PlatformTotals | null> {
  const [swaps, cctp, route] = await Promise.all([
    deps.swaps(),
    deps.cctpBridge(),
    deps.routeBridge(),
  ]);
  if (!swaps && !cctp && !route) return null;

  const swapVolumeUsd = swaps?.volumeUsd ?? 0;
  const swapFeesUsd = swaps?.feesUsd ?? 0;
  const cctpVolumeUsd = cctp?.volumeUsd ?? 0;
  const routeVolumeUsd = route?.volumeUsd ?? 0;
  const bridgeFeesUsd = routeVolumeUsd * deps.feeRate();

  return {
    volumeUsd: swapVolumeUsd + cctpVolumeUsd + routeVolumeUsd,
    feesUsd: swapFeesUsd + bridgeFeesUsd,
    breakdown: {
      swapVolumeUsd: swaps ? swaps.volumeUsd : null,
      swapFeesUsd: swaps ? swaps.feesUsd : null,
      swapCount: swaps ? swaps.swapCount : null,
      cctpBridgeVolumeUsd: cctp ? cctp.volumeUsd : null,
      cctpBridgeCount: cctp ? cctp.count : null,
      routeBridgeVolumeUsd: route ? route.volumeUsd : null,
      routeBridgeCount: route ? route.count : null,
      bridgeFeesUsd,
    },
  };
}
