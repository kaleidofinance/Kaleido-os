# Kaleido Points — pre-TGE design

Status: **schema and arithmetic built; runtime not.** See §11 for what exists,
what is missing, and the build order.

The goal is a points program that converts to an airdrop allocation at TGE and
survives contact with professional farmers. This document is the spec the
implementation should be written against.

---

## 1. Why the current system can't ship

A points system already existed, spread across
`useGetValueAndHealth.ts` (the total) and `logProtocolActivity.ts` (the
indexer). Six inputs fed it: referrals, marketplace, LP, AI, staking, swaps.
**Three of the six were forgeable and none were time-weighted.**

Past tense as of 2026-08-18: both halves are now deleted, and the table below is
kept as the reason rather than as a description of live code. See the status note
after it for what replaced each row.

| #   | Problem                                                                       | Where                     | Consequence                                                                                                                                    |
| --- | ----------------------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Points are inserted by the **browser** using the `NEXT_PUBLIC` anon key       | `logProtocolActivity.ts`  | If RLS does not block INSERT on `kaleido_protocol_activity`, anyone can mint themselves unlimited points. **Verify RLS before anything else.** |
| 2   | `amountInUsd` is not USD — it is `parseFloat(amountIn)`, the raw token amount | `useSwapRouter.ts:166`    | A 1,000 USDC swap scores 1,000; a 0.5 ETH swap (~$1,500) scores 0.5. Weighting is inverted against valuable assets.                            |
| 3   | AI points count `kaleido_conversation_*` keys in **localStorage**             | `useGetValueAndHealth.ts` | Write a fake object in devtools, collect the cap.                                                                                              |
| 4   | LP points = `positionCount × 250` (current NFT balance)                       | `useGetValueAndHealth.ts` | Count, not value, and instantaneous. Ten dust positions beat one deep one.                                                                     |
| 5   | Stake points = `currentStake × 10` (current balance)                          | `useGetValueAndHealth.ts` | Stake the day before snapshot, score the same as six months of loyalty.                                                                        |
| 6   | The total is computed **client-side** for display                             | `useGetValueAndHealth.ts` | The number a user sees is not authoritative and cannot be reconciled.                                                                          |

**Status.** All six rows are closed, and **every file named in the "Where"
column above has since been deleted** — so read that column as a citation into
git history, not as a path.

