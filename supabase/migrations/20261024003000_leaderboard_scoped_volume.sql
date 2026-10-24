-- Avoid aggregating every point action on every public leaderboard request.
-- The API reads point_balances directly for the page and requests volume only
-- for the visible wallets, while this view remains available for personal reads.
create or replace view public.point_leaderboard as
with ranked as (
  select
    b.season,
    b.wallet,
    b.total,
    b.time_points,
    b.action_points,
    b.bonus_points,
    rank() over (partition by b.season order by b.total desc) as rnk,
    cume_dist() over (partition by b.season order by b.total desc) as cume
  from public.point_balances b
  where b.sybil_flag is null
)
select
  r.season,
  r.wallet,
  case when s.disclosure = 'full' or r.rnk <= s.public_rank_limit then r.rnk else null::bigint end as rank,
  ceil(100::double precision * r.cume)::integer as percentile,
  case when s.disclosure = any (array['totals'::text, 'full'::text]) then r.total else null::numeric end as total,
  case when s.disclosure = 'full' then r.time_points else null::numeric end as time_points,
  case when s.disclosure = 'full' then r.action_points else null::numeric end as action_points,
  case when s.disclosure = 'full' then r.bonus_points else null::numeric end as bonus_points,
  coalesce((select sum(pa.usd_value) from public.point_actions pa where pa.wallet = r.wallet and pa.season = r.season), 0::numeric) as volume
from ranked r
join public.point_seasons s on s.id = r.season;
