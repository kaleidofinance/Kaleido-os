-- Make Season 1 (pre-TGE) the default/active season, now that mainnet is live.
--
-- 20260817000000_leaderboard_disclosure set is_default on Season 0 ("testnet
-- rehearsal"), so the app leaderboard and getPoints both defaulted to the testnet
-- season — which is why the live board reads "Season 0 — testnet rehearsal" with
-- nobody ranked. Mainnet is live on Arc and real pre-TGE points (including
-- activated waitlist points, see 20260914020000) are written to Season 1, so
-- Season 1 must be the default the leaderboard resolves when no ?season= is given.
--
-- A unique partial index permits only one is_default = true at a time, so unset
-- Season 0 before setting Season 1. Idempotent: re-running is a no-op.
update public.point_seasons set is_default = false where id = 0 and is_default;
update public.point_seasons set is_default = true  where id = 1;
