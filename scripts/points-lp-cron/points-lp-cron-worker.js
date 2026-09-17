/**
 * The clock for /api/cron/points-lp — the time-based LP points accrual.
 *
 * Our Arc V3 pools reward liquidity held IN-RANGE, per USD per day (`lp` is a
 * time source, not an event). The route snapshots every open position, values
 * the in-range ones, and accrues points against each wallet's previous snapshot.
 * See src/app/api/cron/points-lp.
 *
 * The route does nothing on its own: it answers `Authorization: Bearer
 * $CRON_SECRET`. This Worker is the clock that calls it, on Cloudflare's cron
 * triggers.
 *
 * ── Why a Cloudflare Worker ──────────────────────────────────────────────────
 *
 * Same reasoning as the keeper / waitlist / points-swap Workers: Vercel Hobby
 * caps a schedule at once a day, and Cloudflare's cron triggers are neither
 * best-effort nor rate-capped.
 *
 * ── Cadence matters here ─────────────────────────────────────────────────────
 *
 * Accrual credits min(previous, current) between snapshots — the anti-gaming
 * rule. So the snapshot interval IS the granularity: too sparse, and a wallet's
 * legitimate mid-interval dip is penalised for the whole interval. This runs
 * every 30 minutes (see wrangler.toml), finer than the swap indexer, so the
 * min() is taken over a short window and closely tracks real holdings.
 *
 * ── The secret ───────────────────────────────────────────────────────────────
 *
 * POINTS_LP_CRON_SECRET must equal the Vercel project's CRON_SECRET — the SAME
 * value the other cron Workers hold, because /api/cron/points-lp compares against
 * process.env.CRON_SECRET. A separate Worker needs its own copy (Cloudflare
 * secrets are per-Worker); the value is identical.
 *
 * ── Idempotent ───────────────────────────────────────────────────────────────
 *
 * Snapshots are unique on (wallet, source, block_number) and epochs on (wallet,
 * source, epoch_start), so a re-run or an overlapping schedule never
 * double-writes. There is no cursor — the last snapshot is the checkpoint.
 */

/** Vercel's apex. `www.` 307-redirects, and a redirect is not a safe place to
 *  carry a bearer token. */
const DEFAULT_APP_URL = "https://kaleidofi.xyz";

function baseUrl(env) {
  return (env.APP_URL || DEFAULT_APP_URL).replace(/\/+$/, "");
}

function accrualUrl(env) {
  return new URL(`${baseUrl(env)}/api/cron/points-lp`);
}

/** A hung fetch must be reported, not waited on. The route's own work is bounded
 *  by its 60s function budget, so anything well past that is not arriving. */
const REQUEST_TIMEOUT_MS = 70_000;

/** One retry, only for what a retry can fix: the accrual is idempotent, so a
 *  transient 5xx or a dropped connection is worth one more try; a 401/400 is a
 *  config mistake and retrying it just doubles the log noise. */
const RETRY_DELAY_MS = 20_000;

async function callAccrual(url, secret) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, accept: "application/json" },
      signal: controller.signal,
    });
    return { status: response.status, body: await response.text() };
  } finally {
    clearTimeout(timer);
  }
}

/** One line per run, readable without the body. The route returns
 *  `{ positionsRead, snapshotsWritten, epochsWritten, pointsAccrued, boost, skips }`
 *  (or `{ error }` / `{ skipped }`). */
function summarise(status, body) {
  if (status === 0) return body; // never completed
  let parsed = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    return `${status} non-JSON: ${body.slice(0, 200)}`;
  }
  if (parsed?.error) return `${status} ${parsed.error}`;
  if (parsed?.skipped) return `${status} skipped=${parsed.skipped}`;
  const skips = parsed?.skips
    ? Object.entries(parsed.skips)
        .map(([k, v]) => `${k}:${v}`)
        .join(",")
    : "";
  return (
    `${status} positions=${parsed?.positionsRead ?? "?"} ` +
    `epochs=${parsed?.epochsWritten ?? "?"} points=${parsed?.pointsAccrued ?? "?"} ` +
    `boost=${parsed?.boost ?? "?"}` +
    (skips ? ` skips=${skips}` : "")
  );
}

async function run(env) {
  const secret = env.POINTS_LP_CRON_SECRET;
  if (!secret) {
    throw new Error(
      "POINTS_LP_CRON_SECRET is not set, so there is nothing to authenticate with. " +
        "Set it to the same value as the Vercel project's CRON_SECRET:\n" +
        "  npx wrangler secret put POINTS_LP_CRON_SECRET --config scripts/points-lp-cron/wrangler.toml",
    );
  }

  const url = accrualUrl(env);
  let result = await callAccrual(url, secret).catch((error) => ({
    status: 0,
    body: `fetch failed: ${error?.message ?? error}`,
  }));

  if (result.status === 0 || result.status >= 500) {
    console.warn(`[points-lp-cron] ${summarise(result.status, result.body)} — retrying once`);
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    result = await callAccrual(url, secret).catch((error) => ({
      status: 0,
      body: `fetch failed: ${error?.message ?? error}`,
    }));
  }

  const line = `[points-lp-cron] ${url.pathname} → ${summarise(result.status, result.body)}`;
  if (result.status !== 200) {
    // Thrown, not swallowed: a thrown scheduled handler marks the invocation
    // failed in Cloudflare's dashboard. A silently dead accrual is a silent
    // outage — liquidity would stop earning points.
    console.error(line);
    throw new Error(line);
  }
  console.info(line);
  return line;
}

export default {
  async scheduled(event, env) {
    await run(env);
  },

  /** The same run on demand — to prove a deploy works without waiting a cadence.
   *  Guarded by the same secret: a workers.dev hostname is public, and an
   *  unguarded trigger for a ledger writer is the open-relay problem. */
  async fetch(request, env) {
    const offered = request.headers.get("authorization");
    const expected = env.POINTS_LP_CRON_SECRET
      ? `Bearer ${env.POINTS_LP_CRON_SECRET}`
      : null;
    if (!expected || offered !== expected) {
      return new Response(
        JSON.stringify({
          error: "Unauthorized.",
          armed: Boolean(env.POINTS_LP_CRON_SECRET),
          target: accrualUrl(env).toString(),
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
