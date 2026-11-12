/** Match the native router's existing 15% maximum loss threshold. */
export const MAX_QUOTE_LOSS = 0.15;
export function exceedsQuoteLoss(input: number, output: number): boolean {
  return Number.isFinite(input) && input > 0 && Number.isFinite(output) && output >= 0 && output / input < 1 - MAX_QUOTE_LOSS;
}
/** Reject catastrophic upstream value loss and fixed V4 fees before building calldata.
 * V4's dynamic-fee flag (0x800000) is not a percentage and must not be compared.
 */
export function unsafeKyberQuote(summary: Record<string, unknown>): boolean {
  if (exceedsQuoteLoss(Number(summary.amountInUsd), Number(summary.amountOutUsd))) return true;
  if (!Array.isArray(summary.route)) return false;
  return summary.route.some((path: unknown) => Array.isArray(path) && path.some((leg: unknown) => {
    if (!leg || typeof leg !== "object") return false;
    const row = leg as { poolType?: string; poolExtra?: { fee?: unknown } };
    if (row.poolType !== "uniswap-v4") return false;
    const fee = Number(row.poolExtra?.fee);
    return Number.isFinite(fee) && fee >= 0 && fee <= 1_000_000 && fee / 1_000_000 > MAX_QUOTE_LOSS;
  }));
}
