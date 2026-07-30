"use client";

import { useMemo, useState } from "react";
import { ethers } from "ethers";
import useDataFiltersPanel from "@/hooks/useDataFilterPanel";
import { formatAddress } from "@/constants/utils/formatAddress";
import { tokenImageMap } from "@/constants/utils/tokenImageMap";
import { convertbasisPointsToPercentage } from "@/constants/utils/FormatInterestRate";
import { getTimeUntil, getOverdue } from "@/constants/utils/formatOderDate";
import { getTokenDecimals } from "@/constants/utils/formatTokenDecimals";
import { formatWithCommas } from "@/constants/utils/formatNumber";

/**
 * The order book, as a table.
 *
 * Replaces the card grid: the job on this screen is picking the best offer, and
 * cards place every rate in a different position, so comparison happens from
 * memory instead of by scanning a column.
 *
 * Note the rate colour polarity flips by side. Borrowing, a low rate is good;
 * lending, a high rate is good. A single fixed scale would praise the wrong
 * offers on one of the two tabs.
 */

type SortKey = "interest" | "returnDate" | "amount";
type SortDir = "asc" | "desc";

interface Row {
  listingId?: string;
  requestId?: string;
  tokenAddress: string;
  amount: string;
  interest: number;
  status: string;
  returnDate: string;
  sender?: string;
  author?: string;
  minAmount?: string;
  maxAmount?: string;
}

const HEAD =
  "sticky top-0 z-20 bg-surface py-2.5 text-[10px] font-medium uppercase tracking-[0.1em] text-content-muted";

