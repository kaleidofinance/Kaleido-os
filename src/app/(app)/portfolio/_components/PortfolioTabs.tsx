"use client";

import { useState } from "react";
import Link from "next/link";
import type { Alert, PositionGroup } from "@/hooks/usePortfolio";
import TokenIcon, { hasTokenIcon } from "@/components/v2/TokenIcon";
import ChainIcon from "@/components/v2/ChainIcon";
import TokenCoin from "@/components/v2/TokenCoin";
import BalanceChart from "./BalanceChart";
import { CHAINS_BY_ID } from "@/constants/chains";
import { aggregateByToken, type TokenAggregate } from "@/lib/portfolio/aggregate";
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
  (n ?? 0).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: dp, maximumFractionDigits: dp });

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

/** Brand-ish colours for the allocation bars, by rank (largest first). */
const RANK = ["#1de6a4", "#5b8cff", "#b18cff", "#f0b64a", "#ff7a90", "#8a8f98"];

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/**
 * Overview, laid out the way Uniswap/Zerion read: one value card (figure, when it
 * was read, Refresh), three action tiles, a facts row, then where the value sits
 * by token, then the protocol summary and anything that needs attention.
 */
export function Overview({
  netValue,
  partial,
  groups,
  alerts,
  loading,
  updatedAt,
  onRefresh,
  onOpen,
}: {
  netValue: number | null;
  partial: boolean;
  groups: PositionGroup[];
  alerts: Alert[];
  loading: boolean;
  /** ms of the last completed read; null while the first is in flight. */
  updatedAt: number | null;
  onRefresh: () => void;
  onOpen: (tab: TabId) => void;
}) {
  const wallet = groups.find((g) => g.id === "wallet");
  const tokens = aggregateByToken(wallet?.rows ?? []);
  const networks = new Set((wallet?.rows ?? []).map((r) => r.chainId).filter(Boolean)).size;
  const priced = tokens.reduce(
    (s, tk) => s + tk.chains.reduce((a, c) => a + (c.valueUsd ?? 0), 0),
    0,
  );
  const pricedTokens = tokens
    .map((tk) => ({ tk, v: tk.chains.reduce((a, c) => a + (c.valueUsd ?? 0), 0) }))
    .filter((x) => x.v > 0);
  const top = pricedTokens.slice(0, 5);
  const protocol = groups.filter((g) => g.id !== "wallet");

  return (
    <div className={t.ov}>
      <section className={t.hero}>
        <div className={t.heroTop}>
          <span className={t.heroLabel}>Portfolio value</span>
          <button className={t.refresh} onClick={onRefresh} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <div
          className={`${t.heroVal} tabular`}
          title={partial ? "Excludes holdings with no price feed" : undefined}
        >
          {loading && netValue === null ? "…" : usd(netValue)}
        </div>
        <span className={t.heroSub}>
          {updatedAt ? `Updated ${clock(updatedAt)}` : "Reading your wallet…"}
        </span>
        <BalanceChart
          netValue={netValue}
          holdings={tokens.map((tk) => ({
            symbol: tk.symbol,
            amount: tk.amount,
            valueUsd: tk.chains.reduce((a, c) => a + (c.valueUsd ?? 0), 0),
          }))}
        />
      </section>

      {/* Three actions, each its own colour, with the asset coin art (TokenCoin)
          on the right — the Uniswap card treatment rather than three grey boxes. */}
      <div className={t.tiles}>
        <Link href="/trade/agent" className={`${t.tile} ${t.tileSend}`}>
          <span className={t.tileArt} aria-hidden>
            <TokenCoin symbol="USDC" size={64} />
          </span>
          <span className={t.tileText}>
            <span className={t.tileIcon} aria-hidden>→</span>
            Send
          </span>
        </Link>
        <Link href="/trade/buy" className={`${t.tile} ${t.tileBuy}`}>
          <span className={t.tileArt} aria-hidden>
            <TokenCoin symbol="BTC" size={64} />
          </span>
          <span className={t.tileText}>
            <span className={t.tileIcon} aria-hidden>+</span>
            Buy
          </span>
        </Link>
        <Link href="/trade/swap" className={`${t.tile} ${t.tileSwap}`}>
          <span className={`${t.tileArt} ${t.tileArtPair}`} aria-hidden>
            <TokenCoin symbol="USDC" size={52} />
            <TokenCoin symbol="EURC" size={52} />
          </span>
          <span className={t.tileText}>
            <span className={t.tileIcon} aria-hidden>⇄</span>
            Swap
          </span>
        </Link>
      </div>

      <div className={t.facts}>
        <div>
          <span>Token holdings</span>
          <b className="tabular">{tokens.length}</b>
        </div>
        <div>
          <span>Networks</span>
          <b className="tabular">{networks}</b>
        </div>
        <div>
          <span>Priced holdings</span>
          <b className="tabular">{usd(priced)}</b>
        </div>
      </div>

      {/* Allocation and positions side by side; attention spans the row below. */}
      <div className={t.split}>
        {top.length > 0 && (
          <section className={t.allocCard} aria-label="Allocation">
            <div className={t.cardHead}>
              <span>Your allocation</span>
              <small>By token value</small>
            </div>
            {top.map(({ tk, v }, i) => {
              const share = priced > 0 ? v / priced : 0;
              return (
                <button key={tk.key} className={t.allocRow} onClick={() => onOpen("tokens")}>
                  <span className={`${t.icon} ${hasTokenIcon(tk.symbol) ? t.iconArt : ""}`}>
                    <TokenIcon symbol={tk.symbol} size={32} fallback={tk.symbol.slice(0, 3)} />
                  </span>
                  <span className={t.allocBody}>
                    <span className={t.allocLine}>
                      <b>{tk.symbol}</b>
                      <span className="tabular">
                        {usd(v)} <small>{(share * 100).toFixed(1)}%</small>
                      </span>
                    </span>
                    <span className={t.track}>
                      <span style={{ width: `${Math.max(1, share * 100).toFixed(2)}%`, background: RANK[i] }} />
                    </span>
                  </span>
                </button>
              );
            })}
            {pricedTokens.length > top.length && (
              <button className={t.more2} onClick={() => onOpen("tokens")}>
                View all {tokens.length} tokens →
              </button>
            )}
          </section>
        )}
        <section className={t.allocCard}>
          <div className={t.cardHead}>
            <span>Positions</span>
            <button className={t.linkBtn} onClick={() => onOpen("positions")}>Details →</button>
          </div>
          {protocol.map((g) => (
            <button key={g.id} className={t.posRow} onClick={() => onOpen("positions")}>
              <span>{g.title}</span>
              <span className="tabular">
                {g.rows.length === 0 ? <small>None</small> : usd(g.subtotalUsd)}
              </span>
            </button>
          ))}
        </section>

      </div>

      <section className={t.allocCard}>
        <div className={t.cardHead}>
          <span>Needs attention</span>
        </div>
        {alerts.length === 0 ? (
          <div className={t.calmIn}>Nothing needs attention.</div>
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
