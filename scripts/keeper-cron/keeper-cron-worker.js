/**
 * The clock for /api/keeper/push.
 *
 * Robinhood's ETH/WETH feed is one we publish ourselves, and ProtocolFacet ages a
 * price as `block.timestamp - updatedAt` against a per-feed bound. Measured
 * 2026-09-02 by a dry run of `pushSelfHostedFeeds`:
 *
 *   ETH,WETH  bound 3600s   (per-feed override)
 *   USDC      bound 90000s  (per-feed override)
 *
 * So the whole job is: something must call the push endpoint more often than once
 * an hour, forever. Two things already exist and neither can do it.
 *
 *   • .github/workflows/price-keeper.yml is correct and asks for every 20
 *     minutes, but GitHub drops scheduled runs under load and does not make them
 *     up. Measured 2026-09-01: 47 runs in 152 hours, one per ~3.2h — three times
 *     the bound.
 *   • Vercel Cron would send the Authorization header on its own, but this project
 *     is on the Hobby plan (confirmed via the teams API), which caps a schedule at
 *     once a day. A daily cron against a 3600s bound is not a smaller version of
 *     the fix; it is the same outage with a cron entry next to it.
 *
 * Cloudflare's cron triggers are neither best-effort nor rate-capped, and this
 * repo already deploys a Worker (scripts/relay/ — the AgentRouter relay), so the
 * account, the CLI and the review path all exist. That is why the scheduler lives
 * here rather than in a third-party pinger's web console: a pinger configured by
 * hand cannot be reviewed, redeployed, or explained by reading the repo.
 *
 * ── What it does NOT decide ──────────────────────────────────────────────────
 *
 * Everything about which feeds get pushed, whether a price is fresh enough to be
 * worth a transaction, and whether the keeper may sign at all is decided by
 * src/lib/keeper/pushFeeds.ts behind the endpoint. This file supplies a clock, a
 * secret and a chain list. If it ever grows a decision about prices, it is in the
 * wrong place.
 *
 * ── Cost, so the cadence is a measurement and not a guess ────────────────────
 *
 * Measured on chain 46630, 2026-09-02: `pushAnswer` estimates 45,286 gas at
 * 0.01 gwei — 0.00000045 ETH a push. Both feeds every 15 minutes is 0.000087 a
 * day, and the keeper (0xB37d…99aE) held 0.0199, which is ~229 days. Gas is
 * therefore not a reason to narrow the cadence or the symbol list, and both feeds
 * are pushed on every run rather than only the one with the tight bound.
 *
 * (Cron expressions are kept out of this comment on purpose: a five-field cron
 * contains the two characters that end a block comment. They live in
 * wrangler.toml, which is where the schedule is actually declared anyway.)
 */

/** Vercel's apex. `www.` 307-redirects, and a redirect is not a safe place to
 *  carry a bearer token. */
const DEFAULT_APP_URL = "https://kaleidofi.xyz";

/**
 * Only Robinhood, and not because the others are less important.
 *
 * A dry run across every chain whose oracle is an AggregatorPriceOracle (97,
 * 46630, 84532, 11155111) reports `not-self-hosted` for all but 46630: their
 * feeds are third-party aggregators that publish themselves, so a keeper run
 * there is a few reads and no transaction. Narrowing is a latency choice — the
 * endpoint's maxDuration is 60s and an unscoped run pays four chains' RPC round
 * trips to reach the same one push.
 *
 * To re-derive rather than trust this: call the endpoint with `?dryRun=1` and no
 * `chainId`, and read which chains come back `not-self-hosted`. If a new chain
 * starts self-hosting its feeds it will appear as `dry-run`, and this list is
 * what has to change — the schedule will not notice on its own.
 */
const DEFAULT_CHAIN_IDS = "46630";

/** A hung fetch must be reported, not waited on: the endpoint's own ceiling is
 *  60s, so anything past that is not going to arrive. */
const REQUEST_TIMEOUT_MS = 70_000;

/**
 * One retry, and only for the failures a retry can fix.
 *
 * A push is safe to repeat: the feed rejects an `observedAt` that is not strictly
 * newer than the stored answer, and the endpoint checks that off-chain before
 * spending gas, so a duplicate costs a read. A 401 or a 400 is a configuration
 * mistake and retrying it just doubles the log noise, so those are reported once
 * and left alone.
 */
const RETRY_DELAY_MS = 20_000;

function pushUrl(env) {
  const base = (env.APP_URL || DEFAULT_APP_URL).replace(/\/+$/, "");
  const chains = (env.KEEPER_CHAIN_IDS ?? DEFAULT_CHAIN_IDS).trim();
  const url = new URL(`${base}/api/keeper/push`);
  if (chains) url.searchParams.set("chainId", chains);
  return url;
}

