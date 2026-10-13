-- Waitlist X (Twitter) tasks.
--
-- On top of welcome + referral, a waitlisted wallet can earn kPoint by linking an
-- X account and doing two social tasks (follow, retweet the announcement). Each
-- task is +100 kPoint. Tasks are ATTESTED, not API-verified: linking X is real
-- (OAuth proves the account), but follow/retweet are recorded when the user says
-- they did them. The sybil backstop is unchanged — none of this converts to
-- Season 1 until the wallet acts on Arc mainnet (see 20260914020000) — plus a
-- short display hold on the app side nudges people to actually do the task.
--
-- x_user_id is UNIQUE: one X account can enrich at most one wallet, so linking is
-- not a free per-wallet faucet.

alter table public.waitlist
  add column if not exists x_user_id    text,
  add column if not exists x_handle     text,
  add column if not exists x_linked_at  timestamptz,
  add column if not exists x_followed_at  timestamptz,
  add column if not exists x_retweeted_at timestamptz;

-- One X account links to one wallet. Partial so many nulls (not-yet-linked) are
-- allowed while linked ids stay unique.
create unique index if not exists waitlist_x_user_id_key
  on public.waitlist (x_user_id)
  where x_user_id is not null;
