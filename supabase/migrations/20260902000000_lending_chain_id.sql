-- Give the lending mirror a chain, and make the id mean something again.
--
-- WHAT WAS ACTUALLY BROKEN
--
-- `kaleido_listings."listingId"` and `kaleido_requests."requestId"` were the raw
-- on-chain counters, used as the whole primary key, with no chain column
-- anywhere in either table. Those counters restart at 1 on every deployment, so
-- Base Sepolia's listing #1 and Sepolia's listing #1 were not two rows that
-- looked alike — they were the same row. Indexing a second chain would have
-- collided on insert and, where it did not, would have handed the app a row it
-- could not place: `tokenAddress` is only meaningful together with its chain, so
-- a mixed book resolves one chain's USDC against another chain's registry and a
-- "take listing 1" is signed against whichever diamond the wallet happens to be
-- connected to.
--
-- That is why `src/lib/lending/chain.ts` existed. It pinned every lending read
-- to one chain so the mirror could not be misread, and its own docstring said
-- the constant should stop existing rather than be reassigned once this column
-- landed. This migration is that condition; the constant is deleted in the same
-- change.
--
-- THE KEY IS (chain_id, id), NOT AN ARBITRARY SURROGATE
--
-- A `bigserial` would also have made the rows distinct, and it would have thrown
-- away the property the indexer depends on: the id in this table IS the id the
-- contract answers to, so an upsert can be replayed from the chain at any time
-- and converge. The composite key keeps that and adds the missing half of the
-- identity.
--
-- WHY THE BACKFILL IS AN UPDATE AND NOT A COLUMN DEFAULT
--
-- Every row that exists was written by an indexer configured against a single
-- RPC endpoint on the read chain (11155111 — src/config/provider.ts's
-- DEFAULT_READ_CHAIN_ID, and the value the deleted pin held), so that is the
-- honest value for the rows already here. It is emphatically not the right value
-- for the next row: a column default would let a writer that forgot to say which
-- chain it read silently file its rows under Sepolia, which is the failure this
-- column exists to prevent. So the value is stamped once, explicitly, and the
-- column is left with no default and NOT NULL.
--
-- On a database where these tables are empty the update touches nothing and the
-- `set not null` still holds for every future insert, so the sequence is correct
-- either way.
--
-- Column names: `chain_id` is snake_case and unquoted, matching `created_at` in
-- these same tables and `chain_id` in point_events, push_watch_state and
-- kaleido_limit_orders. The camelCase-and-quoted columns beside it stay exactly
-- as they are — see the genesis migration's header for why that is load-bearing
-- rather than stylistic.

-- ---------------------------------------------------------------------------
-- kaleido_listings
-- ---------------------------------------------------------------------------

alter table public.kaleido_listings
  add column if not exists chain_id bigint;

update public.kaleido_listings set chain_id = 11155111 where chain_id is null;

alter table public.kaleido_listings
  alter column chain_id set not null;

-- A chain id is a positive integer. Cheap, and it catches the one mistake a
-- writer can make that NOT NULL does not: passing 0 for "unknown".
alter table public.kaleido_listings
  drop constraint if exists kaleido_listings_chain_id_positive;
alter table public.kaleido_listings
  add constraint kaleido_listings_chain_id_positive check (chain_id > 0);

comment on column public.kaleido_listings.chain_id is
  'Which deployment this listing lives in. Half of the primary key: "listingId" is a per-chain counter, so the id alone names a different listing on every chain. Pair it with tokenAddress before resolving a symbol or signing anything.';

-- ---------------------------------------------------------------------------
-- kaleido_requests
-- ---------------------------------------------------------------------------

alter table public.kaleido_requests
  add column if not exists chain_id bigint;

update public.kaleido_requests set chain_id = 11155111 where chain_id is null;

alter table public.kaleido_requests
  alter column chain_id set not null;

alter table public.kaleido_requests
  drop constraint if exists kaleido_requests_chain_id_positive;
alter table public.kaleido_requests
  add constraint kaleido_requests_chain_id_positive check (chain_id > 0);

comment on column public.kaleido_requests.chain_id is
  'Which deployment this request lives in. Half of the primary key, and also scopes the "listingId" column beside it — that reference is only resolvable within one chain.';

-- ---------------------------------------------------------------------------
-- Repoint both primary keys
-- ---------------------------------------------------------------------------

-- The constraint is dropped by lookup rather than by name. These two tables
-- predate this migrations directory — the genesis file says so in its first
-- paragraph: they were created by hand in an earlier project's dashboard, so the
-- primary key is only *probably* called `<table>_pkey`, and a `drop constraint
-- kaleido_listings_pkey` that guessed wrong would abort the migration halfway
-- through with the column already added.
--
-- No foreign key references either table, so dropping the key needs no CASCADE
-- and cannot orphan anything. `kaleido_requests."listingId"` looks like a
-- reference and is not one — it was never declared as such, which is fortunate,
-- because a single-column FK to a now-composite key would not have survived this.
do $$
declare
  pk text;
begin
  select conname into pk
    from pg_constraint
   where conrelid = 'public.kaleido_listings'::regclass
     and contype = 'p';
  if pk is not null then
    execute format('alter table public.kaleido_listings drop constraint %I', pk);
  end if;

  select conname into pk
    from pg_constraint
   where conrelid = 'public.kaleido_requests'::regclass
     and contype = 'p';
  if pk is not null then
    execute format('alter table public.kaleido_requests drop constraint %I', pk);
  end if;
end $$;

alter table public.kaleido_listings
  add constraint kaleido_listings_pkey primary key (chain_id, "listingId");

alter table public.kaleido_requests
  add constraint kaleido_requests_pkey primary key (chain_id, "requestId");

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- Every book read is now chain-scoped first and filtered second — the two API
-- routes both `.eq("chain_id", …)` before anything else, because a row from
-- another deployment is not a less relevant answer, it is a wrong one. So the
-- status-prefixed indexes are replaced by chain-first ones rather than kept
-- alongside them: a `(status, tokenAddress)` index still answers the new query
-- but scans every chain's OPEN rows to do it, and leaving both would double the
-- write cost of an indexer that upserts the whole book each pass.
--
-- The three `lower(address)` indexes are deliberately left alone. An owner
-- lookup is selective on the address by itself, and keeping them chain-agnostic
-- leaves a cross-chain "everything this wallet has posted" query indexable —
-- which is the one book question that genuinely spans deployments.

drop index if exists public.kaleido_listings_status_token_idx;
drop index if exists public.kaleido_listings_status_interest_idx;
drop index if exists public.kaleido_requests_status_token_idx;
drop index if exists public.kaleido_requests_status_interest_idx;

create index if not exists kaleido_listings_chain_status_token_idx
  on public.kaleido_listings (chain_id, "status", "tokenAddress");

create index if not exists kaleido_listings_chain_status_interest_idx
  on public.kaleido_listings (chain_id, "status", "interest");

create index if not exists kaleido_requests_chain_status_token_idx
  on public.kaleido_requests (chain_id, "status", "tokenAddress");

create index if not exists kaleido_requests_chain_status_interest_idx
  on public.kaleido_requests (chain_id, "status", "interest");

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

-- Unchanged, and nothing here needs to change it: the policies are on the tables
-- rather than on their keys, both remain public-read and service-role-write, and
-- the revokes from the genesis migration still stand. Noted explicitly because a
-- reader checking whether a new column widened the write surface should find the
-- answer in this file rather than have to go and confirm it.
