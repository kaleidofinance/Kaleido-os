/**
 * Portfolio v2 Activity: one newest-first list from two honest sources.
 *
 *   server  — what the points ledger credited for this wallet (swaps through
 *             Kaleido, daily check-ins), from /api/portfolio/activity. Real
 *             on-chain hashes where there is one. Survives a new device.
 *   device  — the signed-transaction log this browser kept (txLog.ts): every
 *             plan the user signed here, lending and liquidity included.
 *
 * Deduped by tx hash, with the device entry winning — it carries the plan's own
 * title ("Swap 10 USDC → EURC"), which says more than "Swap". Neither source is
 * the whole history, and the tab says nothing it cannot show.
 */
export interface ActivityItem {
  id: string;
  title: string;
  detail?: string;
  chainId: number | null;
  /** Real 0x… hash, or null for an off-chain credit (a check-in). */
  hash: string | null;
  at: number;
  status: "pending" | "confirmed" | "reverted";
  source: "server" | "device";
}

export interface ServerActivity {
  kind: string;
  chainId: number | null;
  txHash: string | null;
  at: string;
}

export const isTxHash = (h: unknown): h is string =>
  typeof h === "string" && /^0x[0-9a-fA-F]{64}$/.test(h);

const TITLES: Record<string, string> = {
  swap: "Swap on Kaleido",
  checkin: "Daily check-in",
  lend: "Lending",
  lp: "Liquidity",
};

export function fromServer(rows: ServerActivity[]): ActivityItem[] {
  return rows
    .map((r): ActivityItem | null => {
      const at = Date.parse(r.at);
      if (!Number.isFinite(at)) return null;
      const hash = isTxHash(r.txHash) ? r.txHash.toLowerCase() : null;
      return {
        id: `s-${hash ?? `${r.kind}-${at}`}`,
        title: TITLES[r.kind] ?? r.kind,
        chainId: r.chainId,
        hash,
        at,
        status: "confirmed",
        source: "server",
      };
    })
    .filter((x): x is ActivityItem => x !== null);
}

export function mergeActivity(server: ActivityItem[], device: ActivityItem[], limit = 100): ActivityItem[] {
  const byHash = new Map<string, ActivityItem>();
  const out: ActivityItem[] = [];
  for (const d of device) {
    if (d.hash) byHash.set(d.hash.toLowerCase(), d);
    out.push(d);
  }
  for (const s of server) {
    if (s.hash && byHash.has(s.hash)) continue;
    out.push(s);
  }
  return out.sort((a, b) => b.at - a.at).slice(0, limit);
}

/**
 * Activity grouped by calendar day (local time), newest first, the way wallet
 * history lists read: "Today", "Yesterday", then "Mon, Sep 29" style dates (with
 * the year only when it is not this year). Items keep their order inside a day.
 */
export function groupByDay(
  items: ActivityItem[],
  now = Date.now(),
): { key: string; label: string; items: ActivityItem[] }[] {
  const dayKey = (ms: number) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  };
  const today = dayKey(now);
  const yesterday = dayKey(now - 86_400_000);
  const thisYear = new Date(now).getFullYear();
  const out: { key: string; label: string; items: ActivityItem[] }[] = [];
  for (const it of items) {
    const k = dayKey(it.at);
    let g = out[out.length - 1];
    if (!g || g.key !== k) {
      const d = new Date(it.at);
      const label =
        k === today
          ? "Today"
          : k === yesterday
            ? "Yesterday"
            : d.toLocaleDateString("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
                ...(d.getFullYear() !== thisYear ? { year: "numeric" } : {}),
              });
      g = { key: k, label, items: [] };
      out.push(g);
    }
    g.items.push(it);
  }
  return out;
}

/** Long raw amounts in a title ("2.362785936882168666 LIFT") cut to 6
 *  significant digits ("2.36279 LIFT"). Whole numbers and short decimals stay. */
export function tidyTitle(title: string): string {
  return title.replace(/\b\d+\.\d{7,}\b/g, (n) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return n;
    return String(Number(v.toPrecision(6)));
  });
}
