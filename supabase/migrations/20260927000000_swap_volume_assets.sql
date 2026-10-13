-- Which assets each swap moved, so swap points can be netted per pair.
--
-- Swap points were paid on gross volume, so a round trip (USDC→EURC, then
-- EURC→USDC) earned on both legs while leaving the wallet where it started.
-- Measured 2026-09-27: 52 of 133 credited swaps looked like return legs. The
-- indexer now nets each wallet's same-day flow per pair (src/lib/points/netFlow.ts)
-- and reads the earlier legs from this ledger, which it already writes before the
-- points decision. That needs each row to say what went in and what came out.
--
-- Forward-only: existing rows keep NULL assets and are ignored by the netting,
-- so nothing already credited is revisited.
--
-- DEPLOY ORDER: apply this BEFORE the code that passes the new arguments. It is
-- backward-compatible with the running code: the old 7-argument call resolves to
-- the new function through its defaults.

alter table public.swap_volume
  add column if not exists asset_in  text,
  add column if not exists asset_out text;

comment on column public.swap_volume.asset_in is
  'Asset the wallet gave up: lowercased token address, or ''usd'' for any Arc dollar (0x3600 USDC, wrapped native). NULL on rows recorded before 2026-09-27 or when unclassifiable.';
comment on column public.swap_volume.asset_out is
  'Asset the wallet received — same keys as asset_in.';

-- The per-wallet, per-day read the netting does.
create index if not exists swap_volume_wallet_occurred_idx
  on public.swap_volume (wallet, occurred_at);

-- Replace the writer with one that also takes the assets. The old signature is
-- dropped so there is ONE writer; the new trailing parameters default to NULL, so
-- a caller still sending seven arguments keeps working.
drop function if exists public.record_swap_volume(int, text, text, numeric, text, boolean, timestamptz);

create or replace function public.record_swap_volume(
  p_chain_id    int,
  p_tx_hash     text,
  p_wallet      text,
  p_usd_value   numeric,
  p_venue       text,
  p_fee_paid    boolean,
  p_occurred_at timestamptz,
  p_asset_in    text default null,
  p_asset_out   text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.swap_volume
    (chain_id, tx_hash, wallet, usd_value, venue, fee_paid, occurred_at, asset_in, asset_out)
  values
    (p_chain_id, lower(p_tx_hash), lower(p_wallet), p_usd_value, p_venue, p_fee_paid,
     p_occurred_at, lower(p_asset_in), lower(p_asset_out))
  on conflict (chain_id, tx_hash) do update
    -- A repeat refreshes classification only, never the value, time or wallet.
    -- Assets are filled in if a row lacks them and never overwritten once set.
    set venue     = excluded.venue,
        fee_paid  = excluded.fee_paid,
        asset_in  = coalesce(public.swap_volume.asset_in,  excluded.asset_in),
        asset_out = coalesce(public.swap_volume.asset_out, excluded.asset_out);
$$;

revoke all on function public.record_swap_volume(int, text, text, numeric, text, boolean, timestamptz, text, text)
  from public, anon, authenticated;
grant execute on function public.record_swap_volume(int, text, text, numeric, text, boolean, timestamptz, text, text)
  to service_role;
