-- Evidence retained for waitlist transaction tasks.
-- The task timestamp alone is not enough to audit which operation qualified it.
create table if not exists public.waitlist_transaction_evidence (
  id              bigint generated always as identity primary key,
  wallet          text not null,
  task            text not null check (task in ('agent', 'bridge', 'arcMainnet')),
  tx_hash        text not null,
  chain_id       int not null,
  operation       text not null,
  provider        text not null,
  target          text,
  verified_at     timestamptz not null default now(),
  unique (task, wallet),
  unique (chain_id, tx_hash)
);

create index if not exists waitlist_transaction_evidence_wallet_idx
  on public.waitlist_transaction_evidence (wallet, task);

alter table public.waitlist_transaction_evidence enable row level security;
revoke all on table public.waitlist_transaction_evidence from public, anon, authenticated;
