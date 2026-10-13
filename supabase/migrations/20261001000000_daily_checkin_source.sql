-- Daily check-in: +10 $kPoint once per UTC day (src/app/api/rewards/checkin).
-- Points are set explicitly on each action row, like 'waitlist'; the once-a-day
-- rule is the existing unique (chain_id, tx_hash) on point_actions.
begin;

insert into public.point_sources (slug, label, kind, product, enabled, notes) values
  ('checkin', 'Daily check-in', 'action', 'social', true,
   '+10 per UTC day per wallet with a Season 1 balance. tx_hash = checkin:<wallet>:<YYYY-MM-DD>.')
on conflict (slug) do nothing;

commit;
