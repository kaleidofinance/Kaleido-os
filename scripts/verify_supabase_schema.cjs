#!/usr/bin/env node
/**
 * Verifies that the live schema has what the app's queries actually ask for.
 *
 * WHY THIS EXISTS. Route code and its migration are two commits, and only one of
 * them gets applied by pushing to git. When they separate, nothing shouts: the
 * leaderboard route catches its own PostgREST error and answers "Could not read
 * the season registry", which reads like a transient outage and is indexed by
 * nobody. The page renders an empty state. A column that the database has never
 * heard of therefore looks exactly like a quiet day.
 *
 * That is not hypothetical — it is how this script came to be written. Three
 * migrations were sitting unapplied behind a newer one that had already run, so
 * `supabase db push` was skipping them by default, and /api/leaderboard had been
 * answering an error for every request since its route landed.
 *
 *   node scripts/verify_supabase_schema.cjs
 *
 * One request to PostgREST's OpenAPI description covers every table, view and
 * function, so this reads the schema without calling anything and cannot have a
 * side effect. The two route queries at the end are replayed verbatim, because a
 * column-by-column comparison is a diagnosis and the query is the ground truth.
 *
 * Exits non-zero when anything the app reads is missing.
 */

const fs = require("fs");
const path = require("path");

const ENV_PATH = path.join(__dirname, "..", ".env");

/** Minimal .env reader — same reasoning as verify_supabase_quota.cjs. */
function readEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    out[line.slice(0, eq).trim()] = line
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = { ...readEnv(ENV_PATH), ...process.env };
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

let missing = 0;
const pass = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => {
  missing++;
  console.log(`  ✗ ${m}`);
};

/*
 * What the app reads, and which migration supplies it.
 *
 * Ordered by migration so a gap reads as "everything from here is absent"
 * rather than as a scatter of unrelated faults — which is what a skipped
 * migration actually looks like. `needs` is only the columns a migration ADDS;
 * the base tables come from 20260801000100 and are checked by their presence.
 */
const EXPECTED = [
  {
    migration: "20260805000000_agent_request_quota.sql",
    functions: ["consume_agent_request", "peek_agent_usage"],
    tables: { agent_usage_daily: ["wallet", "requests", "throttled_at"] },
    usedBy: "the agent's daily model-request ceiling (src/lib/ai/credits.ts)",
  },
  {
    migration: "20260808000000_push_subscriptions.sql",
    tables: { push_subscriptions: ["endpoint"] },
    usedBy: "web push (src/lib/notifications)",
  },
  {
    migration: "20260817000000_leaderboard_disclosure.sql",
    tables: {
      point_seasons: ["disclosure", "public_rank_limit", "is_default"],
      point_leaderboard: ["percentile", "time_points", "action_points"],
    },
    usedBy:
      "src/app/api/leaderboard/route.ts (season resolution AND every row) and me/route.ts",
  },
  {
    migration: "20260818000000_season0_participation_seed.sql",
    tables: {
      point_balances: ["bonus_points"],
      point_leaderboard: ["bonus_points"],
    },
    usedBy: "the bonusPoints field both leaderboard routes select and return",
  },
  {
    migration: "20260825000000_push_watch_state.sql",
    tables: { push_watch_state: [] },
    usedBy: "scripts/push-watcher.mjs (inert until its secrets are set)",
  },
  {
    migration: "20260831000000_release_agent_request.sql",
    functions: ["release_agent_request"],
    usedBy: "refunding a model request the gateway refused (credits.ts)",
  },
];

/* Replayed verbatim from the route files. If these two pass, the leaderboard
   works; if either fails, it does not, whatever the column report above said. */
