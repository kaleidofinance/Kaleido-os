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

/* The candle route's real shape: { dryRun, results: [...] }. A quiet run finds
   no swaps and writes no candles, which is a clean 200, not a failure. */
const CANDLE_200 = JSON.stringify({
  dryRun: false,
  results: [
    { chainId: 11155111, pool: "0xpool", swaps: 0, candles: 0, wrote: false, error: null },
    { chainId: 5042002, pool: null, swaps: 0, candles: 0, wrote: false, error: null },
  ],
});

const realSetTimeout = globalThis.setTimeout;
/* Collapse only the retry wait. The abort timer is 70s and must stay a timer, or
   the "hung fetch" path would abort instantly and the test would prove nothing. */
globalThis.setTimeout = (fn, ms, ...rest) =>
  ms === 20_000 ? realSetTimeout(fn, 0) : realSetTimeout(fn, ms, ...rest);

/* Now that one tick calls TWO endpoints, the stub routes by URL: the `responses`
   sequence drives the endpoint under test (push, unless noted), and the OTHER
   endpoint always answers a clean 200 so it never interferes with a push
   assertion. `pushCalls`/`candleCalls` let a count assertion name which
   endpoint it means. */
let calls = [];
const stubFor = (which, ...responses) => {
  calls = [];
  let i = 0;
  const other = which === "push" ? "/api/keeper/candles" : "/api/keeper/push";
  const otherBody = which === "push" ? CANDLE_200 : REAL_200;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.includes(other)) return new Response(otherBody, { status: 200 });
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    if (r instanceof Error) throw r;
    return new Response(r.body, { status: r.status });
  };
};
/* Most tests drive the push endpoint; keep the short name for them. */
const stub = (...responses) => stubFor("push", ...responses);
const pushCalls = () => calls.filter((c) => c.url.includes("/api/keeper/push"));
const candleCalls = () => calls.filter((c) => c.url.includes("/api/keeper/candles"));

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

console.log("\n— the requests it builds —");
{
  stub({ status: 200, body: REAL_200 });
  await trigger();
  const call = pushCalls()[0];
  check(
    "push targets the apex, scoped to the chain in vars",
    call.url === "https://kaleidofi.xyz/api/keeper/push?chainId=46630",
    call.url,
  );
  check("POSTs", call.init.method === "POST", String(call.init.method));
  check(
    "sends the secret as a bearer token",
    call.init.headers.authorization === `Bearer ${SECRET}`,
    JSON.stringify(call.init.headers),
  );
  check("and never in the query string", !call.url.includes(SECRET), call.url);

  /* The same tick also calls the candle indexer, scoped to the four KLD-pool
     chains and NOT to the push's single chain. */
  const cc = candleCalls()[0];
  check("candles are called on the same tick", cc !== undefined, JSON.stringify(calls.map((c) => c.url)));
  check(
    "candles target the apex, scoped to the pool chains",
    /* The comma is percent-encoded by URLSearchParams, and the route decodes it
       back through nextUrl.searchParams — so decode before comparing rather than
       assert the %2C form. */
    decodeURIComponent(cc?.url ?? "") ===
      "https://kaleidofi.xyz/api/keeper/candles?chainId=11155111,84532,97,46630",
    cc?.url,
  );
  check("candles carry the bearer too", cc?.init.headers.authorization === `Bearer ${SECRET}`);
  check("and the secret is nowhere in the candle URL", !cc?.url.includes(SECRET), cc?.url);
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
  check("a 500 is retried once", pushCalls().length === 2, `${pushCalls().length} push call(s)`);
  check("and a recovered retry reports ok", body.ok === true, JSON.stringify(body));

  /* A 400 means the chainId list is wrong. Retrying cannot fix a var. */
  stub({ status: 400, body: '{"error":"chainId must be one or more positive integers."}' });
  const bad = await trigger();
  const badBody = await bad.json();
  check("a 400 is not retried", pushCalls().length === 1, `${pushCalls().length} push call(s)`);
  check("and is reported as a failure", bad.status === 502 && badBody.ok === false, JSON.stringify(badBody));
  check("quoting the endpoint's own reason", badBody.error.includes("chainId must be"), badBody.error);

  /* 401 is the one that would look like a working scheduler if swallowed. */
  stub({ status: 401, body: '{"error":"Unauthorized."}' });
  const unauth = await trigger();
  check("a 401 is not retried", pushCalls().length === 1, `${pushCalls().length} push call(s)`);
  check("and fails loudly", (await unauth.json()).ok === false, "");

  stub(new Error("network unreachable"));
  const dead = await trigger();
  check("a thrown fetch is retried once", pushCalls().length === 2, `${pushCalls().length} push call(s)`);
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
  check("after the same one retry", pushCalls().length === 2, `${pushCalls().length} push call(s)`);

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
    pushCalls()[0].url === "https://kaleidofi.xyz/api/keeper/push?chainId=46630",
    pushCalls()[0].url,
  );

  stub({ status: 200, body: REAL_200 });
  await trigger({ KEEPER_CRON_SECRET: SECRET, KEEPER_CHAIN_IDS: "" });
  check(
    "an explicitly empty chain list means unscoped, deliberately",
    pushCalls()[0].url === "https://kaleidofi.xyz/api/keeper/push",
    pushCalls()[0].url,
  );

  stub({ status: 200, body: REAL_200 });
  await trigger({ KEEPER_CRON_SECRET: SECRET, APP_URL: "https://kaleidofi.xyz/" });
  check(
    "a trailing slash on APP_URL does not double up",
    pushCalls()[0].url === "https://kaleidofi.xyz/api/keeper/push?chainId=46630",
    pushCalls()[0].url,
  );
}

console.log("\n— candles are their own job, judged on their own —");
{
  /* A clean candle run reads its own shape: candles written, per-chain swaps,
     and a pool-less chain (Arc) shown as a skip rather than a failure. */
  stub({ status: 200, body: REAL_200 });
  const res = await trigger();
  const detail = (await res.json()).detail;
  check("the candle line reports written candles", detail.includes("candles="), detail);
  check("and a pool-less chain reads as a skip", detail.includes("5042002:no-pool"), detail);

  /* A candle failure fails the invocation even when the push is clean — a
     silently failing indexer is the same anti-pattern the push guards against. */
  stubFor(
    "candles",
    { status: 500, body: '{"error":"The candle run could not be completed."}' },
    { status: 500, body: '{"error":"The candle run could not be completed."}' },
  );
  const mixed = await trigger();
  const mixedBody = await mixed.json();
  check("push ok + candles failed is a failed invocation", mixed.status === 502 && mixedBody.ok === false, JSON.stringify(mixedBody));
  check("and the error names the candle route, not the push", mixedBody.error.includes("/api/keeper/candles"), mixedBody.error);
  check("a candle 500 is retried once, like the push", candleCalls().length === 2, `${candleCalls().length} candle call(s)`);
  check("while the push, being fine, was called once", pushCalls().length === 1, `${pushCalls().length} push call(s)`);

  /* And a scheduled tick rethrows on a candle-only failure, so Cloudflare marks
     it — the push being fine must not paper over it. */
  stubFor("candles", { status: 401, body: '{"error":"Unauthorized."}' });
  let threw = null;
  await worker.scheduled({ cron: "*/15 * * * *" }, ENV).catch((e) => (threw = e));
  check("scheduled() rethrows when only candles failed", threw !== null, String(threw));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
