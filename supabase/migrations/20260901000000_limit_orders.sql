-- Signed limit / recurring orders for /trade/limit.
--
-- WHAT THIS TABLE IS, AND WHAT IT IS NOT.
-- It is a delivery mechanism, not a ledger. The authority for every order lives
-- on chain in KaleidoOrders: the maker's signature authorises the fill, the
-- contract's own `stateOf(hash)` counts the fills, and `epochOf(maker)` decides
-- whether a signature is still live. This table exists so a keeper that was not
-- running when the order was signed can find it — nothing more.
--
-- Two consequences worth being explicit about, because both are counter-intuitive
-- for a table that looks like an order book:
--
--   1. Deleting a row does NOT cancel an order. The signature is still valid and
--      anyone who kept a copy can still fill it. Cancellation is `cancel(order)`
--      or `cancelAll()` on the contract, which is why /trade/limit sends a
--      transaction rather than a DELETE.
--   2. `status`, `fills` and `last_fill_at` are a cache the keeper reconciles.
--      They can be a cycle stale, and "cancelled" in particular can be true on
--      chain while this table still says open. The UI reads status live from
--      `checkFill` and uses these columns only to sort and to render history.
--
-- WHY READS ARE PUBLIC AND WRITES ARE NOT.
-- An order book has to be public to be fillable by anyone — that is the property
-- that makes third-party filling possible at all, and none of the columns are
-- secret: every one of them is an argument to a public function on a public
-- chain. Writes go through /api/orders with the service role, which recomputes
-- the digest from the fields and verifies the signature before storing. Without
-- that, the anon key — which ships inside the JS bundle — would let anyone fill
-- the table with unfillable rows in other people's names and bury the real ones.
--
-- WHY EVERY UINT256 IS `text`.
-- PostgREST serialises `numeric` as an unquoted JSON number, so a 256-bit value
-- round-trips through JSON rounded. A rounded `min_out` or `salt` re-hashes to a
-- different digest, which is an order that signs, stores, lists — and can never
-- be filled, with nothing anywhere to say why. `text` with a digits-only check
-- is the only shape that survives the wire intact. Same reason the app layer
-- carries these fields as decimal strings end to end.

