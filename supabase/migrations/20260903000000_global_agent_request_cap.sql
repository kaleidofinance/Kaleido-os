-- A shared daily ceiling on provider calls, beside the per-wallet one.
--
-- The per-wallet ceiling (20260805000000_agent_request_quota.sql) rations one
-- user. It does not ration the bill. 25 requests per wallet per UTC day times an
-- unbounded number of wallets is an unbounded number of provider calls, and a
-- wallet costs nothing to make: `Wallet.createRandom()` in a loop yields 25 more
-- each, against a 34-tool payload, on one shared account. That is survivable
-- while the audience is a known list of invited people. It stops being
-- survivable the moment the access code is published, which is why
-- docs/TESTNET_INVITE_CAMPAIGN.md names this counter as the prerequisite for
-- publishing it.
--
-- WHAT THIS IS NOT, so it is not mistaken for it. One aggregate counter is
-- first-come, first-served: a script that spends the day's allowance by 03:00 UTC
-- leaves everyone else with nothing until midnight. What bounds any single
-- identity's share of it is the per-wallet ceiling — 25 out of 2,000 is 1.25%, so
-- the cheap lever if that ever happens is to LOWER AGENT_DAILY_MODEL_REQUESTS
-- rather than to raise this one. A per-wallet reserve is a different feature and
-- is deliberately not here.
--
-- It also inherits both of the per-wallet ceiling's fail-open paths: an
-- unconfigured service-role key means credits.ts never calls this at all, and an
-- RPC error is logged and allowed. Neither is changed here. A ceiling that took
-- the agent down when Supabase blinked would be a worse trade than a ceiling with
-- a logged outage.

-- ---------------------------------------------------------------------------
-- The counter
-- ---------------------------------------------------------------------------

-- Its own table rather than a reserved wallet value in agent_usage_daily. A
-- sentinel row there would be counted by everything that reads that table as a
-- per-user record — the points system does — so the aggregate would quietly
-- appear as the most active participant on the testnet.
create table if not exists public.agent_global_usage_daily (
  usage_date   date not null primary key,
  requests     int  not null default 0,
  -- When the ceiling first refused today. The operational signal: a stamp here
  -- means real users were turned away, which is the difference between "the cap
  -- is set correctly" and "the cap is set too low".
  throttled_at timestamptz
);

comment on table public.agent_global_usage_daily is
  'Aggregate daily model-request count across all wallets. The ceiling that bounds provider spend when the number of wallets is unbounded. Enforced by consume_agent_request; service-role only.';

-- RLS on with no policy, exactly as agent_usage_daily is: the two definer
-- functions below are the only way in, and the anon key ships in the JS bundle.
alter table public.agent_global_usage_daily enable row level security;

-- ---------------------------------------------------------------------------
-- consume_agent_request — now checks both ceilings
-- ---------------------------------------------------------------------------

