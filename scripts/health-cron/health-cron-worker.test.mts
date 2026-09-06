/*
 * Checks on the health monitor's scheduler. Run with `npm run test:healthcron`.
 *
 * WHY THIS SUITE EXISTS. Every way this Worker can be wrong, it is wrong silently
 * — and the thing it schedules is the alert `lib/notifications/emit.ts` calls "the
 * one alert in this app that has to arrive":
 *
 *   • a field name that does not match what the route returns logs "warned=?"
 *     forever, and a log line is the only artefact a cron leaves behind;
 *   • retrying a 400 or a 401 turns one configuration mistake into a permanent
 *     stream of them, while *not* retrying a transient 5xx wastes a free recovery;
 *   • a swallowed failure is indistinguishable from a working monitor, which is
 *     strictly worse than no monitor: it looks like working alerting right up to
 *     the run that mattered;
 *   • HEALTH_DRY_RUN left on, or on for the wrong value, is a scheduler that reads
 *     everything and warns nobody while reporting success.
 *
 * The last one is the reason `dryRun` is asserted against "0" and "false" as well
 * as "1". A truthy-string check there would arm the flag for every value a person
 * would reach for to turn it off.
 *
 * None of this is reachable by types, and none of it can be exercised for real
 * until HEALTH_CRON_SECRET is set — so fetch is stubbed and the behaviour is
 * asserted directly. The 200 body below is copied from what the route actually
 * returns (`json(result, ...)` where result is runHealthWatch's value); if that
 * shape changes, this is what should fail.
 *
 * `.mts` rather than `.test.ts` for the top-level await: package.json sets no
 * `type`, so tsx reads a bare `.ts` as CJS. Same reason as the keeper's suite.
 */
import module from "./health-cron-worker.js";

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
  HEALTH_CRON_SECRET: SECRET,
};

/* The real shape, copied from what handle() returns: json(result, ...) where
   result is runHealthWatch's return value. */
