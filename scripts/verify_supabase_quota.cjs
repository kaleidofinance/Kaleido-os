#!/usr/bin/env node
/**
 * Verifies the Supabase wiring that Luca's model-request quota depends on.
 *
 * Run after filling the three Supabase vars in .env and applying the
 * migrations, to prove the ceiling is actually enforced rather than failing
 * open. credits.ts returns `unmetered: true` when supabaseAdmin is null, so an
 * unconfigured deployment looks identical to a working one from the outside —
 * the agent answers either way. This script is what tells the two apart.
 *
 * It calls the same two RPCs the route calls, with the service-role key, and
 * exercises the ceiling for real against a throwaway wallet. Nothing here
 * touches a provider, so it costs no model credits.
 *
 *   node scripts/verify_supabase_quota.cjs
 *
 * Exits non-zero on the first failed check so it is usable as a gate.
 */

const fs = require("fs");
const path = require("path");

const ENV_PATH = path.join(__dirname, "..", ".env");

/**
 * Minimal .env reader.
 *
 * A .cjs script under scripts/ has no Next runtime loading .env for it, and the
 * repo has no dotenv dependency. Only KEY=value lines are honoured; quotes and
 * a trailing CR are stripped because this file gets edited on Windows.
 */
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
const ANON = env.NEXT_PUBLIC_SUPABASE_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const LIMIT = Number(env.AGENT_DAILY_MODEL_REQUESTS || 25);

let failed = 0;
const pass = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => {
  failed++;
  console.log(`  ✗ ${m}`);
};

