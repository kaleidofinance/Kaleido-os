-- The points-lend collector's log cursor, one row per chain.
--
-- api/cron/points-lend finds wallets that only DEPOSITED collateral (they appear
-- in no loan request) from the lending diamond's CollateralDeposited logs. Those
-- logs are a stream, scanned once: the state that matters is how far it has read.
-- Same shape and reasoning as points_swap_cursor — without it a run would scan a
-- fixed lookback window, and any backlog older than the window (a collector
-- outage, a deposit surge) would never be seen, so those depositors would never
-- earn `collateral_idle`. With it, the next run resumes at last_block + 1 and a
-- capped run just leaves the remainder for the next.
create table if not exists public.points_lend_cursor (
  chain_id   bigint      not null,
  -- Highest block whose CollateralDeposited logs have been read AND whose
  -- depositors were snapshotted in the same run. The next run scans from
  -- last_block + 1.
  last_block bigint      not null,
  updated_at timestamptz not null default now(),
  primary key (chain_id)
);

alter table public.points_lend_cursor enable row level security;

revoke all on table public.points_lend_cursor from public, anon, authenticated;

comment on table public.points_lend_cursor is
  'Per-chain last-fully-scanned block for the points-lend collector (CollateralDeposited logs). Service-role only.';