async function callPush(url, secret) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      /* The endpoint accepts `Authorization: Bearer` or `X-Keeper-Secret`, and
         compares with timingSafeEqual either way. Bearer, because nothing else
         here claims that header. */
      headers: { authorization: `Bearer ${secret}`, accept: "application/json" },
      signal: controller.signal,
    });
    const text = await response.text();
    return { status: response.status, body: text };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One line per run, and it has to be readable without the response body.
 *
 * A cron's response body goes nowhere. The endpoint logs its own summary into
 * Vercel, but a run that never reached Vercel logs nothing there — which is the
 * failure this scheduler exists to make impossible to miss. So the counts are
 * restated here, in Cloudflare, where the schedule can be seen to have fired.
 */
function summarise(status, body) {
  /* Status 0 is this file's marker for "the request never completed". Saying
     "non-JSON" about it would describe a body that does not exist and send the
     next reader looking at the route. */
  if (status === 0) return body;

  let parsed = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    /* An HTML body means something answered that was not the route — a redirect
       landing page, or a platform error page. Say so with a slice rather than
       claiming a shape it does not have. */
    return `${status} non-JSON: ${body.slice(0, 200)}`;
  }
  if (parsed?.error) return `${status} ${parsed.error}`;
  const chains = (parsed?.chains ?? [])
    .map((c) => `${c.network}:${c.status}`)
    .join(" ");
  return (
    `${status} pushed=${parsed?.pushed ?? "?"} wouldPush=${parsed?.wouldPush ?? "?"} ` +
    `failed=${parsed?.failed ?? "?"}${chains ? ` ${chains}` : ""}`
  );
}

async function run(env) {
  const secret = env.KEEPER_CRON_SECRET;
  if (!secret) {
    /* Unarmed is a state, not a bug — the same choice the route makes about its
       own CRON_SECRET. Named with the exact command, because the whole cost of
       this failure is someone not knowing which one to run. */
    throw new Error(
      "KEEPER_CRON_SECRET is not set, so there is nothing to authenticate with. " +
        "Set it to the same value as the Vercel project's CRON_SECRET:\n" +
        "  npx wrangler secret put KEEPER_CRON_SECRET --config scripts/keeper-cron/wrangler.toml",
    );
  }

  const url = pushUrl(env);
  let attempt = await callPush(url, secret).catch((error) => ({
    status: 0,
    body: `fetch failed: ${error?.message ?? error}`,
  }));

  const worthRetrying = attempt.status === 0 || attempt.status >= 500;
  if (worthRetrying) {
    console.warn(`[keeper-cron] ${summarise(attempt.status, attempt.body)} — retrying once`);
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    attempt = await callPush(url, secret).catch((error) => ({
      status: 0,
      body: `fetch failed: ${error?.message ?? error}`,
    }));
  }

  const line = `[keeper-cron] ${url.pathname}${url.search} → ${summarise(attempt.status, attempt.body)}`;
  if (attempt.status !== 200) {
    /* Thrown, not logged and swallowed. A thrown scheduled handler is what marks
       the invocation failed in Cloudflare's dashboard, and an invisible failing
       keeper is the exact shape of the outage this replaces. */
    console.error(line);
    throw new Error(line);
  }
  console.info(line);
  return line;
}

export default {
  /** The cron trigger. See wrangler.toml for the cadence and why. */
  async scheduled(event, env) {
    await run(env);
  },

  /**
   * The same run, on demand — for proving a deploy works without waiting out a
   * cadence, and for a manual catch-up.
   *
   * Guarded by the same secret as the push itself: a workers.dev hostname is
   * public, and an unguarded trigger for a gas-spending endpoint is the open
   * relay problem again. Without the header this answers 401 and does nothing,
   * which also makes "is the Worker deployed and reachable?" a question that can
   * be answered without holding any secret at all.
   */
  async fetch(request, env) {
    const offered = request.headers.get("authorization");
    const expected = env.KEEPER_CRON_SECRET
      ? `Bearer ${env.KEEPER_CRON_SECRET}`
      : null;
    if (!expected || offered !== expected) {
      return new Response(
        JSON.stringify({
          error: "Unauthorized.",
          armed: Boolean(env.KEEPER_CRON_SECRET),
          target: pushUrl(env).toString(),
        }),
        { status: 401, headers: { "content-type": "application/json" } },
      );
    }
    try {
      return new Response(JSON.stringify({ ok: true, detail: await run(env) }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    } catch (error) {
      return new Response(
        JSON.stringify({ ok: false, error: error?.message ?? String(error) }),
        { status: 502, headers: { "content-type": "application/json" } },
      );
    }
  },
};
