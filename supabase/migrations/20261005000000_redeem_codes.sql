-- Redeem codes: a code worth N $kPoint, usable by up to max_uses wallets, once
-- per wallet, optionally expiring. Redeemed on /rewards (POST /api/rewards/redeem,
-- signature-gated). Created with scripts/redeem-codes.mjs.
begin;

create table if not exists public.redeem_codes (
  code        text        primary key check (code = upper(code) and length(code) between 6 and 40),
  points      int         not null check (points > 0 and points <= 100000),
  max_uses    int         not null default 1 check (max_uses > 0),
  uses        int         not null default 0,
  expires_at  timestamptz,
  active      boolean     not null default true,
  note        text,
  created_at  timestamptz not null default now()
);
alter table public.redeem_codes enable row level security;
revoke all on table public.redeem_codes from public, anon, authenticated;

insert into public.point_sources (slug, label, kind, product, enabled, notes) values
  ('redeem', 'Redeem code', 'action', 'social', true,
   'Points from a redeemed code. tx_hash = redeem:<CODE>:<wallet> (once per wallet per code).')
on conflict (slug) do nothing;

-- One atomic claim: validate, cap, credit. Row-locks the code so concurrent
-- redemptions can't exceed max_uses; the point_actions unique (chain_id,
-- tx_hash) makes it once per wallet.
create or replace function public.redeem_points_code(p_code text, p_wallet text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.redeem_codes%rowtype;
  w text := lower(p_wallet);
  k text := upper(trim(p_code));
begin
  select * into c from public.redeem_codes where code = k for update;
  if not found or not c.active then
    return jsonb_build_object('status', 'invalid');
  end if;
  if c.expires_at is not null and c.expires_at < now() then
    return jsonb_build_object('status', 'expired');
  end if;
  if exists (select 1 from public.point_actions
              where chain_id = 5042 and tx_hash = 'redeem:' || k || ':' || w) then
    return jsonb_build_object('status', 'already');
  end if;
  if c.uses >= c.max_uses then
    return jsonb_build_object('status', 'exhausted');
  end if;

  insert into public.point_actions
    (wallet, source_slug, season, tx_hash, chain_id, usd_value,
     multiplier_applied, points, is_agent_initiated, occurred_at)
  values
    (w, 'redeem', 1, 'redeem:' || k || ':' || w, 5042, 0, 1.0, c.points, false, now());
  update public.redeem_codes set uses = uses + 1 where code = k;
  return jsonb_build_object('status', 'claimed', 'points', c.points);
end;
$$;

revoke all on function public.redeem_points_code(text, text) from public, anon, authenticated;
grant execute on function public.redeem_points_code(text, text) to service_role;

commit;
