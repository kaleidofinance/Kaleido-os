"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Alert, PositionGroup } from "@/hooks/usePortfolio";
import TokenIcon, { hasTokenIcon } from "@/components/v2/TokenIcon";
import ChainIcon from "@/components/v2/ChainIcon";
import TokenCoin from "@/components/v2/TokenCoin";
import BalanceChart from "./BalanceChart";
import { RecentActivity } from "./ActivityTab";
import { CHAINS_BY_ID } from "@/constants/chains";
import { hasFeed } from "@/lib/v2/prices/feeds";
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
  address,
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
  address?: string;
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
      {/* Uniswap's portfolio overview: value + chart on the left, actions and
          positions on the right; then a tokens preview beside recent activity. */}
      <div className={t.ovTop}>
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
            wallet={address}
            netValue={netValue}
            holdings={tokens.map((tk) => ({
              symbol: tk.symbol,
              amount: tk.amount,
              valueUsd: tk.chains.reduce((a, c) => a + (c.valueUsd ?? 0), 0),
            }))}
          />
        </section>
        <div className={t.ovSide}>
        <div className={`${t.tiles} ${t.tiles2}`}>
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
          <Link href="/pool" className={`${t.tile} ${t.tileEarn}`}>
            <span className={t.tileArt} aria-hidden>
              <TokenCoin symbol="EURC" size={64} />
            </span>
            <span className={t.tileText}>
              <span className={t.tileIcon} aria-hidden>✦</span>
              Earn
            </span>
          </Link>
        </div>
          <section className={t.allocCard}>
            <div className={t.cardHead}>
              <span>Positions</span>
              <button className={t.linkBtn} onClick={() => onOpen("positions")}>Details →</button>
            </div>
            {protocol.map((g) => (
              <button key={g.id} className={t.posRow} onClick={() => onOpen("positions")}>
                <span>{g.title}</span>
                <span className="tabular">{usd(g.subtotalUsd)}</span>
              </button>
            ))}
          </section>
        </div>
      </div>

      <div className={t.ovBottom}>
        <section className={t.allocCard} aria-label="Tokens">
          <div className={t.cardHead}>
            <span>Tokens</span>
            <small>
              {tokens.length} {tokens.length === 1 ? "token" : "tokens"}
            </small>
          </div>
          <div className={`${t.miniRow} ${t.miniHead}`}>
            <span>Token</span>
            <span className={t.r}>Price</span>
            <span className={t.r}>Balance</span>
            <span className={t.r}>Value</span>
          </div>
          {top.length === 0 ? (
            <div className={t.calmIn}>{loading ? "Reading your wallet…" : "No token balances yet."}</div>
          ) : (
            top.map(({ tk, v }) => (
              <button key={tk.key} className={t.miniRow} onClick={() => onOpen("tokens")}>
                <span className={t.tTok}>
                  <TokenCoin symbol={tk.symbol} size={28} />
                  <b>{tk.symbol}</b>
                </span>
                <span className={`${t.r} tabular`}>{usd(tk.amount > 0 ? v / tk.amount : 0)}</span>
                <span className={`${t.r} tabular`}>{amt(tk.amount)}</span>
                <span className={`${t.r} tabular`}>
                  {usd(v)} <small>{priced > 0 ? `${((v / priced) * 100).toFixed(1)}%` : ""}</small>
                </span>
              </button>
            ))
          )}
          {tokens.length > 0 ? (
            <button className={t.more2} onClick={() => onOpen("tokens")}>
              View all tokens →
            </button>
          ) : null}
        </section>

        <div className={t.ovSide}>
          <RecentActivity address={address} onAll={() => onOpen("activity")} />
          {alerts.length > 0 ? (
            <section className={t.allocCard}>
              <div className={t.cardHead}>
                <span>Needs attention</span>
              </div>
              {alerts.map((al) => (
                <a key={al.id} href={al.href ?? "#"} className={t.alert}>
                  <span className={`${t.aIcon} ${al.severity === "info" ? "" : t.aWarn}`}>
                    {al.severity === "info" ? "↑" : "!"}
                  </span>
                  <span>
                    <span className={t.alTitle}>{al.title}</span>
                    <span className={t.alDetail}>{al.detail}</span>
                  </span>
                </a>
              ))}
            </section>
          ) : null}
        </div>
      </div>
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

/** 1D price change per symbol (fraction), from the trade chart's /api/prices feed.
 *  Stables are skipped (flat by definition); tokens with no feed stay absent. */
function useDayChange(symbols: string[]): Record<string, number> {
  const [out, setOut] = useState<Record<string, number>>({});
  const key = symbols.join(",");
  useEffect(() => {
    if (!key) return;
    const ctl = new AbortController();
    Promise.all(
      key.split(",").map((sym) =>
        fetch(`/api/prices?symbol=${encodeURIComponent(sym)}&range=1D`, { signal: ctl.signal })
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => {
            const p = (d?.points ?? []) as [number, number][];
            return p.length >= 2 && p[0][1] > 0 ? ([sym, p[p.length - 1][1] / p[0][1] - 1] as const) : null;
          })
          .catch(() => null),
      ),
    ).then((rows) => {
      if (!ctl.signal.aborted) setOut(Object.fromEntries(rows.filter(Boolean) as [string, number][]));
    });
    return () => ctl.abort();
  }, [key]);
  return out;
}

