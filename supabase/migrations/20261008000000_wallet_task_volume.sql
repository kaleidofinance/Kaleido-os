-- The swap-volume reward task's figure, one row per wallet:
--   swaps_usd       every swap in swap_volume (Luca and manual, sub-$10 included)
--   collateral_usd  idle collateral held NOW: the newest collateral_idle snapshot
--                   per chain, summed (a withdrawal writes 0, so it drops out)
-- Read by the waitlist routes and the top-up sync, so they all agree. Additive:
-- a view only, no data change.
begin;

create or replace view public.wallet_task_volume as
with swaps as (
  select wallet, sum(usd_value) as usd
  from public.swap_volume
  group by wallet
),
collateral as (
  select wallet, sum(usd_value) as usd
  from (
    select distinct on (wallet, chain_id) wallet, chain_id, usd_value
    from public.point_snapshots
    where source_slug = 'collateral_idle'
    order by wallet, chain_id, taken_at desc
  ) latest
  group by wallet
),
wallets as (
  select wallet from swaps
  union
  select wallet from collateral
)
select
  w.wallet,
  coalesce(s.usd, 0) as swaps_usd,
  coalesce(c.usd, 0) as collateral_usd
from wallets w
left join swaps s using (wallet)
left join collateral c using (wallet);

revoke all on public.wallet_task_volume from public, anon, authenticated;
grant select on public.wallet_task_volume to service_role;

commit;