Rows 1–2 went first: the browser insert was disabled, and its `points_earned`
write and the `parseFloat(amountIn)` that fed it were removed. Rows 3–6 were
closed on 2026-08-18 by deleting the client-side total outright — the 70-line
block in `useGetValueAndHealth.ts`, the `referralPointAtom` it wrote to, and the
`getActivityPoints` helper it read from. Rows 3–5 are all count-not-value
metrics whose formulas exist nowhere in `point_source_rates`; row 6 is not a bug
in the arithmetic but in the location, which is why none of it could be repaired
in place. `useGetValueAndHealth.ts` and `constants/atom.ts` each carry a comment
where their piece used to be. `logProtocolActivity.ts` does not, because a
later dead-code sweep removed the file once its last caller
(`useSwapRouter.ts`, row 2's location) was itself deleted — the surviving
account of that write is this section plus the header of
`20260801000000_lock_activity_writes.sql`, which locked the table it targeted.

What replaces all of it is `point_leaderboard`, read through `/api/leaderboard`
and `/api/leaderboard/me`.

Problems 4 and 5 were the same structural flaw and the most damaging one: the
program rewarded a _snapshot_, not a _history_. Time-weighted accrual is the
primary defense against last-minute farming — six months of ordinary usage
should beat six days of intensive farming. Nothing computes either metric today;
§3a is how they come back.

---

## 2. Principles

1. **The client never writes points, and never computes them.** It reads a
   server-computed balance. Every write is service-role.
2. **Every action point is anchored to a transaction hash the server verified
   itself**, by fetching the receipt and decoding the logs. Client-supplied
   amounts are treated as a hint, never as truth.
3. **Passive capital accrues over time**, in `usd-seconds`, not on snapshot.
4. **One oracle.** Value everything with the Diamond's own
   `getUsdValue(token, amount, decimals)` — the same source the protocol trusts
   to price collateral. Points and liquidations should never disagree.
5. **Epochs are immutable and append-only.** Balances are derived. A bug is
   fixed by writing a correcting epoch, never by mutating history — a points
   program whose past can be edited has no credibility.

---

## 3. Hybrid accrual model

### 3a. Time-weighted — passive capital

Accrues continuously while capital is at risk. This is the majority of the
allocation and it is what loyalty actually means.

| Source               | Measured as                              | Rate      | Read from                                    |
| -------------------- | ---------------------------------------- | --------- | -------------------------------------------- |
| `stake`              | staked KLD, USD-valued                   | 1.0×      | KLD vault `getUserDeposit`                   |
| `lp`                 | V3 position value, **in-range only**     | 1.5×      | position manager + pool `slot0`              |
| `vault`              | kafUSD vault deposit                     | 1.0×      | stablecoin vault                             |
| `lend`               | capital lent out on serviced loans       | **1.0×**  | `kaleido_requests` where `status = SERVICED` |
| `borrow`             | outstanding principal, interest accruing | **0.4×**  | Diamond active requests                      |
| `collateral_idle`    | collateral **not** backing a live loan   | **0.25×** | Diamond `gets_addressToCollateralDeposited`  |
| `collateral_backing` | collateral backing a live loan           | **0×**    | — paid via the `borrow` leg                  |

#### Why lending and borrowing are not paid equally

The deciding factor is not risk appetite, it is **recursion**. If collateral
earns and borrowing also earns at full rate, one capital commitment is paid
twice — and the borrowed asset can be redeposited or swapped to be paid a third
time. That is a farming loop, and it is how COMP was mined in 2020: it
manufactured fake TVL and real bad debt, on positions the protocol then had to
liquidate.

Two rules close it:

1. **Collateral backing a live loan earns nothing on its own.** The `borrow`
   leg is the payment for that capital. Only genuinely idle collateral accrues,
   and at a low rate, because pre-positioning is mildly useful but unproductive.
2. **Borrowing accrues well below lending.** Borrowing must earn _something_ —
   this is a P2P order book, not a pool, so a match needs both sides and a book
   with no borrowers is dead. But on an isolated loan the lender carries the
   residual credit risk while the borrower holds what amounts to an option to
   walk away from their collateral. Pay the party holding the risk more.

If a loop still looks profitable at these rates, the borrow rate is too high.
Sanity-check it against the interest actually paid: points earned on a borrow
should never exceed the interest cost of holding it.

Accrual for one wallet, one source, one epoch:

```
usd_seconds  = usd_value_at_snapshot × (epoch_end − epoch_start)
points       = usd_seconds × RATE[source] / 86400
```

`RATE` is expressed as **points per USD per day**, so it reads plainly:
`RATE.lp = 1.5` means a dollar of in-range liquidity earns 1.5 points a day.

Two deliberate choices:

- **In-range liquidity only.** An out-of-range V3 position is not providing
  usable depth. Paying for it invites parking liquidity where it does nothing.
- **Lent capital, not posted offers.** An unfilled offer costs nothing to post.

### 3b. Action-weighted — one-off events

Capped, deduplicated by `tx_hash`, and only credited after server verification.

| Action                                | Points            | Cap                           |
| ------------------------------------- | ----------------- | ----------------------------- |
| Swap                                  | `usd_value × 1.0` | per-epoch cap per wallet      |
| Agent-initiated swap                  | `usd_value × 1.2` | shares the swap cap           |
| Take/fund a loan                      | `usd_value × 1.0` | per-epoch cap                 |
| Referral (referee stays active ≥ 30d) | flat              | hard cap on referrals counted |
| First swap / first LP / first loan    | flat, once ever   | one per wallet                |

The 1.2× agent multiplier already exists in `logProtocolActivity.ts` and is
worth keeping — it is the cheapest way to push users toward Luca.

**Referrals only count once the referee has been active for 30 days.** Instant
referral credit is the single most farmed mechanic in every points program.

### 3c. Split

Target roughly **70% time-weighted / 30% action-weighted** of total emissions.
Tune before launch, publish, then do not change mid-season without a new
season.

---

## 4. Schema

```sql
-- Immutable balance observations. One row per wallet per source per snapshot.
create table point_snapshots (
  id            bigserial primary key,
  wallet        text        not null,
  source        text        not null,   -- stake | lp | collateral | vault | lend
  usd_value     numeric     not null,
  block_number  bigint      not null,
  taken_at      timestamptz not null,
  unique (wallet, source, block_number)
);

-- Derived, append-only accrual. Never updated in place.
create table point_epochs (
  id           bigserial primary key,
  wallet       text        not null,
  source       text        not null,
  epoch_start  timestamptz not null,
  epoch_end    timestamptz not null,
  usd_seconds  numeric     not null,
  points       numeric     not null,
  season       int         not null default 1,
  created_at   timestamptz not null default now(),
  unique (wallet, source, epoch_start)
);

-- One-off actions. tx_hash unique is the whole anti-replay story.
create table point_actions (
  id           bigserial primary key,
  wallet       text        not null,
  tx_hash      text        not null unique,
  action_type  text        not null,
  usd_value    numeric     not null,   -- server-derived, never client-supplied
  multiplier   numeric     not null default 1.0,
  points       numeric     not null,
  season       int         not null default 1,
  occurred_at  timestamptz not null,
  verified_at  timestamptz not null    -- null is not allowed: unverified never counts
);

-- Materialized total the UI reads.
create table point_balances (
  wallet        text primary key,
  time_points   numeric not null default 0,
  action_points numeric not null default 0,
  total         numeric not null default 0,
  sybil_flag    text,                  -- null = clean
  season        int     not null default 1,
  updated_at    timestamptz not null default now()
);
```

RLS on all four: **service-role write, public read.** `point_balances` and a
leaderboard view are the only things the anon key should ever touch, and only
for `SELECT`.

---

## 5. Anti-sybil

Layered, because no single rule survives a determined farmer.

1. **Activation threshold.** A wallet earns nothing until it crosses a minimum
   (the existing `MIN_KLD_STAKE` idea, raised and applied to USD value, not KLD
   count). Points accrue but stay locked until activation, so the threshold
   does not punish someone who grows into it.
2. **Per-epoch per-wallet caps** on action points. Bounds the value of any
   single compromised path.
3. **48-hour rule.** Flag wallets whose entire on-chain history falls inside a
   48-hour window near a snapshot.
4. **Funding-graph clustering.** Flag wallets funded by a common address, or
   that sweep to one. This catches the majority of low-effort farms.
5. **Flag, don't delete.** Set `sybil_flag` and exclude from conversion.
   Deleting history destroys the audit trail and every appeal becomes
   unfalsifiable.

Publish the rules _before_ the season starts. Retroactive sybil rules are the
fastest way to lose a community.

---

## 6. Conversion at TGE

- Community allocation: **10% of supply is standard, 20–30% is generous.**
- Allocation is **pro-rata on point share**, per season.
- Early-season multiplier is normal and expected — decide it up front and
  publish it.
- Freeze accrual at a stated block, publish the full point table, and allow a
  dispute window before tokens move.

---

## 7. Migration from what exists

1. **Verify RLS on `kaleido_protocol_activity` right now.** Everything else is
   secondary to whether points are currently mintable.

   **Done** — `20260801000000_lock_activity_writes.sql` revokes the anon INSERT.
   The browser-side writer is gone too (§1 status note), but the migration is
   the part that matters: the anon key and project URL both ship in the client
   bundle, so the endpoint was reachable without going through the writer at
   all, and deleting the caller would not have closed it.

2. Fix `amountInUsd` at the source — value with `getUsdValue`, server-side.
   Until then, historical rows in `kaleido_protocol_activity` are denominated
   in mixed units and **cannot be migrated as-is**.
3. Drop the localStorage AI metric. If agent usage should score, it scores via
   `is_agent_initiated` on a verified swap — an on-chain fact.

   **Done 2026-08-18**, as part of deleting the client-side total (§1 status
   note). Nothing reads `kaleido_conversation_*` for points any more. The
   replacement is not yet built: `is_agent_initiated` exists as a column on
   `point_actions` (`20260801000100_points_system.sql:183`), but nothing writes
   it. The client helper that used to carry the flag as a parameter was deleted
   along with its last caller, and the server ingest route that should set it
   does not exist yet — so agent usage currently scores nothing, which is the
   intended interim state rather than a regression: scoring nothing is
   recoverable, scoring forgeably is not.

4. Treat existing `kaleido_protocol_activity` as **Season 0**: a record of
   participation, not a points balance. Awarding a flat, capped Season 0 bonus
   for having used the protocol is defensible; carrying the raw numbers over is
   not, because they are unverified and mis-denominated.

   Implemented by `20260818000000_season0_participation_seed.sql`, which settles
   the two things "flat, capped" leaves open:
   - **100 points per surface participated in, three surfaces, so 300 is the
     ceiling.** Flat means a wallet cannot earn more by having done more — the
     counts in these tables are not evidence of size, and on a testnet a fifth
     listing costs nothing. For scale, 300 points is $300 of Season 1 swap
     volume: enough to acknowledge an early user, never enough to outrank one.
   - **Credit lands in a new `point_balances.bonus_points` column**, not in
     `action_points`. That column means "backed by rows in `point_actions`",
     this credit has none, and the first real accrual run for Season 0 would
     recompute the column and erase the bonus without a trace. `total` now
     carries a CHECK that it equals the sum of all three components, so a writer
     that forgets one fails instead of drifting.
   - **A wallet whose only evidence is `kaleido_protocol_activity` is credited
     and then `sybil_flag`-marked** (`season0_activity_unverified`). That table
     was browser-written with the anon key, so it is forgeable as a _set_, not
     just in its values: ten thousand generated keypairs would be ten thousand
     participation bonuses. Flagging rather than excluding keeps the credit
     recorded and appealable while `point_leaderboard` leaves it out and
     conversion cannot reach it. Wallets in `kaleido_listings.sender` or
     `kaleido_requests.author` are unflagged — appearing there cost gas.

5. ~~Point `getActivityPoints` at `point_balances`~~, and delete the client-side
   total in `useGetValueAndHealth`. **Both done, but the first half was done
   differently to how it is written here, and the plan as written is not
   achievable.**

   `getActivityPoints` was **deleted rather than repointed**.
   `20260817000000_leaderboard_disclosure.sql` revoked anon access to
   `point_balances` in order to make raw balances unreadable from a browser, so
   a client-side function that reads that table cannot exist — repointing it
   would only have moved the read to a table that now rejects it. This item was
   written before that migration and the two contradict each other; the
   migration is the one that holds, because it is §2 principle 1 in SQL.

   The browser's read path is `point_leaderboard` — the masked view — through
   `/api/leaderboard` for the board and `/api/leaderboard/me` for a wallet's own
   row. Both apply the season's disclosure tier server-side (§8), which is the
   property no client-side sum over a raw table could have had.

   The client-side total is gone with it: see the §1 status note for the three
   identifiers removed and where each is documented.

---

## 8. Leaderboard disclosure

Three tiers, tightening privacy without losing the competitive pull that makes
a leaderboard a growth lever in the first place.

| Audience                   | Sees                                          |
| -------------------------- | --------------------------------------------- |
| Public, during season      | Top N by **rank and point total only**        |
| Any user, about themselves | Their own exact rank and points               |
| Public long tail           | **Percentile** — "top 12%", not "#4,832"      |
| Everyone, at TGE freeze    | The **complete table**, for audit and dispute |

**Never publish USD position sizes.** A public wallet-to-balance map is a
phishing and MEV target list, and it advertises how concentrated the protocol
is.

Exact per-wallet points stay private _during_ the season because publishing
them hands farmers a targeting function: if the wallet at rank 50 visibly holds
48,000 points, everyone knows exactly how much to deposit to displace it. Rank
and percentile preserve the competition without publishing the threshold.

At the freeze that inverts — the allocation must be fully auditable and
disputable, so everything is published before any token moves.

---

## 9. Seasons continue after TGE

TGE is the end of Season 1, not the end of the program. Multi-season is the
dominant model in 2026 — Backpack is on Season 4 with 25% of supply committed
to the community, and Apyx raised its Season 2 budget to 6% of supply from 4%
in Season 1. Points remain the acquisition channel indefinitely.

One structural thing changes the moment the token trades, and the conversion
mechanic has to account for it.

### Post-TGE, points are priceable

Before TGE, points have no computable value — people farm on faith. After TGE
there is a market price, so anyone can derive "1 point ≈ $X" from the last
season's conversion and decide whether cost-to-farm beats expected payout.
Farming stops being speculation and becomes arbitrage, executed by people who
are much better at it than the average user.

### Fixed budget per season, pro-rata within it

**Publish a token budget per season. Never publish a points-to-token rate.**

| Mechanic                       | Behaviour under 10× expected participation                                |
| ------------------------------ | ------------------------------------------------------------------------- |
| Fixed rate (`1 pt = N tokens`) | Liability scales with farmers. You owe 10×. Unbounded and exploitable.    |
| **Fixed budget, pro-rata**     | Each point is worth 1/10th. Marginal farmers leave on their own. Bounded. |

The budget model self-regulates: heavy participation dilutes each point until
farming stops being profitable, and light participation concentrates it until
farming resumes. The budget is the lever between seasons — raise it to buy
growth, lower it to conserve supply — and it is adjusted _between_ seasons,
never inside one.

### Carve the multi-season allocation before TGE

This is the decision that cannot be deferred. If 10% of supply is allocated for
the TGE drop and seasons are planned afterward, there is nothing to distribute
by Season 3, and minting more is a governance fight. Commit the full
multi-season budget up front — Backpack's 25% is the whole program, not the
first drop.

Suggested shape, to be set by tokenomics rather than here:

- Season 1 / TGE drop: a defined slice
- Seasons 2–N: the remainder, on a published schedule
- The schedule is public from day one, so farmers can price it and loyal users
  can see the program has a future

### Eventually, fee revenue should fund it

Emissions-funded growth is borrowing from future holders. The healthy end state
replaces some of the seasonal token budget with real fee revenue, so incentives
are paid out of what the protocol earns rather than what it prints. Worth
naming as a direction now even if the switch is years out.

### What retains people is not the points

Points buy the first visit. Luca has to earn the second. A strong points
program pointed at a mediocre product just accelerates churn — it pays people
to discover that they do not want to stay. The agent needs to be genuinely good
_before_ the incentive brings volume, not after.

---

## 10. Still open

- Season length, and whether points carry across seasons or reset.
- Snapshot cadence: hourly is defensible, more frequent gets expensive fast.
- Whether the Season 0 bonus (§7) is flat per wallet or tiered by activity.

---

## 11. Implementation plan

Written after the contract rewrite, when Abstract was deprioritised and no
contracts were deployed anywhere. Two facts drive the whole ordering.

### 11a. Where things actually stand

| Layer                                                  | Where                                                  | Status |
| ------------------------------------------------------ | ------------------------------------------------------ | ------ |
| Spec                                                   | this document                                          | ✅     |
| Schema — 9 tables, 2 views, RLS closed, seeded         | `supabase/migrations/20260801000100_points_system.sql` | ✅     |
| Accrual arithmetic — pure, 20 tests                    | `src/lib/points/accrual.ts`                            | ✅     |
| Valuation — symbol-keyed, server-only                  | `src/lib/points/prices.ts`                             | ✅     |
| Legacy write lockdown                                  | `20260801000000_lock_activity_writes.sql`              | ✅     |
| **Snapshotter** — time sources → `point_snapshots`     | —                                                      | ❌     |
| **Verifier** — receipts → `point_actions`              | —                                                      | ❌     |
| **Materializer** — epochs + actions → `point_balances` | —                                                      | ❌     |
| **Read API + UI rewiring**                             | —                                                      | ❌     |

The design half is done. What is missing is entirely runtime: nothing writes a
snapshot, verifies a receipt, or materialises a balance.

### 11b. Three facts that reorder the work

**Nothing is deployed.** This removes the single largest task in the original
plan. Wallet discovery — reconstructing who to snapshot from historical logs —
does not exist when you index a fresh contract from block 0. The wallet universe
starts empty and grows with real usage.

It also settles §7. If contracts only ever ran on testnet, `kaleido_protocol_activity`
holds nothing but testnet activity, and the schema's own rule (testnet chains
never convert) disposes of it. There is nothing worth migrating. A flat, capped
Season 0 participation bonus is the clean answer.

