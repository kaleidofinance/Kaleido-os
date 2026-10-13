/**
 * The clock for /api/cron/points-swap — the swap-points indexer.
 *
 * Our Arc swaps pay a 0.2% fee (a transfer of the output token to
 * SWAP_FEE_RECEIVER). The route scans a recent window of those transfers and
 * credits each swapper's Season-1 `swap` points for the USD value of their input
 * leg — idempotent on the swap's real tx_hash, so nothing is double-credited.
 * See src/app/api/cron/points-swap.
 *
 * The route does not schedule itself: it answers `Authorization: Bearer
 * $CRON_SECRET` and does nothing on its own. This Worker is the clock that calls
 * it, on Cloudflare's cron triggers.
 *
 * ── Why a Cloudflare Worker and not a Vercel cron ────────────────────────────
 *
 * Same reasoning as scripts/keeper-cron and scripts/waitlist-activation-cron
 * (read their headers): Vercel's Hobby plan caps a schedule at once a day.
 * Cloudflare's cron triggers are neither best-effort nor rate-capped, the account
 * and CLI already exist for the other Workers, and a scheduler that lives in the
 * repo can be reviewed and redeployed by reading it.
 *
 * ── The secret ───────────────────────────────────────────────────────────────
 *
 * POINTS_SWAP_CRON_SECRET must equal the Vercel project's CRON_SECRET — the SAME
 * value the keeper and waitlist Workers hold, because /api/cron/points-swap
 * compares against process.env.CRON_SECRET. A separate Worker needs its own copy
 * because Cloudflare secrets are per-Worker; the value is identical.
 *
 * ── Idempotent, so cadence is free ───────────────────────────────────────────
 *
 * The credit's tx_hash is the swap's real on-chain hash under a unique
 * constraint, so a swap is credited at most once no matter how often this fires
 * or how far the scan windows overlap. The credit itself is the checkpoint — no
 * cursor to keep.
 *
 * (Cron expressions live in wrangler.toml, not here: a five-field cron contains
 * the two characters that end a block comment.)
 */

/** Vercel's apex. `www.` 307-redirects, and a redirect is not a safe place to
 *  carry a bearer token. */
const DEFAULT_APP_URL = "https://kaleidofi.xyz";

function baseUrl(env) {
  return (env.APP_URL || DEFAULT_APP_URL).replace(/\/+$/, "");
}

function indexerUrl(env) {
  return new URL(`${baseUrl(env)}/api/cron/points-swap`);
}

/** A hung fetch must be reported, not waited on. The route's own work is bounded
 *  by its 60s function budget, so anything well past that is not arriving. */
const REQUEST_TIMEOUT_MS = 70_000;

/** One retry, only for what a retry can fix: the credit is safe to repeat
 *  (idempotent tx_hash), so a transient 5xx or a dropped connection is worth one
 *  more try; a 401/400 is a config mistake and retrying it just doubles the log
 *  noise. */
const RETRY_DELAY_MS = 20_000;

async function callIndexer(url, secret) {
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
 *  `{ scanned, credited, skips }` (or `{ error }` / `{ skipped }`). */
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
    `${status} scanned=${parsed?.scanned ?? "?"} credited=${parsed?.credited ?? "?"}` +
    (skips ? ` skips=${skips}` : "")
  );
}

async function run(env) {
  const secret = env.POINTS_SWAP_CRON_SECRET;
  if (!secret) {
    throw new Error(
      "POINTS_SWAP_CRON_SECRET is not set, so there is nothing to authenticate with. " +
        "Set it to the same value as the Vercel project's CRON_SECRET:\n" +
        "  npx wrangler secret put POINTS_SWAP_CRON_SECRET --config scripts/points-swap-cron/wrangler.toml",
    );
  }

  const url = indexerUrl(env);
  let result = await callIndexer(url, secret).catch((error) => ({
    status: 0,
    body: `fetch failed: ${error?.message ?? error}`,
  }));

  if (result.status === 0 || result.status >= 500) {
    console.warn(`[points-swap-cron] ${summarise(result.status, result.body)} — retrying once`);
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    result = await callIndexer(url, secret).catch((error) => ({
      status: 0,
      body: `fetch failed: ${error?.message ?? error}`,
    }));
  }

  const line = `[points-swap-cron] ${url.pathname} → ${summarise(result.status, result.body)}`;
  if (result.status !== 200) {
    // Thrown, not swallowed: a thrown scheduled handler marks the invocation
    // failed in Cloudflare's dashboard. A silently dead indexer is a silent
    // outage — swaps would stop earning points.
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
    const expected = env.POINTS_SWAP_CRON_SECRET
      ? `Bearer ${env.POINTS_SWAP_CRON_SECRET}`
      : null;
    if (!expected || offered !== expected) {
      return new Response(
        JSON.stringify({
          error: "Unauthorized.",
          armed: Boolean(env.POINTS_SWAP_CRON_SECRET),
          target: indexerUrl(env).toString(),
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
