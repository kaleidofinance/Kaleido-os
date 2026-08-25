-- Season 0 participation credit — the backfill docs/points-system.md §7.4 asks for.
-- Spec: "Treat existing kaleido_protocol_activity as Season 0: a record of
-- participation, not a points balance. Awarding a flat, capped Season 0 bonus for
-- having used the protocol is defensible; carrying the raw numbers over is not,
-- because they are unverified and mis-denominated."
--
-- So this file reads the FACT that a wallet appears, and never a figure it
-- carries. `points_earned` and `amountInUsd` are not referenced anywhere below:
-- the first was attacker-controllable (the table was browser-written with the
-- anon key — 20260801000000_lock_activity_writes.sql), and the second is
-- documented at kaleido_core_tables.sql:127 as holding raw token amounts in some
-- rows and USD in others. Neither is a quantity this schema may believe.
--
-- WHY THIS IS SQL AND NOT A SCRIPT
--
-- Every input is a table in this database and the output is a table in this
-- database. A Node seeder would open a service-role client, page three tables out
-- over the wire, aggregate in float64, and write back — trading exact numeric
-- arithmetic for a round-trip, and leaving a credentialed one-off script in the
-- repo. `supabase db push` already runs as a role that bypasses RLS, which is the
-- only privilege the write needs.
--
-- WHY IT IS SAFE TO RUN TWICE
--
-- The insert upserts on (wallet, season) and recomputes from the source tables
-- each time, so re-running converges rather than accumulating. That matters more
-- than it looks: a migration runs once, but the indexer is not live yet, so if
-- rows land after this push the fix is to re-run this file rather than to write a
-- second, differently-behaved backfill.

-- ---------------------------------------------------------------------------
-- A column for credit that is neither accrued nor transacted
-- ---------------------------------------------------------------------------

-- Not folded into action_points, which is the tempting shortcut and is wrong
-- twice over. That column means "points backed by rows in point_actions", and
-- this credit has no such rows — so a reconciliation query would silently
-- disagree with it, in a schema whose stated premise is that "a points program
-- whose past can be edited has no credibility". Worse, the first real accrual run
-- for Season 0 will recompute action_points from point_actions and would erase
-- this credit without a trace.
--
-- A separate column also makes the nature of the figure legible at the point of
-- use: bonus_points is by construction not a measurement of anything, and the
-- leaderboard's `full` tier can show it as such.
alter table public.point_balances
  add column if not exists bonus_points numeric not null default 0;

comment on column public.point_balances.bonus_points is
  'Discretionary credit, not derived from snapshots or verified transactions. Season 0 participation is the only current source; see 20260818000000_season0_participation_seed.sql. Excluded from any reconciliation against point_epochs or point_actions, on purpose.';

-- `total` is a stored column, so adding a third component means every writer now
-- has to remember a sum. A comment would not survive that; a constraint does.
--
-- The ergonomic consequence is real and worth stating rather than discovering:
-- CHECK is evaluated at the end of each statement, not at commit, so a writer
-- cannot update time_points in one statement and total in the next even inside a
-- transaction. Balances must be written in one atomic UPDATE or upsert — which is
-- what a materialized-total table should be doing anyway.
--
-- Validating rather than NOT VALID: if a row already disagrees, this migration
-- should stop and say so. Legacy drift that is skipped is legacy drift that stays
-- invisible, and this table is meant to be auditable.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'point_balances_total_sums'
      and conrelid = 'public.point_balances'::regclass
  ) then
    alter table public.point_balances
      add constraint point_balances_total_sums
      check (total = time_points + action_points + bonus_points);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- The credit
-- ---------------------------------------------------------------------------

-- Flat per surface, three surfaces, so 300 points is the ceiling and no wallet
-- can earn more by having done more. That is the whole point of §7.4's "flat,
-- capped": the counts in these tables are not evidence of size. The route this
-- replaces (api/leaderboard) scored `min(listings, 5) * 100 + min(requests, 5) *
-- 50`, which is capped but not flat — it still paid for volume, on testnet, where
-- posting a fifth listing costs nothing.
--
-- 300 is deliberately small against the Season 1 rates seeded in
-- 20260801000100: at 1.0 points per USD of swap volume, the entire participation
-- bonus is worth $300 of swapping. It acknowledges early users without letting
-- them outrank anyone who actually used the protocol.
with participants as (
  -- Indexer-written, mirroring on-chain events. Trustworthy as a SET, not merely
  -- in its values: appearing here cost gas.
  select lower("sender") as wallet, 'listing'  as surface
    from public.kaleido_listings  where "sender" is not null
  union
  select lower("author"),           'request'
    from public.kaleido_requests  where "author" is not null
  union
  -- Browser-written with the anon key. See the sybil_flag reasoning below: this
  -- surface is credited, then marked, because it is forgeable by whoever wants
  -- to forge it.
  select lower("wallet"),           'activity'
    from public.kaleido_protocol_activity where "wallet" is not null
),
shaped as (
  -- A cheap shape gate, not a verification. The activity table accepted whatever
  -- the browser sent, so it can hold anything a string column accepts; requiring
  -- a lowercase 20-byte hex address keeps outright junk from becoming a
  -- leaderboard row. It does not make the remaining values trustworthy, and the
  -- flag below is what carries that.
  select wallet, surface from participants
   where wallet ~ '^0x[0-9a-f]{40}$'
),
credited as (
  select
    wallet,
    count(distinct surface) * 100 as bonus,
    -- On-chain evidence exists for this wallet independent of anything a browser
    -- claimed. This is what decides the flag.
    bool_or(surface in ('listing', 'request')) as onchain
  from shaped
  group by wallet
),
-- Earliest evidence we hold, rather than now(). activated_at is a fact about the
-- wallet, and stamping every backfilled row with the migration's own clock would
-- throw away the only history these tables have.
first_seen as (
  select lower("sender")  as wallet, min("created_at") as seen
    from public.kaleido_listings where "sender" is not null group by 1
  union all
  select lower("author"),  min("created_at")
    from public.kaleido_requests where "author" is not null group by 1
  union all
  select lower("wallet"),  min("created_at")
    from public.kaleido_protocol_activity where "wallet" is not null group by 1
)
insert into public.point_balances
  (wallet, season, time_points, action_points, bonus_points, total, sybil_flag, activated_at, updated_at)