const STABLE = new Set(["USDC", "WUSDC", "USDT", "USDE", "USDG", "DAI", "KFUSD", "KAFUSD", "EURC"]);

const priceFmt = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: n < 1 ? 6 : 2,
  });

/**
 * Tokens, laid out as Uniswap's: the total and token count over a search box,
 * then Token · Price · 1D change · Balance · Value · Allocation. One row per
 * token summed across chains; a row opens to the per-chain split and the routes
 * into the protocol.
 */
export function Tokens({ wallet, loading }: { wallet: PositionGroup | undefined; loading: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const all = aggregateByToken(wallet?.rows ?? []);
  const valueOf = (tk: TokenAggregate) => tk.chains.reduce((a, c) => a + (c.valueUsd ?? 0), 0);
  const total = all.reduce((a, tk) => a + valueOf(tk), 0);
  const q = query.trim().toLowerCase();
  const tokens = q ? all.filter((tk) => tk.symbol.toLowerCase().includes(q)) : all;
  const changes = useDayChange(
    all
      .filter((tk) => !STABLE.has(tk.symbol.toUpperCase()) && hasFeed(tk.symbol) && valueOf(tk) > 0)
      .slice(0, 12)
      .map((tk) => tk.symbol.toUpperCase()),
  );

  if (loading && all.length === 0)
    return (
      <div className={t.list}>
        <div className={t.skel} />
        <div className={t.skel} />
      </div>
    );
  if (all.length === 0)
    return (
      <Link href={wallet?.href ?? "/trade/swap"} className={t.emptyBox}>
        {wallet?.empty ?? "No token balances in this wallet."}
      </Link>
    );

  return (
    <div className={t.actWrap}>
      <div className={t.tokHead}>
        <div>
          <div className={`${t.tokTotal} tabular`}>{usd(total)}</div>
          <div className={t.heroSub}>
            {all.length} {all.length === 1 ? "token" : "tokens"}
          </div>
        </div>
        <input className={t.search} type="search" placeholder="Search tokens" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <div className={t.atable}>
        <div className={`${t.trow} ${t.ahead}`}>
          <span>Token</span>
          <span className={t.r}>Price</span>
          <span className={t.r}>1D change</span>
          <span className={t.r}>Balance</span>
          <span className={t.r}>Value</span>
          <span className={t.r}>Allocation</span>
        </div>
        {tokens.length === 0 ? <div className={t.calmIn}>No token matches “{query}”.</div> : null}
        {tokens.map((tk) => {
          const v = valueOf(tk);
          const price = tk.amount > 0 && v > 0 ? v / tk.amount : null;
          const ch = STABLE.has(tk.symbol.toUpperCase()) ? 0 : changes[tk.symbol.toUpperCase()];
          const share = total > 0 ? v / total : 0;
          const isOpen = open === tk.key;
          return (
            <div key={tk.key} className={isOpen ? t.tokOpen : undefined}>
              <button className={t.trow} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : tk.key)}>
                <span className={t.tTok}>
                  <TokenCoin symbol={tk.symbol} size={34} />
                  <span className={t.tName}>
                    <b>{tk.symbol}</b>
                    <small>
                      {tk.chains.length === 1
                        ? CHAINS_BY_ID[tk.chains[0].chainId ?? 0]?.shortName ?? "1 network"
                        : `${tk.chains.length} networks`}
                    </small>
                  </span>
                </span>
                <span className={`${t.r} tabular`}>{price === null ? priceFmt(0) : priceFmt(price)}</span>
                <span className={`${t.r} tabular ${ch === undefined ? "" : ch >= 0 ? t.balUp : t.balDown}`}>
                  {ch === undefined ? "0.00%" : `${ch >= 0 ? "▲" : "▼"} ${Math.abs(ch * 100).toFixed(2)}%`}
                </span>
                <span className={`${t.r} tabular`}>
                  {amt(tk.amount)} {tk.symbol}
                </span>
                <span className={`${t.r} tabular`}>{usd(v)}</span>
                <span className={`${t.r} ${t.allocCell}`}>
                  <span className="tabular">{(share * 100).toFixed(1)}%</span>
                  <span className={t.track}>
                    <span style={{ width: `${Math.max(1, share * 100).toFixed(2)}%`, background: "var(--k-brand)" }} />
                  </span>
                </span>
              </button>
              {isOpen && (
                <div className={t.detail}>
                  {tk.chains.map((c) => {
                    const meta = c.chainId ? CHAINS_BY_ID[c.chainId] : undefined;
                    return (
                      <div key={c.id} className={t.sub}>
                        <ChainIcon id={meta?.iconId} size={18} fallback={<i className={t.dot} style={{ background: meta?.color ?? "#888" }} />} />
                        <span>{meta?.shortName ?? `chain ${c.chainId}`}</span>
                        <span className={`${t.subVal} tabular`}>
                          {usd(c.valueUsd)} <small>{c.amount}</small>
                        </span>
                      </div>
                    );
                  })}
                  <div className={t.acts}>
                    <Link href="/trade/swap" className={t.act}>Swap</Link>
                    <Link href="/lend" className={t.act}>Lend</Link>
                    <Link href="/borrow" className={t.act}>Borrow against it</Link>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