-- THE DROP IS LOAD-BEARING. The new function takes a third argument, so creating
-- it alongside the old two-argument one would leave two things named
-- consume_agent_request: a call passing two arguments would be ambiguous (the new
-- one's default makes it a candidate), and worse, a caller that resolved to the
-- old overload would spend wallet quota with no aggregate ceiling at all. There
-- must be exactly one of these.
drop function if exists public.consume_agent_request(text, int);

create or replace function public.consume_agent_request(
  p_wallet       text,
  p_limit        int,
  -- Defaulted so that a deploy skew is not an outage. If this migration is
  -- applied before the code that passes three arguments, the two-argument call
  -- still resolves and is still capped — at this number rather than at the app's
  -- configured one. Keep it in step with GLOBAL_DAILY_MODEL_REQUESTS in
  -- src/lib/ai/credits.ts.
  p_global_limit int default 2000
)
returns table (
  allowed      boolean,
  used         int,
  quota        int,
  -- Which ceiling said no, null when neither did. The caller needs this to
  -- answer honestly: telling someone who has asked two questions that they have
  -- used all 25 of theirs is a lie, and it sends them away for the rest of the
  -- day instead of back in ten minutes.
  refused_by   text,
  global_used  int,
  global_quota int
)
language plpgsql
-- security definer for the same reason as before: the tables deny all direct
-- access. Execute is granted to service_role only, below.
security definer
set search_path = public
as $$
declare
  v_wallet text := lower(p_wallet);
  v_used   int;
  v_global int;
begin
  -- ── the wallet's own ceiling ────────────────────────────────────────────
  -- Checked first, and it is the cheaper refusal: it needs no lock on the row
  -- every other request in the system also wants. It also fixes the lock order
  -- at wallet-then-global for every caller, which is what makes a deadlock
  -- between two concurrent requests impossible rather than merely unlikely.

  insert into public.agent_usage_daily (wallet, usage_date, requests)
  values (v_wallet, current_date, 0)
  on conflict (wallet, usage_date) do nothing;

  update public.agent_usage_daily
     set requests = requests + 1
   where wallet     = v_wallet
     and usage_date = current_date
     and requests   < p_limit
  returning requests into v_used;

  if v_used is null then
    select a.requests into v_used
      from public.agent_usage_daily a
     where a.wallet = v_wallet
       and a.usage_date = current_date;

    update public.agent_usage_daily
       set throttled_at = now()
     where wallet = v_wallet
       and usage_date = current_date
       and throttled_at is null;

    select g.requests into v_global
      from public.agent_global_usage_daily g
     where g.usage_date = current_date;

    return query
      select false, coalesce(v_used, 0), p_limit,
             'wallet'::text, coalesce(v_global, 0), p_global_limit;
    -- Bare RETURN, and it is not decoration. RETURN QUERY appends rows and
    -- carries on; without this, the refusal above fell through to the success
    -- row at the bottom and the function answered with TWO rows, allowed=false
    -- then allowed=true. It went unnoticed because every caller reads row[0],
    -- which is the correct one — but the first caller to use .single() would
    -- have got an error, and the first to read the last row would have got a
    -- free pass through the ceiling.
    return;
  end if;

  -- ── the shared ceiling ──────────────────────────────────────────────────
  -- One row, so every metered request in the deployment serialises on it. That
  -- is the point and it is affordable: this is a few thousand row locks a day,
  -- each held for the microseconds left in the transaction, and the alternative
  -- to a lock is a counter that can be overspent by exactly as many requests as
  -- arrive at once.

  insert into public.agent_global_usage_daily (usage_date, requests)
  values (current_date, 0)
  on conflict (usage_date) do nothing;

  update public.agent_global_usage_daily
     set requests = requests + 1
   where usage_date = current_date
     and requests   < p_global_limit
  returning requests into v_global;

  if v_global is null then
    -- Give the wallet's request straight back. It was charged a moment ago and
    -- nothing was served, and this is the one refusal where the two counters
    -- disagree about whether anything happened.
    --
    -- No `greatest(…, 0)` guard, deliberately: this is the same transaction that
    -- incremented that row and still holds its lock, so it is provably at least
    -- 1. A guard here would silently paper over the day this stops being true.
    update public.agent_usage_daily
       set requests = requests - 1
     where wallet     = v_wallet
       and usage_date = current_date
    returning requests into v_used;

    -- throttled_at on the WALLET row is left alone: the wallet was not
    -- throttled, the deployment was. Stamping it would put this refusal in the
    -- per-user data and make a shared outage look like 3,000 people abusing
    -- their allowance.
    update public.agent_global_usage_daily
       set throttled_at = now()
     where usage_date = current_date
       and throttled_at is null;

    select g.requests into v_global
      from public.agent_global_usage_daily g
     where g.usage_date = current_date;

    return query
      select false, coalesce(v_used, 0), p_limit,
             'global'::text, coalesce(v_global, 0), p_global_limit;
    return;
  end if;

  return query
    select true, v_used, p_limit, null::text, v_global, p_global_limit;
end;
$$;

comment on function public.consume_agent_request(text, int, int) is
  'Atomically spends one model request against both the wallet''s daily quota and the deployment''s. Returns allowed=false with refused_by set to which ceiling refused, incrementing neither. Service-role only.';

-- ---------------------------------------------------------------------------
-- release_agent_request — hands back both
-- ---------------------------------------------------------------------------

-- A consume that succeeded charged two counters, so a refund that returns one is
-- a leak: the aggregate would climb by one on every gateway refusal and never
-- come down, and enough of them would strand the whole deployment at a ceiling
-- nobody actually reached. Same signature as before, so nothing that calls it
-- has to change.
create or replace function public.release_agent_request(
  p_wallet text,
  p_limit  int
)
returns table (used int, quota int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet text := lower(p_wallet);
  v_before int;
  v_used   int;
begin
  -- Read under a lock, because what to do about the global counter depends on
  -- whether this wallet's counter actually moves — and "it moved" cannot be
  -- read off an UPDATE that floors at zero.
  select a.requests into v_before
    from public.agent_usage_daily a
   where a.wallet = v_wallet
     and a.usage_date = current_date
   for update;

  -- Nothing was counted today, so there is nothing to give back, and the shared
  -- counter must NOT be touched: decrementing it here would let a stream of
  -- releases for wallets that never spent anything mint aggregate allowance.
  -- Deliberately not creating the row either — a release is not a usage event,
  -- and a row at zero is indistinguishable from a wallet that spent its
  -- allowance and got all of it back, so usage data would gain phantoms.
  if v_before is null or v_before = 0 then
    return query select coalesce(v_before, 0), p_limit;
    return;
  end if;

  update public.agent_usage_daily
     set requests = v_before - 1
   where wallet     = v_wallet
     and usage_date = current_date
  returning requests into v_used;

  -- Floored, unlike the wallet decrement above, because this row's history is
  -- not provable from here: it is shared, and a release for a wallet whose
  -- consume predates this migration has no matching increment on it.
  update public.agent_global_usage_daily
     set requests = greatest(requests - 1, 0)
   where usage_date = current_date;

  -- throttled_at is left alone on both tables. It records that a ceiling was
  -- reached today, which stays true whether or not a later request was handed
  -- back; clearing it would erase the only signal that throttling happened.

  return query select v_used, p_limit;
end;
$$;

comment on function public.release_agent_request(text, int) is
  'Hands back one model request charged today but never served by a provider, from the wallet''s count and the deployment''s. Floors at zero and records nothing for a wallet that spent nothing. Service-role only.';

-- ---------------------------------------------------------------------------
-- peek_global_agent_usage — read the aggregate without spending
-- ---------------------------------------------------------------------------

-- For the verifier and for answering "how close are we" without burning a
-- request to find out. Not called from the app: the credits pill shows the
-- reader their own allowance, and replacing that number with a deployment-wide
-- one would be both less useful to them and a fact they cannot act on.
create or replace function public.peek_global_agent_usage()
returns table (used int, throttled_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select coalesce(g.requests, 0), g.throttled_at
    from public.agent_global_usage_daily g
   where g.usage_date = current_date
  union all
  select 0, null::timestamptz
   where not exists (
     select 1 from public.agent_global_usage_daily g2
      where g2.usage_date = current_date
   );
$$;

comment on function public.peek_global_agent_usage() is
  'Today''s aggregate model request count. Read-only; never increments. Service-role only.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

-- Postgres grants execute to public by default, which on a security-definer
-- function over a browser-inaccessible table would hand the shipped anon key a
-- quota it can spend, refund or read. Revoke first, then grant to service_role
-- only. consume_agent_request is listed by its NEW three-argument signature; the
-- old two-argument one was dropped above, along with its grants.
revoke all on function public.consume_agent_request(text, int, int) from public, anon, authenticated;
revoke all on function public.release_agent_request(text, int)      from public, anon, authenticated;
revoke all on function public.peek_global_agent_usage()             from public, anon, authenticated;

grant execute on function public.consume_agent_request(text, int, int) to service_role;
grant execute on function public.release_agent_request(text, int)      to service_role;
grant execute on function public.peek_global_agent_usage()             to service_role;
