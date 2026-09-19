-- Waitlist referral rewards are uncapped: 50 points per qualifying referral.
-- Reprice existing waitlist credits so the Season 1 board reflects the same rule.

update public.point_actions a
set points = a.points
  - least(50 * coalesce(lb.referrals, 0), 5000)
  + (50 * coalesce(lb.referrals, 0))
from public.waitlist_leaderboard lb
where a.source_slug = 'waitlist'
  and a.season = 1
  and a.wallet = lb.wallet;

do $$
declare
  r record;
begin
  for r in
    select distinct wallet, season
    from public.point_actions
    where source_slug = 'waitlist' and season = 1
  loop
    perform public.materialize_point_balance(r.wallet, r.season);
  end loop;
end;
$$;