**Abstract is deprioritised.** Season 0's rehearsal chain is no longer Abstract
Testnet; it is the testnet of whichever priority chain deploys first. Abstract
stays in `chains.ts` for balance reading but loses `tradable`.

**Testnet comes first, deliberately.** Every priority chain deploys to its
testnet and is proven there before its mainnet is touched. This is the fact that
moves the most work _earlier_: Phases 4 and 5 are gated on "a deployment exists
to index", and a testnet deployment satisfies that completely. An RPC endpoint,
a receipt and an event log are the same shape on Base Sepolia as on Base. So the
verifier and the snapshotter unblock at the **first testnet deploy**, not at
mainnet, and the entire pipeline can be running end to end before a single
mainnet address exists.

It also promotes Season 0 from a hypothetical to the plan of record. Season 0 is
seeded `converts_to_tokens = false`, and the schema forbids it carrying a
`supply_budget` at all — so the rehearsal is structurally incapable of being
mistaken for a claimable allocation, no matter how long it runs or how many
points it mints.

One gap this exposes. `is_testnet` appears in exactly three places: the column,
the seed, and the `point_conversion_violations` view — which **detects** the
problem at freeze time rather than **preventing** it at write time. That is the
right trade while testnet is hypothetical. Once testnet is where everything
starts, the materializer should refuse to write an epoch for an `is_testnet`
chain into a season with `converts_to_tokens = true`, and fail loudly. Catching
it in the view still works, but only after the bad rows exist.

