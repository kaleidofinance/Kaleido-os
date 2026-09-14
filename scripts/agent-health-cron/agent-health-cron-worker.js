/**
 * The clock and the alarm for /api/health/agent.
 *
 * The turn log (agent_turns) and the health endpoint make Luca's state
 * READABLE; this Worker is what makes a bad state HEARD. It calls the endpoint
 * on a cadence and, when the answer says the agent is unwell, throws — and a
 * thrown scheduled handler is what marks the invocation failed in Cloudflare,
 * which is the alert. Without it, the endpoint is a page someone has to remember
 * to open; with it, an outage pages the team on its own.
 *
 * ── What counts as "unwell", and why it is more than a non-200 ────────────────
 *
 * The health-watch Worker beside this one throws only on a non-200, which is
 * right for it. This endpoint is different: it answers 200 while REPORTING that
 * Luca cannot work — `ok:false` when no model provider key reached the
 * deployment (a rotated or deleted key, which used to look identical to a
 * provider outage) or when the quota counter is off (a missing service key, so
 * provider spend is unbounded). So a 200 is not enough; `ok` is read too. And a
 * rising failure rate over the last hour is a provider degrading even while a key
 * is present — a soft signal, alerted past a threshold with a minimum sample so a
 * single failure in a quiet hour does not page anyone.
 *
 * ── A SECOND Worker, deliberately ────────────────────────────────────────────
 *
 * Like scripts/health-cron, this is its own deployment rather than a second cron
 * on the keeper's: folding it in would make every edit here an edit to the price
 * keeper's deploy, and this is purely additive — deploying, breaking or deleting
 * it cannot touch a feed or a warning. The cost is that it must be armed with its
 * own secret; the mitigation is that the endpoint writes nothing and this Worker
 * is read-only, so a missed run costs only a missed check, and `lastGoodTurnAt`
 * in the response answers "has Luca answered anything lately" independently.
 *
 * It supplies a clock, a secret and a threshold. Who is healthy is the endpoint's
 * decision; if this file grows an opinion about a provider, it is in the wrong
 * place.
 */

/** Vercel's apex. `www.` 307-redirects, and a redirect is not a safe place to
 *  carry a bearer token. */
const DEFAULT_APP_URL = "https://kaleidofi.xyz";

/** The endpoint's own ceiling is 60s; past that the answer is not arriving. */
const REQUEST_TIMEOUT_MS = 70_000;

/** One retry, and only for the transient failures a retry can fix (a dropped
 *  connection, a 5xx). A 401 or a 200-ok:false is a configuration state — report
 *  it once, do not double the noise. Read-only, so a retry is always safe. */
const RETRY_DELAY_MS = 20_000;

/** The last-hour failure rate that counts as unwell, and the fewest turns that
 *  rate must be measured over — so one failure in a quiet hour is not an alarm.
 *  Both overridable, because the right numbers are a matter of live volume. */
const DEFAULT_FAILURE_RATE = 0.5;
const DEFAULT_MIN_SAMPLE = 10;

function healthUrl(env) {
  const base = (env.APP_URL || DEFAULT_APP_URL).replace(/\/+$/, "");
  return new URL(`${base}/api/health/agent`);
}

async function callHealth(url, secret) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      /* The endpoint accepts `Authorization: Bearer` or `X-Keeper-Secret` and
         compares with timingSafeEqual either way. Bearer, since nothing else
         here claims that header. */
      headers: { authorization: `Bearer ${secret}`, accept: "application/json" },
      signal: controller.signal,
    });
    return { status: response.status, body: await response.text() };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The verdict on one response: healthy, plus a one-line summary.
 *
 * Restated in Cloudflare because a run that never reached Vercel logs nothing
 * there — which is the failure this scheduler exists to make impossible to miss.
 * No user text and no address: the endpoint stores none, and this keeps it so.
 */
