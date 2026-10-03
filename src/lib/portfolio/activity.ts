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
  /** The action's kind (intent kind for device entries, ledger source for
   *  server ones), for the Type column and filter. */
  kind?: string;
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
        kind: r.kind,
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

/* ---------------- the activity table: type, amount, filters ---------------- */

export type ActivityType = "swap" | "liquidity" | "lending" | "bridge" | "transfer" | "approve" | "rewards" | "other";

export const ACTIVITY_TYPES: { key: ActivityType; label: string }[] = [
  { key: "swap", label: "Swap" },
  { key: "liquidity", label: "Liquidity" },
  { key: "lending", label: "Lending" },
  { key: "bridge", label: "Bridge" },
  { key: "transfer", label: "Send" },
  { key: "approve", label: "Approve" },
  { key: "rewards", label: "Rewards" },
  { key: "other", label: "Transaction" },
];

/** The Type column for a row: from its kind first, then its title's verb. */
export function activityType(it: Pick<ActivityItem, "kind" | "title">): ActivityType {
  const k = (it.kind ?? "").toLowerCase();
  const t = it.title.toLowerCase();
  const has = (re: RegExp) => re.test(k) || re.test(t);
  if (has(/approv/)) return "approve";
  if (has(/checkin|check-in|claim(?!yield)|reward|faucet|points/)) return "rewards";
  if (has(/bridge|cctp/)) return "bridge";
  if (has(/liquidity|\blp\b|position|collectfees|collect fees|range/)) return "liquidity";
  if (has(/lend|borrow|repay|collateral|loan|withdraw|deposit|fill/)) return "lending";
  if (has(/swap|wrap|buy|sell|order/)) return "swap";
  if (has(/send|transfer/)) return "transfer";
  return "other";
}

/** The first "<amount> <SYMBOL>" in a title ("Swap 0.00246701 cirBTC for USDC"
 *  → 0.00246701 cirBTC). Null when the title names no amount. */
export function activityAmount(title: string): { amount: string; symbol: string } | null {
  const m = title.match(/(\d[\d,]*(?:\.\d+)?)\s+([A-Za-z][A-Za-z0-9.]{0,11})\b/);
  return m ? { amount: m[1], symbol: m[2] } : null;
}

export type ActivityWindow = "all" | "24h" | "7d" | "30d";
const WINDOW_MS: Record<ActivityWindow, number> = { all: Infinity, "24h": 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000 };

/** Type, time-window and free-text filters, as the table's filter row applies them. */
export function filterActivity(
  items: ActivityItem[],
  f: { type: ActivityType | "all"; window: ActivityWindow; query: string },
  now = Date.now(),
): ActivityItem[] {
  const q = f.query.trim().toLowerCase();
  return items.filter(
    (it) =>
      (f.type === "all" || activityType(it) === f.type) &&
      now - it.at <= WINDOW_MS[f.window] &&
      (!q || it.title.toLowerCase().includes(q) || (it.hash ?? "").toLowerCase().includes(q)),
  );
}
