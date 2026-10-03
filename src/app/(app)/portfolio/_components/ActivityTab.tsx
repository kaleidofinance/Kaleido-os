"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ChainIcon from "@/components/v2/ChainIcon";
import { CHAINS, CHAINS_BY_ID } from "@/constants/chains";
import { readTxLog, subscribeTxLog } from "@/lib/v2/txLog";
import {
  ACTIVITY_TYPES,
  activityAmount,
  activityType,
  filterActivity,
  fromServer,
  mergeActivity,
  tidyTitle,
  type ActivityItem,
  type ActivityType,
  type ActivityWindow,
  type ServerActivity,
} from "@/lib/portfolio/activity";
import TokenCoin from "@/components/v2/TokenCoin";
import t from "./PortfolioTabs.module.css";

function readDevice(address: string): ActivityItem[] {
  const out: ActivityItem[] = [];
  for (const c of CHAINS)
    for (const e of readTxLog(c.id, address))
      out.push({
        id: `d-${c.id}-${e.hash}`,
        title: e.title,
        detail: e.detail,
        chainId: c.id,
        hash: e.hash.toLowerCase(),
        at: e.at,
        status: e.status,
        source: "device",
        kind: e.kind,
      });
  return out;
}

const when = (ms: number) => {
  const d = Date.now() - ms;
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  // The day header already names the date; a row shows its time.
  return new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
};

/**
 * Activity: the points ledger's credited actions (server) merged with this
 * device's signed-transaction log. See lib/portfolio/activity.ts.
 */
/** The merged activity feed (server ledger + this device's signed log), shared by
 *  the Activity tab and the Overview's Recent activity. */
