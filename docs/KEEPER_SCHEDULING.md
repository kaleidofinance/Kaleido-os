# Keeper scheduling

How the self-hosted price feeds stay fresh, and what has to be true in production
for that to happen. Read this before pointing users at the app: when the keeper is
not running, `getUsdValue` reverts `Protocol__StalePrice` and every screen that
prices anything fails at once.

The push logic itself is documented in `src/lib/keeper/pushFeeds.ts`; the HTTP door
is `src/app/api/keeper/push/route.ts`. This file is only about **who calls it and
how often**.

## The problem, measured

We publish our own `PushablePriceFeed` prices on the chains where no third-party
aggregator exists — the ones in `SELF_HOSTING_CANDIDATE_CHAINS`, derived from the
registry as every chain whose `oracleKind` is `aggregator-v3`. In practice the one
that matters is **Robinhood Chain Testnet (46630)**, whose ETH feed carries a
`maxAge` of **3600s**.

The committed GitHub Actions keeper (`.github/workflows/price-keeper.yml`) is
correct and still cannot hold that bound. Measured 2026-09-01: a `*/20` schedule
delivered **47 runs in 152 hours — one per ~3.2 h** against a 3600s bound. GitHub
drops scheduled runs under load and does not make them up. No change to the script
fixes this; the fix is to let something more punctual call the same work over HTTP.

Note the bound is **per feed**, read with `getFeedMaxAge`. Do not reason from the
global 300s default — it is not what these feeds are configured with.

## 1. Arm the route — DONE 2026-09-02

Both of these now exist in Vercel → Project → Settings → Environment Variables →
**Production**, and production has been redeployed, so the route no longer answers
503. Verified end to end the same day: a scoped dry run returns 200 with
`wouldPush > 0`, a wrong secret returns 401, no secret returns 401, and a real push
of both Robinhood feeds landed and dropped the ETH feed's age from 4,805s to 157s
against its 3,600s bound.

Keep the values. Rotating `KEEPER_PRIVATE_KEY` is not a matter of generating a new
one: `0xB37d079F6AccE50332043cf20e1f4FFD363799aE` is the address named in each
feed's `isPusher` and the address holding the gas, so a fresh key would authenticate
and then revert. Rotating means `scripts/grant-pusher.js` and funding, in that
order, before the swap.

| Variable             | Why                                                                                                                                                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CRON_SECRET`        | The route spends the keeper's gas, so unauthenticated it could be drained by anyone calling it in a loop. Unset means "not armed" and the route refuses everything — that is deliberate, not a misconfiguration. |
| `KEEPER_PRIVATE_KEY` | The account that signs the pushes and pays the gas. Without it the route authenticates the caller and then finds no signer.                                                                                      |

Generate the secret fresh, and generate it yourself — **never commit it, and never
paste it into a shell command, a chat, or an issue.** This repository is public.

```bash
openssl rand -hex 32
```

`KEEPER_PRIVATE_KEY` already exists in the local `.env` and as a GitHub Actions
secret; it needs to be copied into Vercel by hand for the same reason.

Redeploy after setting them — Vercel only picks up new environment variables on the
next build. Confirmed: the running deployment answered 503 with both variables
already saved, and 200 only after `vercel redeploy`.

## 2. The Cloudflare Worker — DEPLOYED, ARMED, AND FIRING

`scripts/keeper-cron/` is a Cloudflare Worker deployed as `kaleido-keeper-cron`. It is
armed, it pushes correctly when invoked, and **as of 2026-09-02 23:39 UTC it is also
firing on its own schedule** — see the measurement below, which supersedes an earlier
reading in this file that concluded it never fired.

Configuration, all of it in `scripts/keeper-cron/wrangler.toml` so a change to it is
reviewable:

| Name                 | Kind   | Value                                             |
| -------------------- | ------ | ------------------------------------------------- |
| `APP_URL`            | var    | `https://kaleidofi.xyz` — the apex, because `www.` answers 307 and a redirect is not somewhere to send a bearer token |
| `KEEPER_CHAIN_IDS`   | var    | `46630`                                           |
| `KEEPER_CRON_SECRET` | secret | the Vercel project's `CRON_SECRET`, byte for byte  |