const ROUTE_QUERIES = [
  {
    label: "leaderboard rows",
    source: "src/app/api/leaderboard/route.ts:56 + me/route.ts:49",
    path: "point_leaderboard",
    select:
      "wallet, rank, percentile, total, time_points, action_points, bonus_points",
  },
  {
    label: "season resolution",
    source: "src/app/api/leaderboard/route.ts:106",
    path: "point_seasons",
    select:
      "id, label, starts_at, ends_at, frozen_at, converts_to_tokens, disclosure, public_rank_limit, is_default",
  },
];

async function main() {
  console.log("\nSupabase schema vs. what the app queries\n");

  if (!URL_ || !SERVICE) {
    fail("NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is empty");
    return finish();
  }
  console.log(`project ${URL_}\n`);

  const res = await fetch(`${URL_}/rest/v1/`, {
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  }).catch((e) => ({ ok: false, status: 0, err: e.message }));
  if (!res.ok) {
    fail(`could not read the schema description: ${res.err ?? res.status}`);
    return finish();
  }
  const spec = await res.json();

  /* PostgREST names every reachable function as a path and every table and view
     as a definition, so both questions are answered from one document. */
  const functions = new Set(
    Object.keys(spec.paths ?? {})
      .filter((p) => p.startsWith("/rpc/"))
      .map((p) => p.slice(5)),
  );
  const columnsOf = (t) =>
    spec.definitions?.[t]
      ? new Set(Object.keys(spec.definitions[t].properties ?? {}))
      : null;

  const behind = [];

  for (const group of EXPECTED) {
    console.log(group.migration);
    let ok = true;

    for (const fn of group.functions ?? []) {
      if (functions.has(fn)) pass(`function ${fn}`);
      else {
        fail(`function ${fn} — ABSENT`);
        ok = false;
      }
    }

    for (const [table, cols] of Object.entries(group.tables ?? {})) {
      const have = columnsOf(table);
      if (!have) {
        fail(`table ${table} — ABSENT`);
        ok = false;
        continue;
      }
      const gone = cols.filter((c) => !have.has(c));
      if (gone.length === 0) {
        pass(`${table}${cols.length ? ` (${cols.join(", ")})` : ""}`);
      } else {
        fail(`${table} is missing: ${gone.join(", ")}`);
        ok = false;
      }
    }

    if (!ok) {
      behind.push(group.migration);
      console.log(`    used by ${group.usedBy}`);
    }
    console.log("");
  }

  /* The queries themselves. A route that selects one absent column gets no rows
     and no partial answer — PostgREST rejects the whole request — so this is
     pass/fail per feature rather than per column. */
  console.log("the app's own queries, replayed");
  for (const q of ROUTE_QUERIES) {
    const r = await fetch(
      `${URL_}/rest/v1/${q.path}?select=${encodeURIComponent(q.select)}&limit=1`,
      { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } },
    );
    if (r.status === 200) {
      pass(`${q.label} (${q.source})`);
    } else {
      const body = await r.text();
      let msg = body.slice(0, 160);
      try {
        msg = JSON.parse(body).message ?? msg;
      } catch {
        /* non-JSON body surfaces raw */
      }
      fail(`${q.label} → HTTP ${r.status}: ${msg}`);
      console.log(`    ${q.source}`);
    }
  }

  if (behind.length) {
    console.log(`\n${behind.length} migration(s) not applied:`);
    for (const m of behind) console.log(`  supabase/migrations/${m}`);
    /* --include-all is the part that is easy to miss. `db push` applies only
       migrations newer than the latest one already recorded, so a migration that
       ran out of order leaves everything older than it permanently skipped, and
       the default push reports "up to date". */
    console.log(
      "\nApply with:\n  npx supabase db push --include-all\n" +
        "(--include-all is required: these sort BEFORE a migration that has already\n" +
        " been applied, so a plain push considers them history and skips them.)\n",
    );
  }

  finish();
}

function finish() {
  console.log(
    missing === 0
      ? "Schema matches what the app queries.\n"
      : `${missing} check(s) failed — the app is querying columns the database does not have.\n`,
  );
  process.exit(missing === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\nverifier crashed:", e.message);
  process.exit(1);
});