select
  c.wallet,
  0,
  0,
  0,
  c.bonus,
  c.bonus,
  -- Not a punishment and not an accusation — the schema's own words are that
  -- flagged wallets "keep accruing but are excluded at conversion; deleting
  -- history would make every appeal unfalsifiable". A wallet whose only evidence
  -- is the anon-written activity table is exactly that case: the credit is
  -- recorded and appealable, point_leaderboard leaves it out, and conversion
  -- cannot reach it. Using the flag rather than dropping the row is also what
  -- keeps this honest if the table turns out to hold ten thousand keypairs
  -- somebody generated: they are all still here, all still visible to the service
  -- role, and none of them are on the board.
  case
    when c.onchain then null
    else 'season0_activity_unverified'
  end::text,
  (select min(f.seen) from first_seen f where f.wallet = c.wallet),
  now()
from credited c
-- The existing row is addressed by the bare table name, which is the form
-- ON CONFLICT DO UPDATE documents; `excluded` is the row this statement proposed.
on conflict (wallet, season) do update
  set bonus_points = excluded.bonus_points,
      -- Recomputed from the row's own current components, so a re-run after real
      -- accrual has landed adjusts the bonus without discarding it. Written in the
      -- same statement as bonus_points because point_balances_total_sums above
      -- will not tolerate anything else.
      total        = point_balances.time_points
                   + point_balances.action_points
                   + excluded.bonus_points,
      -- NOT a bare `= excluded.sybil_flag`, which is the version I wrote first and
      -- which quietly destroys an investigation. sybil_flag is where a human
      -- records a finding — a multi-account ring, a funding graph — and a re-run
      -- of this backfill has no business overturning that. So this only ever
      -- writes over its own marker or over nothing, and any other value survives
      -- untouched. The one thing it can do is clear its own marker, which is
      -- correct: a wallet that has since posted a listing on chain now has the
      -- evidence the marker said was missing.
      sybil_flag   = case
                       when point_balances.sybil_flag is null
                         or point_balances.sybil_flag = 'season0_activity_unverified'
                       then excluded.sybil_flag
                       else point_balances.sybil_flag
                     end,
      -- least() ignores nulls and returns null only if every argument is null, so
      -- an existing row that never had an activated_at picks up the backfilled one
      -- instead of keeping the null.
      activated_at = least(point_balances.activated_at, excluded.activated_at),
      updated_at   = now();

-- ---------------------------------------------------------------------------
-- Publish the component at the audit tier
-- ---------------------------------------------------------------------------

-- CREATE OR REPLACE, not DROP and CREATE: bonus_points goes on the END of the
-- column list, and appending is the one change REPLACE permits. That keeps the
-- grant and the security_invoker setting from 20260817000000 rather than
-- re-establishing them, and a mistake in any of the seven leading columns fails
-- loudly here ("cannot change name of view column") instead of quietly widening
-- what the view discloses.
--
-- `full` tier only, alongside the time/action split: at rank_only and totals a
-- component of the total is still a number about a wallet, and §8 gives the
-- public no components until the freeze. But it must appear at `full` — a
-- published allocation that says 300 points with no line explaining where they
-- came from is not auditable, and this is the one component that is a decision
-- rather than a measurement.
create or replace view public.point_leaderboard as
with ranked as (
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
  ceil(100 * r.cume)::int as percentile,   -- ceil, not round: see 20260817000000
  case
    when s.disclosure in ('totals', 'full') then r.total
  end as total,
  case
    when s.disclosure = 'full' then r.time_points
  end as time_points,
  case
    when s.disclosure = 'full' then r.action_points
  end as action_points,
  case
    when s.disclosure = 'full' then r.bonus_points
  end as bonus_points
from ranked r
join public.point_seasons s on s.id = r.season;

-- Re-asserted rather than assumed. CREATE OR REPLACE preserves reloptions, so
-- this is a no-op today — but it is the line that makes the view able to read a
-- table anon cannot, 20260817000000's header documents two ways it silently
-- empties if it is lost, and a no-op that keeps a load-bearing property visible
-- is worth one statement.
alter view public.point_leaderboard set (security_invoker = false);