None of the three facts touches the schema, because chains and sources are
registry rows rather than enums. All three are `UPDATE`s.

### 11c. Chain rollout

Priority order: **Arc, Base, Robinhood, BNB Smart Chain, Ethereum.** Each ships
testnet first (Gate A) and mainnet only after (Gate B) — so the table below reads
left to right as the actual rollout sequence per chain, not as two alternatives.

All nine corresponding rows are already seeded in `point_chains`, every one
`enabled = false`, and every testnet row correctly carries `is_testnet = true`.
Turning a chain on is an `UPDATE`, gated on §11f.

| Chain     | Mainnet | Testnet  | Note                                                                                                          |
| --------- | ------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| Arc       | —       | 5042002  | **No mainnet yet.** Fine for Gate A, which is where Arc leads. Arc clears Gate B only when its mainnet ships. |
| Base      | 8453    | 84532    |                                                                                                               |
| Robinhood | 4663    | 46630    |                                                                                                               |
| BNB       | 56      | 97       |                                                                                                               |
| Ethereum  | 1       | 11155111 |                                                                                                               |
| Abstract  | 2741    | 11124    | Registered, never `tradable`. Balance reading only.                                                           |

Two gaps to close:

- **Polygon (137), Arbitrum (42161) and Hyperliquid (999) have no `point_chains`
  row.** They exist in `chains.ts` for balance reading. `point_snapshots.chain_id`
  is a foreign key, so points cannot be recorded there at all until seeded.
  Fine while they stay view-only; a blocker the moment they are not.
