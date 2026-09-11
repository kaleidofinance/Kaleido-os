-- KLD price candles, drawn from our own V3 pool's swaps.
--
-- WHY THIS TABLE EXISTS. KLD is a testnet token with no exchange listing, so
-- src/lib/v2/prices/feeds.ts prices it as nothing — there is no CoinGecko id to
-- ask. The only honest KLD price is the one our own KLD/USDC pool last traded
-- at, and that lives in the pool's Swap events. A keeper scans those events,
-- turns each swap's tick into a price (src/lib/v2/prices/candles.ts), buckets
-- them into candles, and writes them here for the chart to read back. The tick
-- math and the bucketing are covered by test:candles and test:v3math; this
-- migration is only the store.
--
-- ONE GRANULARITY, NOT FOUR. The chart offers 15m / 1h / 4h / 1d, and it would
-- be a mistake to store all four. OHLC composes: a 1h candle is the open of the
-- first 15m in the hour, the close of the last, the max high and the min low —
-- identical to a 1h computed from the swaps directly. So only the 15m base is
-- stored, and the coarser intervals are rolled up on read. Storing four would be
-- four writes per bucket and four chances for a 1h to disagree with its own four
-- 15m candles; deriving them keeps one source of truth. If a finer base is ever
-- needed the base changes here, in a migration, rather than the set of stored
-- intervals drifting silently.
--
-- KEYED BY POOL, NOT JUST CHAIN. A chain can hold more than one KLD pool — a
-- second fee tier, a redeployment — and they will not trade at the same price;
-- there is no arbitrage between two testnet pools any more than between two
-- testnet chains. So the price is per (chain, pool), and the chart names which
-- one it is drawing rather than blending them.
--
-- SERVICE-ROLE ONLY, matching push_watch_state and health_watch_state. The anon
-- key ships in the JS bundle, and a writable price series is a way to draw a
-- candle that never traded — a fake wick on the one number that prices KLD. The
-- keeper writes through the service key (/api/keeper/candles); the chart reads
-- through a server route (/api/prices/kld) that selects with the same key, never
-- the browser. RLS is enabled with no policy, which denies anon and
-- authenticated every operation, and the grants are revoked so a future
-- dashboard-created policy has nothing to act on.

create table if not exists public.kld_candles (
  -- The deployment this price is from. A KLD price is only meaningful with its
  -- chain: KLD/USDC on Base and on Sepolia are different markets.
  chain_id      bigint      not null,
  -- Lowercase 0x pool address. Lowercased by the writer, the same normalisation
  -- every address column in this schema applies, so a select can match without
  -- an ilike.
  pool          text        not null,
  -- Bucket start, unix SECONDS (not milliseconds, and not timestamptz). The
  -- candle code speaks unix seconds throughout — INTERVALS, bucketStart — and a
  -- bigint round-trips it with no timezone in the middle to get a boundary
  -- wrong. Always a multiple of 900 (the 15m base).
  bucket_start  bigint      not null,
  -- OHLC, USDC per KLD, already oriented (src/lib/v2/prices/candles.ts resolves
  -- token order per chain). Numeric rather than double precision for the same
  -- reason health_watch_state gives: this is the number a chart draws and a
  -- reader judges a price by, and binary rounding has no business in it. KLD can
  -- trade well below a cent, so the scale is generous.
  o             numeric(40, 18) not null,
  h             numeric(40, 18) not null,
  l             numeric(40, 18) not null,
  c             numeric(40, 18) not null,
  -- Swaps that produced this candle. One is a print, not a market, and the
  -- chart dims a one-swap candle rather than drawing it as if it were liquid.
  n             integer     not null,
  -- Last write. The indexer re-scans the still-open bucket every run, so a
  -- bucket's row is rewritten until it closes; this is when that last happened.
  updated_at    timestamptz not null default now(),
  primary key (chain_id, pool, bucket_start)
);

-- The one read the chart makes: a chain+pool's candles, newest first, limited to
-- a window. bucket_start descending is the order the API pages in.
create index if not exists kld_candles_series_idx
  on public.kld_candles (chain_id, pool, bucket_start desc);

alter table public.kld_candles enable row level security;

-- Belt and braces, matching push_watch_state: RLS with no policy already denies
-- these, but revoking the grant means a later policy still has nothing to act on.
revoke all on table public.kld_candles from public, anon, authenticated;

comment on table public.kld_candles is
  'KLD 15m OHLC per (chain, pool), from our own V3 pool swaps. Coarser intervals roll up on read. Service-role only — a writable price series can draw a candle that never traded.';

-- The indexer's resume point, one row per (chain, pool). Exactly the shape of
-- push_watch_state and for the same reason: a Swap scan is a stream of points in
-- time, scanned once and never re-derived, so the state that matters is how far
-- it has read. Separate from the candles because a run that produced no new
-- candles (a quiet fifteen minutes) still advanced the block cursor, and losing
-- that would re-scan the same empty range forever.
create table if not exists public.kld_candle_cursor (
  chain_id      bigint      not null,
  pool          text        not null,
  -- Highest block whose Swap events have been folded into candles. The next run
  -- scans from last_block + 1 — with a reorg margin the indexer applies, since a
  -- testnet can reorg and a candle built from an orphaned swap would be wrong.
  last_block    bigint      not null,
  updated_at    timestamptz not null default now(),
  primary key (chain_id, pool)
);

alter table public.kld_candle_cursor enable row level security;

revoke all on table public.kld_candle_cursor from public, anon, authenticated;

comment on table public.kld_candle_cursor is
  'Per (chain, pool) last-scanned block for the KLD candle indexer. Service-role only — a writable cursor forces duplicate or skipped candles.';
