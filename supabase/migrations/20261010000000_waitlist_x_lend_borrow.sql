-- Arc lend & borrow launch tasks: two independent first-200 X claims.
-- Each task is attested, held for five hours in the UI, and credited by the
-- existing waitlist reconciliation path after the wallet is active on Arc.
begin;

alter table public.waitlist
  add column if not exists x_lendborrow_at timestamptz,
  add column if not exists x_lendborrow_comment_at timestamptz;

comment on column public.waitlist.x_lendborrow_at is
  'Attested like + repost of the lend & borrow launch post; +500 kPoint; first 200 wallets.';
comment on column public.waitlist.x_lendborrow_comment_at is
  'Attested comment on the lend & borrow launch post; +500 kPoint; first 200 wallets.';

create or replace function public.claim_capped_x_task(
  p_wallet text,
  p_column text,
  p_cap    int
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
  done timestamptz;
begin
  if p_column not in (
    'x_argus_at', 'x_argus2_at', 'x_absexit_at', 'x_commented_at',
    'x_lendborrow_at', 'x_lendborrow_comment_at'
  ) then
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
