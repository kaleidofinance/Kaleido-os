-- CCTP transfers: the server-side registry of burns awaiting their destination
-- mint.
--
-- A CCTP bridge is two transactions on two chains: the user burns USDC on the
-- source, then someone submits `receiveMessage` on the destination once Circle
-- attests. Until 2026-09-17 "someone" was only the user, from the browser, and
-- that needed gas on the destination — a wallet with no ETH on Base burned its
-- USDC on Arc and could not mint it. The burn sets destinationCaller = 0, so
-- anyone may complete it; this table is how the completion keeper
-- (src/lib/keeper/cctpKeeper.ts, driven by /api/keeper/cctp) knows what to
-- complete. Written by /api/cctp/record right after the burn confirms, read by
-- /api/cctp/status so the browser's own pending list clears once the keeper
-- has minted.
--
-- Idempotent throughout (`if not exists`), so it can be pasted into the SQL
-- editor and later applied by `supabase db push` as a harmless no-op.

create table if not exists public.cctp_transfers (
  id              bigint generated always as identity primary key,
  tx_hash         text        not null unique,
  source_chain_id int         not null,
  dest_chain_id   int         not null,
  -- The burn's mintRecipient: the wallet the USDC is minted TO. The keeper
  -- pays gas; it never chooses the recipient — that is fixed in the burn.
  recipient       text        not null,
  amount          text        not null,
  symbol          text        not null default 'USDC',
  -- pending → minted (by the keeper, or by anyone — a used nonce reads as
  -- minted) | failed (attempts exhausted, or no attestation within 3 days).
  status          text        not null default 'pending',
  mint_tx_hash    text,
  attempts        int         not null default 0,
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (tx_hash ~ '^0x[0-9a-fA-F]{64}$'),
  check (recipient ~ '^0x[0-9a-fA-F]{40}$'),
  check (status in ('pending', 'minted', 'failed')),
  check (char_length(amount) <= 40),
  check (char_length(symbol) <= 16),
  check (char_length(last_error) <= 400)
);

create index if not exists cctp_transfers_status_created_idx
  on public.cctp_transfers (status, created_at);

alter table public.cctp_transfers enable row level security;
-- Service-role only: written and read through the app's own routes, which
-- validate the burn on chain before recording it.
revoke all on table public.cctp_transfers from public, anon, authenticated;
