import { supabaseAdmin } from "@/lib/supabase/serverClient";
import type { Candle } from "./candles";

/**
 * Reading and writing KLD candles, service-role only.
 *
 * See supabase/migrations/20260911000000_kld_candles.sql for the shape and why
 * it is one granularity. This module is the only thing that touches those
 * tables: the keeper writes through `upsertCandles`/`setCursor`, the price route
 * reads through `readCandles`. All three hold the service key by way of
 * `serverClient.ts`, whose own `window` guard (there is no `server-only`
 * package in this repo — see docs.ts) turns a browser import into a loud error
 * rather than a silent key leak. Import this only from route handlers.
 *
 * The row<->candle mapping is split out and pure so it can be tested without a
 * database, because the one thing that silently corrupts a price series is a
 * number that survived a round trip as the wrong type. Postgres `numeric` comes
 * back over the wire as a STRING, and `Number("0.0000012")` is fine while
 * `+row.o` on an accidental null is `0` — a real price. So the mapping is
 * explicit and refuses a row it cannot read rather than coercing it to a candle
 * that prints zero.
 */

export interface CandleRow {
  chain_id: number;
  pool: string;
  bucket_start: number;
  o: string | number;
  h: string | number;
  l: string | number;
  c: string | number;
  n: number;
}

/** A candle to its row for (chain, pool). Prices are sent as strings so the
 *  full numeric precision reaches Postgres rather than a float's 15 digits. */
export function candleToRow(
  chainId: number,
  pool: string,
  candle: Candle,
): CandleRow {
  return {
    chain_id: chainId,
    pool: pool.toLowerCase(),
    bucket_start: candle.t,
    o: candle.o.toString(),
    h: candle.h.toString(),
    l: candle.l.toString(),
    c: candle.c.toString(),
    n: candle.n,
  };
}

/**
 * A row back to a candle, or null when it cannot be read as one.
 *
 * Every OHLC field is parsed and checked finite and positive: a null, a NaN or
 * a non-positive price is not a cheaper candle, it is a corrupt one, and a chart
 * is better missing a bar than drawing a zero. Returning null lets the caller
 * drop it; throwing would lose the whole series to one bad row.
 */
export function rowToCandle(row: CandleRow): Candle | null {
  const num = (v: string | number): number | null => {
    const x = typeof v === "string" ? Number(v) : v;
    return Number.isFinite(x) && x > 0 ? x : null;
  };
  const o = num(row.o);
  const h = num(row.h);
  const l = num(row.l);
  const c = num(row.c);
  const t = Number(row.bucket_start);
  if (o === null || h === null || l === null || c === null) return null;
  if (!Number.isFinite(t)) return null;
  return { t, o, h, l, c, n: Number(row.n) || 0 };
}

/**
 * Upsert candles for one (chain, pool). Overwrites by the primary key, which is
 * what makes re-scanning the open bucket idempotent — the same bucket_start
 * writes the same row rather than a second one.
 */
export async function upsertCandles(
  chainId: number,
  pool: string,
  candles: Candle[],
): Promise<{ written: number; error: string | null }> {
  if (!supabaseAdmin) return { written: 0, error: "supabase not configured" };
  if (candles.length === 0) return { written: 0, error: null };

  const rows = candles.map((c) => ({
    ...candleToRow(chainId, pool, c),
    updated_at: new Date().toISOString(),
  }));
  const { error } = await supabaseAdmin
    .from("kld_candles")
    .upsert(rows, { onConflict: "chain_id,pool,bucket_start" });
  return { written: error ? 0 : rows.length, error: error?.message ?? null };
}

/**
 * The most recent `limit` base candles for a (chain, pool), oldest first.
 *
 * Selected newest-first to honour the limit against the index, then reversed so
 * the caller gets ascending time — which is what both a chart and
 * `aggregateCandles` want. Unreadable rows are dropped, not thrown on.
 */
export async function readCandles(
  chainId: number,
  pool: string,
  limit: number,
): Promise<{ candles: Candle[]; error: string | null }> {
  if (!supabaseAdmin) return { candles: [], error: "supabase not configured" };

  const { data, error } = await supabaseAdmin
    .from("kld_candles")
    .select("chain_id,pool,bucket_start,o,h,l,c,n")
    .eq("chain_id", chainId)
    .eq("pool", pool.toLowerCase())
    .order("bucket_start", { ascending: false })
    .limit(limit);

  if (error) return { candles: [], error: error.message };
  const candles = (data ?? [])
    .map((r) => rowToCandle(r as CandleRow))
    .filter((c): c is Candle => c !== null)
    .reverse();
  return { candles, error: null };
}

/** The indexer's resume block for a (chain, pool), or null if it has never run. */
export async function getCursor(
  chainId: number,
  pool: string,
): Promise<number | null> {
  if (!supabaseAdmin) return null;
  const { data } = await supabaseAdmin
    .from("kld_candle_cursor")
    .select("last_block")
    .eq("chain_id", chainId)
    .eq("pool", pool.toLowerCase())
    .maybeSingle();
  const b = data?.last_block;
  return typeof b === "number" || typeof b === "string" ? Number(b) : null;
}

/** Advance the indexer's resume block. */
export async function setCursor(
  chainId: number,
  pool: string,
  lastBlock: number,
): Promise<{ error: string | null }> {
  if (!supabaseAdmin) return { error: "supabase not configured" };
  const { error } = await supabaseAdmin.from("kld_candle_cursor").upsert(
    {
      chain_id: chainId,
      pool: pool.toLowerCase(),
      last_block: lastBlock,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "chain_id,pool" },
  );
  return { error: error?.message ?? null };
}
