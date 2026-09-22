import { supabaseAdmin } from "@/lib/supabase/serverClient";
import { swapFeeBps } from "@/lib/swap/kyberswapServer";
import { lifiFeeRate } from "@/lib/stats/platform";

/**
 * Daily time series for the /analytics charts — volume, fees, swaps and new
 * wallets per day over a window. Pure bucketing (bucketDaily) so it is tested
 * without a database; the reader supplies the ledger rows and the fee rates.
 *
 * "New wallets" is first-EVER-action-per-wallet, so the reader passes the whole
 * history and only the last `days` buckets are emitted — a wallet active for
 * months is not counted new again inside the window. Cheap at launch volume; a
 * SQL rollup view replaces the fetch when the tables grow.
 */

export interface DailyPoint {
  /** UTC calendar day, YYYY-MM-DD. */
  date: string;
  volumeUsd: number; // swaps + cctp + route bridges that day
  feesUsd: number; // swap fee + route-bridge fee that day
  swaps: number;
  newWallets: number;
}

export interface ActionRow {
  occurred_at?: string | null;
  usd_value?: number | string | null;
  source_slug?: string | null;
  wallet?: string | null;
}
export interface BridgeRow {
  created_at?: string | null;
  amount?: string | null; // CCTP: human USDC
  usd_value?: number | string | null; // route: priced notional
}

const DAY_MS = 86_400_000;

function utcDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Fold ledger rows into one point per day for the last `days` days ending at
 *  `now` (UTC). Pure. */
export function bucketDaily(input: {
  actions: ReadonlyArray<ActionRow>;
  cctp: ReadonlyArray<BridgeRow>;
  route: ReadonlyArray<BridgeRow>;
  days: number;
  swapFeeRate: number; // fraction, e.g. 0.002
  lifiFeeRate: number; // fraction
  now?: number;
}): DailyPoint[] {
  const days = Math.max(1, Math.min(365, Math.floor(input.days)));
  const now = input.now ?? Date.now();
  const todayUtc = new Date(now).toISOString().slice(0, 10);
  const end = Date.parse(todayUtc + "T00:00:00Z");

  // Ordered window of day keys, oldest → newest.
  const keys: string[] = [];
  const bucket = new Map<
    string,
    { swapVol: number; cctpVol: number; routeVol: number; swaps: number; newWallets: number }
  >();
  for (let i = days - 1; i >= 0; i--) {
    const key = new Date(end - i * DAY_MS).toISOString().slice(0, 10);
    keys.push(key);
    bucket.set(key, { swapVol: 0, cctpVol: 0, routeVol: 0, swaps: 0, newWallets: 0 });
  }
  const inWindow = keys.length ? keys[0] : todayUtc;

  // First-ever action day per wallet, over ALL history passed in.
  const firstDay = new Map<string, string>();
  for (const a of input.actions) {
    const w = (a.wallet ?? "").toLowerCase();
    const d = utcDay(a.occurred_at);
    if (!w || !d) continue;
    const prev = firstDay.get(w);
    if (!prev || d < prev) firstDay.set(w, d);
  }
  for (const [, d] of firstDay) {
    if (d < inWindow) continue;
    const b = bucket.get(d);
    if (b) b.newWallets++;
  }

  // Swaps → volume + count, on their day if in window.
  for (const a of input.actions) {
    if ((a.source_slug ?? "") !== "swap") continue;
    const d = utcDay(a.occurred_at);
    const b = d ? bucket.get(d) : undefined;
    if (!b) continue;
    b.swapVol += num(a.usd_value);
    b.swaps++;
  }
  for (const r of input.cctp) {
    const d = utcDay(r.created_at);
    const b = d ? bucket.get(d) : undefined;
    if (b) b.cctpVol += num(r.amount);
  }
  for (const r of input.route) {
    const d = utcDay(r.created_at);
    const b = d ? bucket.get(d) : undefined;
    if (b) b.routeVol += num(r.usd_value);
  }

  return keys.map((date) => {
    const b = bucket.get(date)!;
    return {
      date,
      volumeUsd: b.swapVol + b.cctpVol + b.routeVol,
      feesUsd: b.swapVol * input.swapFeeRate + b.routeVol * input.lifiFeeRate,
      swaps: b.swaps,
      newWallets: b.newWallets,
    };
  });
}

const READ_CAP = 200_000;

/** Read the ledgers and bucket them. `null` only when the primary ledger
 *  (point_actions) is unavailable; missing bridge tables just drop those bars. */
export async function readTimeseries(days = 30): Promise<DailyPoint[] | null> {
  if (!supabaseAdmin) return null;
  const actions = await supabaseAdmin
    .from("point_actions")
    .select("occurred_at, usd_value, source_slug, wallet")
    .limit(READ_CAP);
  if (actions.error || !actions.data) return null;

  const cctp = await supabaseAdmin
    .from("cctp_transfers")
    .select("created_at, amount")
    .neq("status", "failed")
    .limit(READ_CAP);
  const route = await supabaseAdmin
    .from("route_bridges")
    .select("created_at, usd_value")
    .limit(READ_CAP);

  return bucketDaily({
    actions: actions.data as ActionRow[],
    cctp: cctp.error ? [] : ((cctp.data ?? []) as BridgeRow[]),
    route: route.error ? [] : ((route.data ?? []) as BridgeRow[]),
    days,
    swapFeeRate: swapFeeBps() / 10_000,
    lifiFeeRate: lifiFeeRate(),
  });
}
