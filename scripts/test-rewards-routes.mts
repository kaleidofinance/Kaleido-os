import assert from "node:assert/strict";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://rewards-test.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_KEY = "test-anon";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service";
const wallet = "0x00000000000000000000000000000000000000ab";
const calls: { url: string; method: string; prefer: string | null }[] = [];
let failReads = false;
let failPath: string | null = null;
let absent = false;
const asOf = "2026-10-25T18:00:00.000Z";
globalThis.fetch = async (input, init) => {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  );
  calls.push({
    url: url.pathname,
    method: init?.method ?? "GET",
    prefer: new Headers(init?.headers).get("prefer"),
  });
  if (failReads || (failPath && url.pathname.endsWith(failPath)))
    return Response.json(
      { message: "database timeout", code: "57014" },
      { status: 503 },
    );
  if (url.pathname.endsWith("/point_seasons"))
    return Response.json([
      {
        id: 1,
        label: "Season 1",
        starts_at: asOf,
        ends_at: null,
        frozen_at: null,
        converts_to_tokens: true,
        disclosure: "full",
        public_rank_limit: 1000000,
        is_default: true,
      },
    ]);
  if (url.pathname.endsWith("/reward_read_metadata"))
    return Response.json({ participants: { "1": 2 }, as_of: asOf });
  if (url.pathname.endsWith("/reward_board_rows")) {
    const row = {
      wallet,
      rank: 1,
      percentile: 50,
      total: 150,
      time_points: 0,
      action_points: 150,
      bonus_points: 0,
      volume: 0,
      referrals: 1,
      as_of: asOf,
    };
    return Response.json(url.searchParams.has("wallet") ? row : [row]);
  }
  if (url.pathname.endsWith("/rpc/reward_wallet_facts"))
    return Response.json(
      absent
        ? null
        : {
            row: {
              wallet,
              ref_code: "testref",
              welcome_points: 100,
              activated_at: asOf,
              x_robinhood_integration_at: new Date(
                Date.now() - 6 * 3600000,
              ).toISOString(),
            },
            referral: {
              referrals: 1,
              active_referrals: 1,
              pending_referrals: 0,
              rank: 1,
            },
            volume: { swaps_usd: 100, collateral_usd: 0 },
            taskCounts: { robinhoodIntegration: 500 },
            season1: {
              total: 1650,
              tasks: 1650,
              trading: 0,
              liquidity: 0,
              other: 0,
            },
            asOf,
          },
    );
  throw new Error(`Unexpected database path ${url.pathname}`);
};

const { NextRequest } = await import("next/server");
const board = await import("../src/app/api/leaderboard/route");
const me = await import("../src/app/api/leaderboard/me/route");
const rewards = await import("../src/app/api/waitlist/route");
const call = async (handler: (req: any) => Promise<Response>, path: string) => {
  const response = await handler(
    new NextRequest(`https://example.test${path}`),
  );
  return { status: response.status, body: await response.json() };
};

const first = await call(board.GET, "/api/leaderboard");
assert.equal(first.status, 200);
assert.equal(first.body.data.participants, 2);
assert.equal(first.body.data.rows[0].rank, 1);
assert.equal(first.body.data.asOf, asOf);
const beforeCache = calls.length;
await call(board.GET, "/api/leaderboard?refresh=1");
assert.equal(
  calls.length,
  beforeCache,
  "refresh flag cannot bypass shared cache",
);
const own = await call(me.GET, `/api/leaderboard/me?wallet=${wallet}&season=1`);
assert.equal(own.body.data.participants, 2);
assert.equal(own.body.data.row.rank, 1);
const beforeRewards = calls.length;
const status = await call(rewards.GET, `/api/waitlist?wallet=${wallet}`);
assert.equal(status.status, 200);
assert.equal(status.body.xTasks.robinhoodIntegration.done, true);
assert.equal(
  status.body.xTasks.robinhoodIntegration.closed,
  false,
  "completed capped task stays completed",
);
assert.equal(status.body.points, 1650);
assert.equal(status.body.season1.total, 1650);
assert.equal(
  calls.length - beforeRewards,
  1,
  "Rewards needs exactly one database request",
);
assert.ok(
  calls.every((c) => !c.prefer?.includes("count=exact")),
  "no request-time exact counts",
);
assert.ok(
  calls
    .filter((c) => c.method === "POST")
    .every((c) => c.url.endsWith("/reward_wallet_facts")),
  "only read-only RPC POSTs during page loading",
);
absent = true;
assert.equal(
  (await call(rewards.GET, `/api/waitlist?wallet=${wallet}`)).body.registered,
  false,
);
failReads = true;
const failed = await call(rewards.GET, `/api/waitlist?wallet=${wallet}`);
assert.equal(failed.status, 503);
assert.equal(
  failed.body.registered,
  undefined,
  "failure cannot reset registration",
);
failReads = false;
failPath = "/reward_board_rows";
const failedBoard = await call(board.GET, "/api/leaderboard?page=2");
assert.equal(failedBoard.status, 503);
assert.equal(
  failedBoard.body.success,
  false,
  "failed board cannot become zero participants",
);
failPath = null;
failReads = true;
assert.equal(
  (await call(me.GET, `/api/leaderboard/me?wallet=${wallet}&season=1`)).status,
  503,
);
const { supabase } = await import("../src/lib/supabase/supabaseClient");
supabase.auth.stopAutoRefresh();
console.log(
  "PASS: real route handlers use snapshots, preserve completed tasks, cache refreshes, share standings, and report outages without zeros",
);
