-- Time-boxed multiplier boosts on a (season, source) — the "campaign" mechanism.
--
-- A campaign rewards a behaviour (trading volume, providing liquidity) for a
-- window WITHOUT creating a new season: the existing Season 1 leaderboard still
-- holds the points, they just accrue at a boosted multiplier while the campaign
-- runs. `creditAction` multiplies the source's base `point_source_rates.multiplier`
-- by the active campaign's multiplier when an action's `occurred_at` falls inside
-- [starts_at, ends_at) and the row is active. Ending a campaign is `active=false`
-- or an `ends_at` in the past — the boost simply stops applying, nothing already
-- credited changes.
--
-- The multiplier is a BONUS on top of the base rate, the same lever the agent
-- bonus uses. It composes with the existing per-day guards: `min_usd` still floors
-- dust, `daily_cap_pts` still caps the day, and `multiplier_action_limit` still
-- decays the (now boosted) multiplier past N actions/day — so to run a campaign
-- with no per-action decay, set that source's `multiplier_action_limit` to null
-- for the season while the campaign runs.

create table if not exists public.point_campaigns (
  id           text primary key,                    -- slug, e.g. 'trading-launch'
  label        text        not null,
  season       int         not null references public.point_seasons(id)  on delete restrict,
  source_slug  text        not null references public.point_sources(slug) on delete restrict,
  -- On top of point_source_rates.multiplier. >= 1 so a campaign can only ADD
  -- reward, never quietly dock it.
  multiplier   numeric     not null default 1.0 check (multiplier >= 1.0),
  starts_at    timestamptz not null default now(),
  ends_at      timestamptz,                          -- null = open-ended until set
  active       boolean     not null default true,
  created_at   timestamptz not null default now(),
  -- A closed window must be a real interval.
  constraint point_campaigns_window check (ends_at is null or ends_at > starts_at)
);

comment on table public.point_campaigns is
  'Time-boxed multiplier boost on a (season, source_slug), applied by creditAction when an action occurs within [starts_at, ends_at) and active. multiplier is ON TOP of point_source_rates.multiplier (>= 1). End a campaign with active=false or a past ends_at; already-credited points are untouched.';

-- The lookup creditAction runs every credit: active campaigns for a (season,
-- source). Partial on `active` so ended campaigns cost nothing to skip.
create index if not exists point_campaigns_active_lookup
  on public.point_campaigns (season, source_slug)
  where active;

-- Read-model only, never written from the client: service-role writes it, the
-- credit path reads it. No anon/auth policy is added, matching point_source_rates.
alter table public.point_campaigns enable row level security;

-- ── To LAUNCH the trading campaign, run this (kept commented so the boost is
--    never live by accident — the operator turns it on deliberately):
--
--   insert into public.point_campaigns (id, label, season, source_slug, multiplier, starts_at)
--   values ('trading-launch', 'Trading launch campaign', 1, 'swap', 2.0, now());
--
--   -- and, if the campaign should not decay per-action while it runs:
--   update public.point_source_rates set multiplier_action_limit = null
--     where season = 1 and source_slug = 'swap';
--
-- To END it:  update public.point_campaigns set active = false where id = 'trading-launch';
