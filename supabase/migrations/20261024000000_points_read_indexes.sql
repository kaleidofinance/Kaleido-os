-- Keep the leaderboard's grouped volume leg and wallet rewards reads index-backed.
create index if not exists point_actions_season_wallet_usd_idx
  on public.point_actions (season, wallet)
  include (usd_value);

create index if not exists point_actions_wallet_season_idx
  on public.point_actions (wallet, season);
