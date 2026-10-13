-- One-time bulk credit: migrate every waitlist signup's CURRENT pending balance
-- (welcome + referrals + completed X tasks) into Season 1 now, instead of waiting
-- for each wallet to transact on Arc mainnet.
--
-- WHY NOW, NOT ONLY AT ACTIVATION
--
-- The activation reader (src/app/api/waitlist/activate) credits a wallet only once
-- it has transacted on Arc mainnet — a strong sybil gate. But Arc mainnet is brand
-- new, so almost no signup has activated yet and the Season 1 board reads empty
-- during the launch window. Product decision (2026-09-16): credit the promised
-- balances now so users see them in the dapp and the board reflects real traction.
--
-- This is safe because Season 1 is convertsToTokens = false: crediting puts points
-- on the board and in balances but hands out NO allocation. Nothing becomes
-- claimable KLD until the season is frozen with a supply budget, and THAT freeze is
-- where sybil filtering happens (sybil_flag + point_conversion_violations).
--
-- THE GUARDRAIL — DO NOT LOSE THIS
--
-- This deliberately does NOT stamp waitlist.activated_at. activated_at stays the
-- marker of a wallet that has PROVEN real Arc-mainnet activity (the activation cron
-- keeps stamping it as wallets transact). So at freeze time, a wallet credited here
-- whose activated_at is still NULL is a credit not yet backed by on-chain activity —
-- exactly the set to scrutinise / sybil_flag before any conversion. Never freeze
-- Season 1 for TGE without excluding un-activated, farmed wallets.
--
-- IDEMPOTENT
--
-- One point_actions row per wallet, tx_hash = 'waitlist:<wallet>', under the unique
-- (chain_id, tx_hash). ON CONFLICT DO NOTHING, so:
--   * wallets the cron already credited (real activation) are untouched;
--   * re-running catches signups added since, without double-crediting anyone.
-- Points are snapshotted at first credit — a later top-up as referrals / X tasks
-- grow is the same deliberate follow-up the activation reader already defers.
--
-- The maths mirror api/waitlist/activate exactly: welcome_points + capped referral
-- bonus (50 each, cap 5000, counting only X-linked referees via waitlist_leaderboard)
-- + X-task points (link/follow/retweet 100 each, comment 50). The Phase-1
-- materializer trigger on point_actions folds each credit into point_balances, so
-- the Season 1 leaderboard populates as these rows land.

insert into public.point_actions
  (wallet, source_slug, season, tx_hash, chain_id,
   usd_value, multiplier_applied, points, is_agent_initiated, occurred_at)
select
  w.wallet,
  'waitlist',
  1,
  'waitlist:' || w.wallet,
  5042,
  0,
  1.0,
  w.welcome_points
    + least(50 * coalesce(lb.referrals, 0), 5000)
    + (case when w.x_linked_at    is not null then 100 else 0 end)
    + (case when w.x_followed_at  is not null then 100 else 0 end)
    + (case when w.x_retweeted_at is not null then 100 else 0 end)
    + (case when w.x_commented_at is not null then 50  else 0 end),
  false,
  now()
from public.waitlist w
left join public.waitlist_leaderboard lb on lb.wallet = w.wallet
on conflict (chain_id, tx_hash) do nothing;
