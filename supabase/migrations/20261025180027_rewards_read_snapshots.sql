-- Rebuild shared aggregates on a clock, instead of in every visitor's request.
-- No points ledger, task completion or wallet registration is modified here.
begin;
set local lock_timeout = '20s';
set local statement_timeout = '120s';
set local work_mem = '32MB';

create schema if not exists kaleido_rewards_private;
revoke all on schema kaleido_rewards_private from public, anon, authenticated;
grant usage on schema kaleido_rewards_private to service_role;

create materialized view if not exists kaleido_rewards_private.referrals as
select w.wallet, w.ref_code, coalesce(r.referrals,0) as referrals,
  rank() over (order by coalesce(r.active_referrals,0) desc) as rank,
  coalesce(r.active_referrals,0) as active_referrals,
  coalesce(r.pending_referrals,0) as pending_referrals
from public.waitlist w
left join (
  select referred_by, count(*) as referrals,
    count(*) filter (where activated_at is not null) as active_referrals,
    count(*) filter (where activated_at is null) as pending_referrals
  from public.waitlist where x_user_id is not null and referred_by is not null
  group by referred_by
) r on r.referred_by = w.ref_code;
create unique index if not exists reward_referrals_wallet_idx on kaleido_rewards_private.referrals (wallet);
create index if not exists reward_referrals_rank_idx on kaleido_rewards_private.referrals (rank, wallet);

create materialized view if not exists kaleido_rewards_private.task_volume as
with swaps as (
  select wallet, sum(usd_value) as usd from public.swap_volume group by wallet
), collateral as (
  select wallet, sum(usd_value) as usd from (
    select distinct on (wallet, chain_id) wallet, chain_id, usd_value
    from public.point_snapshots where source_slug = 'collateral_idle'
    order by wallet, chain_id, taken_at desc
  ) latest group by wallet
), wallets as (
  select wallet from swaps union select wallet from collateral
)
select w.wallet, coalesce(s.usd, 0) as swaps_usd, coalesce(c.usd, 0) as collateral_usd
from wallets w left join swaps s using (wallet) left join collateral c using (wallet);
create unique index if not exists reward_task_volume_wallet_idx on kaleido_rewards_private.task_volume (wallet);

create materialized view if not exists kaleido_rewards_private.metadata as
select 1 as id, now() as as_of,
  (select jsonb_object_agg(season, participants) from (
    select season, count(*) as participants from public.point_balances
    where sybil_flag is null group by season
  ) counts) as participants,
  (select jsonb_build_object(
    'commented', count(x_commented_at), 'argus', count(x_argus_at),
    'argus2', count(x_argus2_at), 'absexit', count(x_absexit_at),
    'argusIntegration', count(x_argus_integration_at),
    'argusIntegrationComment', count(x_argus_integration_comment_at),
    'robinhoodIntegration', count(x_robinhood_integration_at),
    'robinhoodIntegrationComment', count(x_robinhood_integration_comment_at)
  ) from public.waitlist) as task_counts;
create unique index if not exists reward_metadata_id_idx on kaleido_rewards_private.metadata (id);

create materialized view if not exists kaleido_rewards_private.board as
with volumes as (
  select season, wallet, sum(usd_value) as volume
  from public.point_actions group by season, wallet
)
select b.season, b.wallet, b.total, b.time_points, b.action_points, b.bonus_points,
  rank() over (partition by b.season order by b.total desc) as rnk,
  ceil(100 * cume_dist() over (partition by b.season order by b.total desc))::int as percentile,
  row_number() over (partition by b.season order by b.total desc, b.wallet) as position,
  count(*) over (partition by b.season) as participants,
  coalesce(v.volume, 0) as volume, coalesce(r.referrals, 0) as referrals,
  now() as as_of
from public.point_balances b
left join volumes v on v.season = b.season and v.wallet = b.wallet
left join kaleido_rewards_private.referrals r on r.wallet = b.wallet
where b.sybil_flag is null;
create unique index if not exists reward_board_wallet_idx on kaleido_rewards_private.board (season, wallet);
create index if not exists reward_board_position_idx on kaleido_rewards_private.board (season, position);

