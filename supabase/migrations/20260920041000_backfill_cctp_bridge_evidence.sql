-- Backfill only evidence that is already independently recorded by the CCTP
-- burn table. This does not change waitlist task timestamps or points.
insert into public.waitlist_transaction_evidence (
  wallet,
  task,
  tx_hash,
  chain_id,
  operation,
  provider,
  target,
  amount,
  symbol,
  source_chain_id,
  destination_chain_id,
  verified_at
)
select
  lower(w.wallet),
  'bridge',
  lower(c.tx_hash),
  c.source_chain_id,
  'bridge',
  'cctp',
  null,
  c.amount,
  c.symbol,
  c.source_chain_id,
  c.dest_chain_id,
  c.created_at
from public.cctp_transfers c
join public.waitlist w on lower(w.wallet) = lower(c.recipient)
where w.bridge_tx_at is not null
on conflict (task, wallet) do nothing;
