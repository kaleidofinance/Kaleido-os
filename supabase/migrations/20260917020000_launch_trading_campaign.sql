-- Launch the trading campaign and reveal Season 1 balances on the leaderboard.
--
-- Operational state, seeded here the way the season defaults and rate updates
-- already are (20260916000000, 20260916010000): version-controlled and idempotent
-- so re-running is a no-op. END the campaign with
--   update public.point_campaigns set active = false where id = 'trading-launch';

-- 2× swap points for the launch window (open-ended until active=false / ends_at).
insert into public.point_campaigns (id, label, season, source_slug, multiplier, starts_at)
values ('trading-launch', 'Trading launch campaign', 1, 'swap', 2.0, now())
on conflict (id) do nothing;

-- Reveal point totals on the leaderboard. Season 1 seeded as 'rank_only' (pre-TGE
-- privacy); now that mainnet points are live and users want to see their balance,
-- show totals.
update public.point_seasons set disclosure = 'totals' where id = 1;
