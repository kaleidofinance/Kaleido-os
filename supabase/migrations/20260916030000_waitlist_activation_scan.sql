-- Rotating activation scan: let the reader reach the whole pending backlog.
--
-- The activation reader (src/app/api/waitlist/activate) selects the oldest
-- not-yet-activated waitlist rows and stamps only the ones that have transacted
-- on Arc mainnet. With plain oldest-first ordering, unqualified wallets at the
-- FRONT of the queue are re-selected on every run and the scan never reaches
-- deeper — a wallet that DID transact but sits behind a wall of not-yet-active
-- older signups waits for all of them to activate first. For a backlog of
-- thousands that is effectively a stall.
--
-- last_checked_at fixes it: the reader stamps every wallet it probes (active or
-- not), and orders by last_checked_at (nulls first, then created_at), so each
-- run picks the LEAST-recently-checked wallets and the scan rotates through the
-- entire pending set. Activated wallets leave the set via activated_at and are
-- unaffected by this column.
alter table public.waitlist
  add column if not exists last_checked_at timestamptz;

comment on column public.waitlist.last_checked_at is
  'When the activation reader last probed this wallet on Arc mainnet (any outcome). Drives the rotating scan order so the whole pending backlog is reached; see src/app/api/waitlist/activate.';

-- Matches the reader's scan predicate + order exactly: only pending rows,
-- least-recently-checked first. Partial, so it stays small as the backlog
-- activates out of the pending set.
create index if not exists waitlist_activation_scan_idx
  on public.waitlist (last_checked_at asc nulls first, created_at asc)
  where activated_at is null;
