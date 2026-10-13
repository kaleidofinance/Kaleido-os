-- Pin Season 1 (pre-TGE) as the default/active season — durably.
--
-- 20260916000000 already flipped the default to Season 1, but on 2026-09-16 the
-- live leaderboard was observed back on Season 0. The disclosure migration
-- (20260817000000) is self-guarding — it sets Season 0 default only WHEN NO
-- default exists — so a re-run of that file cannot have caused the revert; the
-- flip was either never durably applied or a manual/reset write put it back.
--
-- This file re-asserts Season 1 as the one default, idempotently, and is the
-- canonical, latest statement of which season the app opens on (the route and
-- getPoints both resolve `is_default`). Keep it the highest-timestamped
-- season-default migration: an in-order (re)apply then always ends here, on
-- Season 1, whatever an earlier file set.
--
-- Written to self-heal rather than assume the current state: unset ANY default
-- that is not Season 1 (not just Season 0), then set Season 1. The unique partial
-- index point_seasons_one_default permits exactly one default, so the unset must
-- run first. Both statements are no-ops once Season 1 is already the sole default.
update public.point_seasons set is_default = false where is_default and id <> 1;
update public.point_seasons set is_default = true  where id = 1;
