/**
 * The clock for /api/waitlist/activate — the waitlist points activation reader.
 *
 * A wallet's pending waitlist points (welcome + referral + X tasks) stay a
 * number on a page until the wallet proves it is a real, active user by
 * transacting on Arc mainnet. The activation route walks the oldest
 * not-yet-activated waitlist rows, checks each on Arc mainnet, and for the ones
 * that have transacted writes the canonical Season-1 credit as a `point_actions`
 * row (which the Phase-1 materializer trigger then folds into `point_balances`,
 * so the wallet appears on the leaderboard). See src/app/api/waitlist/activate.
 *
 * The route does not schedule itself. It answers `Authorization: Bearer
 * $CRON_SECRET` and does nothing on its own — so something must call it, on a
 * clock, forever. This Worker is that clock.
 *
 * ── Why a Cloudflare Worker and not a Vercel cron ────────────────────────────
 *
 * Same reasoning as scripts/keeper-cron (read its header for the full argument):
 * this project is on Vercel's Hobby plan, which caps a schedule at once a day —
 * useless for draining a backlog of thousands. Cloudflare's cron triggers are
 * neither best-effort nor rate-capped, the account and CLI already exist for the
 * keeper and relay Workers, and a scheduler that lives in the repo can be
 * reviewed, redeployed and explained by reading it — a hand-configured web
 * pinger cannot.
 *
 * ── The secret ───────────────────────────────────────────────────────────────
 *
 * WAITLIST_CRON_SECRET must equal the Vercel project's CRON_SECRET — the SAME
 * value the keeper Worker holds as KEEPER_CRON_SECRET, because /api/keeper/push
 * and /api/waitlist/activate both compare against `process.env.CRON_SECRET` with
 * timingSafeEqual. A separate Worker needs its own copy because Cloudflare
 * secrets are per-Worker; the value is identical.
 *
 * ── Idempotent, so cadence is free to be generous ────────────────────────────
 *
 * The credit's tx_hash is synthetic and stable per wallet (`waitlist:<wallet>`)
 * under a unique (chain_id, tx_hash) constraint, so a wallet is credited at most
 * once no matter how often this fires. The route also commits per wallet inside
 * its loop, so a run that is cut short by the function's time budget still keeps
 * whatever it activated; the next run resumes from the oldest still-pending row.
 *
 * (Cron expressions live in wrangler.toml, not here: a five-field cron contains
 * the two characters that end a block comment.)
 */

/** Vercel's apex. `www.` 307-redirects, and a redirect is not a safe place to
 *  carry a bearer token. */
const DEFAULT_APP_URL = "https://kaleidofi.xyz";

/**
 * No `?limit`, so the route uses its own DEFAULT_LIMIT (50).
 *
 * The route checks each pending wallet against Arc mainnet sequentially, so the
 * batch size it can finish inside the function's time budget is what bounds a
 * run — not a number chosen here. 50 is the route author's deliberate default
 * for exactly this "a cron calls it repeatedly" usage; overriding it upward only
 * risks the function timing out mid-batch. Set WAITLIST_LIMIT to override if the
 * route's budget is later raised (e.g. an explicit maxDuration).
 */
function activateUrl(env) {
  const url = new URL(`${baseUrl(env)}/api/waitlist/activate`);
  const limit = (env.WAITLIST_LIMIT ?? "").trim();
  if (limit) url.searchParams.set("limit", limit);
  return url;
}

function baseUrl(env) {
  return (env.APP_URL || DEFAULT_APP_URL).replace(/\/+$/, "");
}

/** A hung fetch must be reported, not waited on. The route's own work is
 *  bounded by the Vercel function timeout, so anything well past that is not
 *  going to arrive. */
const REQUEST_TIMEOUT_MS = 70_000;

/** One retry, only for the failures a retry can fix. The activation is safe to
 *  repeat (synthetic tx_hash → credited at most once), so a transient 5xx or a
 *  dropped connection is worth one more try; a 401/400 is a config mistake and
 *  retrying it just doubles the log noise. */
const RETRY_DELAY_MS = 20_000;

