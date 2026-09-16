-- Scale Season 1 point earn-rates (and their point-denominated caps) ×10.
--
-- Why: pre-TGE Arc waitlist balances migrate into Season 1 at FACE VALUE — a
-- user's 100 stays 100 (a 10× drop on migration would flood support). The app's
-- original scale was ~1 point per $1 of activity (accrual.ts: points = usdValue ×
-- rate), so waitlist points sat ~10× hotter. Rather than shrink the waitlist, we
-- scale the protocol side up to meet it: a $10 swap now earns 100 points (was 10).
--
-- This is a UNIFORM ×10, so every relative weight is unchanged — LP still leads,
-- collateral_backing is still 0 (anti-recursion), the lend/borrow spread is intact
-- — and TGE conversion normalises absolute scale anyway. Only points-per-dollar
-- moves. USD floors (min_usd) and the agent multiplier (1.2) are ratios/dollars,
-- not points, so they are untouched. daily_cap_pts scales with rate so the per-day
-- DOLLAR ceiling is preserved.
--
-- Explicit absolute values (not `rate * 10`) so re-running is idempotent — a
-- double-apply cannot compound to ×100. Season 0 (testnet rehearsal) is left as-is.
-- referral.rate is 0 (its points are credited outside this table); only its cap
-- moves, for consistency.

-- Time-weighted
update public.point_source_rates set rate = 15   where source_slug = 'lp'              and season = 1;
update public.point_source_rates set rate = 10   where source_slug = 'stake'           and season = 1;
update public.point_source_rates set rate = 10   where source_slug = 'vault'           and season = 1;
update public.point_source_rates set rate = 10   where source_slug = 'lend'            and season = 1;
update public.point_source_rates set rate = 4    where source_slug = 'borrow'          and season = 1;
update public.point_source_rates set rate = 2.5  where source_slug = 'collateral_idle' and season = 1;

-- Action-weighted (rate + point-denominated daily cap both ×10)
update public.point_source_rates set rate = 10, daily_cap_pts = 500000 where source_slug = 'swap'        and season = 1;
update public.point_source_rates set rate = 10, daily_cap_pts = 300000 where source_slug = 'agent_swap'  and season = 1;
update public.point_source_rates set rate = 5,  daily_cap_pts = 100000 where source_slug = 'stable_mint' and season = 1;
update public.point_source_rates set rate = 0,  daily_cap_pts = 50000  where source_slug = 'referral'    and season = 1;
