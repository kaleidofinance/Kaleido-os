-- Leaderboard disclosure, as a property of the season rather than of the caller.
-- Spec: docs/points-system.md §8.
--
-- 20260801000100_points_system.sql left three things unresolved, and the third
-- is the reason this migration is not just a comment fix.
--
-- 1. §8 CONTRADICTS ITSELF. Its table says the public sees "Top N by rank and
--    point total only"; its prose two paragraphs later (:263) says exact
--    per-wallet points stay private during a season, because "if the wallet at
--    rank 50 visibly holds 48,000 points, everyone knows exactly how much to
--    deposit to displace it". Both readings are defensible. Picking one here
--    forever would be picking it by accident, so `disclosure` makes it a
--    per-season decision with the strict reading as the default.
--
-- 2. TWO SEASONS ARE LIVE AT ONCE. The seed opened Season 0 and Season 1 both
--    at now() with ends_at null, so "the current season" was underdetermined
--    and a UI would have had to guess. Season 1 is the one with no data, so the
--    natural guess opens on an empty page. `is_default` makes it a stated fact.
--
-- 3. POINTS ARE DOLLARS, AND point_balances WAS PUBLIC-READ. The old
--    "balances readable" policy exposed total, time_points and action_points to
--    the anon key, which ships in the client bundle. point_source_rates is also
--    public-read, and the seeded Season 1 swap rate is 1.0 points per USD of
--    transaction value — so action_points ÷ rate IS the wallet's USD swap
--    volume, and time_points ÷ rate ÷ days_elapsed is roughly its average USD
--    position. That is precisely the "public wallet-to-balance map" §8:259
--    forbids, reachable without going through any leaderboard route.
--
--    The old header note (:293) reasoned that snapshots and epochs expose USD
--    while balances only expose points. The rates being published is the hole
--    in that reasoning.
--
--    So the tier is enforced in the VIEW, not in the API. A route that
--    carefully withholds a column while the table behind it stays anon-readable
--    is theatre: anyone can query the table. After this migration
--    point_balances is service-role-only and point_leaderboard is the single
--    public surface, which means the privacy property holds for every caller
--    that ever exists rather than for the ones we remembered to write.

-- ---------------------------------------------------------------------------
-- Season-level disclosure and defaulting
-- ---------------------------------------------------------------------------

alter table public.point_seasons
  add column if not exists disclosure text not null default 'rank_only'
    check (disclosure in ('rank_only', 'totals', 'full'));

comment on column public.point_seasons.disclosure is
  'What the public leaderboard may show for this season. rank_only: rank (top N) and percentile. totals: adds the point total. full: adds the time/action breakdown and drops the top-N limit, for post-freeze audit and dispute. Defaults to the strictest value so a carelessly created season cannot leak by omission.';

-- How far down the public table exact ranks go. §8 gives exact rank to the top
-- N and percentile to the long tail — "top 12%", not "#4,832" — so the cut has
-- to exist somewhere, and a column is better than a constant in a route for the
-- same reason source rates are a table: it is tuned per season, without a
-- migration and without a deploy.
alter table public.point_seasons
  add column if not exists public_rank_limit int not null default 100
    check (public_rank_limit > 0);

comment on column public.point_seasons.public_rank_limit is
  'Rows beyond this rank expose percentile but not exact rank. Ignored when disclosure = full: at the freeze the complete table is published for audit.';

-- Which season the UI opens on. Deliberately an explicit flag rather than
-- "highest id where frozen_at is null" or "latest starts_at": both of those
-- infer a product decision from a timestamp, and both currently resolve to
-- Season 1, which has no rows. Flipping the default is an UPDATE, matching how
-- this schema turns on chains and sources.
alter table public.point_seasons
  add column if not exists is_default boolean not null default false;

-- At most one. A page with two default seasons has no default season.
--
-- Indexed on the column filtered to true rather than on a constant expression:
-- every indexed row necessarily holds `true`, so uniqueness on it permits
-- exactly one, and it needs no argument about whether a constant is indexable.
create unique index if not exists point_seasons_one_default
  on public.point_seasons (is_default) where is_default;