```bash
npx wrangler deploy --config scripts/keeper-cron/wrangler.toml
npx wrangler secret put KEEPER_CRON_SECRET --config scripts/keeper-cron/wrangler.toml
```

Set the secret by **piping** the value in rather than typing it as an argument, so it
never lands in shell history. The name has to be `KEEPER_CRON_SECRET`: the Worker
reads exactly that, and a secret under any other name leaves it unarmed — it will
then throw on every run with the `wrangler secret put` command in the message.

Note that once set, **the live value exists only inside Cloudflare and Vercel, and
neither will read a secret back.** So the two halves can only be compared by behaviour —
the route answers **503 when it is unarmed and 401 when it is armed but the offered
secret is wrong**, which makes a 401 a stale-secret smell before it is a broken-route
one. Re-arming is therefore always: generate a new value, set it in **both** places, and
redeploy production so the new value is baked in.

### What was measured, 2026-09-02

Working, and verified rather than assumed:

- The authenticated manual trigger returns
  `200 pushed=2 wouldPush=0 failed=0 Robinhood:pushed`, and the push **landed**: the
  ETH feed advanced to round 15 and its age dropped to 121s against a 3,600s bound.
  So the code, the secret, the URL and the chain scope are all correct.

Also working, measured at **23:39 UTC** and the reason this section's verdict changed:

- **The cron fires.** Two consecutive pushes landed **15m15s apart** — 23:13:02 and
  23:28:17, each derived by subtracting the feed's `ageSeconds` from the sample time —
  with **no `price-keeper` run in that window** (the last one was 22:41). Nothing else
  can call the route, so Cloudflare is dispatching `*/15`. ETH was at **640s against
  its 3,600s bound**, where before it had been sawtoothing up to 4,805s.

- **The fires land on a phase offset, not on the quarter hours**: :13, :28, :43, :58.
  This matters more than it looks. **Measure a cron by the on-chain age, never by
  watching for an invocation at the boundary** — a check at :15 or :30 sees nothing and
  reads as a dead scheduler.

  The cheapest way to measure needs no `CRON_SECRET` and signs nothing: load `.env` for
  `KEEPER_PRIVATE_KEY`, call
  `pushSelfHostedFeeds({ chainIds: [46630], pushAll: true, dryRun: true })`, and read
  `ageSeconds`. Two samples a few minutes apart date the last push and give the cadence.

An earlier reading in this file said the opposite, and it is kept here because the
method is still worth having: across the 15:30, 15:45, 16:00 and 16:15 UTC boundaries
Cloudflare reported **zero** invocations in both `workersInvocationsAdaptive` and
`wrangler tail`, and narrowing the schedule to `* * * * *` reported zero over the
following four minutes too — which was read as a platform condition needing the
dashboard (Workers → `kaleido-keeper-cron` → Settings → Trigger Events, and whether the
plan includes cron triggers). The phase offset above, plus analytics ingest lag, would
each produce that same negative reading from a working scheduler; a dashboard change in
between would explain it too. **Which of those it was is not established**, so the
lesson to carry forward is the measurement method, not the diagnosis.

### Design notes worth keeping

The Worker **throws** on any non-200 rather than logging and returning, because a
thrown `scheduled` handler is what marks the invocation failed in Cloudflare's
dashboard. A keeper that looks green while the feed goes stale is the exact failure it
exists to end. It retries once, and only for a timeout or a 5xx — a 401 or a 400 is a
configuration mistake, and retrying one only doubles the log noise.

It also exposes the same run over HTTP on its `workers.dev` hostname, guarded by the
same secret, so that "is this deployed and reachable?" can be answered without
waiting out a cadence. That is deliberate and it is not an open relay: without the
`Authorization: Bearer` header it answers 401 and does nothing. Per-version preview
URLs are off, because each one would be another public URL able to spend gas.

To read what it did: `npx wrangler tail kaleido-keeper-cron` for live invocations, or
the dashboard's Cron Triggers tab for history.

