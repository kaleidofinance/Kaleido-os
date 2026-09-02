/*
 * Checks on the price keeper's scheduler. Run with `npm run test:keepercron`.
 *
 * WHY THIS SUITE EXISTS. This Worker is the only thing keeping Robinhood's ETH
 * feed inside its 3600s bound, and every way it can be wrong, it is wrong
 * silently:
 *
 *   • a field name that does not match what the route returns logs "pushed=?"
 *     forever, and a log line is the only artefact a cron leaves behind;
 *   • retrying a 400 or a 401 turns one configuration mistake into a permanent
 *     stream of them, while *not* retrying a transient 5xx wastes a free recovery;
 *   • a swallowed failure is indistinguishable from a working scheduler, which is
 *     the exact outage this replaces;
 *   • a dropped var could send an unscoped run that exceeds the route's 60s
 *     ceiling, or send the secret somewhere it should not go.
 *
 * None of that is reachable by types, and none of it can be exercised for real
 * until KEEPER_CRON_SECRET is set — so fetch is stubbed and the behaviour is
 * asserted directly. The 200 body below is copied from what the route actually
 * returns (`json(result, ...)` where result is pushSelfHostedFeeds' value); if
 * that shape changes, this is what should fail.
 *
 * `.mts` rather than `.test.ts` for the top-level await: package.json sets no
 * `type`, so tsx reads a bare `.ts` as CJS. Same reason as scripts/fill-orders.mts.
 */
import module from "./keeper-cron-worker.js";

/* Cloudflare loads that file as an ES module — wrangler.toml's `main` makes it
   one. Node agrees when it detects module syntax, but tsx routes it through CJS
   interop and hands back { default: … } instead, so the export is unwrapped here
   rather than in every call. Asserted rather than assumed: if interop changes
   again, this should say so instead of every later check failing as "not a
   function". */
const worker = (module as any)?.scheduled ? (module as any) : (module as any)?.default;

