-- Return a model request that was spent but never served.
--
-- consume_agent_request runs immediately before dispatch (see
-- 20260805000000_agent_request_quota.sql, which explains why: consuming on
-- entry to the route would charge locally-answered turns). That ordering is
-- right, but it means a request the provider refuses outright has already been
-- charged. The gateway in front of the model screens some user wording and
-- answers 400 without reaching a model at all — nothing was generated, nothing
-- was billed upstream, and the user should not lose one of their daily
-- allowance for it.
--
-- Deliberately not "undo the last consume". There is no request identity in
-- agent_usage_daily — it is a per-wallet daily counter — so this decrements
-- today's count by one and floors it at zero. That floor is the whole safety
-- story: a release with no matching consume, or the same release replayed,
-- cannot manufacture allowance below zero, and the worst a bug can do is hand
-- back requests the wallet did spend rather than invent ones it did not.
--
-- Callers must only release a consume that actually happened. When Supabase is
-- unconfigured consume_agent_request records nothing and reports
-- `unmetered: true`; releasing in that case would decrement a count that was
-- never incremented, so the Node side gates on that flag rather than calling
-- this unconditionally.

-- ---------------------------------------------------------------------------
-- release_agent_request
-- ---------------------------------------------------------------------------

create or replace function public.release_agent_request(
  p_wallet text,
  p_limit  int
)
returns table (used int, quota int)
language plpgsql
-- security definer for the same reason consume_agent_request is: the table
-- denies all direct access. Execute is granted to service_role only, below.
security definer
set search_path = public
as $$
declare
  v_wallet text := lower(p_wallet);
  v_used   int;
begin
  -- No row means nothing was ever counted today, so there is nothing to give
  -- back. Deliberately not creating the row: a release is not a usage event.
  update public.agent_usage_daily
     set requests = greatest(requests - 1, 0)
   where wallet     = v_wallet
     and usage_date = current_date
  returning requests into v_used;

  -- throttled_at is left alone on purpose. It records that this wallet hit its
  -- ceiling today, which stays true whether or not a later request was handed
  -- back; clearing it would erase the only signal that throttling happened.

  return query select coalesce(v_used, 0), p_limit;
end;
$$;

comment on function public.release_agent_request(text, int) is
  'Hands back one model request charged to a wallet today but never served by a provider. Floors at zero. Service-role only.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

-- Postgres grants execute to public by default, which on a security-definer
-- function over a browser-inaccessible table would let the shipped anon key
-- refund itself. Revoke first, then grant to service_role only.
revoke all on function public.release_agent_request(text, int) from public, anon, authenticated;

grant execute on function public.release_agent_request(text, int) to service_role;
