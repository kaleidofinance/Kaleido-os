/**
 * The clock for /api/keeper/push AND /api/keeper/candles.
 *
 * Two jobs on the one 15-minute tick, because 15 minutes is the right cadence
 * for both and a second Worker would be a second thing to deploy, arm and watch
 * for the same clock. The push keeps a self-hosted price feed inside its
 * freshness bound; the candles fold the KLD pool's swaps into a 15m bucket. They
 * are INDEPENDENT — each is called on its own, each retried on its own, and a
 * failure in one is reported without hiding or being hidden by the other — but
 * they share this file's one contribution: a clock, a secret and a chain list.
 * Everything about what either endpoint actually does lives behind it.
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

/**
 * The chains the candle indexer is pointed at.
 *
 * Not the push's list. KLD/USDC pools exist on four chains — Sepolia (11155111),
 * Base (84532), BSC (97) and Robinhood (46630) — and NOT on Arc (5042002), so
 * Arc is left off rather than scanned to be skipped. Scoped for the same reason
 * the push is: the route's ceiling is 60s and an unscoped run pays a getLogs
 * sweep on every registry chain to reach the same four. Override with
 * CANDLE_CHAIN_IDS if a pool lands on a fifth.
 */
const DEFAULT_CANDLE_CHAIN_IDS = "11155111,84532,97,46630";

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

function baseUrl(env) {
  return (env.APP_URL || DEFAULT_APP_URL).replace(/\/+$/, "");
}

function pushUrl(env) {
  const chains = (env.KEEPER_CHAIN_IDS ?? DEFAULT_CHAIN_IDS).trim();
  const url = new URL(`${baseUrl(env)}/api/keeper/push`);
  if (chains) url.searchParams.set("chainId", chains);
  return url;
}

function candlesUrl(env) {
  const chains = (env.CANDLE_CHAIN_IDS ?? DEFAULT_CANDLE_CHAIN_IDS).trim();
  const url = new URL(`${baseUrl(env)}/api/keeper/candles`);
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

/**
 * The candle route's shape, which is not the push's.
 *
 * It returns `{ dryRun, results: [{ chainId, pool, swaps, candles, wrote,
 * error }] }`. A chain with no KLD pool comes back `pool: null` and is a clean
 * skip, not a failure. The line restates the candles written and flags any chain
 * that reported an error, so a failing indexer is legible in Cloudflare's log
 * without opening Vercel's — the same reason the push summary is restated here.
 */
function summariseCandles(status, body) {
  if (status === 0) return body;

  let parsed = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    return `${status} non-JSON: ${body.slice(0, 200)}`;
  }
  if (parsed?.error) return `${status} ${parsed.error}`;

  const results = parsed?.results ?? [];
  const wrote = results.reduce((n, r) => n + (r?.wrote ? r.candles : 0), 0);
  const perChain = results
    .map((r) =>
      r?.pool
        ? `${r.chainId}:${r.swaps ?? "?"}sw/${r.candles ?? "?"}c${r.error ? "!" : ""}`
        : `${r.chainId}:no-pool`,
    )
    .join(" ");
  return `${status} candles=${wrote}${perChain ? ` ${perChain}` : ""}`;
}

/**
 * One endpoint, called with the one retry the failures a retry can fix deserve.
 *
 * Extracted so push and candles share the exact same call, retry and reporting
 * rules — a divergence between them is a divergence nobody asked for. Returns
 * whether it succeeded and the line to log; the caller decides what a failure
 * means for the invocation as a whole.
 */
async function attempt(url, secret, summarise) {
  let result = await callPush(url, secret).catch((error) => ({
    status: 0,
    body: `fetch failed: ${error?.message ?? error}`,
  }));

  const worthRetrying = result.status === 0 || result.status >= 500;
  if (worthRetrying) {
    console.warn(`[keeper-cron] ${summarise(result.status, result.body)} — retrying once`);
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    result = await callPush(url, secret).catch((error) => ({
      status: 0,
      body: `fetch failed: ${error?.message ?? error}`,
    }));
  }

  const line = `[keeper-cron] ${url.pathname}${url.search} → ${summarise(result.status, result.body)}`;
  return { ok: result.status === 200, line };
}

/**
 * Both jobs, on one tick, independent.
 *
 * Push and candles are called together (Promise.all) rather than in sequence,
 * because neither waits on the other and the invocation's own ceiling is better
 * spent overlapping two waits than stacking them. Each is judged on its own
 * status. The invocation is marked failed if EITHER failed — a silently failing
 * candle indexer is the same anti-pattern as a silently failing push, so both
 * are made loud — and the thrown message names every line that failed so the
 * dashboard says which job, not just that one did.
 */
async function runAll(env) {
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

  const results = await Promise.all([
    attempt(pushUrl(env), secret, summarise),
    attempt(candlesUrl(env), secret, summariseCandles),
  ]);

  for (const r of results) (r.ok ? console.info : console.error)(r.line);

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    /* Thrown, not logged and swallowed. A thrown scheduled handler is what marks
       the invocation failed in Cloudflare's dashboard, and an invisible failing
       keeper is the exact shape of the outage this replaces. */
    throw new Error(failed.map((r) => r.line).join(" | "));
  }
  return results.map((r) => r.line).join(" | ");
}

export default {
  /** The cron trigger. See wrangler.toml for the cadence and why. */
  async scheduled(event, env) {
    await runAll(env);
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
          targets: [pushUrl(env).toString(), candlesUrl(env).toString()],
        }),
        { status: 401, headers: { "content-type": "application/json" } },
      );
    }
    try {
      return new Response(JSON.stringify({ ok: true, detail: await runAll(env) }), {
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
