-- Daily wallet-value snapshots for the portfolio balance chart.
-- One row per wallet per UTC day; the value is computed SERVER-side from the
-- chain (wallet token balances on every mainnet chain x prices), never taken
-- from the client, so a history cannot be written for someone else's wallet.
create table if not exists public.portfolio_snapshots (
  wallet       text        not null check (wallet ~ '^0x[0-9a-f]{40}$'),
  day          date        not null,
  value_usd    numeric     not null check (value_usd >= 0),
  unpriced     text[]      not null default '{}',
  computed_at  timestamptz not null default now(),
  primary key (wallet, day)
);

alter table public.portfolio_snapshots enable row level security;
-- No policies: service role only (the routes use supabaseAdmin).

comment on table public.portfolio_snapshots is
  'Daily wallet token value (USD) per wallet, computed server-side from chain reads; wallet balances only, not protocol positions.';
