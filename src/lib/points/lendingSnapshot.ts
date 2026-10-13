/**
 * Lending positions → USD per wallet, for the three lending time sources.
 *
 *   lend             capital a wallet has out on SERVICED loans (as lender)
 *   borrow           what a wallet owes on SERVICED loans (as borrower)
 *   collateral_idle  collateral deposited but NOT locked to a live loan
 *
 * As docs/points-system.md §3a defines them. The loan leg counts
 * min(principal, amount still owed): accrued interest is not "capital out", and a
 * partial repayment shrinks the position it repaid. Idle collateral is the
 * diamond's free (available) balance of each COLLATERAL token — locked collateral
 * earns nothing here, and a lender's repayment credit (loanable token, not
 * collateral) is not collateral at all.
 *
 * Pure: amounts, decimals and prices in, USD out. Reading the chain and pricing
 * tokens is the route's job; so is refusing to write when a read failed (a
 * missing value here must never become a zero, because accrual pays min(then,
 * now) and a false zero erases the interval for good).
 */
import { ethers } from "ethers";

export const LENDING_SOURCES = ["lend", "borrow", "collateral_idle"] as const;
export type LendingSource = (typeof LENDING_SOURCES)[number];

export interface ServicedLoan {
  author: string;
  lender: string;
  /** Loan currency (address(1) for native). */
  token: string;
  /** Principal. */
  amount: bigint;
  /** Still owed (principal + interest − repaid). */
  totalRepayment: bigint;
}

export interface FreeBalance {
  wallet: string;
  token: string;
  amount: bigint;
}

export interface TokenInfo {
  decimals: number;
  /** USD per whole token; null when it could not be priced. */
  usd: number | null;
}

export interface LendingValues {
  bySource: Record<LendingSource, Map<string, number>>;
  /** Tokens a position needed but that had no price — the caller must not write. */
  unpriced: string[];
}

export function lendingUsd(args: {
  loans: ServicedLoan[];
  free: FreeBalance[];
  tokens: Map<string, TokenInfo>;
  exclude: Set<string>;
}): LendingValues {
  const bySource: Record<LendingSource, Map<string, number>> = {
    lend: new Map(),
    borrow: new Map(),
    collateral_idle: new Map(),
  };
  const unpriced = new Set<string>();

  const usdOf = (token: string, amount: bigint): number | null => {
    const info = args.tokens.get(token.toLowerCase());
    if (!info || info.usd === null) {
      unpriced.add(token.toLowerCase());
      return null;
    }
    return Number(ethers.formatUnits(amount, info.decimals)) * info.usd;
  };
  const add = (source: LendingSource, wallet: string, usd: number) => {
    const w = wallet.toLowerCase();
    if (args.exclude.has(w) || !(usd > 0)) return;
    const m = bySource[source];
    m.set(w, (m.get(w) ?? 0) + usd);
  };

  for (const loan of args.loans) {
    const outstanding = loan.amount < loan.totalRepayment ? loan.amount : loan.totalRepayment;
    if (outstanding <= 0n) continue;
    const usd = usdOf(loan.token, outstanding);
    if (usd === null) continue;
    add("lend", loan.lender, usd);
    add("borrow", loan.author, usd);
  }
  for (const f of args.free) {
    if (f.amount <= 0n) continue;
    const usd = usdOf(f.token, f.amount);
    if (usd === null) continue;
    add("collateral_idle", f.wallet, usd);
  }
  return { bySource, unpriced: [...unpriced] };
}
