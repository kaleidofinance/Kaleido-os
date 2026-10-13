-- Backfill fixed transaction-task grants for wallets that were marked complete
-- before /api/waitlist/transaction began crediting already-activated wallets.
-- Each task has its own stable idempotency key, so this is safe to re-run.

insert into public.point_actions
  (wallet, source_slug, season, tx_hash, chain_id,
   usd_value, multiplier_applied, points, is_agent_initiated, occurred_at)
select w.wallet, 'waitlist', 1,
       'waitlist:task:arcMainnet:' || w.wallet, 5042,
       0, 1.0, 300, false, w.arc_mainnet_tx_at
from public.waitlist w
where w.activated_at is not null
  and w.arc_mainnet_tx_at is not null
  and w.arc_mainnet_tx_at > w.activated_at
  and not exists (
    select 1 from public.point_actions a
    where a.chain_id = 5042
      and a.tx_hash = 'waitlist:task:arcMainnet:' || w.wallet
  )
on conflict (chain_id, tx_hash) do nothing;

insert into public.point_actions
  (wallet, source_slug, season, tx_hash, chain_id,
   usd_value, multiplier_applied, points, is_agent_initiated, occurred_at)
select w.wallet, 'waitlist', 1,
       'waitlist:task:agent:' || w.wallet, 5042,
       0, 1.0, 500, false, w.agent_tx_at
from public.waitlist w
where w.activated_at is not null
  and w.agent_tx_at is not null
  and w.agent_tx_at > w.activated_at
  and not exists (
    select 1 from public.point_actions a
    where a.chain_id = 5042
      and a.tx_hash = 'waitlist:task:agent:' || w.wallet
  )
on conflict (chain_id, tx_hash) do nothing;

insert into public.point_actions
  (wallet, source_slug, season, tx_hash, chain_id,
   usd_value, multiplier_applied, points, is_agent_initiated, occurred_at)
select w.wallet, 'waitlist', 1,
       'waitlist:task:bridge:' || w.wallet, 5042,
       0, 1.0, 500, false, w.bridge_tx_at
from public.waitlist w
where w.activated_at is not null
  and w.bridge_tx_at is not null
  and w.bridge_tx_at > w.activated_at
  and not exists (
    select 1 from public.point_actions a
    where a.chain_id = 5042
      and a.tx_hash = 'waitlist:task:bridge:' || w.wallet
  )
on conflict (chain_id, tx_hash) do nothing;
