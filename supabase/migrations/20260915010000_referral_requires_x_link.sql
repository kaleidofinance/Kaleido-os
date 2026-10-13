-- Referral rewards require the referred user to link their X account.
--
-- Wallets are free to create, so counting a referral the moment a referred wallet
-- registers let one person farm the 50-kPoint-per-referral bonus with throwaway
-- keypairs. Linking X is the sybil backstop: x_user_id is UNIQUE (one X account
-- enriches one wallet — see 20260914030000), so requiring the referee to link X
-- makes a fake referral cost a fresh X account, not a fresh keypair.
--
-- The referral count lives only in this view, and both the displayed count and
-- the credited referral points (api/waitlist/route.ts and api/waitlist/activate)
-- read from it — so gating the join here gates the reward everywhere. A referee
-- who links X later is counted automatically (the view is live), so this defers
-- the reward, it does not permanently forfeit it. Only the join condition
-- changes; the column list and types are identical, so create-or-replace is safe.
create or replace view public.waitlist_leaderboard as
select
  w.wallet,
  w.ref_code,
  count(r.wallet)                             as referrals,
  rank() over (order by count(r.wallet) desc) as rank
from public.waitlist w
left join public.waitlist r
  on r.referred_by = w.ref_code
  and r.x_linked_at is not null
group by w.wallet, w.ref_code;