export function useActivityItems(address: string | undefined): { items: ActivityItem[]; ready: boolean } {
  const [server, setServer] = useState<ActivityItem[] | null>(null);
  const [device, setDevice] = useState<ActivityItem[]>([]);
  // Mounted flag: relative times and localStorage differ server vs client.
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!address) return;
    setDevice(readDevice(address));
    return subscribeTxLog(() => setDevice(readDevice(address)));
  }, [address]);

  useEffect(() => {
    if (!address) return;
    let live = true;
    setServer(null);
    fetch(`/api/portfolio/activity?wallet=${address}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d: { items?: ServerActivity[] }) => live && setServer(fromServer(d.items ?? [])))
      .catch(() => live && setServer([]));
    return () => {
      live = false;
    };
  }, [address]);
  const ready = mounted && !(server === null && device.length === 0);
  return { items: ready ? mergeActivity(server ?? [], device) : [], ready };
}

export function ActivityTab({ address }: { address: string | undefined }) {
  const { items, ready } = useActivityItems(address);

  if (!ready)
    return (
      <div className={t.list}>
        <div className={t.skel} />
        <div className={t.skel} />
      </div>
    );

  if (items.length === 0)
    return (
      <Link href="/trade/agent" className={t.emptyBox}>
        No activity yet. Ask Luca for your first swap →
      </Link>
    );

  return <ActivityTable items={items} />;
}

const TYPE_ICON: Record<ActivityType, string> = {
  swap: "⇄",
  liquidity: "◔",
  lending: "◎",
  bridge: "↗",
  transfer: "→",
  approve: "✓",
  rewards: "★",
  other: "•",
};

const dateCell = (ms: number) => {
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
};

/**
 * The activity table, the way Uniswap lays it out: a filter row (type, time
 * window, search), then Time · Type · Amount · Transaction · →. Amount is the
 * first "<n> <TOKEN>" the action names; the last column is the chain and the
 * transaction (copyable), since our rows carry no counterparty address.
 */
function ActivityTable({ items }: { items: ActivityItem[] }) {
  const [type, setType] = useState<ActivityType | "all">("all");
  const [win, setWin] = useState<ActivityWindow>("all");
  const [query, setQuery] = useState("");
  const rows = filterActivity(items, { type, window: win, query });
  const copy = (h: string) => {
    void navigator.clipboard?.writeText(h).catch(() => {});
  };

  return (
    <div className={t.actWrap}>
      <div className={t.filters}>
        <select className={t.sel} value={type} onChange={(e) => setType(e.target.value as ActivityType | "all")} aria-label="Type">
          <option value="all">All types</option>
          {ACTIVITY_TYPES.map((x) => (
            <option key={x.key} value={x.key}>
              {x.label}
            </option>
          ))}
        </select>
        <select className={t.sel} value={win} onChange={(e) => setWin(e.target.value as ActivityWindow)} aria-label="Time">
          <option value="all">All time</option>
          <option value="24h">Past 24 hours</option>
          <option value="7d">Past 7 days</option>
          <option value="30d">Past 30 days</option>
        </select>
        <input className={t.search} type="search" placeholder="Search activity" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <div className={t.atable}>
        <div className={`${t.arow} ${t.ahead}`}>
          <span>Time</span>
          <span>Type</span>
          <span>Amount</span>
          <span>Transaction</span>
          <span />
        </div>
        {rows.length === 0 ? (
          <div className={t.calmIn}>Nothing matches.</div>
        ) : (
          rows.map((it) => {
            const meta = it.chainId ? CHAINS_BY_ID[it.chainId] : undefined;
            const href = it.hash && meta ? `${meta.blockExplorer.url.replace(/\/$/, "")}/tx/${it.hash}` : null;
            const ty = activityType(it);
            const label = ACTIVITY_TYPES.find((x) => x.key === ty)?.label ?? "Transaction";
            const amt = activityAmount(tidyTitle(it.title));
            return (
              <div key={it.id} className={t.arow} title={it.title}>
                <span className={t.aTime}>{dateCell(it.at)}</span>
                <span className={t.aType}>
                  <span className={t.aTypeIcon} aria-hidden>
                    {TYPE_ICON[ty]}
                  </span>
                  {label}
                  {it.status !== "confirmed" ? (
                    <small className={it.status === "pending" ? t.aPending : t.aFailed}>
                      {it.status === "pending" ? "Pending" : "Failed"}
                    </small>
                  ) : null}
                </span>
                <span className={t.aAmt}>
                  {amt ? (
                    <>
                      <TokenCoin symbol={amt.symbol} size={28} />
                      <b className="tabular">
                        {amt.amount} {amt.symbol}
                      </b>
                    </>
                  ) : (
                    <span className={t.aMuted}>{it.title}</span>
                  )}
                </span>
                <span className={t.aTx}>
                  {meta ? (
                    <ChainIcon id={meta.iconId} size={16} fallback={<i className={t.dot} style={{ background: meta.color }} />} />
                  ) : null}
                  {it.hash ? (
                    <>
                      <span className="tabular">{`${it.hash.slice(0, 6)}…${it.hash.slice(-4)}`}</span>
                      <button className={t.copyBt} onClick={() => copy(it.hash as string)} aria-label="Copy transaction hash" title="Copy">
                        ⧉
                      </button>
                    </>
                  ) : (
                    <span className={t.aMuted}>{meta?.shortName ?? "Kaleido"}</span>
                  )}
                </span>
                {href ? (
                  <a className={t.aGo} href={href} target="_blank" rel="noopener noreferrer" aria-label="View on explorer">
                    →
                  </a>
                ) : (
                  <span />
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/** The Overview's Recent activity: the latest five, compact, with a link to all. */
export function RecentActivity({ address, onAll }: { address: string | undefined; onAll: () => void }) {
  const { items, ready } = useActivityItems(address);
  const top = items.slice(0, 5);
  return (
    <section className={t.allocCard}>
      <div className={t.cardHead}>
        <span>Recent activity</span>
        <small>{ready ? `${items.length} ${items.length === 1 ? "transaction" : "transactions"}` : ""}</small>
      </div>
      {!ready ? (
        <div className={t.skel} />
      ) : top.length === 0 ? (
        <div className={t.calmIn}>No activity yet.</div>
      ) : (
        top.map((it) => {
          const ty = activityType(it);
          const amt = activityAmount(tidyTitle(it.title));
          return (
            <div key={it.id} className={t.recRow}>
              <span className={t.aTypeIcon} aria-hidden>
                {TYPE_ICON[ty]}
              </span>
              <span className={t.tName}>
                <small>{ACTIVITY_TYPES.find((x) => x.key === ty)?.label ?? "Transaction"}</small>
                <b className="tabular">{amt ? `${amt.amount} ${amt.symbol}` : tidyTitle(it.title)}</b>
              </span>
              <span className={t.aTime}>{dateCell(it.at)}</span>
            </div>
          );
        })
      )}
      {items.length > 0 ? (
        <button className={t.more2} onClick={onAll}>
          View all activity →
        </button>
      ) : null}
    </section>
  );
}
