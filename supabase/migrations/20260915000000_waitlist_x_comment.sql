-- Waitlist X: "comment on the launch post" task (+50 kPoint).
--
-- A fourth attested X task, on top of link/follow/retweet. Worth 50 kPoint — the
-- others are 100 — so the app now carries a per-task point map rather than a flat
-- constant (see api/waitlist/route.ts and api/waitlist/activate/route.ts). Same
-- posture as the other X tasks: attested, not API-verified; held ~5h on the
-- client; converts to Season 1 only on Arc-mainnet activation.
--
-- Additive and nullable, so applying it is invisible to running code until the
-- app that reads x_commented_at deploys. `if not exists` keeps it idempotent, so
-- a later `supabase db push` re-running it is a harmless no-op.
alter table public.waitlist
  add column if not exists x_commented_at timestamptz;
