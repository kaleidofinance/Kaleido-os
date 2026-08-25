-- Web push subscriptions.
--
-- Stores the PushSubscription a browser hands us so the server can reach a user
-- whose browser is closed. One row per browser+profile, not per user: the same
-- wallet on a laptop and a phone is two endpoints, and both should ring.
--
-- WHY THE ANON KEY MUST NEVER TOUCH THIS TABLE.
-- A push subscription is a capability. Anyone holding the endpoint plus its two
-- keys can send an OS-level notification to that user's device — a lock-screen
-- write primitive pointed at someone's phone. The anon key ships inside the JS
-- bundle (see 20260801000000_lock_activity_writes.sql for the same reasoning
-- applied to activity rows), so a readable subscriptions table would hand that
-- capability to anyone who opens devtools. RLS is enabled with no policy at all,
-- which denies every operation to anon and authenticated; the service role
-- bypasses RLS and is the only way in.
--
-- Note this is stricter than the activity table, which keeps public SELECT.
-- There is no equivalent here: nothing about a subscription is public.

create table if not exists public.push_subscriptions (
  -- The endpoint URL is globally unique per subscription and is what web-push
  -- addresses, so it is the natural key. Re-subscribing the same browser
  -- upserts rather than accumulating dead rows.
  endpoint    text primary key,
  -- Lowercased wallet. Nullable: a user may enable notifications before
  -- connecting, and a subscription with no wallet still receives broadcasts.
  wallet      text,
  -- p256dh + auth from the subscription's keys. Required to encrypt a payload.
  p256dh      text not null,
  auth        text not null,
  -- Whether to strip amounts from the push body before sending.
  --
  -- Stored here rather than in the browser's localStorage because the *server*
  -- composes the push payload, and it cannot read a preference that only exists
  -- on a device whose browser is closed. Defaults to true: a lock screen is a
  -- public surface, and the safe default should not depend on a user finding a
  -- setting.
  hide_amounts boolean not null default true,
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists push_subscriptions_wallet_idx
  on public.push_subscriptions (wallet);

alter table public.push_subscriptions enable row level security;

-- Belt and braces: RLS with no policy already denies these, but a future
-- dashboard-created policy would silently re-open them. Revoking the grant
-- means such a policy still has nothing to act on.
revoke all on public.push_subscriptions from public, anon, authenticated;

comment on table public.push_subscriptions is
  'Web push endpoints. Service-role only — an endpoint plus its keys is a capability to write to a user''s lock screen.';
