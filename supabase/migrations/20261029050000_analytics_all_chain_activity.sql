-- Keep the cumulative swap rollup aligned with the multi-chain analytics UI.
-- swap_volume is the canonical valued-swap ledger for every supported mainnet.
create or replace view public.aggregator_swap_stats as
select
  count(*)::bigint as swap_count,
  coalesce(sum(v.usd_value), 0)::numeric as volume_usd,
  (coalesce(sum(v.usd_value) filter (where v.fee_paid), 0)
    * (20::numeric / 10000))::numeric as fees_usd,
  max(v.occurred_at) as last_occurred_at,
  coalesce(sum(v.usd_value) filter (where v.fee_paid), 0)::numeric as fee_volume_usd
from public.swap_volume v;

comment on view public.aggregator_swap_stats is
  'Cumulative swap volume across all supported mainnets from swap_volume. fees_usd / fee_volume_usd cover fee-paying swaps only.';

grant select on public.aggregator_swap_stats to anon, authenticated;
