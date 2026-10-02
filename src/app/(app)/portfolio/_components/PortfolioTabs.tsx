"use client";

import { useState } from "react";
import Link from "next/link";
import type { Alert, PositionGroup } from "@/hooks/usePortfolio";
import TokenIcon, { hasTokenIcon } from "@/components/v2/TokenIcon";
import ChainIcon from "@/components/v2/ChainIcon";
import { CHAINS_BY_ID } from "@/constants/chains";
import { aggregateByToken, allocation, type TokenAggregate } from "@/lib/portfolio/aggregate";
import t from "./PortfolioTabs.module.css";

export type TabId = "overview" | "tokens" | "positions" | "activity" | "points";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "tokens", label: "Tokens" },
  { id: "positions", label: "Positions" },
  { id: "activity", label: "Activity" },
  { id: "points", label: "Points" },
];

const usd = (n: number | null, dp = 2) =>
  n === null
    ? "—"
    : n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: dp, maximumFractionDigits: dp });

const amt = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: n >= 1000 ? 0 : n >= 1 ? 4 : 6 });

/** Slice colours for the allocation bar. Plain hex, so the share card's canvas
 *  can draw the same bar. */
export const SLICE: Record<string, string> = {
  wallet: "#1de6a4",
  lending: "#5b8cff",
  borrowing: "#f0b64a",
  stable: "#b18cff",
  staking: "#ff7a90",
};

/**
 * Portfolio v2's in-page tabs. In-page state, not routes: the header, net worth
 * and network stay put while the body swaps (see the Portfolio Rebuild Spec).
 * A scrollable pill row, so the row never crowds when tabs are added.
 */
export function Tabs({ value, onChange }: { value: TabId; onChange: (v: TabId) => void }) {
  return (
    <div className={t.tabs} role="tablist" aria-label="Portfolio sections">
      {TABS.map((x) => (
        <button
          key={x.id}
          role="tab"
          aria-selected={value === x.id}
          className={`${t.tab} ${value === x.id ? t.on : ""}`}
          onClick={() => onChange(x.id)}
        >
          {x.label}
        </button>
      ))}
    </div>
  );
}

/** Overview: where the money is, one card per product, and what needs attention. */
export function Overview({
  groups,
  alerts,
  loading,
  onOpen,
}: {
  groups: PositionGroup[];
  alerts: Alert[];
  loading: boolean;
  onOpen: (tab: TabId) => void;
}) {
  const slices = allocation(groups);
  return (
    <div className={t.overview}>
      {slices.length > 0 && (
        <section className={t.alloc} aria-label="Allocation">
          <div className={t.bar}>
            {slices.map((sl) => (
              <span
                key={sl.id}
                style={{ width: `${(sl.share * 100).toFixed(2)}%`, background: SLICE[sl.id] }}
                title={`${sl.label} ${(sl.share * 100).toFixed(1)}%`}
              />
            ))}
          </div>
          <div className={t.legend}>
            {slices.map((sl) => (
              <span key={sl.id} className={t.lg}>
                <i style={{ background: SLICE[sl.id] }} />
                {sl.label}
                <b className="tabular">{(sl.share * 100).toFixed(1)}%</b>
              </span>
            ))}
          </div>
        </section>
      )}

      <div className={t.cards}>
        {groups.map((g) => (
          <button
            key={g.id}
            className={t.card}
            onClick={() => onOpen(g.id === "wallet" ? "tokens" : "positions")}
          >
            <span className={t.cTitle}>
              <i style={{ background: SLICE[g.id] }} />
              {g.title}
            </span>
            <span className={`${t.cVal} tabular`}>{loading && g.rows.length === 0 ? "…" : usd(g.subtotalUsd)}</span>
            <span className={t.cSub}>
              {g.rows.length === 0
                ? g.empty
                : `${g.rows.length} ${g.rows.length === 1 ? "position" : "positions"}`}
            </span>
          </button>
        ))}
      </div>

      <section className={t.attn}>
        <div className={t.attnTitle}>Needs attention</div>
        {alerts.length === 0 ? (
          <div className={t.calm}>Nothing needs attention.</div>
        ) : (
          alerts.map((a) => (
            <a key={a.id} href={a.href ?? "#"} className={t.alert}>
              <span className={`${t.aIcon} ${a.severity === "info" ? "" : t.aWarn}`}>
                {a.severity === "info" ? "↑" : "!"}
              </span>
              <span>
                <span className={t.alTitle}>{a.title}</span>
                <span className={t.alDetail}>{a.detail}</span>
              </span>
            </a>
          ))
        )}
      </section>
    </div>
  );
}

