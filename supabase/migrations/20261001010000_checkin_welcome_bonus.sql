-- Check-in welcome bonus: the first 100 wallets to check in get a one-time
-- +500 $kPoint (src/app/api/rewards/checkin). The cap must hold under
-- concurrent check-ins, so the count-and-insert runs here under a transaction
-- advisory lock rather than as two round trips from the app.
begin;

create or replace function public.claim_checkin_welcome(
  p_wallet text,
  p_points numeric,
  p_limit  int
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed int;
begin
  perform pg_advisory_xact_lock(hashtext('checkin-welcome'));

  -- Already has it: nothing to do.
  if exists (
    select 1 from public.point_actions
     where tx_hash = 'checkin-welcome:' || lower(p_wallet) and chain_id = 5042
  ) then
    return false;
  end if;

  select count(*) into claimed
    from public.point_actions
   where source_slug = 'checkin' and tx_hash like 'checkin-welcome:%';
  if claimed >= p_limit then
    return false;
  end if;

  insert into public.point_actions
    (wallet, source_slug, season, tx_hash, chain_id, usd_value,
     multiplier_applied, points, is_agent_initiated, occurred_at)
  values
    (lower(p_wallet), 'checkin', 1, 'checkin-welcome:' || lower(p_wallet), 5042, 0,
     1.0, p_points, false, now());
  return true;
end;
$$;

revoke all on function public.claim_checkin_welcome(text, numeric, int)
  from public, anon, authenticated;
grant execute on function public.claim_checkin_welcome(text, numeric, int)
  to service_role;

commit;