- `point_chains.multiplier` is the bootstrap lever. Boosting a new deployment to
  pull liquidity across needs no source-rate change.

Multichain valuation is already correct by construction: `prices.ts` keys on
**symbol, not address**, because a dollar of USDC is a dollar of USDC wherever it
sits. Five chains need no per-chain pricing work.

### 11d. How each product earns

Fifteen sources are registered — ten live, five pre-registered and disabled so
shipping a product is an `UPDATE`, not a migration.

**Time-weighted, ~70% of emissions.** Accrues in `usd-seconds` while capital
sits. `accrueInterval` credits **`min(previous, current)`**, so depositing before
a snapshot and withdrawing after earns nothing.

| Source               | Product       | Rate  | Read from                                          |
| -------------------- | ------------- | ----- | -------------------------------------------------- |
| `lp`                 | Pool          | 1.5   | Position manager + pool `slot0`, **in-range only** |
| `stake`              | Stake         | 1.0   | KLD vault `getUserDeposit`                         |
| `vault`              | Stable › Earn | 1.0   | kafUSD vault                                       |
| `lend`               | Borrow        | 1.0   | Serviced loans only                                |
| `borrow`             | Borrow        | 0.4   | Diamond active requests                            |
| `collateral_idle`    | Borrow        | 0.25  | Collateral **not** backing a loan                  |
| `collateral_backing` | —             | **0** | Paid via the `borrow` leg                          |

