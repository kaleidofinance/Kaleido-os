-- Genesis: the kaleido_* tables the app has always read but no migration created.
--
-- These three predate this migrations directory. They were made by hand in the
-- dashboard on an earlier project, so the schema lived only in that project's
-- catalog and every later migration inherited a dependency on tables that no
-- checked-in file creates. 20260801000000_lock_activity_writes.sql opens with a
-- bare `alter table public.kaleido_protocol_activity enable row level security`
-- and aborts on a database that has never had it — which is exactly what a
-- fresh project is. This file is what makes `supabase db push` work from empty,
-- and it is timestamped ahead of that migration so it runs first.
--
-- Column names are camelCase and quoted throughout. That is not a style choice
-- and must not be "cleaned up": PostgREST exposes column names verbatim, and
-- src/app/api/listings/route.ts selects `listingId, sender, tokenAddress, ...`
-- while src/lib/ai/readTools.ts orders by `interest` and filters `tokenAddress`.
-- Unquoted identifiers fold to lowercase in Postgres, so `listingId` would
-- become `listingid` and every one of those selects would 400.
--
-- WHY amount IS text AND NOT numeric.
-- These are base-unit token values — 18-decimal amounts run past 10^19 and
-- overflow float64. build.ts documents the same hazard from the read side: its
-- MarketRow.amount is only safe because PostgREST serialises the value as a
-- JSON string, and a bare JSON number would already be truncated by
-- fetch().json() before any code could round it. Storing text keeps that true
-- by construction rather than by relying on the driver.
--
-- `interest` is a rate in basis points and stays numeric — readTools.ts does
-- `.order("interest")` on it, and ordering text sorts "9" after "100".

-- ---------------------------------------------------------------------------
-- kaleido_listings — lender offers (what a borrower can take)
-- ---------------------------------------------------------------------------

create table if not exists public.kaleido_listings (
  "listingId"    bigint primary key,
  "sender"       text        not null,
  "tokenAddress" text        not null,
  "amount"       text        not null default '0',
  "minAmount"    text,
  "maxAmount"    text,
  "returnDate"   bigint,
  "interest"     numeric,
  "status"       text        not null default 'OPEN',
  "created_at"   timestamptz not null default now()
);

comment on table public.kaleido_listings is
  'Indexed mirror of on-chain lender listings. Written by the indexer with the service role; the chain is the source of truth and this table is a cache.';
comment on column public.kaleido_listings."amount" is
  'Base units as text. Never numeric — 18-decimal values exceed float64 and PostgREST would emit a number the client truncates on parse.';

-- status+token is the shape every read uses: getMarkets filters status=OPEN
-- then tokenAddress, and the listings route filters the same pair.
create index if not exists kaleido_listings_status_token_idx
  on public.kaleido_listings ("status", "tokenAddress");

-- getMarkets orders by interest ascending within OPEN rows.
create index if not exists kaleido_listings_status_interest_idx
  on public.kaleido_listings ("status", "interest");

-- The leaderboard and useGetValueAndHealth both count rows per wallet.
create index if not exists kaleido_listings_sender_idx
  on public.kaleido_listings (lower("sender"));

-- ---------------------------------------------------------------------------
-- kaleido_requests — borrower asks (what a lender can fund)
-- ---------------------------------------------------------------------------

create table if not exists public.kaleido_requests (
  "requestId"        bigint primary key,
  "listingId"        bigint,
  "author"           text        not null,
  "amount"           text        not null default '0',
  "interest"         numeric,
  "totalRepayment"   text,
  "returnDate"       bigint,
  "lender"           text,
  "tokenAddress"     text        not null,
  "collateralTokens" jsonb,
  "status"           text        not null default 'OPEN',
  "created_at"       timestamptz not null default now()
);

comment on table public.kaleido_requests is
  'Indexed mirror of on-chain borrow requests. status OPEN is fillable; SERVICED is a funded loan, which is what useMarketStats sums for volume.';
comment on column public.kaleido_requests."totalRepayment" is
  'Base units as text, principal plus interest. planDeps.ts hands the raw value to repayLoan — a rounded number underpays and the contract will not close the loan.';
comment on column public.kaleido_requests."collateralTokens" is
  'jsonb rather than text[]: the column is passed through to the client untouched and the on-chain shape is a tuple array, not a flat list of addresses.';

create index if not exists kaleido_requests_status_token_idx
  on public.kaleido_requests ("status", "tokenAddress");

create index if not exists kaleido_requests_status_interest_idx
  on public.kaleido_requests ("status", "interest");

create index if not exists kaleido_requests_author_idx
  on public.kaleido_requests (lower("author"));

-- The requests route filters by lender as well as author.
create index if not exists kaleido_requests_lender_idx
  on public.kaleido_requests (lower("lender"));

-- ---------------------------------------------------------------------------
-- kaleido_protocol_activity — Season 0 participation evidence
-- ---------------------------------------------------------------------------

-- Created here so 20260801000000_lock_activity_writes.sql has something to lock
-- down. That migration's own header is the authority on why the data in it is
-- untrusted: it was written from the browser with the anon key, so points_earned
-- was attacker-controllable, and docs/points-system.md treats these rows as
-- evidence of participation rather than as a balance. Nothing writes it today —
-- logProtocolActivity.ts is already a no-op stub — but getActivityPoints and the
-- leaderboard still read it, and both must find a table rather than a 404.
create table if not exists public.kaleido_protocol_activity (
  id             bigserial primary key,
  "wallet"        text        not null,
  "action"        text,
  "amountInUsd"   numeric,
  "points_earned" integer     not null default 0,
  "tx_hash"       text,
  "created_at"    timestamptz not null default now()
);

comment on table public.kaleido_protocol_activity is
  'Season 0 activity log. Historically browser-written with the anon key, so every row is untrusted — see 20260801000000_lock_activity_writes.sql. Read-only from Phase 1 onward.';
comment on column public.kaleido_protocol_activity."amountInUsd" is
  'Mis-denominated by history: early rows hold the raw token amount, not USD. Do not sum this as currency.';

create index if not exists kaleido_protocol_activity_wallet_idx
  on public.kaleido_protocol_activity (lower("wallet"));

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

-- All three are public-read, service-role-write. The anon key ships inside the
-- JS bundle, so anything it can write is untrusted by definition — the same
-- reasoning 20260801000000 applies to the activity table, applied here to the
-- order book at creation instead of retroactively.
--
-- The activity table's own policies are deliberately NOT created here. That is
-- 20260801000000's job, it runs immediately after this file, and duplicating
-- the policy would make that migration's `drop policy if exists` sequence read
-- as if it were undoing something this one intended.

alter table public.kaleido_listings          enable row level security;
alter table public.kaleido_requests          enable row level security;
alter table public.kaleido_protocol_activity enable row level security;

create policy "listings readable by anyone"
  on public.kaleido_listings for select using (true);

create policy "requests readable by anyone"
  on public.kaleido_requests for select using (true);

-- No insert/update/delete policy on any of the three. With RLS enabled and no
-- policy, those are denied for anon and authenticated; the service role bypasses
-- RLS entirely, so the indexer is unaffected.
revoke insert, update, delete on public.kaleido_listings from anon, authenticated;
revoke insert, update, delete on public.kaleido_requests from anon, authenticated;
