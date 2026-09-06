/**
 * The clock for /api/health/watch.
 *
 * `lib/notifications/emit.ts` calls the health-factor warning "the one alert in
 * this app that has to arrive". Until this Worker exists it arrives only while a
 * tab is open: `useGetValueAndHealth.ts` reads `getHealthFactor` in an effect with
 * no interval, so the warning fires on connect and then not again. A position that
 * drifts toward liquidation overnight is a position nobody is told about.
 *
 * ── Why a Worker and not the two schedulers already in the repo ──────────────
 *
 *   • .github/workflows/* is best-effort. Measured 2026-09-01 against the price
 *     keeper: 47 runs delivered in 152 hours where the schedule asked for ~456 —
 *     one per ~3.2h, and GitHub does not make up a dropped run. For a price feed
 *     that meant a blown freshness bound; for a liquidation warning it means the
 *     alert lands after the liquidation.
 *   • Vercel Cron would send the Authorization header itself, but this project is
 *     on the Hobby plan, which caps a schedule at once a day.
 *
 * Cloudflare's cron triggers are neither best-effort nor rate-capped, and this
 * repo already deploys two Workers (scripts/relay/, scripts/keeper-cron/), so the
 * account, the CLI and the review path exist.
 *
 * ── Why a SECOND Worker rather than a second cron on the keeper's ────────────
 *
 * One Worker can carry several cron expressions and branch on `event.cron`, and
 * doing that would mean one deployment and one secret to arm instead of two. It is
 * still the wrong trade here: scripts/keeper-cron is the only thing keeping
 * Robinhood's ETH feed inside its 3600s bound, and every borrow, health read and
 * liquidation on that chain reverts `Protocol__StalePrice` when it lapses. Folding
 * a second job into it makes every future edit to the health monitor an edit to
 * the price keeper's deploy. This Worker is purely additive: deploying, breaking
 * or deleting it cannot affect the feeds.
 *
 * The cost of that choice is real and worth stating: two Workers must both be
 * armed with the same value, and one can silently stop while the other runs. The
 * mitigation is on the route's side — `last_check_at` in `health_watch_state` is
 * written on every run, so "the monitor has not run since Tuesday" is a question
 * the database answers rather than something to infer from an absence of alerts.
 *
 * ── What it does NOT decide ──────────────────────────────────────────────────
 *
 * Who is at risk, what counts as at risk, the cooldown, and whether a push may be
 * sent at all are all decided by src/lib/health/monitor.ts behind the endpoint.
 * This file supplies a clock and a secret. If it ever grows an opinion about a
 * health factor, it is in the wrong place.
 *
 * (Cron expressions are kept out of this comment on purpose: a five-field cron
 * contains the two characters that end a block comment. They live in
 * wrangler.toml, which is where the schedule is declared anyway.)
 */

/** Vercel's apex. `www.` 307-redirects, and a redirect is not a safe place to
 *  carry a bearer token. */
const DEFAULT_APP_URL = "https://kaleidofi.xyz";

/** A hung fetch must be reported, not waited on: the endpoint's own ceiling is
 *  60s, so anything past that is not going to arrive. */
const REQUEST_TIMEOUT_MS = 70_000;

/**
 * One retry, and only for the failures a retry can fix.
 *
 * Repeating this run is safe in a way the price keeper's is not quite: nothing is
 * signed, and the cooldown in `health_watch_state` is written only after a push
 * succeeds, so a retry after a partial run re-sends only what did not go out. A
 * 401 or a 400 is a configuration mistake and retrying it doubles the log noise,
 * so those are reported once and left alone.
 */
const RETRY_DELAY_MS = 20_000;