That last row is the anti-recursion rule and the most load-bearing number here.
If collateral earned _and_ borrowing earned at full rate, one capital commitment
is paid twice, and the borrowed asset can be redeposited to be paid a third
time. That is how COMP was mined in 2020.

**Action-weighted, ~30%.** One credit per `(chain_id, tx_hash)`, forever, only
after the server has fetched the receipt.

| Source        | Product              | Rate × mult   | Floor | Daily cap                               |
| ------------- | -------------------- | ------------- | ----- | --------------------------------------- |
| `swap`        | Trade › Swap         | 1.0           | $10   | 50k pts                                 |
| `agent_swap`  | Luca                 | 1.0 × **1.2** | $25   | 30k pts, multiplier decays after 20/day |
| `stable_mint` | Stable › Mint/Redeem | 0.5           | $10   | 10k pts                                 |
| `referral`    | Social               | flat          | —     | 5k pts, **30d referee activity first**  |

**Pre-registered, disabled:** `perp`, `launchpad`, `onramp`, `offramp`,
`limit_order`.

Two deliberate exclusions. **Pool minting earns no action points** and is not an
agent command — a chat-typed tick range silently opens out-of-range, earning
nothing, which is a correctness risk rather than a data gap. **The localStorage
AI metric is dropped**; agent usage scores via `is_agent_initiated` on a verified
swap, an on-chain fact.

### 11e. Build order

Contract-free work first, because it is testable today against synthetic
snapshots — `accrual.ts` is pure and takes observations as input, so the
arithmetic, the caps and the disclosure tiers can all be rehearsed with no chain.

| Phase                                                   | Contract-coupled | Build                    |
| ------------------------------------------------------- | ---------------- | ------------------------ |
| 0 — Cleanup (§11g)                                      | No               | ✅ done                  |
| 1 — Materializer: epochs + actions → `point_balances`   | No               | Now                      |
| 2 — Read API: `/api/points/[address]`, leaderboard      | No               | Now                      |
| 3 — UI rewiring, kill the silent insert                 | No               | Now                      |
| 4 — Verifier: receipt fetch, log decode, USD derivation | Yes              | **First testnet deploy** |
| 5 — Snapshotter: six time sources, hourly, per chain    | Yes              | **First testnet deploy** |

Phases 4 and 5 need a chain to read from, not a _mainnet_ to read from. A testnet
deployment unblocks both. Nothing in either phase distinguishes the two: the RPC
calls, receipts, event ABIs and `slot0` reads are identical, and the only
difference — that testnet points must never convert — lives in the season config,
not in the worker.

Phase 4 takes a client-submitted `tx_hash` as a **claim**, never as truth: the
server fetches the receipt, decodes the logs and derives USD itself. This is far
cheaper than a full event indexer and equally safe, because verification is
server-side either way.

Phase 5 is a cron worker under `server/src/points/`, following the existing
worker patterns (`config/envSchema`, `db/supabase.ts`, Pino, Sentry).

### 11f. Deploy gates

