-- Lock down kaleido_protocol_activity.
--
-- URGENT, AND DEPLOYABLE ON ITS OWN. This migration is deliberately separate
-- from the points schema so it can ship without waiting for that review.
--
-- The table is written from the browser by logProtocolActivity.ts using the
-- NEXT_PUBLIC anon key, which ships inside the JS bundle. Anyone who reads it
-- out of the bundle can POST rows with arbitrary points_earned. Every row in
-- this table is therefore untrusted, which is why docs/points-system.md treats
-- the existing data as Season 0 participation evidence rather than as a
-- balance.
--
-- KNOWN CONSEQUENCE: after this runs, client-side activity logging stops
-- working. logProtocolActivity already swallows its own errors and never
-- throws ("activity logging should never break a swap"), so swaps, LP and
-- agent flows keep working — they just stop recording. That is the intended
-- state until the server-side verifier lands, because the numbers being
-- recorded today are mis-denominated anyway: amountInUsd is the raw token
-- amount, not USD.

alter table public.kaleido_protocol_activity enable row level security;

-- Wipe any permissive policy that may exist from the dashboard.
drop policy if exists "anon insert" on public.kaleido_protocol_activity;
drop policy if exists "public insert" on public.kaleido_protocol_activity;
drop policy if exists "enable insert for all" on public.kaleido_protocol_activity;

-- Reads stay open: the activity feed on /v2/explore is public by design.
create policy "activity readable by anyone"
  on public.kaleido_protocol_activity
  for select
  using (true);

-- No INSERT/UPDATE/DELETE policy is created. With RLS enabled and no policy,
-- those operations are denied for anon and authenticated. The service role
-- bypasses RLS entirely, so the future server-side writer is unaffected.

revoke insert, update, delete on public.kaleido_protocol_activity from anon;
revoke insert, update, delete on public.kaleido_protocol_activity from authenticated;
