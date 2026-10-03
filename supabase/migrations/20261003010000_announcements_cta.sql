-- Announcement call-to-action label: the button on the notification row that
-- opens `url` (e.g. "Check in"). Null → the app shows "Open".
begin;
alter table public.announcements
  add column if not exists cta text check (cta is null or length(cta) between 1 and 24);
commit;