revoke all on all tables in schema kaleido_rewards_private from public, anon, authenticated;
grant select on all tables in schema kaleido_rewards_private to service_role;

-- Existing consumers, including the background credit sync, use indexed reads.
create or replace view public.waitlist_leaderboard with (security_invoker = true) as
select wallet, ref_code, referrals, rank, active_referrals, pending_referrals
from kaleido_rewards_private.referrals;
revoke all on public.waitlist_leaderboard from public, anon, authenticated;
grant select on public.waitlist_leaderboard to service_role;

create or replace view public.wallet_task_volume with (security_invoker = true) as
select wallet, swaps_usd, collateral_usd from kaleido_rewards_private.task_volume;
revoke all on public.wallet_task_volume from public, anon, authenticated;
grant select on public.wallet_task_volume to service_role;

-- The public projection must apply the CURRENT disclosure and flag policy,
-- even if an operator changes either between snapshot refreshes.
create view public.reward_board_rows as
select r.season, r.wallet,
  case when s.disclosure = 'full' or r.rnk <= s.public_rank_limit then r.rnk else null::bigint end as rank,
  r.percentile,
  case when s.disclosure in ('totals','full') then r.total else null::numeric end as total,
  case when s.disclosure = 'full' then r.time_points else null::numeric end as time_points,
  case when s.disclosure = 'full' then r.action_points else null::numeric end as action_points,
  case when s.disclosure = 'full' then r.bonus_points else null::numeric end as bonus_points,
  r.volume, r.referrals, r.position, r.participants, r.as_of
from kaleido_rewards_private.board r
join public.point_seasons s on s.id = r.season
join public.point_balances live on live.wallet = r.wallet and live.season = r.season
where live.sybil_flag is null;
revoke all on public.reward_board_rows from public, anon, authenticated;
grant select on public.reward_board_rows to service_role;

create or replace view public.point_leaderboard as
select season, wallet, rank, percentile, total, time_points, action_points, bonus_points, volume
from public.reward_board_rows;
-- Keep this existing public surface's masked projection readable.
grant select on public.point_leaderboard to anon, authenticated, service_role;

create view public.reward_read_metadata with (security_invoker = true) as
select id, as_of, participants, task_counts from kaleido_rewards_private.metadata;
revoke all on public.reward_read_metadata from public, anon, authenticated;
grant select on public.reward_read_metadata to service_role;

-- One request, one snapshot: live task timestamps and balances, indexed shared
-- aggregates. An SQL/connection failure propagates instead of resetting tasks.
create function public.reward_wallet_facts(p_wallet text) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'row', to_jsonb(w), 'referral', to_jsonb(r), 'volume', to_jsonb(v),
    'taskCounts', m.task_counts, 'asOf', m.as_of,
    'season1', case when b.wallet is null then null else jsonb_build_object(
      'total', b.total, 'tasks', a.tasks, 'trading', a.trading,
      'liquidity', b.time_points,
      'other', greatest(0, b.total - a.tasks - a.trading - b.time_points)
    ) end
  )
  from public.waitlist w
  cross join kaleido_rewards_private.metadata m
  left join kaleido_rewards_private.referrals r on r.wallet = w.wallet
  left join kaleido_rewards_private.task_volume v on v.wallet = w.wallet
  left join public.point_balances b on b.wallet = w.wallet and b.season = 1
  left join lateral (
    select coalesce(sum(points) filter(where source_slug = 'waitlist'),0) as tasks,
      coalesce(sum(points) filter(where source_slug = 'swap'),0) as trading
    from public.point_actions where wallet = w.wallet and season = 1
      and source_slug in ('waitlist','swap')
  ) a on true
  where w.wallet = lower(p_wallet);
$$;
revoke all on function public.reward_wallet_facts(text) from public, anon, authenticated;
grant execute on function public.reward_wallet_facts(text) to service_role;

