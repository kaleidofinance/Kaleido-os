"use client";

import { useMemo, useState } from "react";
import { ethers } from "ethers";
import Nav from "@/components/v2/Nav";
import useDataFiltersPanel from "@/hooks/useDataFilterPanel";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import { formatAddress } from "@/constants/utils/formatAddress";
import { convertbasisPointsToPercentage } from "@/constants/utils/FormatInterestRate";
import { getTimeUntil, getOverdue } from "@/constants/utils/formatOderDate";
import { getTokenDecimals } from "@/constants/utils/formatTokenDecimals";
import { formatWithCommas } from "@/constants/utils/formatNumber";
import { tokenImageMap } from "@/constants/utils/tokenImageMap";
import s from "./borrow.module.css";

/**
 * Borrow — Kaleido's P2P order book, on the v2 system.
 *
 * Reuses the data wiring proven in components/market/OfferTable: the same hook,
 * the same actions, the same median-relative rate tone. Only the presentation
 * is new. The rate column reads "APR" because the contract now normalises
 * interest by term (feat(contracts): APR-normalised interest) — before that
 * fix, a rate in isolation was meaningless.
 *
 * The "Instant" pool-backed band from the mockup is deferred: isFeatured exists
 * on the LoanListing struct but isn't surfaced in the frontend data yet, and
 * inventing it would be dishonest.
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
}

export default function BorrowPage() {
  const filters = useDataFiltersPanel();
  const { isConnected } = useWalletV2();
  const [sortKey, setSortKey] = useState<SortKey>("interest");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const isBorrow = filters?.activeTable !== "lend";

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
      const pick = (r: Row) =>
        sortKey === "interest"
          ? Number(r.interest)
          : sortKey === "returnDate"
            ? Number(r.returnDate)
            : Number(r.amount);
      return sortDir === "asc" ? pick(a) - pick(b) : pick(b) - pick(a);
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  /** Median of the visible book, so "cheap" means cheap for what's on offer now. */
  const median = useMemo(() => {
    const rates = rows
      .map((r) => Number(r.interest))
      .filter((n) => Number.isFinite(n) && n > 0)
      .sort((a, b) => a - b);
    return rates.length ? rates[Math.floor(rates.length / 2)] : 0;
  }, [rows]);

  // Rate polarity flips by side: borrowing wants low, lending wants high.
  const rateClass = (bps: number) => {
    if (!median || !bps) return "";
    const good = isBorrow ? bps < median * 0.85 : bps > median * 1.15;
    const bad = isBorrow ? bps > median * 1.15 : bps < median * 0.85;
    return good ? s.rateGood : bad ? s.rateBad : "";
  };

  const sortBy = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "interest" && !isBorrow ? "desc" : "asc");
    }
  };

  const sortMark = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  return (
    <>
      <Nav />
      <main className={s.wrap}>
        <div className={s.head}>
          <h1 className={s.h1}>Borrow</h1>
          <div className={s.toggle}>
            <button
              className={`${s.tg} ${isBorrow ? s.on : ""}`}
              onClick={() => filters?.handleTableChange?.("borrow")}
              aria-pressed={isBorrow}
            >
              Borrow
            </button>
            <button
              className={`${s.tg} ${!isBorrow ? s.on : ""}`}
              onClick={() => filters?.handleTableChange?.("lend")}
              aria-pressed={!isBorrow}
            >
              Lend
            </button>
          </div>
        </div>

        <div className={s.cols}>
          <div>
            <div className={s.gHead}>
              <span className={s.gTitle}>
                {isBorrow ? "Open offers" : "Loan requests"}
              </span>
              <span className={s.gCount}>
                {sorted.length}{" "}
                {isBorrow ? "to borrow from" : "to fund"}
              </span>
            </div>

            <div className={s.table}>
              <div className={s.tw}>
                <div className={`${s.tr} ${s.thead}`}>
                  <span>{isBorrow ? "Lender" : "Borrower"}</span>
                  <button className={s.sortable} onClick={() => sortBy("amount")}>
                    Amount{sortMark("amount")}
                  </button>
                  <button className={s.sortable} onClick={() => sortBy("interest")}>
                    APR{sortMark("interest")}
                  </button>
                  <button className={s.sortable} onClick={() => sortBy("returnDate")}>
                    Term{sortMark("returnDate")}
                  </button>
                  <span className={s.center}>Status</span>
                  <span />
                </div>

                {loading &&
                  Array.from({ length: 5 }, (_, i) => (
                    <div key={`sk${i}`} className={s.tr}>
                      <div className={s.skRow}>
                        <span className={s.skCircle} />
                        <span className={s.skLine} />
                      </div>
                    </div>
                  ))}

                {!loading && sorted.length === 0 && (
                  <div className={s.empty}>
                    <div className={s.emptyTitle}>
                      No {isBorrow ? "offers" : "requests"} right now.
                    </div>
                    <div className={s.emptySub}>
                      Post your own at the rate and term you want.
                    </div>
                  </div>
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
                      counterparty?.toLowerCase() ===
                      filters?.address?.toLowerCase();
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
                      <div
                        key={row.listingId ?? row.requestId ?? i}
                        className={s.tr}
                      >
                        <div className={s.asset}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img className={s.aImg} src={token.image} alt="" />
                          <div className={s.aMeta}>
                            <div className={s.aName}>{token.label}</div>
                            <div className={s.aSub}>
                              {counterparty ? formatAddress(counterparty) : "—"}
                              {isMine && " · you"}
                            </div>
                          </div>
                        </div>
                        <span className={`${s.cellNum} tabular`}>{amount}</span>
                        <span
                          className={`${s.cellNum} tabular ${rateClass(Number(row.interest))}`}
                        >
                          {apr}%
                        </span>
                        <span className={`${s.cellNum} ${s.term} tabular`}>
                          {getTimeUntil(Number(row.returnDate))}
                        </span>
                        <span className={s.center}>
                          <span
                            className={`${s.badge} ${
                              isOverdue
                                ? s.badgeBad
                                : row.status === "OPEN"
                                  ? s.badgeOpen
                                  : ""
                            }`}
                          >
                            {isOverdue ? "Overdue" : row.status || "—"}
                          </span>
                        </span>
                        <span className={s.actionCell}>
                          {isMine ? (
                            <button
                              className={s.closeBtn}
                              onClick={() =>
                                isBorrow
                                  ? filters?.closeListingAd(Number(row.listingId))
                                  : filters?.closeRequest(Number(row.requestId))
                              }
                            >
                              Close
                            </button>
                          ) : (
                            <button
                              className={s.actBtn}
                              disabled={isOverdue || !isConnected}
                              onClick={() =>
                                isBorrow
                                  ? filters?.handleBorrowAllocation(row)
                                  : filters?.serviceRequest(
                                      Number(row.requestId),
                                      String(row.tokenAddress),
                                      row.amount,
                                    )
                              }
                            >
                              {isBorrow ? "Borrow" : "Fund"}
                            </button>
                          )}
                        </span>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>

          <aside className={s.side}>
            <div className={s.card}>
              <div className={s.cardTitle}>Rates are per year</div>
              <p className={s.cardBody}>
                Every rate here is an APR. A 30-day loan at 6% costs about 0.49%
                over its term — so you can compare a 7-day offer and a 90-day one
                on the same scale.
              </p>
            </div>
            <div className={s.card}>
              <div className={s.cardTitle}>Isolated by design</div>
              <p className={s.cardBody}>
                Each loan holds its own collateral. One bad position can&apos;t
                touch another lender&apos;s funds — unlike a shared pool.
              </p>
            </div>
          </aside>
        </div>
      </main>
    </>
  );
}
