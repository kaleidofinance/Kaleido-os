begin;

alter table public.waitlist
  add column if not exists x_peach_integration_at timestamptz,
  add column if not exists x_peach_integration_comment_at timestamptz;

comment on column public.waitlist.x_peach_integration_at is
  'Attested like + repost of https://x.com/kaleido_finance/status/2120892376160075859; +300 kPoint; first 300 wallets.';
comment on column public.waitlist.x_peach_integration_comment_at is
  'Attested comment on https://x.com/kaleido_finance/status/2120892376160075859; +300 kPoint; first 300 wallets.';

create index if not exists waitlist_peach_integration_idx
  on public.waitlist (x_peach_integration_at)
  where x_peach_integration_at is not null;
create index if not exists waitlist_peach_integration_comment_idx
  on public.waitlist (x_peach_integration_comment_at)
  where x_peach_integration_comment_at is not null;

-- Extend the database-side allowlist used by the exact first-300 claim gate.
do $$
declare
  definition text;
  updated_definition text;
begin
  definition := pg_get_functiondef(
    'public.claim_capped_x_task(text,text,integer)'::regprocedure
  );
  if position('x_peach_integration_at' in definition) = 0 then
    updated_definition := replace(
      definition,
      quote_literal('x_elysium_lending_comment_at'),
      quote_literal('x_elysium_lending_comment_at') || ', ' ||
        quote_literal('x_peach_integration_at') || ', ' ||
        quote_literal('x_peach_integration_comment_at')
    );
    if updated_definition = definition then
      raise exception 'Could not extend claim_capped_x_task for Peach Launchpad';
    end if;
    execute updated_definition;
  end if;
end;
$$;

create or replace function public.reward_wallet_facts(p_wallet text) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'row', to_jsonb(w), 'referral', to_jsonb(r), 'volume', to_jsonb(v),
    'taskCounts', m.task_counts || jsonb_build_object(
      'lucaModelIntegration', (select count(*) from public.waitlist where x_luca_model_integration_at is not null),
      'lucaModelIntegrationComment', (select count(*) from public.waitlist where x_luca_model_integration_comment_at is not null),
      'elysiumIntegration', (select count(*) from public.waitlist where x_elysium_integration_at is not null),
      'elysiumIntegrationComment', (select count(*) from public.waitlist where x_elysium_integration_comment_at is not null),
      'elysiumLending', (select count(*) from public.waitlist where x_elysium_lending_at is not null),
      'elysiumLendingComment', (select count(*) from public.waitlist where x_elysium_lending_comment_at is not null),
      'peachIntegration', (select count(*) from public.waitlist where x_peach_integration_at is not null),
      'peachIntegrationComment', (select count(*) from public.waitlist where x_peach_integration_comment_at is not null)
    ), 'asOf', m.as_of,
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

create or replace function public.reward_reconcile_waitlist() returns jsonb
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
          "x_robinhood_integration_at":500,"x_robinhood_integration_comment_at":500,
          "x_luca_model_integration_at":300,"x_luca_model_integration_comment_at":300,
          "x_elysium_integration_at":300,"x_elysium_integration_comment_at":300,
          "x_elysium_lending_at":300,"x_elysium_lending_comment_at":300,
          "x_peach_integration_at":300,"x_peach_integration_comment_at":300,
          "x_bitget_at":100
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

notify pgrst, 'reload schema';
commit;
