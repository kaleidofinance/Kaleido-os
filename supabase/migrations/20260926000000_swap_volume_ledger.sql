-- Swap VOLUME, recorded independently of points eligibility.
--
-- Before this, every volume figure — Total Volume / Total fees
-- (aggregator_swap_stats), the /analytics daily chart, the admin 24h volume —
-- was derived from credited `point_actions` rows. A swap earns 0 points below
-- the Season-1 rate's min_usd ($10), and a 0-point swap writes no row, so every
-- sub-$10 swap was absent from "Total Volume". Measured on 2026-09-26: 63 of 69
-- historical native-pool trades fell under the floor and were never counted.
--
-- Points stay exactly as they are. This ledger is written for every swap the
-- indexer can value, before and regardless of the points decision, and the
-- volume readers move to it. Zero-point rows in point_actions were rejected:
-- unique-wallet counts, points distributed, the leaderboard and waitlist task
-- sync all read that table and would be polluted.
--
-- DEPLOY ORDER: apply this BEFORE the code that writes it. It is
-- backward-compatible with the current code — aggregator_swap_stats keeps its
-- columns (one is appended), and the ledger is seeded from point_actions below,
-- so Total Volume reads the same the moment this lands.

create table if not exists public.swap_volume (
  chain_id    int         not null,
  -- One swap, one row, forever — the same anti-replay key as point_actions.
  tx_hash     text        not null,
  wallet      text        not null,
  -- The trade's dollar size, as the indexer valued it. Never rewritten once
  -- recorded (see record_swap_volume), so a re-scan at today's prices cannot
  -- restate history.
  usd_value   numeric     not null check (usd_value >= 0),
  -- 'aggregator' | 'argus' | 'native-pool' | 'other' | 'unknown' (seeded rows).
  venue       text        not null default 'unknown',
  -- Whether the swap paid Kaleido's fee to SWAP_FEE_RECEIVER. Total fees are
  -- charged on fee-paying volume only: a direct native-pool trade pays none.
  fee_paid    boolean     not null default true,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  primary key (chain_id, tx_hash)
);

create index if not exists swap_volume_occurred_at_idx
  on public.swap_volume (occurred_at);

alter table public.swap_volume enable row level security;
revoke all on table public.swap_volume from public, anon, authenticated;

comment on table public.swap_volume is
  'Every valued swap, independent of points eligibility. Source of Total Volume, the daily chart and admin volume. Service-role only; written via record_swap_volume.';

-- Seed from the points ledger so the view below reads the same totals as
-- before the moment it is repointed. venue is unknown for these; fee_paid is
-- true because until #445 the indexer only ever discovered fee-paying swaps.
-- The chain backfill that follows corrects venue/fee_paid per transaction.
insert into public.swap_volume (chain_id, tx_hash, wallet, usd_value, venue, fee_paid, occurred_at)
select a.chain_id, lower(a.tx_hash), lower(a.wallet), a.usd_value, 'unknown', true, a.occurred_at
  from public.point_actions a
 where a.source_slug = 'swap'
on conflict (chain_id, tx_hash) do nothing;

-- The ONE writer. Inserts a new swap; on a repeat it refreshes only the
-- classification (venue, fee_paid) and never the recorded value, time or
-- wallet — so re-running a backfill is safe and a seeded row gets its real
-- venue without its dollar value being re-priced.
create or replace function public.record_swap_volume(
  p_chain_id    int,
  p_tx_hash     text,
  p_wallet      text,
  p_usd_value   numeric,
  p_venue       text,
  p_fee_paid    boolean,
  p_occurred_at timestamptz
)
returns void
language sql
-- security definer so the function can write a table that denies all direct
-- access. Execute is granted to service_role only, below.
security definer
set search_path = public
as $$
  insert into public.swap_volume (chain_id, tx_hash, wallet, usd_value, venue, fee_paid, occurred_at)
  values (p_chain_id, lower(p_tx_hash), lower(p_wallet), p_usd_value, p_venue, p_fee_paid, p_occurred_at)
  on conflict (chain_id, tx_hash) do update
    set venue    = excluded.venue,
        fee_paid = excluded.fee_paid;
$$;

revoke all on function public.record_swap_volume(int, text, text, numeric, text, boolean, timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_swap_volume(int, text, text, numeric, text, boolean, timestamptz)
  to service_role;

-- Repoint the public stats view at the ledger. Same leading columns, so the
-- current reader keeps working; fee_volume_usd is appended (Postgres allows
-- adding trailing columns in CREATE OR REPLACE VIEW) and is what fees are now
-- computed on — fee-paying swaps only, not direct pool trades.
create or replace view public.aggregator_swap_stats as
select
  count(*)::bigint                                                          as swap_count,
  coalesce(sum(v.usd_value), 0)::numeric                                    as volume_usd,
  (coalesce(sum(v.usd_value) filter (where v.fee_paid), 0)
     * (20::numeric / 10000))::numeric                                      as fees_usd,
  max(v.occurred_at)                                                        as last_occurred_at,
  coalesce(sum(v.usd_value) filter (where v.fee_paid), 0)::numeric          as fee_volume_usd
from public.swap_volume v
where v.chain_id = 5042;

comment on view public.aggregator_swap_stats is
  'Cumulative swap volume on Arc from swap_volume — every valued swap (aggregator routes, Argus, direct pool trades), including those below the points floor. fees_usd / fee_volume_usd cover fee-paying swaps only.';

grant select on public.aggregator_swap_stats to anon, authenticated;
