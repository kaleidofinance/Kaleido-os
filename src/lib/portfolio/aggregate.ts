import type { Position, PositionGroup } from "@/hooks/usePortfolio";

/**
 * Portfolio v2: fold the Wallet group's per-(token, chain) rows into one row per
 * token, the way Uniswap / Zerion / DeBank list holdings. A wallet with USDC on
 * three chains reads as one USDC line with three network badges, and expands to
 * the per-chain split.
 *
 * Keyed on the upper-cased symbol. That is a display grouping, never an identity:
 * nothing resolves a token through it, and every child row keeps its own chain and
 * address. Two different tokens sharing a ticker on two chains would fold together
 * — acceptable for a holdings list, which is why the children are always shown.
 *
 * Value rules match usePortfolio's: an unpriced child makes the token's total
 * unknown (null), never short. A token whose children are all unpriced sorts last.
 */
export interface TokenAggregate {
  key: string;
  symbol: string;
  /** Sum of child USD values; null when any child could not be priced. */
  valueUsd: number | null;
  /** Sum of child amounts in token units (same symbol, so summable). */
  amount: number;
  chains: Position[];
}

/** Parse the human amount usePortfolio writes ("1,240.5", "0.28"). */
export function amountOf(p: Position): number {
  if (!p.amount) return 0;
  const n = Number(p.amount.replace(/,/g, "").replace(/[^\d.eE+-].*$/, ""));
  return Number.isFinite(n) ? n : 0;
}

export function aggregateByToken(rows: Position[]): TokenAggregate[] {
  const by = new Map<string, TokenAggregate>();
  for (const r of rows) {
    const key = r.label.trim().toUpperCase();
    let t = by.get(key);
    if (!t) {
      t = { key, symbol: r.label, valueUsd: 0, amount: 0, chains: [] };
      by.set(key, t);
    }
    t.chains.push(r);
    t.amount += amountOf(r);
    t.valueUsd =
      t.valueUsd === null || r.valueUsd === null ? null : t.valueUsd + r.valueUsd;
  }
  const out = [...by.values()];
  for (const t of out)
    t.chains.sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1));
  // A token with a partial price still has a floor worth sorting by.
  const floor = (t: TokenAggregate) =>
    t.valueUsd ?? t.chains.reduce((s, c) => s + (c.valueUsd ?? 0), 0) - 0.5;
  return out.sort((a, b) => floor(b) - floor(a));
}

export interface AllocationSlice {
  id: string;
  label: string;
  valueUsd: number;
  share: number;
}

/**
 * Where the money is, by group, for the Overview bar. Only positive subtotals
 * are allocation (Borrowing's is net of debt and can be negative, which is not a
 * slice of anything). Shares sum to 1 over what is shown; empty when nothing is
 * priced.
 */
export function allocation(groups: PositionGroup[]): AllocationSlice[] {
  const parts = groups
    .filter((g) => (g.subtotalUsd ?? 0) > 0)
    .map((g) => ({ id: g.id, label: g.title, valueUsd: g.subtotalUsd as number }));
  const total = parts.reduce((s, p) => s + p.valueUsd, 0);
  if (total <= 0) return [];
  return parts
    .map((p) => ({ ...p, share: p.valueUsd / total }))
    .sort((a, b) => b.valueUsd - a.valueUsd);
}
