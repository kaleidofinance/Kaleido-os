/**
 * Daily review-scan clock. It never edits the registry: it calls the protected
 * report endpoint and fails loudly when the scan or registry freshness check is
 * unhealthy. A human still reviews and commits approved entries.
 */
const DEFAULT_APP_URL = "https://kaleidofi.xyz";
const REQUEST_TIMEOUT_MS = 70_000;

function baseUrl(env) {
  return (env.APP_URL || DEFAULT_APP_URL).replace(/\/+$/, "");
}

async function call(url, secret) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, accept: "application/json" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readRegistryStatus(env) {
  const response = await fetch(`${baseUrl(env)}/api/pools/external/status`, {
    headers: { accept: "application/json" },
  });
  const body = await response.text();
  return { status: response.status, body };
}

async function run(env) {
  const secret = String(env.EXTERNAL_POOL_REFRESH_SECRET || "").trim();
  if (!secret) throw new Error("EXTERNAL_POOL_REFRESH_SECRET is not configured");
  const registry = await readRegistryStatus(env);
  const response = await call(`${baseUrl(env)}/api/pools/external/refresh`, secret);
  const body = await response.text();
  if (!response.ok) throw new Error(`external pool refresh HTTP ${response.status}: ${body.slice(0, 400)}`);
  console.log(`[external-pools-cron] registry status HTTP ${registry.status}: ${registry.body.slice(0, 400)}`);
  console.log(`[external-pools-cron] refresh report: ${body.slice(0, 1000)}`);
  if (registry.status === 503) {
    throw new Error(`external pool registry is stale; review the report and promote approved entries: ${registry.body.slice(0, 400)}`);
  }
}

export default {
  async scheduled(_event, env) {
    await run(env);
  },
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
    try {
      await run(env);
      return new Response("ok");
    } catch (error) {
      return new Response(String(error?.message || error), { status: 502 });
    }
  },
};
