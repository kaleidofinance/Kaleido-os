-- Preserve the bridge notional and corridor alongside the verified transaction.
-- This is intentionally nullable so historical task flags remain readable while
-- new automatic bridge verifications become auditable.
alter table public.waitlist_transaction_evidence
  add column if not exists amount text,
  add column if not exists symbol text,
  add column if not exists source_chain_id integer,
  add column if not exists destination_chain_id integer;

comment on column public.waitlist_transaction_evidence.amount is
  'Human-readable source amount supplied by the trusted bridge intent; nullable for legacy/manual evidence.';
comment on column public.waitlist_transaction_evidence.symbol is
  'Source asset symbol from the trusted bridge intent.';
comment on column public.waitlist_transaction_evidence.source_chain_id is
  'Source chain of the bridge transaction.';
comment on column public.waitlist_transaction_evidence.destination_chain_id is
  'Destination chain requested by the trusted bridge intent.';