create table if not exists public.kaleido_limit_orders (
  -- `hashOrder(order)` — the EIP-712 digest. The contract's own state key, so
  -- using it here means the two tables agree on what "the same order" means.
  -- Recomputed server-side from the fields; never taken from the client, since a
  -- client-supplied hash is a client-supplied primary key.
  order_hash    text primary key,

  -- Which chain's KaleidoOrders this was signed against. Part of the digest, so
  -- an order is not portable: the same maker, pair and amount on another chain is
  -- a different order. Indexed with maker because that pair is every query.
  chain_id      integer not null,
  -- The `verifyingContract`. Stored rather than derived from chain_id so a row
  -- outlives a redeploy legibly: after one, the old rows still say which contract
  -- they belong to instead of appearing to belong to the new one.
  orders        text not null,

  -- Lowercased, because a checksummed address and its lowercase form are the
  -- same wallet and an index cannot know that. The signed `order_json.maker`
  -- keeps its checksum — that one is part of the digest only as 20 bytes, but
  -- round-tripping it unchanged is what lets the digest be recomputed.
  maker         text not null,
  token_in      text not null,
  token_out     text not null,

  -- Base units, per fill. Not the total: a recurring order spends amount_in on
  -- each of its max_fills fills.
  amount_in     text not null,
  -- The worst output the maker accepts per fill — the price bound and the fill
  -- trigger in one value. Never zero; the contract refuses that, because a zero
  -- floor lets a filler move the price, fill, and move it back.
  min_out       text not null,

  start_at      bigint not null,
  expiry        bigint not null,
  -- Seconds between fills; 0 for a one-shot limit order.
  interval_secs bigint not null,
  -- 1 for a limit order, n for a recurring buy. The only two fields that
  -- distinguish the products.
  max_fills     integer not null,
  -- The maker's epoch at signing time. A `cancelAll()` bumps the on-chain epoch
  -- and every row carrying an older one is dead — which is why the keeper filters
  -- on this rather than assuming a row is live.
  epoch         bigint not null,
  salt          text not null,

  -- The maker's EIP-712 signature. An EOA's 65 bytes, or whatever a contract
  -- wallet validates through ERC-1271 — the second is not optional, since in-app
  -- email and social wallets are smart accounts and do not sign with a
  -- recoverable key.
  signature     text not null,
  -- True when the signature could not be checked without an RPC call (a contract
  -- wallet's). Recorded rather than rejected: the keeper's `checkFill` resolves
  -- it against the chain, and refusing these at the door would lock out every
  -- smart-account maker.
  sig_unverified boolean not null default false,

  -- The exact object that was signed, so the digest can be recomputed and the
  -- order can be handed to `fill` without reassembling it from columns. The
  -- columns above are for querying; this is the source of truth for the bytes.
  order_json    jsonb not null,

  -- The keeper's reconciliation. 'open' until the chain says otherwise.
  status        text not null default 'open'
                  check (status in ('open', 'filled', 'cancelled', 'expired')),
  fills         integer not null default 0,
  last_fill_at  bigint,
  created_at    timestamptz not null default now(),
  reconciled_at timestamptz,

  -- The shape checks. These mirror KaleidoOrders' `_shapeValid`, and they are
  -- here as well as in the app layer because an order that fails any of them
  -- signs cleanly and can never fill: it would sit in the list forever looking
  -- pending. Cheaper to refuse the row than to explain it later.
  constraint kaleido_limit_orders_amounts_numeric
    check (amount_in ~ '^[0-9]+$' and min_out ~ '^[0-9]+$' and salt ~ '^[0-9]+$'),
  constraint kaleido_limit_orders_amounts_positive
    check (amount_in <> '0' and min_out <> '0'),
  constraint kaleido_limit_orders_window
    check (expiry > start_at),
  constraint kaleido_limit_orders_fills
    check (max_fills >= 1 and fills >= 0 and fills <= max_fills),
  -- interval = 0 with max_fills > 1 is the one combination the contract rejects
  -- outright, and it is what a form produces when the recurrence control is
  -- cleared without clearing the count.
  constraint kaleido_limit_orders_recurrence
    check ((max_fills = 1 and interval_secs = 0) or (max_fills > 1 and interval_secs > 0)),
  constraint kaleido_limit_orders_pair
    check (token_in <> token_out)
);

-- The list on /trade/limit: one wallet, one chain, newest first.
create index if not exists kaleido_limit_orders_maker_idx
  on public.kaleido_limit_orders (maker, chain_id, created_at desc);

-- The keeper's sweep: everything still fillable on a chain, oldest first so a
-- long-standing order is not starved by newer ones.
create index if not exists kaleido_limit_orders_open_idx
  on public.kaleido_limit_orders (chain_id, status, expiry)
  where status = 'open';

alter table public.kaleido_limit_orders enable row level security;

-- Wipe any permissive policy a dashboard click may have left.
drop policy if exists "anon insert" on public.kaleido_limit_orders;
drop policy if exists "public insert" on public.kaleido_limit_orders;

-- Reads stay open: an order book that only its author can see cannot be filled
-- by anyone else, and every column is already an argument to a public function.
create policy "limit orders readable by anyone"
  on public.kaleido_limit_orders
  for select
  using (true);

-- No INSERT/UPDATE/DELETE policy. With RLS on and no policy those are denied to
-- anon and authenticated; the service role bypasses RLS, so /api/orders and the
-- keeper are unaffected. Belt and braces on top, because a future dashboard
-- policy would otherwise silently re-open them.
revoke insert, update, delete on public.kaleido_limit_orders from anon;
revoke insert, update, delete on public.kaleido_limit_orders from authenticated;

comment on table public.kaleido_limit_orders is
  'Signed KaleidoOrders orders, so a keeper can find them. Delivery, not authority: deleting a row does not cancel an order — only cancel()/cancelAll() on chain does.';
comment on column public.kaleido_limit_orders.min_out is
  'Base units of token_out accepted per fill. The price bound and the trigger. Text, not numeric: PostgREST would round it through JSON and a rounded floor re-hashes to a different digest.';
comment on column public.kaleido_limit_orders.status is
  'Keeper cache, up to one cycle stale. The chain answers via stateOf(order_hash) and epochOf(maker).';
