-- Only referrals that have activated on Arc mainnet count in settled points.
-- Linked but inactive referees remain visible as pending in Rewards.
begin;

create or replace view public.waitlist_leaderboard as
select
  w.wallet,
  w.ref_code,
  count(r.wallet) filter (where r.x_user_id is not null) as referrals,
  rank() over (
    order by count(r.wallet) filter (
      where r.x_user_id is not null and r.activated_at is not null
    ) desc
  ) as rank,
  count(r.wallet) filter (
    where r.x_user_id is not null and r.activated_at is not null
  ) as active_referrals,
  count(r.wallet) filter (
    where r.x_user_id is not null and r.activated_at is null
  ) as pending_referrals
from public.waitlist w
left join public.waitlist r on r.referred_by = w.ref_code
group by w.wallet, w.ref_code;

-- Remove already-settled points for inactive referrals with an append-only
-- compensating action. When a referee activates later, normal reconciliation
-- credits the positive delta back and preserves the audit trail.
insert into public.point_actions
  (wallet, source_slug, season, tx_hash, chain_id,
   usd_value, multiplier_applied, points, is_agent_initiated, occurred_at)
select
  lb.wallet,
  'waitlist',
  1,
  'waitlist:pending-referrals-reversal:' || lb.pending_referrals,
  5042,
  0,
  1.0,
  -(50 * lb.pending_referrals),
  false,
  now()
from public.waitlist_leaderboard lb
where lb.pending_referrals > 0
  and exists (
    select 1 from public.point_actions a
    where a.wallet = lb.wallet
      and a.source_slug = 'waitlist'
      and a.season = 1
  )
on conflict (chain_id, tx_hash) do nothing;

commit;