Two gates, in order. Neither is a migration; both are `UPDATE`s plus a passing
test run.

**Gate A — testnet, opens Season 0.** Per chain:

1. Contracts deployed to that chain's testnet, addresses populated in
   `DEPLOYMENTS` in `src/constants/registry.ts` (deliberately empty today),
   `poolInitCodeHash` verified against _that_ deployment's compiled bytecode, and
   `registry.test.ts` passing for the chain.
2. `point_chains.enabled = true` for the **testnet** chain id, once the
   snapshotter has run and reconciled against on-chain state.

Season 0 then rehearses the full pipeline — snapshot, accrue, verify, materialise,
leaderboard — with `converts_to_tokens = false`. Points mint freely and mean
nothing, which is the point: it is the only way to find out whether the caps, the
`min(previous, current)` rule and the disclosure tiers behave under real usage
before they are load-bearing.

What Gate A is actually testing for, beyond "it runs":

- Snapshot cadence holds under real wallet counts without RPC cost blowing up
  (§10 lists cadence as open — Season 0 is how it gets decided).
- `collateral_backing = 0` genuinely closes the recursion, verified by trying to
  farm it on a testnet where capital is free.
- Sybil flagging catches a wallet fan-out that costs nothing to attempt.
- Action verification is idempotent per `(chain_id, tx_hash)` across replays and
  reorgs.

**Gate B — mainnet, opens Season 1.** Adds, on top of Gate A for that chain:

3. `poolInitCodeHash` **re-verified for the mainnet deployment.** It is a property
   of compiled bytecode, not of source, so a testnet value does not carry over —
   and a wrong one fails at the first swap callback, not at deploy.
4. Contract addresses in `DEPLOYMENTS` are the mainnet set, not testnet values
   promoted by accident.
5. `point_chains.enabled = true` for the **mainnet** chain id.
6. `point_conversion_violations` returns zero rows.
7. The multi-season supply carve is decided (§10, and see below) before
   `converts_to_tokens` flips to true on Season 1.

Gate B is where a testnet-first plan can quietly go wrong, so the sequencing
matters: **flip `converts_to_tokens` only after the testnet chain rows are
accounted for.** Testnet chains may stay `enabled` after mainnet ships — useful
for continuing to exercise the indexer — but the moment a converting season is
live, every testnet row inside it is an allocation leak. That is what
`point_conversion_violations` is for, and per §11b the materializer should refuse
the write rather than leave the view to find it afterwards.

### 11g. Phase 0 — stale Abstract facts

Wrong today, independent of points, and Phase 1 should not be built on top.

**Done.**

