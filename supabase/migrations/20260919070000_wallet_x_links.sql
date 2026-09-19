-- Wallet-scoped X links for all Kaleido users. This stays separate from the
-- waitlist so linking in the dapp cannot create a waitlist row or mint points.
create table if not exists public.wallet_x_links (
  wallet text primary key check (wallet ~ '^0x[0-9a-fA-F]{40}$'),
  x_user_id text not null unique,
  x_handle text not null,
  linked_at timestamptz not null default now()
);

alter table public.wallet_x_links enable row level security;
