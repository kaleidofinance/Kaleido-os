-- Health-factor monitor state.
--
-- src/hooks/useGetValueAndHealth.ts raises the pre-liquidation warning that
-- lib/notifications/emit.ts calls "the one alert in this app that has to arrive".
-- It arrives only while a tab is open: the read is an effect keyed on the
-- connected wallet, with no interval, so a user whose position drifts toward
-- liquidation overnight is told nothing. /api/health/watch is the server-side
-- half, and this table is what makes it send once rather than every fifteen
-- minutes for as long as the position stays unhealthy.
--
-- WHY PER-WALLET AND NOT PER-CHAIN. push_watch_state
-- (20260825000000_push_watch_state.sql) is a block cursor because an event is a
-- point in time: scanned once, delivered once, never seen again. A health factor
-- is a *level*. It does not happen, it persists — a position at 1.02 is still at
-- 1.02 on the next run, and a cursor over blocks would say nothing about whether
-- the user has already been told. So the state is a per-wallet, per-chain record
-- of when we last warned, and the monitor's cooldown reads it.
--
-- The two columns are not redundant:
--
--   * last_warned_at is the cooldown. A run that finds an unhealthy position
--     within the window reads the level, decides it is already known, and sends
--     nothing. This is the client's `__kaleido_last_health_warning` window made
--     durable — the client's lives on `window` and resets on every reload, which
--     is why an open tab can re-warn every refresh while a closed one never does.
--   * last_check_at is the liveness signal, and it is what tells an operator the
--     difference between "no warnings because everyone is healthy" and "no
--     warnings because the monitor has not run since Tuesday". A silent alerting
--     system is indistinguishable from a working one until it matters.
--
-- last_health is kept for the same reason: a level that got worse since the last
-- warning is news again even inside the cooldown, and without the previous value
-- there is no way to know that it did.
--
-- SERVICE-ROLE ONLY, for the same reason as push_subscriptions and
-- push_watch_state: the anon key ships in the JS bundle. A writable cooldown is a
-- way to silence someone else's liquidation warning — set last_warned_at forward
-- and the monitor decides they have already been told. RLS is enabled with no
-- policy, which denies anon and authenticated every operation, and the grants are
-- revoked so a future dashboard-created policy has nothing to act on.

create table if not exists public.health_watch_state (
  -- Lowercase 0x address. The monitor lowercases before reading and writing, the
  -- same normalisation /api/push/send applies to its `wallet` field.
  wallet          text        not null,
  -- One row per (wallet, chain): the same address can hold a healthy position on
  -- one deployment and a liquidatable one on another, and a warning about one
  -- must not suppress a warning about the other.
  chain_id        bigint      not null,
  -- When a warning was last sent for this position. Null means never.
  last_warned_at  timestamptz,
  -- The health factor at that warning, in real units (1.0 = liquidation).
  -- Numeric rather than double precision: the comparison decides whether someone
  -- is told their collateral is about to be sold, and binary rounding at the
  -- third decimal is not a thing to introduce into that.
  last_health     numeric,
  -- When this wallet was last evaluated, whether or not anything was sent.
  last_check_at   timestamptz not null default now(),
  primary key (wallet, chain_id)
);

alter table public.health_watch_state enable row level security;

-- Belt and braces, matching push_watch_state: RLS with no policy already denies
-- these, but revoking the grant means a later policy still has nothing to act on.
revoke all on public.health_watch_state from public, anon, authenticated;

comment on table public.health_watch_state is
  'Per-wallet, per-chain cooldown for the health-factor monitor (/api/health/watch). Service-role only — a writable cooldown can suppress a liquidation warning.';
