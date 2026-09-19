-- Keep the wallet↔X identity separate from waitlist membership.
--
-- The dapp header is available to every wallet, not only Arc waitlisters. A
-- link must therefore not insert a waitlist row (that would mint welcome
-- points), while existing waitlist links remain readable through the same API.
create table if not exists public.wallet_x_links (
  wallet     text primary key check (wallet ~ '^0x[0-9a-fA-F]{40}$'),
  x_user_id  text not null unique,
  x_handle   text not null,
  linked_at  timestamptz not null default now()
);

alter table public.wallet_x_links enable row level security;

comment on table public.wallet_x_links is
  'Signature-gated wallet to X identity links for all Kaleido users; waitlist points remain in waitlist.';
