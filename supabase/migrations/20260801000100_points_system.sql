-- Kaleido points system.
-- Spec: docs/points-system.md
--
-- Two design constraints drive the shape of this schema:
--
-- 1. NEW EARNABLE PRODUCTS MUST NOT REQUIRE A MIGRATION. Perp trading, a
--    launchpad, and the on/off-ramp are all planned. Sources therefore live in
--    a registry table rather than an enum, and their rates live in a per-season
--    table. Adding a product is two INSERTs.
--
-- 2. POINTS ARE NEVER WRITTEN BY A CLIENT. Every table here is service-role
--    write, public read. The browser reads point_balances and the leaderboard
--    view; it can touch nothing else.

-- ---------------------------------------------------------------------------
-- Seasons
-- ---------------------------------------------------------------------------

create table if not exists public.point_seasons (
  id            int         primary key,
  label         text        not null,
  starts_at     timestamptz not null,
  -- Null while the season is running. Set once, at freeze.
  ends_at       timestamptz,
  -- Fraction of total supply allocated to this season, e.g. 0.06 for 6%.
  -- The per-point token value is NOT stored: it is derived at freeze as
  -- budget / total_points, and cannot be known before the season closes.
  supply_budget numeric,
  frozen_at     timestamptz,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Source registry — the extensibility seam
-- ---------------------------------------------------------------------------

create table if not exists public.point_sources (
  slug        text primary key,
  label       text not null,
  -- 'time'   accrues per usd-second while capital sits
  -- 'action' credited once per verified transaction
  kind        text not null check (kind in ('time', 'action')),
  -- Which product surface it belongs to, for grouping in the UI.
  product     text not null,
  enabled     boolean not null default false,
  notes       text,
  created_at  timestamptz not null default now()
);

comment on table public.point_sources is
  'Registry of earnable surfaces. Add a product by inserting here plus a row in point_source_rates — no migration required.';

create table if not exists public.point_source_rates (
  source_slug   text not null references public.point_sources(slug) on delete restrict,
  season        int  not null references public.point_seasons(id)   on delete restrict,

  -- kind='time'   → points per USD per day
  -- kind='action' → points per USD of transaction value
  rate          numeric not null default 0,

  -- Applied on top of rate. The agent bonus lives here.
  multiplier    numeric not null default 1.0,

  -- Below this USD value an action earns nothing. Kills dust spam, which is
  -- the cheapest farm once an agent is doing the typing.
  min_usd       numeric not null default 0,

  -- Per wallet per UTC day. Null means uncapped.
  daily_cap_usd numeric,
  daily_cap_pts numeric,

  -- Actions per wallet per day that still receive `multiplier`. Beyond this
  -- the multiplier decays to 1.0 — see point_actions.multiplier_applied.
  -- Null means the multiplier never decays.
  multiplier_action_limit int,

  primary key (source_slug, season)
);

comment on column public.point_source_rates.multiplier_action_limit is
  'Agent abuse control: an agent can fire hundreds of transactions cheaply, so the bonus multiplier only applies to the first N actions per wallet per day.';

-- ---------------------------------------------------------------------------
-- Time-weighted accrual
-- ---------------------------------------------------------------------------

-- Raw balance observations. Immutable; one row per wallet/source/block.
create table if not exists public.point_snapshots (
  id           bigserial   primary key,
  wallet       text        not null,
  source_slug  text        not null references public.point_sources(slug),
  usd_value    numeric     not null check (usd_value >= 0),
  block_number bigint      not null,
  taken_at     timestamptz not null,
  unique (wallet, source_slug, block_number)
);

create index if not exists point_snapshots_wallet_idx
  on public.point_snapshots (wallet, source_slug, taken_at desc);

-- Derived accrual. Append-only: a mistake is corrected by writing a
-- compensating row, never by editing history. A points program whose past can
-- be edited has no credibility.
create table if not exists public.point_epochs (
  id           bigserial   primary key,
  wallet       text        not null,
  source_slug  text        not null references public.point_sources(slug),
  season       int         not null references public.point_seasons(id),
  epoch_start  timestamptz not null,
  epoch_end    timestamptz not null,
  usd_seconds  numeric     not null,
  points       numeric     not null,
  created_at   timestamptz not null default now(),
  check (epoch_end > epoch_start),
  unique (wallet, source_slug, epoch_start)
);

create index if not exists point_epochs_wallet_season_idx
  on public.point_epochs (wallet, season);

-- ---------------------------------------------------------------------------
-- Action points
-- ---------------------------------------------------------------------------

create table if not exists public.point_actions (
  id                 bigserial   primary key,
  wallet             text        not null,
  source_slug        text        not null references public.point_sources(slug),
  season             int         not null references public.point_seasons(id),

  -- The whole anti-replay story. One transaction, one credit, forever.
  tx_hash            text        not null unique,
  chain_id           int         not null,

  -- Server-derived via the Diamond's getUsdValue. Never client-supplied.
  usd_value          numeric     not null check (usd_value >= 0),
  multiplier_applied numeric     not null default 1.0,
  points             numeric     not null,

  is_agent_initiated boolean     not null default false,
  occurred_at        timestamptz not null,

  -- Not nullable on purpose: a row only exists once the server has fetched
  -- the receipt and confirmed the transaction really did what it claims.
  verified_at        timestamptz not null default now()
);

create index if not exists point_actions_wallet_day_idx
  on public.point_actions (wallet, source_slug, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Agent usage — abuse control, independent of points
-- ---------------------------------------------------------------------------

-- An agent lowers the cost of transacting to near zero, so it needs its own
-- ceiling regardless of what the points tables say. This is the record the
-- API layer rate-limits against.
create table if not exists public.agent_usage_daily (
  wallet        text        not null,
  usage_date    date        not null,
  requests      int         not null default 0,
  actions_built int         not null default 0,
  actions_sent  int         not null default 0,
  usd_routed    numeric     not null default 0,
  throttled_at  timestamptz,
  primary key (wallet, usage_date)
);

comment on table public.agent_usage_daily is
  'Per-wallet daily agent budget. Enforced at the API layer so a user cannot bulk-transact through Luca to farm the multiplier or exhaust provider credits.';

-- ---------------------------------------------------------------------------
-- Materialized balance — the only table the UI reads
-- ---------------------------------------------------------------------------

create table if not exists public.point_balances (
  wallet        text    not null,
  season        int     not null references public.point_seasons(id),
  time_points   numeric not null default 0,
  action_points numeric not null default 0,
  total         numeric not null default 0,
  -- Null means clean. Flagged wallets keep accruing but are excluded at
  -- conversion; deleting history would make every appeal unfalsifiable.
  sybil_flag    text,
  activated_at  timestamptz,
  updated_at    timestamptz not null default now(),
  primary key (wallet, season)
);

create index if not exists point_balances_leaderboard_idx
  on public.point_balances (season, total desc) where sybil_flag is null;

-- Rank only. Per-wallet totals and USD position sizes stay unpublished during
-- a season: publishing them tells a farmer exactly what threshold to beat.
-- See docs/points-system.md §8.
create or replace view public.point_leaderboard as
select
  season,
  wallet,
  rank() over (partition by season order by total desc) as rank,
  total
from public.point_balances
where sybil_flag is null;

-- ---------------------------------------------------------------------------
-- RLS: service-role writes, public reads
-- ---------------------------------------------------------------------------

alter table public.point_seasons       enable row level security;
alter table public.point_sources       enable row level security;
alter table public.point_source_rates  enable row level security;
alter table public.point_snapshots     enable row level security;
alter table public.point_epochs        enable row level security;
alter table public.point_actions       enable row level security;
alter table public.point_balances      enable row level security;
alter table public.agent_usage_daily   enable row level security;

-- Readable: the program has to be publicly auditable to be believed.
create policy "seasons readable"  on public.point_seasons      for select using (true);
create policy "sources readable"  on public.point_sources      for select using (true);
create policy "rates readable"    on public.point_source_rates for select using (true);
create policy "balances readable" on public.point_balances     for select using (true);

-- Not readable by the public: raw snapshots and epochs expose per-wallet USD
-- position sizes, which is a phishing and MEV target list.
-- point_actions and agent_usage_daily likewise stay server-side.

-- No write policies anywhere. Service role bypasses RLS; nothing else writes.
--
-- Scoped table-by-table on purpose. A blanket
-- `revoke ... on all tables in schema public` would also strip the client's
-- upsert into `kaleido` (useUpdateTable.ts sets usernames) and break profiles.
revoke insert, update, delete on
  public.point_seasons,
  public.point_sources,
  public.point_source_rates,
  public.point_snapshots,
  public.point_epochs,
  public.point_actions,
  public.point_balances,
  public.agent_usage_daily
from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Seed: Season 1 and the surfaces that exist today
-- ---------------------------------------------------------------------------

insert into public.point_seasons (id, label, starts_at)
values (1, 'Season 1 — pre-TGE', now())
on conflict (id) do nothing;

-- Live surfaces. Three trade modes (limit, buy, sell) are "coming soon" stubs
-- and are registered below as disabled rather than omitted, so turning them on
-- later is an UPDATE.
insert into public.point_sources (slug, label, kind, product, enabled, notes) values
  ('swap',              'Swap volume',          'action', 'trade',  true,  'V2 and V3 DEX swaps, executed manually'),
  ('agent_swap',        'Swap via Luca',        'action', 'agent',  true,  'Bonus multiplier, decaying after a daily action count — an agent makes spam cheap'),
  ('lend',              'Capital lent',         'time',   'borrow', true,  'Serviced loans only; resting offers earn nothing'),
  ('borrow',            'Outstanding borrow',   'time',   'borrow', true,  'Rated well below lend — see spec §3a'),
  ('collateral_idle',   'Idle collateral',      'time',   'borrow', true,  'Only collateral NOT backing a live loan'),
  ('lp',                'Liquidity provided',   'time',   'pool',   true,  'In-range V3 positions only'),
  ('stake',             'KLD staked',           'time',   'stake',  true,  'stKLD vault deposits'),
  ('vault',             'kafUSD vault',         'time',   'stable', true,  'Stable Earn deposits'),
  ('stable_mint',       'kfUSD minted',         'action', 'stable', true,  'Mint and redeem'),
  ('referral',          'Referrals',            'action', 'social', true,  'Credited only after referee is 30d active'),
  -- Planned. Enabled by UPDATE when the product ships.
  ('perp',              'Perp trading volume',  'action', 'perp',       false, 'Planned'),
  ('launchpad',         'Launchpad activity',   'action', 'launchpad',  false, 'Planned'),
  ('onramp',            'Fiat on-ramp',         'action', 'trade',      false, 'Trade > Buy, currently a stub'),
  ('offramp',           'Fiat off-ramp',        'action', 'trade',      false, 'Trade > Sell, currently a stub'),
  ('limit_order',       'Limit orders',         'action', 'trade',      false, 'Trade > Limit, currently a stub')
on conflict (slug) do nothing;

-- Season 1 rates. Time rates are points per USD per day; action rates are
-- points per USD of value. Tune before launch, publish, then leave alone
-- until Season 2 — changing rates mid-season breaks trust.
insert into public.point_source_rates
  (source_slug, season, rate, multiplier, min_usd, daily_cap_pts, multiplier_action_limit) values
  ('swap',            1, 1.0,  1.0, 10,  50000, null),
  -- The agent bonus is capped three ways, because bulk-transacting through
  -- Luca is cheaper than doing it by hand: a $25 floor kills dust, the daily
  -- point cap bounds the total, and the multiplier drops to 1.0 after 20
  -- agent actions in a day so the 21st swap is worth no more than a manual one.
  ('agent_swap',      1, 1.0,  1.2, 25,  30000, 20),
  ('lend',            1, 1.0,  1.0, 0,   null,  null),
  ('borrow',          1, 0.4,  1.0, 0,   null,  null),
  ('collateral_idle', 1, 0.25, 1.0, 0,   null,  null),
  ('lp',              1, 1.5,  1.0, 0,   null,  null),
  ('stake',           1, 1.0,  1.0, 0,   null,  null),
  ('vault',           1, 1.0,  1.0, 0,   null,  null),
  ('stable_mint',     1, 0.5,  1.0, 10,  10000, null),
  ('referral',        1, 0,    1.0, 0,   5000,  null)
on conflict (source_slug, season) do nothing;
