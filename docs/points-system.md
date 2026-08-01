# Kaleido Points — pre-TGE design

Status: **design, not built.** Accrual runtime deliberately undecided.

The goal is a points program that converts to an airdrop allocation at TGE and
survives contact with professional farmers. This document is the spec the
implementation should be written against.

---

## 1. Why the current system can't ship

A points system already exists, spread across
`useGetValueAndHealth.ts` (the total) and `logProtocolActivity.ts` (the
indexer). Six inputs feed it: referrals, marketplace, LP, AI, staking, swaps.
**Three of the six are forgeable and none are time-weighted.**

| # | Problem | Where | Consequence |
|---|---|---|---|
| 1 | Points are inserted by the **browser** using the `NEXT_PUBLIC` anon key | `logProtocolActivity.ts` | If RLS does not block INSERT on `kaleido_protocol_activity`, anyone can mint themselves unlimited points. **Verify RLS before anything else.** |
| 2 | `amountInUsd` is not USD — it is `parseFloat(amountIn)`, the raw token amount | `useSwapRouter.ts:166` | A 1,000 USDC swap scores 1,000; a 0.5 ETH swap (~$1,500) scores 0.5. Weighting is inverted against valuable assets. |
| 3 | AI points count `kaleido_conversation_*` keys in **localStorage** | `useGetValueAndHealth.ts` | Write a fake object in devtools, collect the cap. |
| 4 | LP points = `positionCount × 250` (current NFT balance) | `useGetValueAndHealth.ts` | Count, not value, and instantaneous. Ten dust positions beat one deep one. |
| 5 | Stake points = `currentStake × 10` (current balance) | `useGetValueAndHealth.ts` | Stake the day before snapshot, score the same as six months of loyalty. |
| 6 | The total is computed **client-side** for display | `useGetValueAndHealth.ts` | The number a user sees is not authoritative and cannot be reconciled. |

Problems 4 and 5 are the same structural flaw and the most damaging one: the
program rewards a *snapshot*, not a *history*. Time-weighted accrual is the
primary defense against last-minute farming — six months of ordinary usage
should beat six days of intensive farming, and today it does not.

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

| Source | Measured as | Read from |
|---|---|---|
| `stake` | staked KLD, USD-valued | KLD vault `getUserDeposit` |
| `lp` | V3 position value, **in-range only** | position manager + pool `slot0` |
| `collateral` | collateral deposited | Diamond `gets_addressToCollateralDeposited` |
| `vault` | kafUSD vault deposit | stablecoin vault |
| `lend` | capital actually lent out on serviced listings | `kaleido_requests` where `status = SERVICED` |

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

| Action | Points | Cap |
|---|---|---|
| Swap | `usd_value × 1.0` | per-epoch cap per wallet |
| Agent-initiated swap | `usd_value × 1.2` | shares the swap cap |
| Take/fund a loan | `usd_value × 1.0` | per-epoch cap |
| Referral (referee stays active ≥ 30d) | flat | hard cap on referrals counted |
| First swap / first LP / first loan | flat, once ever | one per wallet |

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

Publish the rules *before* the season starts. Retroactive sybil rules are the
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
2. Fix `amountInUsd` at the source — value with `getUsdValue`, server-side.
   Until then, historical rows in `kaleido_protocol_activity` are denominated
   in mixed units and **cannot be migrated as-is**.
3. Drop the localStorage AI metric. If agent usage should score, it scores via
   `is_agent_initiated` on a verified swap — an on-chain fact.
4. Treat existing `kaleido_protocol_activity` as **Season 0**: a record of
   participation, not a points balance. Awarding a flat, capped Season 0 bonus
   for having used the protocol is defensible; carrying the raw numbers over is
   not, because they are unverified and mis-denominated.
5. Point `getActivityPoints` at `point_balances`, and delete the client-side
   total in `useGetValueAndHealth`.

---

## 8. Open questions

- Season length, and whether points carry across seasons or reset.
- Whether lending and borrowing earn at the same rate (they are not the same
  risk).
- Whether the leaderboard is public per-wallet or bucketed — public
  per-wallet is better for credibility and worse for privacy.
- Snapshot cadence: hourly is defensible, more frequent gets expensive fast.
