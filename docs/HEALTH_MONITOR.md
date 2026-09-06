# The pre-liquidation warning

How a borrower whose position is drifting toward liquidation gets told, and what
has to be true in production for that to happen.

The decisions — who is at risk, what counts as at risk, the cooldown — live in
`src/lib/health/monitor.ts`. The HTTP door is
`src/app/api/health/watch/route.ts`, and the clock is
`scripts/health-cron/`. This file is about **why it exists and how to arm it**.

## The gap it closes

`src/lib/notifications/emit.ts` calls the health-factor warning "the one alert in
this app that has to arrive". Before this it did not.

`src/hooks/useGetValueAndHealth.ts` reads `getHealthFactor` inside an effect keyed
on `[address, activeAccount, isClient, refreshNonce]`. There is no interval. So the
warning fires when a wallet connects, and then never again until something else
re-renders the hook. A position that drifts overnight, or over a weekend, is a
position nobody is told about.

That is exactly the case the web-push stack was built for — `public/sw.js`,
`/api/push/send`, the `push_subscriptions` table — and it was all in place, with
nothing server-side firing the risk category.

There is a second, subtler failure it fixes. The client's own cooldown lives on
`window.__kaleido_last_health_warning`, so every page reload re-arms it: an open
tab can warn on every refresh, while a closed one never warns at all. The cooldown
had to become durable to be a cooldown.

## Who gets checked, and why it is a view and not a log scan

`scripts/push-watcher.mjs` derives its work from events, and correctly — an event
is a point in time: scanned once, delivered once. A health factor is a **level**.
It does not happen, it persists.

Deriving the borrower set from logs would mean reconstructing `RequestServiced`
minus `LoanRepayment(outstanding == 0)` minus `RequestLiquidated` — a set the chain
already stores — and it would be wrong on day one regardless. A cursor seeded at
head is right for events (a backlog is not news) and useless here, because every
currently-open loan was funded in the past. It would need a one-time backfill, and
the backfill would have to enumerate every request anyway.

`getServicedRequests()` **is** that enumeration, on chain, in one `eth_call`: every
request whose status is `SERVICED`, which is exactly "has an open debt". No cursor,
no backfill, no drift. A run's view of who is borrowing is the chain's own view at
the block it read.

The bounded `getRequest(n)` scan in `borrowersOf` is a fallback for one failure:
that view returns an unbounded array, and a node may refuse a large enough
response. A truncated fallback is reported as `truncated: true` rather than passed
off as the whole set, because a missing borrower there is an unsent warning.

## The cooldown is the design problem

A monitor that warns whenever it sees an unhealthy position sends the same warning
96 times a day at a 15-minute cadence, and the alert that has to arrive becomes the
one the user turned off.

So `health_watch_state` records, per wallet per chain, when a warning was last sent
and at what level. `shouldWarn` sends when:

- nothing has been sent inside **`COOLDOWN_MS` (6 hours)**, or
- the factor has fallen at least **`WORSENED_BY` (0.02)** below the level last
  warned about.

The second clause is what keeps the first honest. Without it the cooldown is a gag:
warn once at 1.04 and say nothing while the position walks to 1.001.

The threshold is **`WARN_AT` (1.05)**, deliberately the same number the client
uses. Two surfaces disagreeing about what counts as dangerous is how a user gets a
push saying they are at risk and a portfolio page saying they are fine.

`npm run test:health` pins all of this. The asymmetry it is built around: an
over-eager rule sends a duplicate, and an over-cautious one withholds a liquidation
warning that leaves no trace anywhere.

## What is deliberately not a warning

- **No debt.** `_healthFactor` returns `type(uint256).max` for an account with no
  borrow (ProtocolFacet.sol:2455). Tested on the bigint before scaling.
- **An unreadable factor.** `getHealthFactor` prices collateral, so it reverts
  `Protocol__StalePrice` on a chain whose feed has aged out. That is counted as a
  **failure**, not as a healthy position — the run goes red and an operator looks.
  See `docs/KEEPER_SCHEDULING.md`, which is about keeping that from happening.
