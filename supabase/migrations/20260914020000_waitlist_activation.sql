-- Waitlist activation: the bridge from pending waitlist points into Season 1.
--
-- The waitlist (20260914010000) holds welcome + referral points as PENDING, off
-- the Season 1 ledger, so a free signup faucet cannot dilute real earners. This
-- migration adds the two registry rows the activation reader needs to write a
-- canonical `point_actions` row when a waitlisted wallet proves it is real
-- (nonce > 0 on Arc mainnet):
--
--  1. a `waitlist` point source — action-kind, so the credit lands as
--     action_points; the reader sets the point value explicitly on the row, so
--     the rate is 0 (points are a fixed grant, not usd-derived).
--  2. the private Arc mainnet chain 5042 (rpc.arc-scan.org) — where activity is
--     checked and where the action row is filed. NOT a testnet, so the credit is
--     eligible for conversion; distinct from Arc Testnet 5042002.
--
-- Note: nothing in this repo materialises point_balances from point_actions yet
-- (accrual.ts is pure; the indexer is external / not-yet-built). This migration +
-- the reader produce the correct append-only records; whoever owns balance
-- materialisation must include the `waitlist` source when it credits Season 1.

insert into public.point_sources (slug, label, kind, product, enabled, notes) values
  ('waitlist', 'Arc waitlist bonus', 'action', 'social', true,
   'Welcome + referral bonus, credited once per wallet by the activation reader after the wallet is active on Arc mainnet (nonce>0). Points are set explicitly on the action row.')
on conflict (slug) do nothing;

insert into public.point_chains (chain_id, label, enabled, multiplier, is_testnet) values
  (5042, 'Arc', true, 1.0, false)
on conflict (chain_id) do nothing;

insert into public.point_source_rates (source_slug, season, rate, multiplier, min_usd) values
  ('waitlist', 1, 0, 1.0, 0),
  ('waitlist', 0, 0, 1.0, 0)
on conflict (source_slug, season) do nothing;
