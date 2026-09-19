-- Cumulative launch metrics for swaps routed through Kaleido's KyberSwap path.
--
-- The swap collector already records one verified point_actions row per Kyber
-- transaction. Keep the public stats derived from that same server-only ledger
-- so a second indexer cannot disagree with points or count browser-written data.
-- This is deliberately separate from pool_sweep's short 24h event sample:
-- Kyber liquidity is external to Kaleido's pools and must not be mixed into LP
-- TVL or LP fees.

create or replace view public.aggregator_swap_stats as
select
  count(*)::bigint as swap_count,
  coalesce(sum(a.usd_value), 0)::numeric as volume_usd,
  coalesce(sum(a.usd_value) * (20::numeric / 10000), 0)::numeric as fees_usd,
  max(a.occurred_at) as last_occurred_at
from public.point_actions a
where a.source_slug = 'swap'
  and a.chain_id = 5042;

comment on view public.aggregator_swap_stats is
  'Cumulative verified KyberSwap-routed volume on Arc. Fees are Kaleido fee revenue at the configured 20 bps rate; external LP fees are not included.';

grant select on public.aggregator_swap_stats to anon, authenticated;
