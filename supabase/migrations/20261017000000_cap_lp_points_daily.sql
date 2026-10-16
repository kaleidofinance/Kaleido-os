-- Cap Season 1 LP accrual at 500 points per wallet per UTC day.
update public.point_source_rates
set daily_cap_pts = 500
where source_slug = 'lp' and season = 1;