- **A wallet with no push subscription.** Reported as `unsubscribed` rather than
  dropped, because "nobody was warned" and "nobody could be warned" are different
  operational facts.

## Arming it

Three things, and the route is quiet rather than broken until all three exist.

**1. `CRON_SECRET` in the Vercel project.** The same secret as
`/api/keeper/push` — one scheduler credential for the deployment's own jobs. Unset
means the route answers 503 to everything, which is the armed/unarmed switch rather
than a misconfiguration.

**2. `APP_URL` and `PUSH_SEND_SECRET` in the Vercel project.** The monitor calls
`/api/push/send` over HTTP rather than importing it, so that every sender goes
through the same authenticated door. Without both it is permanently a dry run:
every read done, every warning decided, nothing sent, no cooldown written. The
response's `dryRun` field is how you tell that apart from "everyone is healthy".

**3. The Worker.**

```bash
npx wrangler deploy --config scripts/health-cron/wrangler.toml
```

```bash
npx wrangler secret put HEALTH_CRON_SECRET --config scripts/health-cron/wrangler.toml
```

`HEALTH_CRON_SECRET` must equal the Vercel project's `CRON_SECRET`. Cloudflare
rather than GitHub Actions for the reason measured in `docs/KEEPER_SCHEDULING.md`:
GitHub delivered 47 of ~456 scheduled runs over 152 hours. Vercel Cron would send
the header itself but caps a Hobby schedule at once a day.

It is a **second** Worker rather than a second cron expression on
`scripts/keeper-cron`. That Worker is the only thing keeping Robinhood's ETH feed
inside its 3600s bound; folding a job into it would make every future edit here an
edit to the price keeper's deploy. The cost is that two Workers must both be armed,
and one can stop while the other runs — which is what `last_check_at` is for.

## Verify it

Point it at `?dryRun=1` first. It does every read and decides every warning, and
sends nothing:

```bash
curl -sS -X POST -H "X-Keeper-Secret: $CRON_SECRET" "https://kaleidofi.xyz/api/health/watch?dryRun=1"
```

Reading the response:

- `dryRun: true` with a `chains` array of `status: "ok"` — armed, authenticated,
  and it read every chain. This is the success condition.
- `wouldWarn: 0` is the **expected** result on a healthy testnet and is not
  evidence of a broken monitor. What proves the path works is `borrowers > 0` and
  `checked > 0`: it found positions and read their levels.
- `503` — `CRON_SECRET` is not set in this environment.
- `401` — the secret does not match. No further detail is returned by design.
- `dryRun: true` on a run where you did **not** pass `dryRun=1` means `APP_URL` or
  `PUSH_SEND_SECRET` is missing. This is the failure that otherwise looks like
  success.
- `failed > 0` returns 500. Read each chain's `reason`; a `Protocol__StalePrice` on
  a chain is a keeper problem, not a monitor problem.

To prove delivery end to end without waiting for a real position to deteriorate,
narrow to a wallet you control and whose browser has enabled notifications:

```bash
curl -sS -X POST -H "X-Keeper-Secret: $CRON_SECRET" "https://kaleidofi.xyz/api/health/watch?wallet=0xYourAddress"
```

That still only sends if the position is genuinely at or below 1.05 — the threshold
is not overridable by a parameter, deliberately, because a route that could be
asked to warn an arbitrary wallet is the spam primitive the secret exists to
prevent.

## Related

- `src/lib/health/monitor.ts` — every decision, and why
- `supabase/migrations/20260905000000_health_watch_state.sql` — the cooldown store
- `docs/KEEPER_SCHEDULING.md` — the sibling scheduler, and the measurements behind
  choosing Cloudflare
- `scripts/push-watcher.mjs` — the event-driven pushes, and the contrast that
  explains why this one reads a view