function watchUrl(env) {
  const base = (env.APP_URL || DEFAULT_APP_URL).replace(/\/+$/, "");
  const url = new URL(`${base}/api/health/watch`);
  /* Unset by default, and that is the opposite of the keeper's default.
     `HEALTH_CHAIN_IDS` narrowing exists only as an escape hatch for a run that
     cannot finish inside maxDuration — every tradable chain has a lending
     deployment and a borrower on any of them can be liquidated, so scoping to one
     chain here would mean not watching the other four. */
  const chains = (env.HEALTH_CHAIN_IDS ?? "").trim();
  if (chains) url.searchParams.set("chainId", chains);
  /* An explicit "1" only. A dry run reads everything, decides everything and
     sends nothing — useful for proving a deploy, wrong to leave on, and a var
     that turned it on for any non-empty value would do so for "0" and "false". */
  if (String(env.HEALTH_DRY_RUN ?? "").trim() === "1") {
    url.searchParams.set("dryRun", "1");
  }
  return url;
}

async function callWatch(url, secret) {
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
 * One line per run, readable without the response body.
 *
 * A cron's response body goes nowhere. The endpoint logs its own summary into
 * Vercel, but a run that never reached Vercel logs nothing there — which is the
 * failure this scheduler exists to make impossible to miss. So the counts are
 * restated here, in Cloudflare, where the schedule can be seen to have fired.
 *
 * No wallet addresses. The body carries them per chain and they are not secret,
 * but a Worker log is a different retention and access surface from the app's,
 * and "who is near liquidation" is not a list to leave lying in a second place.
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
    .map((c) => `${c.network}:${c.status}(${c.borrowers ?? "?"}b)`)
    .join(" ");
  return (
    `${status} ${parsed?.dryRun ? "DRY " : ""}warned=${parsed?.warned ?? "?"} ` +
    `wouldWarn=${parsed?.wouldWarn ?? "?"} failed=${parsed?.failed ?? "?"}` +
    `${chains ? ` ${chains}` : ""}`
  );
}

async function run(env) {
  const secret = env.HEALTH_CRON_SECRET;
  if (!secret) {
    /* Unarmed is a state, not a bug — the same choice the route makes about its
       own CRON_SECRET. Named with the exact command, because the whole cost of
       this failure is someone not knowing which one to run. */
    throw new Error(
      "HEALTH_CRON_SECRET is not set, so there is nothing to authenticate with. " +
        "Set it to the same value as the Vercel project's CRON_SECRET:\n" +
        "  npx wrangler secret put HEALTH_CRON_SECRET --config scripts/health-cron/wrangler.toml",
    );
  }

  const url = watchUrl(env);
  let attempt = await callWatch(url, secret).catch((error) => ({
    status: 0,
    body: `fetch failed: ${error?.message ?? error}`,
  }));

  const worthRetrying = attempt.status === 0 || attempt.status >= 500;
  if (worthRetrying) {
    console.warn(
      `[health-cron] ${summarise(attempt.status, attempt.body)} — retrying once`,
    );
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    attempt = await callWatch(url, secret).catch((error) => ({
      status: 0,
      body: `fetch failed: ${error?.message ?? error}`,
    }));
  }

  const line = `[health-cron] ${url.pathname}${url.search} → ${summarise(attempt.status, attempt.body)}`;
  if (attempt.status !== 200) {
    /* Thrown, not logged and swallowed. A thrown scheduled handler is what marks
       the invocation failed in Cloudflare's dashboard, and an invisibly failing
       monitor is worse than none: it looks like a working alerting system right up
       to the run that mattered. */
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
   * Guarded by the same secret as the endpoint: a workers.dev hostname is public,
   * and an unguarded trigger here is a way to make someone's phone buzz on
   * request until they turn notifications off. Without the header this answers 401
   * and does nothing, which also makes "is the Worker deployed and reachable?" a
   * question that can be answered without holding any secret at all.
   */
  async fetch(request, env) {
    const offered = request.headers.get("authorization");
    const expected = env.HEALTH_CRON_SECRET
      ? `Bearer ${env.HEALTH_CRON_SECRET}`
      : null;
    if (!expected || offered !== expected) {
      return new Response(
        JSON.stringify({
          error: "Unauthorized.",
          armed: Boolean(env.HEALTH_CRON_SECRET),
          target: watchUrl(env).toString(),
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
