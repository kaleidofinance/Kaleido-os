-- Complete the waitlist transaction-task schema. The original transaction
-- migration was already recorded before bridge_tx_at was added, so this must be
-- a new migration rather than an edit to an applied migration.
alter table public.waitlist
  add column if not exists arc_mainnet_tx_at timestamptz,
  add column if not exists agent_tx_at timestamptz,
  add column if not exists bridge_tx_at timestamptz;