/** POST to a Postgres function through PostgREST, as the service role. */
async function rpc(name, body) {
  const res = await fetch(`${URL_}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON bodies are surfaced raw below */
  }
  return { status: res.status, json, text };
}

/** The RPCs return either a bare row or a single-element array. */
const row = (j) => (Array.isArray(j) ? j[0] : j);

async function main() {
  console.log("\nSupabase quota wiring\n");

  console.log("config");
  if (!URL_) return (fail("NEXT_PUBLIC_SUPABASE_URL is empty"), finish());
  pass(`URL set (${URL_})`);
  if (!ANON)
    fail("NEXT_PUBLIC_SUPABASE_KEY is empty — browser reads will fail");
  else pass(`anon key set (len ${ANON.length})`);
  if (!SERVICE)
    return (
      fail(
        "SUPABASE_SERVICE_ROLE_KEY is empty — supabaseAdmin stays null and credits.ts fails OPEN",
      ),
      finish()
    );
  pass(`service-role key set (len ${SERVICE.length})`);

  /* The anon and service-role keys are different roles of the same project. If
     they match, the "service" key is really the anon key and every definer
     function below will 403 — worth catching here rather than in the RPC. */
  if (ANON && SERVICE && ANON === SERVICE)
    fail("anon and service-role keys are identical — one of them is wrong");

  console.log("\nreachability");
  const ping = await fetch(`${URL_}/rest/v1/`, {
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  }).catch((e) => ({ status: 0, err: e.message }));
  if (!ping.status)
    return (fail(`cannot reach project: ${ping.err}`), finish());
  pass(`PostgREST reachable (HTTP ${ping.status})`);

  /* A throwaway wallet, so the check never disturbs a real user's count. Not
     random: a fixed address keeps reruns idempotent within a UTC day, and the
     script resets the row at the end anyway. */
  const WALLET = "0x000000000000000000000000000000000000dead";

  console.log("\npeek_agent_usage (must not spend)");
  const peek1 = await rpc("peek_agent_usage", { p_wallet: WALLET });
  if (peek1.status === 404)
    return (
      fail(
        "function not found — apply supabase/migrations/20260805000000_agent_request_quota.sql",
      ),
      finish()
    );
  if (peek1.status !== 200)
    return (
      fail(`HTTP ${peek1.status}: ${peek1.text.slice(0, 200)}`),
      finish()
    );
  const before = Number(row(peek1.json)?.used ?? row(peek1.json) ?? 0);
  pass(`returns used=${before}`);

  const peek2 = await rpc("peek_agent_usage", { p_wallet: WALLET });
  const after = Number(row(peek2.json)?.used ?? row(peek2.json) ?? 0);
  after === before
    ? pass("second peek unchanged — reading is free")
    : fail(`peek incremented ${before} -> ${after}; it must never spend`);

  console.log("\nconsume_agent_request (must be atomic and bounded)");
  const c1 = await rpc("consume_agent_request", {
    p_wallet: WALLET,
    p_limit: LIMIT,
  });
  if (c1.status !== 200)
    return (fail(`HTTP ${c1.status}: ${c1.text.slice(0, 200)}`), finish());
  const r1 = row(c1.json);
  r1?.allowed === true
    ? pass(`allowed=true, used=${r1.used}, quota=${r1.quota}`)
    : fail(`expected allowed=true, got ${JSON.stringify(r1)}`);

  const peek3 = await rpc("peek_agent_usage", { p_wallet: WALLET });
  const spent = Number(row(peek3.json)?.used ?? row(peek3.json) ?? 0);
  spent === after + 1
    ? pass(`counter advanced ${after} -> ${spent}`)
    : fail(`counter went ${after} -> ${spent}, expected ${after + 1}`);

  /* The ceiling, proven rather than assumed. p_limit=1 against a row already at
     >=1 must refuse WITHOUT incrementing — that combination is the whole
     contract, and a function that merely counts would pass every check above
     while enforcing nothing. */
  console.log("\nthe ceiling actually refuses");
  const denied = await rpc("consume_agent_request", {
    p_wallet: WALLET,
    p_limit: 1,
  });
  const rd = row(denied.json);
  rd?.allowed === false
    ? pass(`allowed=false at the limit (used=${rd.used})`)
    : fail(`expected refusal at p_limit=1, got ${JSON.stringify(rd)}`);

  const peek4 = await rpc("peek_agent_usage", { p_wallet: WALLET });
  const held = Number(row(peek4.json)?.used ?? row(peek4.json) ?? 0);
  held === spent
    ? pass("a refused request spent nothing")
    : fail(`refusal still incremented ${spent} -> ${held}`);

  /* Concurrency: five simultaneous calls against a limit of used+3 must grant
     exactly 3. This is the race the migration's single-statement UPDATE exists
     to close, and a read-then-write implementation fails here specifically. */
  console.log("\nconcurrent calls cannot overspend");
  const room = 3;
  const burst = await Promise.all(
    Array.from({ length: 5 }, () =>
      rpc("consume_agent_request", { p_wallet: WALLET, p_limit: held + room }),
    ),
  );
  const granted = burst.filter((b) => row(b.json)?.allowed === true).length;
  granted === room
    ? pass(`5 concurrent calls, exactly ${room} granted`)
    : fail(`5 concurrent calls granted ${granted}, expected ${room}`);

  console.log("\nanon key must NOT be able to spend quota");
  if (ANON) {
    const leak = await fetch(`${URL_}/rest/v1/rpc/consume_agent_request`, {
      method: "POST",
      headers: {
        apikey: ANON,
        Authorization: `Bearer ${ANON}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_wallet: WALLET, p_limit: LIMIT }),
    });
    leak.status === 200
      ? fail(
          `anon key executed the function (HTTP 200) — the REVOKE in the migration did not take`,
        )
      : pass(`anon refused (HTTP ${leak.status})`);
  }

  /* Leave no trace: delete the throwaway row so a rerun starts clean and the
     dead address never shows up in usage data. */
  await fetch(
    `${URL_}/rest/v1/agent_usage_daily?wallet=eq.${WALLET}&usage_date=eq.${new Date().toISOString().slice(0, 10)}`,
    {
      method: "DELETE",
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    },
  ).catch(() => {});

  finish();
}

function finish() {
  console.log(
    failed === 0
      ? "\nAll checks passed — the quota is enforced.\n"
      : `\n${failed} check(s) failed — the quota is NOT reliably enforced.\n`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\nverifier crashed:", e.message);
  process.exit(1);
});