async function callActivate(url, secret) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      /* The route accepts `Authorization: Bearer` or `X-Cron-Secret`, comparing
         with timingSafeEqual either way. Bearer, because nothing else here
         claims that header. */
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
 * A cron's response body goes nowhere; the route logs into Vercel, but a run
 * that never reached Vercel logs nothing there — which is the failure this
 * scheduler exists to make impossible to miss. So the counts are restated here,
 * in Cloudflare, where the schedule can be seen to have fired. The route returns
 * `{ ok, scanned, activated, remainingChecked, limit, errors }`; a non-empty
 * `errors` array (per-wallet RPC/insert hiccups) rides in a 200 body and is a
 * "left it pending for next run", not a run failure.
 */
function summarise(status, body) {
  /* Status 0 is this file's marker for "the request never completed". */
  if (status === 0) return body;

  let parsed = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    /* An HTML body means something answered that was not the route — a redirect
       landing page, or a platform error page. Say so with a slice. */
    return `${status} non-JSON: ${body.slice(0, 200)}`;
  }
  if (parsed?.error) return `${status} ${parsed.error}`;
  const errs = Array.isArray(parsed?.errors) ? parsed.errors.length : 0;
  return (
    `${status} scanned=${parsed?.scanned ?? "?"} activated=${parsed?.activated ?? "?"} ` +
    `limit=${parsed?.limit ?? "?"}${errs ? ` errors=${errs}` : ""}`
  );
}

/**
 * The one endpoint, with the one retry the failures a retry can fix deserve.
 */
async function run(env) {
  const secret = env.WAITLIST_CRON_SECRET;
  if (!secret) {
    /* Unarmed is a state, not a bug — the same choice the route makes about its
       own CRON_SECRET. Named with the exact command, because the whole cost of
       this failure is someone not knowing which one to run. */
    throw new Error(
      "WAITLIST_CRON_SECRET is not set, so there is nothing to authenticate with. " +
        "Set it to the same value as the Vercel project's CRON_SECRET:\n" +
        "  npx wrangler secret put WAITLIST_CRON_SECRET --config scripts/waitlist-activation-cron/wrangler.toml",
    );
  }

  const url = activateUrl(env);
  let result = await callActivate(url, secret).catch((error) => ({
    status: 0,
    body: `fetch failed: ${error?.message ?? error}`,
  }));

  const worthRetrying = result.status === 0 || result.status >= 500;
  if (worthRetrying) {
    console.warn(`[waitlist-activation-cron] ${summarise(result.status, result.body)} — retrying once`);
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    result = await callActivate(url, secret).catch((error) => ({
      status: 0,
      body: `fetch failed: ${error?.message ?? error}`,
    }));
  }

  const line = `[waitlist-activation-cron] ${url.pathname}${url.search} → ${summarise(result.status, result.body)}`;
  if (result.status !== 200) {
    /* Thrown, not logged and swallowed: a thrown scheduled handler is what marks
       the invocation failed in Cloudflare's dashboard. A silently failing
       activation drain is a silent outage — waitlist users would never migrate. */
    console.error(line);
    throw new Error(line);
  }
  console.info(line);
  return line;
}

export default {
  /** The cron trigger. See wrangler.toml for the cadence. */
  async scheduled(event, env) {
    await run(env);
  },

  /**
   * The same run, on demand — for proving a deploy works without waiting out a
   * cadence, and for a manual catch-up. Guarded by the same secret as the route:
   * a workers.dev hostname is public, and an unguarded trigger for a ledger
   * writer is the open-relay problem. Without the header this answers 401, which
   * also makes "is the Worker deployed and reachable?" answerable while holding
   * no secret at all.
   */
  async fetch(request, env) {
    const offered = request.headers.get("authorization");
    const expected = env.WAITLIST_CRON_SECRET
      ? `Bearer ${env.WAITLIST_CRON_SECRET}`
      : null;
    if (!expected || offered !== expected) {
      return new Response(
        JSON.stringify({
          error: "Unauthorized.",
          armed: Boolean(env.WAITLIST_CRON_SECRET),
          target: activateUrl(env).toString(),
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
