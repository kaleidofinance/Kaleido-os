-- $ARGUS listing task, batch 2: 50 more spots at +300 kPoint for wallets that
-- missed batch 1. Same claim function; its column allowlist gains x_argus2_at.
begin;

alter table public.waitlist
  add column if not exists x_argus2_at timestamptz;

comment on column public.waitlist.x_argus2_at is
  'Attested RT + comment on the $ARGUS listing post, batch 2; +300 kPoint; 50 wallets.';

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
  if p_column not in ('x_argus_at', 'x_argus2_at', 'x_commented_at') then
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
