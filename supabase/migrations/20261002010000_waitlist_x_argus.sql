-- Waitlist X: "RT & comment on the $ARGUS listing post" — +1000 kPoint, first
-- 100 wallets only. Claimed through claim_capped_x_task so the cap holds under
-- concurrent claims (count + update under one advisory lock), unlike a
-- count-then-update from the app.
begin;

alter table public.waitlist
  add column if not exists x_argus_at timestamptz;

comment on column public.waitlist.x_argus_at is
  'Attested RT + comment on the $ARGUS listing post; +1000 kPoint; first 100 wallets.';

create or replace function public.claim_capped_x_task(
  p_wallet text,
  p_column text,
  p_cap    int
)
returns text  -- 'claimed' | 'already' | 'closed' | 'missing'
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
  done timestamptz;
begin
  -- Only the capped task columns, never an arbitrary identifier.
  if p_column not in ('x_argus_at', 'x_commented_at') then
    raise exception 'column % is not a capped X task', p_column;
  end if;

  perform pg_advisory_xact_lock(hashtext('capped-x:' || p_column));

  execute format('select %I from public.waitlist where wallet = $1', p_column)
    into done using lower(p_wallet);
  if not found then return 'missing'; end if;
  if done is not null then return 'already'; end if;

  execute format('select count(*) from public.waitlist where %I is not null', p_column)
    into n;
  if n >= p_cap then return 'closed'; end if;

  execute format('update public.waitlist set %I = now() where wallet = $1 and %I is null',
                 p_column, p_column)
    using lower(p_wallet);
  return 'claimed';
end;
$$;

revoke all on function public.claim_capped_x_task(text, text, int)
  from public, anon, authenticated;
grant execute on function public.claim_capped_x_task(text, text, int)
  to service_role;

commit;
