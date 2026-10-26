/** Merge transaction-level swaps with native pool logs for a single chain.
 * A routed transaction may emit several pool logs: its recorded trade notional
 * always wins. For native-only transactions use the largest valued pool leg;
 * multiple legs are marked partial because their transaction notional is unknown.
 */
export function summarizeSwapTotals(
  swaps: readonly { tx_hash: string; usd_value: unknown; fee_paid: boolean | null }[],
  pools: readonly { tx_hash: string; usd_value: unknown }[],
) {
  const trades = new Map<string, { usd: number; feePaid: boolean }>();
  const positive = (value: unknown) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  for (const row of swaps) {
    trades.set(row.tx_hash.toLowerCase(), { usd: positive(row.usd_value), feePaid: row.fee_paid === true });
  }
  const native = new Map<string, { usd: number; legs: number }>();
  for (const row of pools) {
    const key = row.tx_hash.toLowerCase();
    if (trades.has(key)) continue;
    const old = native.get(key);
    native.set(key, { usd: Math.max(old?.usd ?? 0, positive(row.usd_value)), legs: (old?.legs ?? 0) + 1 });
  }
  let volumeUsd = 0;
  let feeVolumeUsd = 0;
  for (const trade of trades.values()) {
    volumeUsd += trade.usd;
    if (trade.feePaid) feeVolumeUsd += trade.usd;
  }
  for (const trade of native.values()) volumeUsd += trade.usd;
  return { volumeUsd, feeVolumeUsd, swapCount: trades.size + native.size,
    partial: [...native.values()].some((trade) => trade.legs > 1) };
}
