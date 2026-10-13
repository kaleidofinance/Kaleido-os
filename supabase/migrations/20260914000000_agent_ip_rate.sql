-- Per-IP rate limit for /api/chat — the thing that was missing in front of an
-- unauthenticated endpoint.
--
-- WHY. Model quota is metered by wallet address, which the caller supplies as
-- free text and does not have to own. So a script could POST a victim's address
-- 25 times to lock them out for the day, or rotate addresses to burn the shared
-- 2,000/day deployment ceiling for everyone. The global cap bounds the damage;
-- nothing bounded the RATE. This does, keyed on the platform-set client IP, which
-- on Vercel the caller cannot forge.
--
-- FIXED WINDOW, not a leaky bucket, because it has to be one atomic round trip
-- against a shared store (many serverless instances answer one deployment) and a
-- calendar-bucket counter is exactly that. A burst at a window edge can reach up
-- to 2x the limit; that is fine — this is a floor under abuse, not a fair-share
-- scheduler, and the per-wallet and global caps still sit behind it.
--
-- FAILS OPEN, like the quota: a limiter outage must not take the agent down. The
-- app treats a missing row/error as allowed and logs it.
--
-- SERVICE-ROLE ONLY. Written from /api/chat via bump_ip_rate. RLS on, no policies.

create table if not exists public.agent_ip_rate (
  ip            text   not null,
  -- Unix window bucket: floor(epoch / window_seconds). Bigint so it never wraps.
  window_start  bigint not null,
  count         int    not null default 0,
  primary key (ip, window_start)
);

-- For pruning old windows (a scheduled delete, or by hand): everything older
-- than the current window is dead weight.
create index if not exists agent_ip_rate_window_idx
  on public.agent_ip_rate (window_start);

alter table public.agent_ip_rate enable row level security;
revoke all on table public.agent_ip_rate from public, anon, authenticated;

-- Increment this IP's count in the current window and report whether it is still
-- under the limit. One statement, so concurrent requests from one IP cannot race
-- past the ceiling.
create or replace function public.bump_ip_rate(
  p_ip             text,
  p_limit          int,
  p_window_seconds int default 60
)
returns table (allowed boolean, hits int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bucket bigint := floor(extract(epoch from now()) / p_window_seconds)::bigint;
  v        int;
begin
  insert into public.agent_ip_rate (ip, window_start, count)
       values (p_ip, v_bucket, 1)
  on conflict (ip, window_start)
       do update set count = agent_ip_rate.count + 1
    returning count into v;
  return query select (v <= p_limit), v;
end;
$$;

comment on function public.bump_ip_rate(text, int, int) is
  'Increment and check one IP''s request count in the current fixed window. Read/write, service-role only.';

revoke all on function public.bump_ip_rate(text, int, int) from public, anon, authenticated;
grant execute on function public.bump_ip_rate(text, int, int) to service_role;
