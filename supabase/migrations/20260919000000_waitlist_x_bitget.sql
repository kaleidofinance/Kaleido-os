-- Bitget Wallet integration post task: like + repost, attested by the wallet.
alter table public.waitlist
  add column if not exists x_bitget_at timestamptz;