| Where                                             | Was                                                                          | Now                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chains.ts` header + `tradable` doc               | "Only Abstract has the contracts deployed"                                   | States nothing is deployed anywhere; `tradable` documented as _intent_, to be paired with `isDeployed()`                                                                                                                                                                                             |
| `chains.ts` — Abstract 2741/11124                 | the only `tradable: true` chains                                             | `tradable` dropped; moved to the nine priority-chain rows instead. Safe because `tradableChains()` ands it with `isDeployed()`, which is still false everywhere                                                                                                                                      |
| `chains.ts` — `DEFAULT_CHAIN_ID = 11124`          | dead testnet, zero importers                                                 | Removed. A default chain id is a guess that outlives its reason — callers use the connected chain and handle "not deployed" explicitly                                                                                                                                                               |
| `chains.ts` — `TRADABLE_CHAIN_IDS`                | name implied a deployment check                                              | `INTENDED_TRADABLE_CHAIN_IDS`, so the name can't be mistaken for one                                                                                                                                                                                                                                 |
| `tokens.ts` — `ABSTRACT_MAINNET_CHAIN_ID = 11124` | 11124 is _testnet_; mainnet is 2741                                          | Removed (zero importers) rather than corrected                                                                                                                                                                                                                                                       |
| `tokens.ts` — `ABSTRACT_TOKENS` / `ACTIVE_TOKENS` | eight dead 11124 addresses, read on whatever chain the user was connected to | **Deleted.** `tokens.ts` is now a thin chain-scoped adapter over `registry.ts` holding zero addresses: `chainTokens`, `chainTokenBySymbol`, `chainTokenByAddress`, `symbolForAddress`, `decimalsForAddress`. Every call site takes a `chainId`, and empty is the honest answer until a chain deploys |
| `tokens.ts` — `searchTokens`                      | dead, zero importers                                                         | Removed. `TokenSelector` filters `chainTokens(chainId)` inline                                                                                                                                                                                                                                       |
| `tokens.ts` — decimals fallback                   | `?? 18` buried in the helper                                                 | `decimalsForAddress` returns `undefined`. Display-only callers may `?? 18`, which makes the guess visible at the call site instead of hiding it behind a lookup                                                                                                                                      |
| `faq.ts` — chains topic                           | "Abstract … the one chain you can actually trade on"                         | States nothing is tradable yet and gives the real testnet-first rollout order                                                                                                                                                                                                                        |
| `agent/page.tsx` — plan path                      | built signable plans from dead addresses                                     | Gated on `isDeployed(chainId)`; refuses with a true reason. Parse, slot-fill, `help` and FAQ still run                                                                                                                                                                                               |
| `agent/page.tsx` — `chainId ?? 11124`             | told the server every disconnected user was on Abstract                      | Sends `undefined`, which is the truth                                                                                                                                                                                                                                                                |
| `chat/route.ts` — whitelist gate                  | `result.chainId \|\| body.chainId \|\| 11124`                                | Fails **closed**: `body.chainId` only, no default. See below                                                                                                                                                                                                                                         |
| `provider.ts`                                     | comment said "sepolia"; network named `abstract-sepolia`                     | Comment corrected, network renamed `abstract-testnet`, blocker documented                                                                                                                                                                                                                            |

Two of these were more than tidying.

**The chat route's security gate failed open.** It picked the whitelist with
`result.chainId || body.chainId || 11124`. `result` is _model output_, so the
model could nominate the chain whose whitelist it was checked against — it chose
its own security policy. And the `11124` default meant a request carrying no
chain still got a populated whitelist and could pass. It now reads `body.chainId`
only, with no default, so an unknown chain yields an empty whitelist and the
check rejects.

**The agent built signable plans from dead addresses.** This was the one that
bit soonest, because it doesn't fail — it renders a normal PlanReview that fails
on submit. The gate sits after parsing deliberately: the grammar is worth
exercising before a deploy, it just must not produce something signable.

**Deferred to Gate A**, needing a real deployment to point at rather than a
guess:

| Where                | Why it waits                                                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `config/provider.ts` | `chainId` must match whatever `envVars.httpRPC` serves. Guessing one without the other makes every read silently return another chain's data. |

**Closed 2026-08-20 — `SUPPORTED_CHAIN_ID` is gone.** It was listed here as
Gate A work on the theory that it needed a deployment to point at. It did not:
the array was only ever read to answer "can we transact here", and
`isDeployed(chainId)` answers that from the deploy records without naming a
chain. `config/chain.ts` now derives `isSupportedChain` from it, which mattered
more than the hardcode looked — `[11124]` made the predicate false on all five
wave chains, and all seven lending write hooks bail with "SWITCH NETWORK" when it
is false, so a fully successful deployment would still have transacted nothing.

Removed with it, all of which existed only to index that array:

- `getContractByChainId` — a switch whose `case` and `default` returned the same
  thing. Zero call sites, six hooks importing it anyway.
- `getContractAddressesByChainId` — same do-nothing switch, but 5 real call
  sites. Now `getContracts(chainId).diamond`, the same field
  `getKaleidoContract` reads, so the ERC20 approve spender and the call target
  cannot disagree.
- Three toasts telling the user to "wait a few minutes for your deposit to go
  cross-chain", fired whenever `chainId !== 11124` — i.e. always, about a
  transaction already confirmed on the line above. Relics of a cross-chain
  design that no longer exists now each chain has its own Diamond.
- `getProtocolContract` (zero callers) and `type ChainId = 11124 | 2741` (zero
  importers).

**Found while verifying the above, and a Phase 1 blocker rather than a Gate A
one** — `constants/utils/getUsdcBalance.ts` resolved token addresses without a
usable chain dimension:

- `getUsdcAddressByChainId` had three branches. `SUPPORTED_CHAIN_ID[1]` is
  `undefined`, so that `case` could never match a numeric chain id, and both
  remaining paths returned `USDC_ADDRESS` — the Abstract testnet address — for
  every chain. **Fixed 2026-08-20:** it is now
  `getContracts(chainId).usdc ?? findTokenBySymbol(chainId, "USDC")?.address`
  and returns `undefined` rather than defaulting, because an allowance read
  against the wrong token reports zero, which reads as "needs approval" and
  sends an approval for a token the user does not hold. Its one caller,
  `useCheckAllowance`, guards on it.
- `getUsdRBalance`, `getKfUSDBalance` and `getUSDTBalance` took `chainId`, used
  it to pick a provider, then read a single hardcoded address regardless. All
  four per-token helpers had zero callers and are deleted.

`getProviderByChainId` did switch correctly across six chains, so the result was
an Abstract address queried against a foreign RPC: a revert or a zero, not an
error anyone sees. This matters for points beyond portfolio display, because
`usd_seconds` accrues on observed balances — a silent zero is not a neutral
reading, it is a wrong one that lowers a real balance to nothing.
