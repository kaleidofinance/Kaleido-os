-- The points-swap indexer's resume point, one row per chain.
--
-- Before this, api/cron/points-swap scanned a fixed "last WINDOW_BLOCKS blocks"
-- each run with no memory of how far it had read. On Arc (~0.5s/block) 10k blocks
-- is only ~1.4h, and the run is capped at MAX_TXS transactions — so under a swap
-- surge (a promo) the backlog ages out of the window and is credited NEVER. The
-- exact shape and reasoning of kld_candle_cursor: a swap scan is a stream of
-- points in time, scanned once and never re-derived, so the state that matters
-- is how far it has read. With a cursor the next run resumes from last_block + 1
-- (minus a reorg margin the indexer applies), so nothing is lost no matter the
-- volume — a capped run just leaves the remainder for the next run.
create table if not exists public.points_swap_cursor (
  chain_id   bigint      not null,
  -- Highest block whose fee-transfer swaps have been fully processed. The next
  -- run scans from last_block + 1. Only advanced past blocks the run drained
  -- completely, so a MAX_TXS-capped run re-scans the remainder (idempotent —
  -- point_actions is keyed by tx_hash, so a re-credit is a no-op).
  last_block bigint      not null,
  updated_at timestamptz not null default now(),
  primary key (chain_id)
);

alter table public.points_swap_cursor enable row level security;

revoke all on table public.points_swap_cursor from public, anon, authenticated;

comment on table public.points_swap_cursor is
  'Per-chain last-fully-scanned block for the points-swap indexer. Service-role only — a writable cursor forces duplicate or skipped swap credits.';
