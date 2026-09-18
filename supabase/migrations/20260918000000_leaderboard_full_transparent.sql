-- Fully transparent, paginated leaderboard: reveal Season 1 point totals, rank
-- every wallet, and surface per-wallet trading volume.
--
-- Product decision 2026-09-18: the board becomes a public competitive surface so
-- users can see the exact gap to climb. This intentionally relaxes §8's rank_only
-- privacy for Season 1 — point TOTALS become public (the time/action/bonus split
-- still waits for the freeze at the 'full' tier), and the exact rank is published
-- for every wallet, not just the top public_rank_limit. Reversible in principle
-- (set disclosure back to 'rank_only'), but note the totals will already have been
-- public once this ships.

-- 1) Season 1 → show totals, and rank the whole list. public_rank_limit is raised
--    past any plausible wallet count so the view stops masking rank on the tail.
update public.point_seasons
   set disclosure = 'totals',
       public_rank_limit = 1000000,
       -- The waitlist/Season-1 points DO convert to KLD at TGE, so the season
       -- is a converting one. Safe re: the materializer/point_conversion_violations
       -- testnet guard — every Season-1 action is on Arc mainnet (5042, not testnet).
       converts_to_tokens = true,
       -- 'PreTGE' (one word) rather than 'pre-TGE': the hyphen wrapped
       -- badly in the season stat card ("pre-" / "TGE" on two lines).
       label = 'Season 1 — PreTGE'
 where id = 1;

-- 2) Add per-wallet trading volume (Σ usd_value) to the public view. Waitlist
--    credits carry usd_value 0, so volume reads 0 until volume-bearing protocol
--    actions land, then fills automatically. Only a TRAILING column is added and
--    the leading columns keep their names/order/types, so create-or-replace is
--    valid. The anon grant and owner-privilege (security_invoker = false) are
--    re-asserted: a replace that dropped them would silently empty the board for
--    the app's anon reads (see the read-replica/anon fix, 20260916...).
create or replace view public.point_leaderboard as
with vol as (
  select wallet, season, sum(usd_value) as volume
  from public.point_actions
  group by wallet, season
),
ranked as (
  select
    b.season,
    b.wallet,
    b.total,
    b.time_points,
    b.action_points,
    b.bonus_points,
    rank()      over (partition by b.season order by b.total desc) as rnk,
    cume_dist() over (partition by b.season order by b.total desc) as cume
  from public.point_balances b
  where b.sybil_flag is null
)
select
  r.season,
  r.wallet,
  case
    when s.disclosure = 'full' or r.rnk <= s.public_rank_limit then r.rnk
  end as rank,
  ceil(100 * r.cume)::int as percentile,
  case
    when s.disclosure in ('totals', 'full') then r.total
  end as total,
  case when s.disclosure = 'full' then r.time_points end   as time_points,
  case when s.disclosure = 'full' then r.action_points end as action_points,
  case when s.disclosure = 'full' then r.bonus_points end  as bonus_points,
  coalesce(v.volume, 0) as volume
from ranked r
join public.point_seasons s on s.id = r.season
left join vol v on v.wallet = r.wallet and v.season = r.season;

alter view public.point_leaderboard set (security_invoker = false);
grant select on public.point_leaderboard to anon, authenticated;
