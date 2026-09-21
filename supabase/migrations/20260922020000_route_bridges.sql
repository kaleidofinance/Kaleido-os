-- Route (LI.FI) bridge volume ledger.
--
-- CCTP bridges are recorded in cctp_transfers; aggregator-route bridges (LI.FI)
-- had no ledger, so their volume and our integrator fee were missing from the
-- pool page's platform totals. This is that ledger: /api/bridge/record writes
-- one row per confirmed LI.FI bridge — after verifying on chain that the tx
-- exists, succeeded, was sent by the wallet, and went to a known bridge router —
-- and prices the notional server-side (lib/points/prices) so usd_value is the
-- app's own valuation, not a client's claim. lib/stats/platform sums it into the
-- headline; fees are derived from the configured LIFI_FEE at read time.
--
-- Idempotent throughout, so it can be pasted into the SQL editor and later
-- applied by `supabase db push` as a no-op.

create table if not exists public.route_bridges (
  id              bigint generated always as identity primary key,
  tx_hash         text        not null unique,
  source_chain_id int         not null,
  wallet          text        not null,
  -- Human amount + symbol of the asset bridged, for audit. usd_value is the
  -- priced notional (null when the asset had no meaningful USD price).
  amount          text        not null,
  symbol          text        not null,
  usd_value       numeric,
  provider        text        not null default 'lifi',
  created_at      timestamptz not null default now(),
  check (tx_hash ~ '^0x[0-9a-fA-F]{64}$'),
  check (wallet ~ '^0x[0-9a-fA-F]{40}$'),
  check (char_length(amount) <= 40),
  check (char_length(symbol) <= 16),
  check (char_length(provider) <= 24),
  check (usd_value is null or usd_value >= 0)
);

create index if not exists route_bridges_created_idx
  on public.route_bridges (created_at);

alter table public.route_bridges enable row level security;
-- Service-role only: written and read through the app's own routes, which
-- verify the bridge on chain before recording it.
revoke all on table public.route_bridges from public, anon, authenticated;