-- Same forward-only eligibility rules as lib/waitlist/eligible.ts. Serialize
-- the clock and activation callers so two different eligible totals cannot
-- both credit against the same previous balance.
create function public.reward_reconcile_waitlist() returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  result jsonb;
begin
  if not pg_try_advisory_xact_lock(5042, 2502) then
    return jsonb_build_object('wallets',0,'toppedUp',0,'points',0,'errors','[]'::jsonb,'skipped',true);
  end if;
  with credits as materialized (
    select wallet, sum(points) as credited from public.point_actions
    where season = 1 and source_slug = 'waitlist' group by wallet
  ), candidates as (
    select wallet from credits where credited > 0
    union select wallet from public.waitlist where activated_at is not null
  ), facts as (
    select w.wallet, coalesce(c.credited,0) as credited,
      w.welcome_points + 50 * coalesce(r.active_referrals,0)
      + case when w.arc_mainnet_tx_at is not null then 300 else 0 end
      + case when w.agent_tx_at is not null then 500 else 0 end
      + case when w.bridge_tx_at is not null then 500 else 0 end
      + case
        when coalesce(v.swaps_usd,0) + coalesce(v.collateral_usd,0) >= 300 then 2000
        when coalesce(v.swaps_usd,0) + coalesce(v.collateral_usd,0) >= 100 then 1000
        when coalesce(v.swaps_usd,0) + coalesce(v.collateral_usd,0) >= 50 then 700
        when coalesce(v.swaps_usd,0) + coalesce(v.collateral_usd,0) >= 10 then 500
        else 0 end
      + coalesce((select sum(weight.value::numeric)
        from jsonb_each_text('{
          "x_linked_at":100,"x_followed_at":100,"x_retweeted_at":100,"x_commented_at":50,
          "x_launch_at":100,"x_llama_at":100,"x_argus_at":600,"x_argus2_at":300,
          "x_absexit_at":700,"x_lendborrow_at":500,"x_lendborrow_comment_at":500,
          "x_limitorder_at":500,"x_limitorder_comment_at":500,
          "x_argus_integration_at":500,"x_argus_integration_comment_at":500,
          "x_robinhood_integration_at":500,"x_robinhood_integration_comment_at":500,"x_bitget_at":100
        }'::jsonb) weight
        where (to_jsonb(w)->>weight.key)::timestamptz <= now() - interval '5 hours'
      ),0) as eligible
    from candidates k join public.waitlist w on w.wallet = k.wallet
    left join credits c on c.wallet = w.wallet
    left join kaleido_rewards_private.referrals r on r.wallet = w.wallet
    left join kaleido_rewards_private.task_volume v on v.wallet = w.wallet
  ), inserted as (
    insert into public.point_actions
      (wallet,source_slug,season,tx_hash,chain_id,usd_value,multiplier_applied,points,is_agent_initiated,occurred_at)
    select wallet,'waitlist',1,'waitlist:reconcile:' || wallet || ':' || trim_scale(eligible)::text,
      5042,0,1,eligible-credited,false,now()
    from facts where eligible > credited
    on conflict (chain_id,tx_hash) do nothing
    returning points
  )
  select jsonb_build_object('wallets',(select count(*) from facts),
    'toppedUp',count(*),'points',coalesce(sum(points),0),'errors','[]'::jsonb)
  into result from inserted;
  return result;
end;
$$;
revoke all on function public.reward_reconcile_waitlist() from public, anon, authenticated;
grant execute on function public.reward_reconcile_waitlist() to service_role;

create function kaleido_rewards_private.refresh_read_models() returns void
language plpgsql security invoker set search_path = '' set work_mem = '32MB' as $$
begin
  if not pg_try_advisory_xact_lock(5042, 2501) then return; end if;
  refresh materialized view concurrently kaleido_rewards_private.referrals;
  refresh materialized view concurrently kaleido_rewards_private.task_volume;
  perform public.reward_reconcile_waitlist();
  refresh materialized view concurrently kaleido_rewards_private.metadata;
  refresh materialized view concurrently kaleido_rewards_private.board;
end;
$$;
revoke all on function kaleido_rewards_private.refresh_read_models() from public, anon, authenticated;

-- SCHEDULER: the database refreshes independently of browsers and app restarts.
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('kaleido-rewards-read-models', '* * * * *',
  'set statement_timeout = ''45s''; select kaleido_rewards_private.refresh_read_models();');
-- END SCHEDULER
notify pgrst, 'reload schema';
commit;
