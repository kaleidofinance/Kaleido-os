-- On-chain waitlist tasks. Timestamps are server-written only after verification.
alter table public.waitlist
  add column if not exists arc_mainnet_tx_at timestamptz,
  add column if not exists agent_tx_at timestamptz,
  add column if not exists bridge_tx_at timestamptz;
