"use client";

import { useEffect, useState } from "react";

import { getChainTxUrl } from "@/constants/utils/getTxUrl";
import { DASH, qty } from "@/lib/format/figures";
import type { PoolTxn } from "@/hooks/dex/usePoolTransactions";

import s from "../pool.module.css";

/**
 * The pair's recent swaps, mints and burns.
 *
 * Reads a window of blocks, not a history — so the empty state names the window
 * rather than saying the pool is quiet. `usePoolTransactions` explains why that
 * distinction is the whole design of the hook.
 */
export default function PoolTxnTable({
  txns,
  loading,
  error,
  scannedBlocks,
  hasMore,
  chainId,
  symbol0,
  symbol1,
}: {
  txns: PoolTxn[];
  loading: boolean;
  error: string | null;
  scannedBlocks: number | null;
  hasMore: boolean;
  chainId: number;
  symbol0: string;
  symbol1: string;
}) {
  /* Zero until an effect stamps it, so the first paint measures nothing against
     a clock. Same reason TxHistory stamps on open rather than per render: every
     row in one render then agrees about when "now" is, and a list crossing a
     minute boundary mid-map cannot show a newer transaction as older. */
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
  }, [txns]);

  return (
    <div className={s.txns}>
      <div className={s.txHead}>
        <span>Action</span>
        <span className={s.right}>{symbol0}</span>
        <span className={s.right}>{symbol1}</span>
        <span className={s.right}>Time</span>
      </div>

      {error ? (
        <div className={s.tEmpty}>{error}</div>
      ) : loading && txns.length === 0 ? (
        [0, 1, 2].map((i) => (
          <div key={i} className={s.rowSkeleton}>
            <span className={s.skLine} />
          </div>
        ))
      ) : txns.length === 0 ? (
        <div className={s.tEmpty}>
          {scannedBlocks === null
            ? "Transactions not read."
            : `No transactions in the last ${qty(scannedBlocks)} blocks.`}
        </div>
      ) : (
        txns.map((t) => (
          <TxnRow
            key={`${t.hash}-${t.logIndex}`}
            txn={t}
            now={now}
            chainId={chainId}
            symbol0={symbol0}
            symbol1={symbol1}
          />
        ))
      )}

      {hasMore && (
        /* The truncation is stated rather than left for the reader to infer from
           a list that stops. A table that silently drops rows reads as the whole
           window. */
        <div className={s.txMore}>
          Showing the {txns.length} most recent of a busier window
        </div>
      )}
    </div>
  );
}

function TxnRow({
  txn,
  now,
  chainId,
  symbol0,
  symbol1,
}: {
  txn: PoolTxn;
  now: number;
  chainId: number;
  symbol0: string;
  symbol1: string;
}) {
  const href = getChainTxUrl(chainId, txn.hash);

  const action =
    txn.kind === "add"
      ? "Add liquidity"
      : txn.kind === "remove"
        ? "Remove liquidity"
        : /* Named in full rather than signed. A minus on one amount column would
             have to mean "left the pool" here and "left the trader" on the next
             page, and the reader has no way to know which. */
          `Swap ${txn.soldToken0 ? symbol0 : symbol1} for ${
            txn.soldToken0 ? symbol1 : symbol0
          }`;

  /* An em dash when the block read failed — the transaction happened whether or
     not its timestamp could be fetched, and a blank cell reads as a rendering
     fault rather than a missing figure. Blank only for the single frame before
     the effect stamps the clock, where a dash would flash into a time. */
  const when = txn.at === null ? DASH : now === 0 ? "" : timeAgo(txn.at, now);

  return (
    <div className={s.txRow}>
      {href ? (
        <a
          className={s.txAction}
          href={href}
          target="_blank"
          rel="noreferrer"
          title="View transaction"
        >
          {action}
        </a>
      ) : (
        <span className={s.txAction}>{action}</span>
      )}
      <span className={`${s.right} tabular`}>{amount(txn.amount0)}</span>
      <span className={`${s.right} tabular`}>{amount(txn.amount1)}</span>
      <span className={`${s.txTime} ${s.right}`}>{when}</span>
    </div>
  );
}

/** Decimals by magnitude — see PoolBalanceBar's note on why one fixed dp cannot
    serve both a million-unit token and a fractional one. */
const amount = (n: number) => qty(n, n >= 1000 ? 0 : n >= 1 ? 4 : 6);

/**
 * How long ago, in the coarsest unit that still says something.
 *
 * Takes `now` rather than reading the clock, for the reason given at the call
 * site. Deliberately a local copy of TxHistory's: that one and NotificationRow's
 * already disagree about the "just now" threshold and about floor vs round, and
 * those differences are real behaviour in two shipped panels — merging three
 * callers onto one helper would be a change to both of them rather than to this
 * table.
 */
function timeAgo(at: number, now: number): string {
  const sec = Math.max(0, Math.round((now - at) / 1000));
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(at).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}
