-- Drop the marketplace_* scaffold.
--
-- The linked project (twjqdjiilnmfolbjzyji) was created with three tables from a
-- different schema generation than the one this app reads:
--
--   marketplace_listings, marketplace_loans, marketplace_repayments
--
-- They are snake_case with `interest_rate_bps`, `user_id`, `chain_id`; the app
-- reads camelCase `kaleido_listings`/`kaleido_requests` with `interest`,
-- `sender`, `tokenAddress`. Same domain, incompatible naming — a parallel design
-- that nothing in src/ references. Verified: zero rows in all three at the time
-- this was written, and `grep -r marketplace_ src/` returns nothing.
--
-- Dropped rather than left in place because a half-populated second order book
-- is worse than no second order book: the next person to open the dashboard
-- cannot tell which pair of tables is live, and the empty one looks like data
-- loss rather than an abandoned draft.
--
-- `cascade` because marketplace_loans references marketplace_listings and
-- marketplace_repayments references marketplace_loans. `if exists` so this file
-- is a no-op on any project that never had them — including a local `supabase
-- db reset`, where the genesis migration before this one is the only thing that
-- has run.

drop table if exists public.marketplace_repayments cascade;
drop table if exists public.marketplace_loans      cascade;
drop table if exists public.marketplace_listings   cascade;
