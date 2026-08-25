-- Push watcher checkpoints.
--
-- scripts/push-watcher.mjs turns three on-chain events (a request funded, a loan
-- repaid, a position liquidated) into web pushes for the counterparty they are
-- news to, so an alert reaches a browser that is closed — the rung public/sw.js
-- and /api/push/send exist to serve but that nothing was firing.
--
-- This table holds the last block that watcher has processed on each chain. It is
-- the whole reason the cron is correct rather than merely frequent:
--
--   * Without it, a run that re-scanned an overlapping range would push the same
--     liquidation twice, and a run that started from genesis would flood every
--     user with years of historical events.
--   * With it, each run scans strictly the blocks after the checkpoint, so cadence
--     affects only latency: a dropped or delayed GitHub run is caught up by the
--     next one, and each event is delivered exactly once.
--
-- First sight of a chain seeds the checkpoint to the current head and notifies
-- nothing — a backlog is not news.
--
-- SERVICE-ROLE ONLY, for the same reason as push_subscriptions
-- (20260808000000_push_subscriptions.sql): the anon key ships in the JS bundle,
-- and a writable checkpoint is a way to make the watcher re-send or skip events at
-- will. There is nothing public about a block cursor, so RLS is enabled with no
-- policy — which denies anon and authenticated every operation — and the grants
-- are revoked so a future dashboard-created policy has nothing to act on. The
-- service role bypasses RLS and is the only way in.

create table if not exists public.push_watch_state (
  -- Chain id. One cursor per deployed chain the watcher covers.
  chain_id    bigint primary key,
  -- Highest block whose events have been turned into pushes. The next run scans
  -- from chain_id's last_block + 1.
  last_block  bigint not null,
  updated_at  timestamptz not null default now()
);

alter table public.push_watch_state enable row level security;

-- Belt and braces, matching push_subscriptions: RLS with no policy already denies
-- these, but revoking the grant means a later policy still has nothing to act on.
revoke all on public.push_watch_state from public, anon, authenticated;

comment on table public.push_watch_state is
  'Per-chain last-processed block for scripts/push-watcher.mjs. Service-role only — a writable cursor can force duplicate or skipped pushes.';
