-- Gate referrals (and, via the same view, credited referral points) on x_user_id,
-- not x_linked_at — aligning the code with its own documented intent.
--
-- 20260915010000 states the sybil backstop as "x_user_id is UNIQUE (one X account
-- enriches one wallet)", but its JOIN actually filtered on x_linked_at. Those
-- diverge: x_linked_at can be stamped by a partial or failed OAuth that never
-- captured a real, unique x_user_id, so it OVER-counts "X-verified". x_user_id is
-- the column that carries the UNIQUE constraint, so it is the true
-- one-real-X-account-per-wallet marker. (Observed 2026-09-17: x_linked_at ran well
-- ahead of x_user_id, inflating the board.)
--
-- Only the join condition changes; the column list and types are identical, so
-- create-or-replace is safe and preserves the anon grant + owner-privilege
-- (security_invoker) that let anon read this view over the service-role-only
-- waitlist table. The activation reader's credit gate is switched to x_user_id in
-- the same PR, so the displayed referral count and the credited points stay in
-- lockstep.
create or replace view public.waitlist_leaderboard as
select
  w.wallet,
  w.ref_code,
  count(r.wallet)                             as referrals,
  rank() over (order by count(r.wallet) desc) as rank
from public.waitlist w
left join public.waitlist r
  on r.referred_by = w.ref_code
  and r.x_user_id is not null
group by w.wallet, w.ref_code;