const REAL_200 = JSON.stringify({
  dryRun: false,
  warned: 1,
  wouldWarn: 0,
  failed: 0,
  subscribed: 3,
  chains: [
    { chainId: 11155111, network: "sepolia", status: "ok", borrowers: 4, checked: 2, warned: 1, failed: 0, wallets: [] },
  ],
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
    new Request("https://kaleido-health-cron.workers.dev/", {
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
  const unarmed = await trigger({ ...ENV, HEALTH_CRON_SECRET: undefined }, null);
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
    "targets the apex, unscoped — every chain has borrowers who can be liquidated",
    call.url === "https://kaleidofi.xyz/api/health/watch",
    call.url,
  );
  check("POSTs", call.init.method === "POST", String(call.init.method));
  check(
    "sends the secret as a bearer token",
    call.init.headers.authorization === `Bearer ${SECRET}`,
    JSON.stringify(call.init.headers),
  );
  check("and never in the query string", !call.url.includes(SECRET), call.url);
}

console.log("\n— it reads the real response shape —");
{
  stub({ status: 200, body: REAL_200 });
  const res = await trigger();
  const body = await res.json();
  check("a clean run is ok", res.status === 200 && body.ok === true, JSON.stringify(body));
  check(
    "the log line carries the counts, not question marks",
    body.detail.includes("warned=1") &&
      body.detail.includes("wouldWarn=0") &&
      body.detail.includes("failed=0"),
    body.detail,
  );
  check(
    "and names the chain, its status and how many borrowers it saw",
    body.detail.includes("sepolia:ok(4b)"),
    body.detail,
  );
  check(
    "a live run is not labelled DRY",
    !body.detail.includes("DRY"),
    body.detail,
  );
  /* The route reports dryRun itself when APP_URL or PUSH_SEND_SECRET is missing
     on the Vercel side, which the Worker cannot see. Surfacing it is the only way
     "the schedule fires and nobody is warned" is diagnosable from the log. */
  stub({
    status: 200,
    body: JSON.stringify({ dryRun: true, warned: 0, wouldWarn: 2, failed: 0, chains: [] }),
  });
  const dry = await trigger();
  check(
    "a dry run from the route's side is labelled",
    (await dry.json()).detail.includes("DRY warned=0 wouldWarn=2"),
    "",
  );
}

console.log("\n— no wallet addresses in the log line —");
{
  /* The body carries them; the summary must not. A Worker log is a different
     retention and access surface from the app's, and "who is near liquidation" is
     not a list to leave lying in a second place. */
  const WITH_WALLETS = JSON.stringify({
    dryRun: false,
    warned: 1,
    wouldWarn: 0,
    failed: 0,
    chains: [
      {
        chainId: 11155111,
        network: "sepolia",
        status: "ok",
        borrowers: 1,
        checked: 1,
        warned: 1,
        failed: 0,
        wallets: [{ wallet: "0x00000000000000000000000000000000deadbeef", health: 1.01, warned: true }],
      },
    ],
  });
  stub({ status: 200, body: WITH_WALLETS });
  const res = await trigger();
  const { detail } = await res.json();
  check("the summary omits the address", !detail.toLowerCase().includes("deadbeef"), detail);
  check("while still reporting the count", detail.includes("warned=1"), detail);
}

console.log("\n— what it retries, and what it does not —");
{
  /* failed > 0 returns 500 from the route. A repeat is safe here: the cooldown in
     health_watch_state is written only after a push succeeds, so a retry re-sends
     only what did not go out. */
  stub(
    { status: 500, body: '{"dryRun":false,"warned":0,"wouldWarn":0,"failed":1,"chains":[]}' },
    { status: 200, body: REAL_200 },
  );
  const recovered = await trigger();
  const body = await recovered.json();
  check("a 500 is retried once", calls.length === 2, `${calls.length} call(s)`);
  check("and a recovered retry reports ok", body.ok === true, JSON.stringify(body));

  /* A 400 means the chainId list names a chain with no lending deployment.
     Retrying cannot fix a var. */
  stub({ status: 400, body: '{"error":"no lending deployment on chain(s) 999"}' });
  const bad = await trigger();
  const badBody = await bad.json();
  check("a 400 is not retried", calls.length === 1, `${calls.length} call(s)`);
  check(
    "and is reported as a failure",
    bad.status === 502 && badBody.ok === false,
    JSON.stringify(badBody),
  );
  check(
    "quoting the endpoint's own reason",
    badBody.error.includes("no lending deployment"),
    badBody.error,
  );

  /* 503 is the unarmed route — CRON_SECRET unset on Vercel. Retried, because it
     is in the 5xx band and a deploy in progress looks like this. */
  stub({ status: 503, body: '{"error":"The health monitor is not enabled."}' });
  const unarmedRoute = await trigger();
  check("a 503 is retried", calls.length === 2, `${calls.length} call(s)`);
  check(
    "and then reported with the route's reason",
    (await unarmedRoute.json()).error.includes("not enabled"),
    "",
  );

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
    "HTML at a 200 is not read as a successful run",
    body.ok === true && body.detail.includes("non-JSON"),
    body.detail,
  );
}

console.log("\n— the cron entry point runs the same path —");
{
  stub({ status: 500, body: '{"error":"The health check could not be completed."}' });
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

console.log("\n— vars, including the one that can silence the monitor —");
{
  stub({ status: 200, body: REAL_200 });
  await trigger({ HEALTH_CRON_SECRET: SECRET });
  check(
    "no vars still targets the apex, unscoped",
    calls[0].url === "https://kaleidofi.xyz/api/health/watch",
    calls[0].url,
  );

  stub({ status: 200, body: REAL_200 });
  await trigger({ HEALTH_CRON_SECRET: SECRET, HEALTH_CHAIN_IDS: "11155111,84532" });
  check(
    "a chain list narrows the run when one is given",
    calls[0].url === "https://kaleidofi.xyz/api/health/watch?chainId=11155111%2C84532",
    calls[0].url,
  );

  stub({ status: 200, body: REAL_200 });
  await trigger({ HEALTH_CRON_SECRET: SECRET, APP_URL: "https://kaleidofi.xyz/" });
  check(
    "a trailing slash on APP_URL does not double up",
    calls[0].url === "https://kaleidofi.xyz/api/health/watch",
    calls[0].url,
  );

  stub({ status: 200, body: REAL_200 });
  await trigger({ HEALTH_CRON_SECRET: SECRET, HEALTH_DRY_RUN: "1" });
  check(
    "HEALTH_DRY_RUN=1 asks the route not to send",
    calls[0].url === "https://kaleidofi.xyz/api/health/watch?dryRun=1",
    calls[0].url,
  );

  /* The important half. Anything a person would write to turn the flag OFF must
     turn it off — a truthy-string check would arm it for all three of these and
     the monitor would read everything and warn nobody, reporting success. */
  for (const off of ["0", "false", ""]) {
    stub({ status: 200, body: REAL_200 });
    await trigger({ HEALTH_CRON_SECRET: SECRET, HEALTH_DRY_RUN: off });
    check(
      `HEALTH_DRY_RUN=${JSON.stringify(off)} does NOT silence the monitor`,
      !calls[0].url.includes("dryRun"),
      calls[0].url,
    );
  }
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
