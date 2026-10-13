/*
 * Checks on the LP-points accrual scheduler. Run with `npm run test:pointslpcron`.
 *
 * WHY THIS SUITE EXISTS. Every way this Worker is wrong, it is wrong silently. The
 * LP-specific risk is the summary field names: the route returns
 * `{ positionsRead, snapshotsWritten, epochsWritten, pointsAccrued, boost, skips }`,
 * and a mismatch logs "points=?" forever while looking like it works. It must also
 * throw on a non-200 (a swallowed failure = a silently dead accrual → liquidity
 * stops earning), and refuse an unauthenticated manual trigger.
 *
 * fetch is stubbed; the 200 body is copied from what src/app/api/cron/points-lp
 * actually returns. If that shape changes, this is what should fail.
 */
import mod from "./points-lp-cron-worker.js";

const worker = (mod as any)?.fetch ? (mod as any) : (mod as any)?.default;

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, got?: string) => {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got === undefined ? "" : ` — ${got}`}`); }
};

const SECRET = "s3cret";
const ENV = { POINTS_LP_CRON_SECRET: SECRET, APP_URL: "https://kaleidofi.xyz" };

const LEND_200 = {
  chainId: 5042,
  sources: {
    lend: { wallets: 3, usd: 1500.5, epochs: 3, points: 420, snapshots: 3 },
    borrow: { wallets: 2, usd: 1000, epochs: 2, points: 110, snapshots: 2 },
    collateral_idle: { wallets: 4, usd: 800, epochs: 4, points: 55, snapshots: 4 },
  },
  notes: [],
};

/* One stub per route: `responses` drives points-lp (the route most tests are
   about); points-lend answers `lend` (a clean 200 unless a test says otherwise). */
function stubFetch(
  responses: Array<{ status: number; body: unknown }>,
  lend: { status: number; body: unknown } = { status: 200, body: LEND_200 },
) {
  const calls: string[] = [];
  let i = 0;
  (globalThis as any).fetch = async (url: URL | string) => {
    calls.push(String(url));
    const r = String(url).includes("/api/cron/points-lend")
      ? lend
      : responses[Math.min(i++, responses.length - 1)];
    return {
      status: r.status,
      text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r.body)),
    };
  };
  return calls;
}

const req = (auth?: string) =>
  new Request("https://worker/", auth ? { headers: { authorization: auth } } : {});

async function main() {
  console.log("\n— auth on the manual trigger —");
  {
    const noSecret = await worker.fetch(req(`Bearer ${SECRET}`), {});
    check("unarmed (no secret) → 401", noSecret.status === 401, String(noSecret.status));
    const wrong = await worker.fetch(req("Bearer nope"), ENV);
    check("wrong secret → 401", wrong.status === 401, String(wrong.status));
    const none = await worker.fetch(req(), ENV);
    check("no header → 401", none.status === 401, String(none.status));
  }

  console.log("\n— the happy path summarises the route's real fields —");
  {
    const calls = stubFetch([
      { status: 200, body: { positionsRead: 4, snapshotsWritten: 3, epochsWritten: 2, pointsAccrued: 1234, boost: 10, skips: { excluded: 1 } } },
    ]);
    const res = await worker.fetch(req(`Bearer ${SECRET}`), ENV);
    const body = await res.json();
    check("200 and ok:true", res.status === 200 && body.ok === true, JSON.stringify(body));
    check("it hit /api/cron/points-lp on the apex", calls[0] === "https://kaleidofi.xyz/api/cron/points-lp", calls[0]);
    check("the summary reads positions/epochs/points (not '?')", /positions=4 epochs=2 points=1234/.test(body.detail), body.detail);
    check("the boost rides along", /boost=10/.test(body.detail), body.detail);
    check("skip reasons ride along", /excluded:1/.test(body.detail), body.detail);
  }

  console.log("\n— a skipped run reads as skipped, not a failure —");
  {
    stubFetch([{ status: 200, body: { skipped: "no-lp-rate" } }]);
    const res = await worker.fetch(req(`Bearer ${SECRET}`), ENV);
    const body = await res.json();
    check("still a 200 ok:true", res.status === 200 && body.ok === true && /skipped=no-lp-rate/.test(body.detail), JSON.stringify(body));
  }

  console.log("\n— a non-200 throws (no silent failure); a 401 is not retried —");
  {
    const calls = stubFetch([{ status: 401, body: { error: "unauthorised" } }]);
    const res = await worker.fetch(req(`Bearer ${SECRET}`), ENV);
    const body = await res.json();
    check("route 401 → worker 502 ok:false", res.status === 502 && body.ok === false, JSON.stringify(body));
    check("a 401 is NOT retried (one call only)", calls.filter((c) => c.includes("/points-lp")).length === 1, String(calls.length));
  }

  console.log("\n— the lending accrual rides the same tick —");
  {
    const calls = stubFetch([{ status: 200, body: { positionsRead: 1, snapshotsWritten: 1, epochsWritten: 1, pointsAccrued: 5, boost: 1, skips: {} } }]);
    const res = await worker.fetch(req(`Bearer ${SECRET}`), ENV);
    const body = await res.json();
    check("both routes are called", calls.includes("https://kaleidofi.xyz/api/cron/points-lp") && calls.includes("https://kaleidofi.xyz/api/cron/points-lend"), JSON.stringify(calls));
    check("the lending summary reads the real per-source fields", /lend:3w\/\$1500\.5\/420pts/.test(body.detail) && /collateral_idle:4w/.test(body.detail), body.detail);

    stubFetch([{ status: 200, body: { skipped: "no-lp-rate" } }], { status: 200, body: { skipped: "no-diamond", chainId: 5042 } });
    const skipped = await (await worker.fetch(req(`Bearer ${SECRET}`), ENV)).json();
    check("no diamond yet (before the mainnet deploy) is a skip, not a failure", skipped.ok === true && /skipped=no-diamond/.test(skipped.detail), JSON.stringify(skipped));

    stubFetch([{ status: 200, body: { positionsRead: 1, snapshotsWritten: 1, epochsWritten: 1, pointsAccrued: 5, boost: 1, skips: {} } }], { status: 401, body: { error: "unauthorised" } });
    const failed = await worker.fetch(req(`Bearer ${SECRET}`), ENV);
    const fb = await failed.json();
    check("a failing lending accrual fails the run even when LP is fine", failed.status === 502 && /points-lend/.test(fb.error), JSON.stringify(fb));
  }
}

main().then(() => {
  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
});
