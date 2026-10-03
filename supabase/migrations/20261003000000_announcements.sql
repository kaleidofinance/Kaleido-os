-- Product-update announcements (src/app/api/announcements). Each row becomes a
-- "product update" in every visitor's notification panel, delivered once per
-- browser. Post with `node scripts/announce.mjs "Title" "Body" [url]`.
begin;

create table if not exists public.announcements (
  id           bigserial   primary key,
  title        text        not null check (length(title) between 1 and 120),
  body         text        not null check (length(body) between 1 and 500),
  url          text,
  published_at timestamptz not null default now(),
  active       boolean     not null default true
);

create index if not exists announcements_published_idx
  on public.announcements (published_at desc);

-- Served through the API with the service role; no direct client access.
alter table public.announcements enable row level security;
revoke all on table public.announcements from public, anon, authenticated;

commit;