const OfferTable = () => {
  const filters = useDataFiltersPanel();
  const [sortKey, setSortKey] = useState<SortKey>("interest");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const isBorrow = filters?.activeTable !== "lend";
  // Both paginated* values are page objects, not arrays — the rows live on .data.
  const rows: Row[] = useMemo(() => {
    const page = isBorrow
      ? filters?.paginatedBorrowData
      : filters?.paginatedLendData;
    return (page?.data ?? []) as unknown as Row[];
  }, [isBorrow, filters?.paginatedBorrowData, filters?.paginatedLendData]);
  const loading = isBorrow ? filters?.loadingBorrow : filters?.lendLoading;

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      let av: number;
      let bv: number;
      if (sortKey === "interest") {
        av = Number(a.interest);
        bv = Number(b.interest);
      } else if (sortKey === "returnDate") {
        av = Number(a.returnDate);
        bv = Number(b.returnDate);
      } else {
        av = Number(a.amount);
        bv = Number(b.amount);
      }
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  /** Median rate of what's on screen, so "cheap" means cheap for this book. */
  const median = useMemo(() => {
    const rates = rows
      .map((r) => Number(r.interest))
      .filter((n) => Number.isFinite(n) && n > 0)
      .sort((a, b) => a - b);
    if (!rates.length) return 0;
    return rates[Math.floor(rates.length / 2)];
  }, [rows]);

  const rateTone = (bps: number) => {
    if (!median || !bps) return "text-content";
    const favourable = isBorrow ? bps < median * 0.85 : bps > median * 1.15;
    const poor = isBorrow ? bps > median * 1.15 : bps < median * 0.85;
    if (favourable) return "text-positive";
    if (poor) return "text-accent-alt";
    return "text-content";
  };

  const sortBy = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      // Rate ascending is the useful default when borrowing; descending when
      // lending, since each side wants the opposite end of the book.
      setSortDir(key === "interest" && !isBorrow ? "desc" : "asc");
    }
  };

  const ariaSort = (key: SortKey) =>
    sortKey === key
      ? sortDir === "asc"
        ? ("ascending" as const)
        : ("descending" as const)
      : undefined;

  return (
    <div className="w-full min-w-0">
      {/* Side toggle — a borrower should never scan offers they can't take. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex gap-0.5 rounded-lg border border-edge bg-surface p-0.5">
          <button
            onClick={() => filters?.handleTableChange?.("borrow")}
            aria-pressed={isBorrow}
            className={`rounded-md px-4 py-1.5 text-sm transition-colors ${
              isBorrow
                ? "bg-surface-hover text-content"
                : "text-content-muted hover:text-content"
            }`}
          >
            Borrow
          </button>
          <button
            onClick={() => filters?.handleTableChange?.("lend")}
            aria-pressed={!isBorrow}
            className={`rounded-md px-4 py-1.5 text-sm transition-colors ${
              !isBorrow
                ? "bg-surface-hover text-content"
                : "text-content-muted hover:text-content"
            }`}
          >
            Lend
          </button>
        </div>
        <span className="text-[11px] text-content-muted">
          {sorted.length} {isBorrow ? "offers to borrow from" : "requests to fund"}
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-edge">
        <table className="min-w-[680px] w-full text-sm">
          <thead>
            <tr>
              <th className={`${HEAD} pl-4 text-left`}>
                {isBorrow ? "Lender" : "Borrower"}
              </th>
              <th
                className={`${HEAD} cursor-pointer select-none text-right hover:text-content`}
                aria-sort={ariaSort("amount")}
                onClick={() => sortBy("amount")}
              >
                Amount
              </th>
              <th
                className={`${HEAD} cursor-pointer select-none text-right hover:text-content`}
                aria-sort={ariaSort("interest")}
                onClick={() => sortBy("interest")}
              >
                APR
              </th>
              <th
                className={`${HEAD} cursor-pointer select-none text-right hover:text-content`}
                aria-sort={ariaSort("returnDate")}
                onClick={() => sortBy("returnDate")}
              >
                Term
              </th>
              <th className={`${HEAD} text-center`}>Status</th>
              <th className={`${HEAD} pr-4 text-right`}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 6 }, (_, i) => (
                <tr key={`s${i}`} className="border-t border-edge">
                  {Array.from({ length: 6 }, (__, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-4 animate-pulse rounded bg-surface-hover" />
                    </td>
                  ))}
                </tr>
              ))}

            {!loading && sorted.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center">
                  <p className="text-sm text-content-secondary">
                    No {isBorrow ? "offers" : "requests"} match your filters.
                  </p>
                  <p className="mt-1 text-xs text-content-muted">
                    Widen the filters, or post your own at the rate you want.
                  </p>
                </td>
              </tr>
            )}

            {!loading &&
              sorted.map((row, i) => {
                const token = tokenImageMap[row.tokenAddress] ?? {
                  image: "/Eye.svg",
                  label: "—",
                };
                const decimals = getTokenDecimals(row.tokenAddress);
                const counterparty = isBorrow ? row.sender : row.author;
                const isMine =
                  counterparty?.toLowerCase() === filters?.address?.toLowerCase();
                const [, isOverdue] = getOverdue(Number(row.returnDate));
                const apr = convertbasisPointsToPercentage(row.interest);

                let amount = "—";
                try {
                  amount = formatWithCommas(
                    ethers.formatUnits(row.amount ?? "0", decimals),
                    token.label === "ETH" ? 4 : 2,
                  );
                } catch {
                  amount = "—";
                }

                return (
                  <tr
                    key={row.listingId ?? row.requestId ?? i}
                    className="border-t border-edge transition-colors hover:bg-surface-hover"
                  >
                    <td className="py-3 pl-4">
                      <div className="flex items-center gap-2">
                        <img
                          src={token.image}
                          alt=""
                          className="h-6 w-6 shrink-0 rounded-full"
                        />
                        <div className="min-w-0">
                          <div className="truncate text-content">
                            {token.label}
                          </div>
                          <div className="font-mono text-[11px] text-content-muted">
                            {counterparty ? formatAddress(counterparty) : "—"}
                            {isMine && " · you"}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="py-3 text-right font-mono tabular-nums text-content">
                      {amount}
                    </td>

                    <td
                      className={`py-3 text-right font-mono tabular-nums ${rateTone(Number(row.interest))}`}
                    >
                      {apr}%
                    </td>

                    <td className="py-3 text-right font-mono text-xs tabular-nums text-content-secondary">
                      {getTimeUntil(Number(row.returnDate))}
                    </td>

                    <td className="py-3 text-center">
                      <span
                        className={`inline-block rounded px-2 py-0.5 text-[11px] ${
                          isOverdue
                            ? "bg-negative-subtle text-negative"
                            : row.status === "OPEN"
                              ? "bg-accent-subtle text-accent"
                              : "bg-surface-raised text-content-muted"
                        }`}
                      >
                        {isOverdue ? "Overdue" : row.status || "—"}
                      </span>
                    </td>

                    <td className="py-3 pr-4 text-right">
                      {isMine ? (
                        <button
                          onClick={() =>
                            isBorrow
                              ? filters?.closeListingAd(Number(row.listingId))
                              : filters?.closeRequest(Number(row.requestId))
                          }
                          className="rounded-md border border-edge px-2.5 py-1 text-xs text-content-muted transition-colors hover:border-edge-strong hover:text-content"
                        >
                          Close
                        </button>
                      ) : (
                        <button
                          disabled={isOverdue}
                          onClick={() =>
                            isBorrow
                              ? filters?.handleBorrowAllocation(row)
                              : filters?.serviceRequest(
                                  Number(row.requestId),
                                  String(row.tokenAddress),
                                  row.amount,
                                )
                          }
                          className="rounded-md bg-accent px-3 py-1 text-xs font-semibold text-content-onAccent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-surface-raised disabled:text-content-muted"
                        >
                          {isBorrow ? "Borrow" : "Fund"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default OfferTable;