function evaluate(status, body, env) {
  if (status === 0) return { healthy: false, line: body };

  let p = null;
  try {
    p = JSON.parse(body);
  } catch {
    return { healthy: false, line: `${status} non-JSON: ${body.slice(0, 200)}` };
  }
  if (p?.error) return { healthy: false, line: `${status} ${p.error}` };

  const prov = p?.providers ?? {};
  const q = p?.globalQuota;
  const w = p?.window1h;

  const rateLimit = Number(env.AGENT_FAILURE_RATE ?? DEFAULT_FAILURE_RATE);
  const minSample = Number(env.AGENT_FAILURE_MIN_SAMPLE ?? DEFAULT_MIN_SAMPLE);
  const rate = Number(w?.failureRate ?? 0);
  const total = Number(w?.total ?? 0);
  const degraded =
    Number.isFinite(rateLimit) &&
    total >= minSample &&
    rate > rateLimit;

  const healthy = status === 200 && p?.ok === true && !degraded;

  const line =
    `${status} ok=${p?.ok} providers=${prov.count ?? "?"}(${prov.primary ?? "none"}) ` +
    `metered=${p?.metered}${q ? ` quota=${q.used}/${q.cap}` : ""}` +
    `${w ? ` fails=${w.failures}/${w.total}` : ""}` +
    `${degraded ? " DEGRADED" : ""}` +
    `${p?.lastGoodTurnAt ? ` lastOk=${p.lastGoodTurnAt}` : " lastOk=never"}`;
  return { healthy, line };
}

async function run(env) {
  const secret = env.AGENT_HEALTH_CRON_SECRET;
  if (!secret) {
    /* Unarmed is a state, not a bug — the same choice the endpoint makes about
       its own CRON_SECRET. Named with the exact command, because the whole cost
       of this failure is someone not knowing which one to run. */
    throw new Error(
      "AGENT_HEALTH_CRON_SECRET is not set, so there is nothing to authenticate " +
        "with. Set it to the same value as the Vercel project's CRON_SECRET:\n" +
        "  npx wrangler secret put AGENT_HEALTH_CRON_SECRET --config scripts/agent-health-cron/wrangler.toml",
    );
  }

  const url = healthUrl(env);
  let attempt = await callHealth(url, secret).catch((error) => ({
    status: 0,
    body: `fetch failed: ${error?.message ?? error}`,
  }));

  if (attempt.status === 0 || attempt.status >= 500) {
    console.warn(
      `[agent-health] ${evaluate(attempt.status, attempt.body, env).line} — retrying once`,
    );
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    attempt = await callHealth(url, secret).catch((error) => ({
      status: 0,
      body: `fetch failed: ${error?.message ?? error}`,
    }));
  }

  const { healthy, line } = evaluate(attempt.status, attempt.body, env);
  const full = `[agent-health] ${url.pathname} → ${line}`;
  if (!healthy) {
    /* Thrown, not swallowed. A thrown scheduled handler is what marks the
       invocation failed in Cloudflare's dashboard and triggers its notification;
       an invisibly failing monitor looks like a working one until the run that
       mattered. */
    console.error(full);
    throw new Error(full);
  }
  console.info(full);
  return full;
}

export default {
  /** The cron trigger. See wrangler.toml for the cadence. */
  async scheduled(event, env) {
    await run(env);
  },

  /**
   * The same run on demand — to prove a deploy without waiting out a cadence.
   * Guarded by the same secret: a workers.dev hostname is public, and an
   * unguarded trigger is a way to make the team's alerting fire on request.
   * Without the header it answers 401, so "is the Worker deployed?" can be asked
   * without holding any secret.
   */
  async fetch(request, env) {
    const offered = request.headers.get("authorization");
    const expected = env.AGENT_HEALTH_CRON_SECRET
      ? `Bearer ${env.AGENT_HEALTH_CRON_SECRET}`
      : null;
    if (!expected || offered !== expected) {
      return new Response(
        JSON.stringify({
          error: "Unauthorized.",
          armed: Boolean(env.AGENT_HEALTH_CRON_SECRET),
          target: healthUrl(env).toString(),
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