-- Season 0 is the testnet rehearsal: is_testnet chains, converts_to_tokens
-- false, and the only season that has any data today. There is nothing to farm
-- and no allocation to target, so it carries the permissive tier and is where
-- the leaderboard interface can actually be exercised end to end.
--
-- Guarded on "no season is default yet" rather than written as a bare UPDATE:
-- re-running this file after the default has deliberately been moved to Season 1
-- must not drag it back to Season 0, and an unguarded write would also collide
-- with the unique index above. Season 1 needs no statement at all — the column
-- default already gives it 'rank_only' on first run, and `add column if not
-- exists` touches nothing on a re-run.
update public.point_seasons
   set disclosure = 'totals', is_default = true
 where id = 0
   and not exists (select 1 from public.point_seasons where is_default);

-- ---------------------------------------------------------------------------
-- The public surface
-- ---------------------------------------------------------------------------

-- Replaces the view whose comment claimed "Rank only" while its SELECT returned
-- `total` unconditionally. Every column a caller is not entitled to is NULL
-- here, computed from the season's own tier — so the answer does not depend on
-- which route asked, or on that route remembering.
--
-- rank() and cume_dist() run over every unflagged row in the season, before any
-- masking, so masking a value never moves anyone's position.
--
-- DROP then CREATE, not CREATE OR REPLACE: the old view's fourth column was
-- `total` and this one's is `percentile`, and REPLACE cannot rename or reorder
-- an existing column — it may only append. Dropping also drops the grants,
-- which is why the grant below is explicit rather than inherited. No CASCADE:
-- nothing depends on this view (point_conversion_violations reads epochs, not
-- balances), so a dependency appearing later should fail loudly here rather than
-- be silently dropped.
drop view if exists public.point_leaderboard;

create view public.point_leaderboard as
with ranked as (
  select
    b.season,
    b.wallet,
    b.total,
    b.time_points,
    b.action_points,
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
  -- Ordinal, so it leaks no size at any tier, and §8 names it as exactly what
  -- the long tail gets. ceil() rather than round() because the top wallet of a
  -- thousand is "top 1%", never "top 0%".
  ceil(100 * r.cume)::int as percentile,
  case
    when s.disclosure in ('totals', 'full') then r.total
  end as total,
  case
    when s.disclosure = 'full' then r.time_points
  end as time_points,
  case
    when s.disclosure = 'full' then r.action_points
  end as action_points
from ranked r
join public.point_seasons s on s.id = r.season;

-- LOAD-BEARING, and the one line in this file that will look like lint debt.
--
-- Per the CREATE VIEW docs: with security_invoker off, "access to the underlying
-- base relations is determined by the permissions of the view owner", and "if
-- any of the underlying base relations has row-level security enabled, then by
-- default, the row-level security policies of the view owner are applied". That
-- is what lets this view read point_balances now that anon cannot — and it works
-- because the owner is the table owner, who is not subject to its RLS.
--
-- Two ways it silently empties rather than failing loudly, both worth knowing:
--
--  - Flipping this to true, for instance to clear Supabase's "security definer
--    view" advisory. The view then evaluates as the caller, anon has no select
--    policy, and the leaderboard returns zero rows. If that advisory has to be
--    cleared, the fix is to serve the whole page from the service role.
--  - Recreating the view under a role that does not own point_balances. It
--    would then be subject to that table's RLS, which has no select policy at
--    all after this migration.
alter view public.point_leaderboard set (security_invoker = false);

comment on view public.point_leaderboard is
  'The only public points surface. Masks per-wallet figures according to point_seasons.disclosure, so the tier cannot be bypassed by querying the base table or forgotten by an API route. Excludes sybil-flagged wallets; a flagged wallet learning that it is flagged is a self-lookup concern (§8 tier 2), not a leaderboard one.';

grant select on public.point_leaderboard to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Close the base table
-- ---------------------------------------------------------------------------

-- See header note 3. Nothing in src reads point_balances today, so this closes
-- a door before anyone walks through it rather than breaking a caller.
drop policy if exists "balances readable" on public.point_balances;

-- Belt and braces: RLS with no select policy already denies these roles, but a
-- future migration adding a policy "so the client can read its own row" would
-- re-open the table without the grant, and would then fail visibly instead.
revoke select on public.point_balances from anon, authenticated;

comment on table public.point_balances is
  'Service-role only, read and write. §2 requires the program be publicly auditable, and it is — through point_leaderboard, which publishes everything once a season reaches disclosure = full. What is withheld is withheld only while a season is running and only because point_source_rates is public: at a rate of 1.0 points per USD, a point total is a USD volume.';
