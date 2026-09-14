-- Arc pre-mainnet waitlist.
--
-- WHAT THIS IS AND, MORE IMPORTANTLY, WHAT IT IS NOT.
--
-- This captures wallet registrations and referrals for the Arc launch push. The
-- points it tracks are PENDING and live only in this table. They are deliberately
-- NOT written into point_balances / the Season 1 ledger, because that ledger is
-- the one users expect to convert to tokens, and a free "connect a wallet, get
-- 100 points" faucet open to anyone is a sybil magnet that would dilute genuine
-- earners and trip point_conversion_violations. See 20260801000100_points_system
-- for why nothing there is ever free or client-written.
--
-- The bridge is `activated_at`: a wallet's welcome + referral points are meant to
-- be credited into Season 1 (via the existing service-role points path) ONLY when
-- that wallet performs its first genuine Kaleido action on Arc mainnet. Until then
-- they are a number on a page, not an allocation. That crediting is a follow-up
-- owned by the points indexer; this migration only stores what it needs.

create table if not exists public.waitlist (
  -- Lowercased EVM address. The API verifies a signature from it before insert,
  -- so a row here means the wallet holder actually asked to join.
  wallet         text        primary key,
  -- The referrer's share code, handed out in kaleidofi.xyz/waitlist?ref=CODE.
  ref_code       text        unique not null,
  -- Whose code brought them, by ref_code. Null for organic signups. Set-null on a
  -- (never-expected) referrer delete rather than cascading the referee away.
  referred_by    text        references public.waitlist(ref_code) on delete set null,
  welcome_points numeric     not null default 100,
  -- Null = pending. Stamped when the wallet's points are credited into Season 1.
  activated_at   timestamptz,
  created_at     timestamptz not null default now(),
  -- A wallet cannot refer itself.
  check (referred_by is null or referred_by <> ref_code)
);

create index if not exists waitlist_referred_by_idx on public.waitlist (referred_by);

-- Referral standings. Rank + count only; the wallet address is already public.
-- Pending point maths (welcome + per-referral, capped) is done in the API from
-- these counts, not stored, so the reward curve can be tuned without a migration.
create or replace view public.waitlist_leaderboard as
select
  w.wallet,
  w.ref_code,
  count(r.wallet)                                   as referrals,
  rank() over (order by count(r.wallet) desc)       as rank
from public.waitlist w
left join public.waitlist r on r.referred_by = w.ref_code
group by w.wallet, w.ref_code;

-- Same posture as the points tables: service role writes and reads, nothing else.
-- Every browser read goes through a route handler on the service-role client, so
-- the raw table needs no public policy and gets none.
alter table public.waitlist enable row level security;

revoke insert, update, delete, select on public.waitlist from anon, authenticated;