function ChainStack({ token }: { token: TokenAggregate }) {
  const shown = token.chains.slice(0, 4);
  return (
    <span className={t.stack} aria-label={`${token.chains.length} networks`}>
      {shown.map((c) => {
        const meta = c.chainId ? CHAINS_BY_ID[c.chainId] : undefined;
        return (
          <span key={c.id} className={t.chip} title={meta?.shortName}>
            <ChainIcon
              id={meta?.iconId}
              size={16}
              fallback={<i className={t.dot} style={{ background: meta?.color ?? "#888" }} />}
            />
          </span>
        );
      })}
      {token.chains.length > 4 && <span className={t.more}>+{token.chains.length - 4}</span>}
    </span>
  );
}

/**
 * Tokens: one row per token summed across chains, a network badge stack, and a
 * tap to open the per-chain split plus the routes into the protocol.
 */
export function Tokens({ wallet, loading }: { wallet: PositionGroup | undefined; loading: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const tokens = aggregateByToken(wallet?.rows ?? []);

  if (loading && tokens.length === 0)
    return (
      <div className={t.list}>
        <div className={t.skel} />
        <div className={t.skel} />
      </div>
    );
  if (tokens.length === 0)
    return (
      <Link href={wallet?.href ?? "/trade/swap"} className={t.emptyBox}>
        {wallet?.empty ?? "No token balances in this wallet."}
      </Link>
    );

  return (
    <div className={t.list}>
      {tokens.map((tk) => {
        const isOpen = open === tk.key;
        return (
          <div key={tk.key} className={`${t.tok} ${isOpen ? t.tokOpen : ""}`}>
            <button className={t.tokRow} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : tk.key)}>
              <span className={`${t.icon} ${hasTokenIcon(tk.symbol) ? t.iconArt : ""}`}>
                <TokenIcon symbol={tk.symbol} size={34} fallback={tk.symbol.slice(0, 3)} />
              </span>
              <span className={t.tName}>
                <b>{tk.symbol}</b>
                <small>
                  {tk.chains.length === 1
                    ? CHAINS_BY_ID[tk.chains[0].chainId ?? 0]?.shortName ?? "1 network"
                    : `${tk.chains.length} networks`}
                </small>
              </span>
              <ChainStack token={tk} />
              <span className={`${t.tVal} tabular`}>
                <b>{usd(tk.valueUsd)}</b>
                <small>
                  {amt(tk.amount)} {tk.symbol}
                </small>
              </span>
              <span className={t.caret} aria-hidden>
                {isOpen ? "▾" : "›"}
              </span>
            </button>
            {isOpen && (
              <div className={t.detail}>
                {tk.chains.map((c) => {
                  const meta = c.chainId ? CHAINS_BY_ID[c.chainId] : undefined;
                  return (
                    <div key={c.id} className={t.sub}>
                      <ChainIcon
                        id={meta?.iconId}
                        size={18}
                        fallback={<i className={t.dot} style={{ background: meta?.color ?? "#888" }} />}
                      />
                      <span>{meta?.shortName ?? `chain ${c.chainId}`}</span>
                      <span className={`${t.subVal} tabular`}>
                        {usd(c.valueUsd)} <small>{c.amount}</small>
                      </span>
                    </div>
                  );
                })}
                <div className={t.acts}>
                  <Link href="/trade/swap" className={t.act}>
                    Swap
                  </Link>
                  <Link href="/lend" className={t.act}>
                    Lend
                  </Link>
                  <Link href="/borrow" className={t.act}>
                    Borrow against it
                  </Link>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
