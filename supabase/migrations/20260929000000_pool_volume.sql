-- All-time volume per native pool (src/lib/points/poolVolume.ts).
--
-- The Pools table showed a 24h figure extrapolated from a short block window,
-- which is empty almost always while our Arc pools are young, so every row read
-- "—". It now shows cumulative totals from this ledger: one row per pool Swap
-- log, valued by the pool's own dollar leg, written by the points-swap cron
-- (live and backfill). Keyed per log so any re-scan counts a swap once.

begin;

create table if not exists public.pool_volume (
  chain_id    int         not null,
  tx_hash     text        not null,
  log_index   int         not null,
  pool        text        not null,
  usd_value   numeric     not null check (usd_value >= 0),
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  primary key (chain_id, tx_hash, log_index)
);

create index if not exists pool_volume_pool_idx
  on public.pool_volume (chain_id, pool);

alter table public.pool_volume enable row level security;
revoke all on table public.pool_volume from public, anon, authenticated;

comment on table public.pool_volume is
  'One row per native-pool Swap log, valued by the pool''s dollar leg. Service-role only; source of the Pools table''s Total volume / Total fees.';

create or replace view public.pool_volume_totals as
select
  chain_id,
  pool,
  coalesce(sum(usd_value), 0)::numeric as volume_usd,
  count(*)::bigint                     as swaps,
  min(occurred_at)                     as first_at,
  max(occurred_at)                     as last_at
from public.pool_volume
group by chain_id, pool;

revoke all on public.pool_volume_totals from public, anon, authenticated;

commit;