let pass = 0;
let fail = 0;
const check = (name, cond, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} ${detail}`);
  }
};

const SECRET = "harness-secret-not-a-real-one";
const ENV = {
  APP_URL: "https://kaleidofi.xyz",
  KEEPER_CHAIN_IDS: "46630",
  KEEPER_CRON_SECRET: SECRET,
};

/* The real shape, copied from what handle() returns: json(result, ...) where
   result is pushSelfHostedFeeds' return value. */
const REAL_200 = JSON.stringify({
  pushed: 2,
  wouldPush: 0,
  failed: 0,
  chains: [{ network: "robinhoodTestnet", status: "pushed" }],
});

const realSetTimeout = globalThis.setTimeout;
/* Collapse only the retry wait. The abort timer is 70s and must stay a timer, or
   the "hung fetch" path would abort instantly and the test would prove nothing. */
globalThis.setTimeout = (fn, ms, ...rest) =>
  ms === 20_000 ? realSetTimeout(fn, 0) : realSetTimeout(fn, ms, ...rest);

let calls = [];
const stub = (...responses) => {
  calls = [];
  let i = 0;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    if (r instanceof Error) throw r;
    return new Response(r.body, { status: r.status });
  };
};

const trigger = (env = ENV, auth = `Bearer ${SECRET}`) =>
  worker.fetch(
    new Request("https://kaleido-keeper-cron.workers.dev/", {
      headers: auth ? { authorization: auth } : {},
    }),
    env,
  );

console.log("\n— the module Cloudflare will load —");
{
  check(
    "exports both handlers",
    typeof worker?.scheduled === "function" && typeof worker?.fetch === "function",
    `scheduled=${typeof worker?.scheduled} fetch=${typeof worker?.fetch}`,
  );
}

console.log("\n— it refuses anything without the secret —");
{
  stub({ status: 200, body: REAL_200 });
  const unarmed = await trigger({ ...ENV, KEEPER_CRON_SECRET: undefined }, null);
  const body = await unarmed.json();
  check("unarmed answers 401", unarmed.status === 401, String(unarmed.status));
  check("and says so", body.armed === false, JSON.stringify(body));
  check("and never calls the endpoint", calls.length === 0, JSON.stringify(calls));

  stub({ status: 200, body: REAL_200 });
  const wrong = await trigger(ENV, "Bearer wrong");
  check("a wrong secret answers 401", wrong.status === 401, String(wrong.status));
  check("and still calls nothing", calls.length === 0, JSON.stringify(calls));
}

console.log("\n— the request it builds —");
{
  stub({ status: 200, body: REAL_200 });
  await trigger();
  const [call] = calls;
  check(
    "targets the apex, scoped to the chain in vars",
    call.url === "https://kaleidofi.xyz/api/keeper/push?chainId=46630",
    call.url,
  );
  check("POSTs", call.init.method === "POST", String(call.init.method));
  check(
    "sends the secret as a bearer token",
    call.init.headers.authorization === `Bearer ${SECRET}`,
    JSON.stringify(call.init.headers),
  );
  check(
    "and never in the query string",
    !call.url.includes(SECRET),
    call.url,
  );
}

console.log("\n— it reads the real response shape —");
{
  stub({ status: 200, body: REAL_200 });
  const res = await trigger();
  const body = await res.json();
  check("a clean run is ok", res.status === 200 && body.ok === true, JSON.stringify(body));
  check(
    "the log line carries the counts, not question marks",
    body.detail.includes("pushed=2") &&
      body.detail.includes("wouldPush=0") &&
      body.detail.includes("failed=0"),
    body.detail,
  );
  check(
    "and names the chain and its status",
    body.detail.includes("robinhoodTestnet:pushed"),
    body.detail,
  );
}

console.log("\n— what it retries, and what it does not —");
{
  /* failed > 0 returns 500 from the route, and a repeat push is refused by the
     feed itself, so one retry is free. */
  stub({ status: 500, body: '{"pushed":0,"wouldPush":0,"failed":1,"chains":[]}' }, { status: 200, body: REAL_200 });
  const recovered = await trigger();
  const body = await recovered.json();
  check("a 500 is retried once", calls.length === 2, `${calls.length} call(s)`);
  check("and a recovered retry reports ok", body.ok === true, JSON.stringify(body));

  /* A 400 means the chainId list is wrong. Retrying cannot fix a var. */
  stub({ status: 400, body: '{"error":"chainId must be one or more positive integers."}' });
  const bad = await trigger();
  const badBody = await bad.json();
  check("a 400 is not retried", calls.length === 1, `${calls.length} call(s)`);
  check("and is reported as a failure", bad.status === 502 && badBody.ok === false, JSON.stringify(badBody));
  check("quoting the endpoint's own reason", badBody.error.includes("chainId must be"), badBody.error);

  /* 401 is the one that would look like a working scheduler if swallowed. */
  stub({ status: 401, body: '{"error":"Unauthorized."}' });
  const unauth = await trigger();
  check("a 401 is not retried", calls.length === 1, `${calls.length} call(s)`);
  check("and fails loudly", (await unauth.json()).ok === false, "");

  stub(new Error("network unreachable"));
  const dead = await trigger();
  check("a thrown fetch is retried once", calls.length === 2, `${calls.length} call(s)`);
  const deadBody = await dead.json();
  check("then reported", deadBody.ok === false, "");
  check(
    "as a failed request, not as an unreadable body",
    deadBody.error.includes("fetch failed") && !deadBody.error.includes("non-JSON"),
    deadBody.error,
  );
}

console.log("\n— a body that is not the route —");
{
  stub({ status: 200, body: "<!DOCTYPE html><title>Redirecting…</title>" });
  const html = await trigger();
  const body = await html.json();
  check(
    "HTML at a 200 is not read as a successful push",
    body.ok === true && body.detail.includes("non-JSON"),
    body.detail,
  );
}

console.log("\n— the cron entry point runs the same path —");
{
  stub({ status: 500, body: '{"error":"The keeper run could not be completed."}' });
  let threw = null;
  await worker.scheduled({ cron: "*/15 * * * *" }, ENV).catch((e) => (threw = e));
  check(
    "scheduled() rethrows so Cloudflare marks the run failed",
    threw !== null,
    String(threw),
  );
  check("after the same one retry", calls.length === 2, `${calls.length} call(s)`);

  stub({ status: 200, body: REAL_200 });
  let ok = true;
  await worker.scheduled({ cron: "*/15 * * * *" }, ENV).catch(() => (ok = false));
  check("and stays quiet on success", ok === true, "");
}

console.log("\n— defaults, for the case where a var is dropped —");
{
  stub({ status: 200, body: REAL_200 });
  await trigger({ KEEPER_CRON_SECRET: SECRET });
  check(
    "no vars still targets the apex and scopes the chain",
    calls[0].url === "https://kaleidofi.xyz/api/keeper/push?chainId=46630",
    calls[0].url,
  );

  stub({ status: 200, body: REAL_200 });
  await trigger({ KEEPER_CRON_SECRET: SECRET, KEEPER_CHAIN_IDS: "" });
  check(
    "an explicitly empty chain list means unscoped, deliberately",
    calls[0].url === "https://kaleidofi.xyz/api/keeper/push",
    calls[0].url,
  );

  stub({ status: 200, body: REAL_200 });
  await trigger({ KEEPER_CRON_SECRET: SECRET, APP_URL: "https://kaleidofi.xyz/" });
  check(
    "a trailing slash on APP_URL does not double up",
    calls[0].url === "https://kaleidofi.xyz/api/keeper/push?chainId=46630",
    calls[0].url,
  );
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
