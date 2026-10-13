-- Replace the Bitget Wallet social task with the live Arc mainnet launch post.
-- Keep x_bitget_at for historical completions: removing that column or its
-- credit would silently reduce balances for users who already finished it.
alter table public.waitlist
  add column if not exists x_launch_at timestamptz;

comment on column public.waitlist.x_launch_at is
  'Attested like + repost completion for the Kaleido Arc mainnet launch post; +100 kPoint.';
