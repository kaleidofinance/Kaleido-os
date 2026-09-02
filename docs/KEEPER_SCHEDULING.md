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

## 2. Primary scheduler: cron-job.org

Free, needs no repository change and no Vercel plan change, and unlike GitHub
Actions it actually fires on the interval it advertises.

- **URL** `https://kaleidofi.xyz/api/keeper/push?chainId=46630`
- **Schedule** every **15 minutes** (`*/15`) — four pushes per hour against a
  3600s bound, so three consecutive misses still leave the feed fresh.
- **Method** `POST` (the route accepts both; `GET` exists for Vercel Cron)
- **Header** `X-Keeper-Secret: <CRON_SECRET>`

**Scope it to 46630, and do not point the scheduler at the unscoped URL.** Robinhood
is the only chain with a feed of ours to push, and an unscoped run currently returns
**500** in production even when it succeeds: chains 97 and 11155111 exhaust their RPC
retries while discovering they have nothing to do, which counts as `failed: 2`
alongside `wouldPush: 2`. The same code returns `failed: 0` locally, so it is Vercel's
egress being rate-limited by those public RPCs rather than anything the keeper did.
Unscoped, a job with failure notifications on would therefore alert on every
successful run — which teaches you to ignore it, and the alert you then ignore is the
one that matters. Scoped, the run takes 1.7s instead of 13s.

Use `X-Keeper-Secret` rather than `Authorization: Bearer` here, because some
pingers reserve the `Authorization` header for their own use. Both are accepted and
compared with `timingSafeEqual`.

**Never put the secret in the query string.** The route refuses to read it from
there on purpose: a secret in a URL lands in access logs, referrer headers and
browser history.

Turn on failure notifications, and treat the status code as the signal — the route
answers **200 when nothing failed and 500 when something did**, mirroring the
hardhat keeper's exit code. "Every feed skipped because the source published
nothing new" is a **200**: that run succeeded and cost no gas.

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
