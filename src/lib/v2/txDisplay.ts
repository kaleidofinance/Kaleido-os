/** Compact, wallet-style copy for the local transaction activity feed. */

const AMOUNT = /\b\d+(?:\.\d+)?\b/g;

export function formatTxAmount(raw: string): string {
  const value = Number(raw);
  if (!Number.isFinite(value)) return raw;
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 6,
    useGrouping: true,
  }).format(value);
}

function formatNumbers(text: string): string {
  return text.replace(AMOUNT, (raw) => {
    /* Keep short integers as authored — “Swap 2 USDC” is clearer than “2.00”. */
    if (!raw.includes(".") && raw.length < 4) return raw;
    return formatTxAmount(raw);
  });
}

export function displayTxTitle(title: string): string {
  const formatted = formatNumbers(title);
  const swap = formatted.match(/^Swap (.+) for (.+)$/);
  return swap ? `Swap ${swap[1]} → ${swap[2]}` : formatted;
}

export function displayTxDetail(detail?: string): string | undefined {
  if (!detail) return undefined;
  const minimum = detail.match(/At least ([\d.]+) (\S+) after slippage\.?/i);
  if (minimum) {
    const prefix = detail.slice(0, minimum.index).trim().replace(/[.:]$/, "");
    const floor = `Min. received ${formatTxAmount(minimum[1])} ${minimum[2]}`;
    return prefix ? `${formatNumbers(prefix)} · ${floor}` : floor;
  }
  if (detail === "One-time approval.") return "Approval";
  return formatNumbers(detail);
}
