-- Model request quota for Luca.
--
-- agent_usage_daily already exists (20260801000100_points_system.sql) and its
-- comment states the intent: "Enforced at the API layer so a user cannot bulk-
-- transact through Luca to farm the multiplier or exhaust provider credits."
-- Nothing enforced it. This migration adds the enforcement primitive.
--
-- WHY AN RPC RATHER THAN A READ THEN A WRITE FROM NODE.
-- Reading `requests`, comparing it to the limit, and then writing back is racy:
-- two requests from the same wallet can interleave between the read and the
-- write and both pass a check that only one should. Provider credits are money,
-- so the check and the increment happen in a single UPDATE whose WHERE clause
-- *is* the check. Postgres takes a row lock, so the second caller sees the
-- first's increment and matches zero rows.
--
-- Local turns must never call this. The whole point of the local-first router
-- is that a parsed command costs nothing, so only a real provider call spends
-- quota. Callers therefore consume immediately before dispatching to a
-- provider, not on entry to the route.

-- ---------------------------------------------------------------------------
-- consume_agent_request
-- ---------------------------------------------------------------------------

create or replace function public.consume_agent_request(
  p_wallet text,
  p_limit  int
)
returns table (allowed boolean, used int, quota int)
language plpgsql
-- security definer so the function can write a table that denies all direct
-- access. Execute is granted to service_role only, below.
security definer
set search_path = public
as $$
declare
  v_wallet text := lower(p_wallet);
  v_used   int;
begin
  -- Ensure today's row exists without disturbing an existing count.
  insert into public.agent_usage_daily (wallet, usage_date, requests)
  values (v_wallet, current_date, 0)
  on conflict (wallet, usage_date) do nothing;

  -- Check and increment in one statement. `requests < p_limit` is the gate:
  -- when the wallet is already at its ceiling this matches no row, v_used
  -- stays null, and nothing is incremented.
  update public.agent_usage_daily
     set requests = requests + 1
   where wallet     = v_wallet
     and usage_date = current_date
     and requests   < p_limit
  returning requests into v_used;

  if v_used is null then
    -- Denied. Report the current count for the caller's headers, and stamp the
    -- first refusal of the day so throttling is visible in the data.
    select a.requests into v_used
      from public.agent_usage_daily a
     where a.wallet = v_wallet
       and a.usage_date = current_date;

    update public.agent_usage_daily
       set throttled_at = now()
     where wallet = v_wallet
       and usage_date = current_date
       and throttled_at is null;

    return query select false, coalesce(v_used, 0), p_limit;
  end if;

  return query select true, v_used, p_limit;
end;
$$;

comment on function public.consume_agent_request(text, int) is
  'Atomically spends one model request from a wallet''s daily quota. Returns allowed=false without incrementing once the ceiling is reached. Service-role only.';

-- ---------------------------------------------------------------------------
-- peek_agent_usage — read without spending
-- ---------------------------------------------------------------------------

-- Lets the UI show a remaining count on load. Separate from the consuming
-- function so displaying a number can never cost the user a request.
create or replace function public.peek_agent_usage(p_wallet text)
returns table (used int)
language sql
security definer
set search_path = public
as $$
  select coalesce(
    (select a.requests
       from public.agent_usage_daily a
      where a.wallet = lower(p_wallet)
        and a.usage_date = current_date),
    0
  );
$$;

comment on function public.peek_agent_usage(text) is
  'Today''s model request count for a wallet. Read-only; never increments.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

-- Both functions are security definer over a table the browser cannot touch, so
-- execute must not reach the anon key that ships in the JS bundle. Revoking
-- from public first because Postgres grants execute to public by default, which
-- would otherwise leave a definer function callable by anyone.
revoke all on function public.consume_agent_request(text, int) from public, anon, authenticated;
revoke all on function public.peek_agent_usage(text)           from public, anon, authenticated;

grant execute on function public.consume_agent_request(text, int) to service_role;
grant execute on function public.peek_agent_usage(text)           to service_role;
