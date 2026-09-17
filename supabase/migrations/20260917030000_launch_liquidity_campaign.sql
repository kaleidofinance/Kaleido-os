-- Launch the liquidity-provider campaign: 10× on the time-based `lp` source.
--
-- Deliberately higher than the 2× trading campaign — the goal is to pull
-- liquidity into the Arc pools. `lp` is time-weighted (points per USD held
-- in-range per day), so this boosts every day a wallet keeps liquidity in range,
-- not a one-off. Idempotent (on conflict do nothing); END it with
--   update public.point_campaigns set active = false where id = 'liquidity-launch';

insert into public.point_campaigns (id, label, season, source_slug, multiplier, starts_at)
values ('liquidity-launch', 'Liquidity provider campaign', 1, 'lp', 10.0, now())
on conflict (id) do nothing;