**Scope it to 46630, and do not point any scheduler at the unscoped URL.** Robinhood
is the only chain with a feed of ours to push, and an unscoped run currently returns
**500** in production even when it succeeds: chains 97 and 11155111 exhaust their RPC
retries while discovering they have nothing to do, which counts as `failed: 2`
alongside `wouldPush: 2`. The same code returns `failed: 0` locally, so it is Vercel's
egress being rate-limited by those public RPCs rather than anything the keeper did.
Unscoped, a job with failure notifications on would therefore alert on every
successful run — which teaches you to ignore it, and the alert you then ignore is the
one that matters. Scoped, the run takes 1.7s instead of 13s.

The route accepts `Authorization: Bearer <secret>` or `X-Keeper-Secret: <secret>` and
compares either with `timingSafeEqual`. The Worker sends Bearer, because nothing else
in it claims that header. A third-party pinger should send `X-Keeper-Secret` instead,
because some of them reserve `Authorization` for their own use.

**Never put the secret in the query string.** The route refuses to read it from
there on purpose: a secret in a URL lands in access logs, referrer headers and
browser history.

Whatever calls it, turn on failure notifications and treat the status code as the
signal — the route answers **200 when nothing failed and 500 when something did**,
mirroring the hardhat keeper's exit code. "Every feed skipped because the source
published nothing new" is a **200**: that run succeeded and cost no gas.

## 3. Backup scheduler: Vercel Cron — REQUIRES PRO

> **Do not commit `vercel.json` with a sub-daily schedule while the project is on
> the Hobby plan.** Hobby's cron floor is once per day, and a sub-daily expression
> **fails at deployment** — so merging this file on Hobby does not give you a
> second keeper, it breaks every production deploy. The project was on Hobby as of
> 2026-09-02.

Once the project is on Pro, create `vercel.json` at the repository root:

```json
{
  "crons": [
    {
      "path": "/api/keeper/push",
      "schedule": "*/15 * * * *"
    }
  ]
}
```

Vercel Cron sends `Authorization: Bearer $CRON_SECRET` of its own accord when
`CRON_SECRET` is set, so no extra configuration is needed on that side.

Running both schedulers is safe and is the point of having two. A second push
arriving seconds after the first is refused by the feed itself — `observedAt` must
be strictly newer than the stored answer — and the route checks that off chain
before spending gas, so the overlap costs a read, not a transaction.

## 4. Verify it

Point anything new at `?dryRun=1` first. It performs every read and checks every
guard, and sends no transaction:

```bash
curl -sS -X POST -H "X-Keeper-Secret: $CRON_SECRET" "https://kaleidofi.xyz/api/keeper/push?dryRun=1&chainId=46630"
```

Reading the response:

- `wouldPush > 0` — armed, authenticated, and it can see work to do. This is the
  success condition for a dry run. Note it is also the *steady state*: pushes are
  gated on the source having a newer observation, not on the feed nearing its bound,
  so a dry run seconds after a successful push still reports `wouldPush: 2`. Age, not
  `wouldPush`, is what tells you whether a feed is stale.
- `503` — `CRON_SECRET` is not set in this environment. Step 1 is incomplete.
- `401` — the secret does not match. No further detail is returned by design.
- A chain reporting `status: "not-self-hosted"` with `skipped` feeds is **correct**,
  not a failure: that chain uses a third-party aggregator and has no feed of ours.
  An unscoped run therefore returns 200 with only Robinhood transacting — except when
  a third-party chain's RPC throttles the read that establishes it has nothing to do,
  which is what section 2 is about.

Then drop `dryRun` and confirm a real push lands. The durable check is on chain, not
in this response — read the diamond's `getUsdValue` and compare age against that
feed's own `getFeedMaxAge`.

Narrow with `?chainId=46630` if a run gets close to the 60s `maxDuration`.
Narrowing is a latency choice, not a safety one.

## Related

- `src/lib/keeper/pushFeeds.ts` — what gets pushed, what does not, and why
- `docs/MULTICHAIN_DEPLOYMENT_MAP.md` — which chains have which oracle
- `.github/workflows/price-keeper.yml` — the hardhat keeper; leave it running as a
  third, unreliable safety net, but do not count it as a scheduler
