"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ChainIcon from "@/components/v2/ChainIcon";
import { CHAINS, CHAINS_BY_ID } from "@/constants/chains";
import { readTxLog, subscribeTxLog } from "@/lib/v2/txLog";
import { fromServer, mergeActivity, type ActivityItem, type ServerActivity } from "@/lib/portfolio/activity";
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
      });
  return out;
}

const when = (ms: number) => {
  const d = Date.now() - ms;
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

/**
 * Activity: the points ledger's credited actions (server) merged with this
 * device's signed-transaction log. See lib/portfolio/activity.ts.
 */
export function ActivityTab({ address }: { address: string | undefined }) {
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

  if (!mounted || (server === null && device.length === 0))
    return (
      <div className={t.list}>
        <div className={t.skel} />
        <div className={t.skel} />
      </div>
    );

  const items = mergeActivity(server ?? [], device);
  if (items.length === 0)
    return (
      <Link href="/trade/agent" className={t.emptyBox}>
        No activity yet. Ask Luca for your first swap →
      </Link>
    );

  return (
    <div className={t.list}>
      {items.map((it) => {
        const meta = it.chainId ? CHAINS_BY_ID[it.chainId] : undefined;
        const href = it.hash && meta ? `${meta.blockExplorer.url.replace(/\/$/, "")}/tx/${it.hash}` : null;
        const body = (
          <>
            <span className={t.icon}>
              {meta ? (
                <ChainIcon id={meta.iconId} size={22} fallback={<i className={t.dot} style={{ background: meta.color }} />} />
              ) : (
                "✓"
              )}
            </span>
            <span className={t.tName}>
              <b>{it.title}</b>
              <small>
                {meta?.shortName ?? "Kaleido"}
                {it.status !== "confirmed" && ` · ${it.status === "pending" ? "Pending" : "Failed"}`}
              </small>
            </span>
            <span className={`${t.tVal} tabular`}>
              <small>{when(it.at)}</small>
            </span>
            <span className={t.caret} aria-hidden>
              {href ? "↗" : ""}
            </span>
          </>
        );
        return href ? (
          <a key={it.id} className={`${t.tokRow} ${t.actRow}`} href={href} target="_blank" rel="noopener noreferrer">
            {body}
          </a>
        ) : (
          <div key={it.id} className={`${t.tokRow} ${t.actRow}`}>
            {body}
          </div>
        );
      })}
    </div>
  );
}
