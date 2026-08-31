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
 * It calls the same three RPCs the route calls, with the service-role key, and
 * exercises the ceiling and the refund for real against a throwaway wallet.
 * Nothing here touches a provider, so it costs no model credits.
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

/** Today's counter row, read straight from the table as the service role. */
async function usageRow(wallet) {
  const today = new Date().toISOString().slice(0, 10);
  const res = await fetch(
    `${URL_}/rest/v1/agent_usage_daily?wallet=eq.${wallet}&usage_date=eq.${today}&select=requests,throttled_at`,
    { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } },
  );
  const json = await res.json().catch(() => null);
  return Array.isArray(json) ? (json[0] ?? null) : null;
}

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

  /*
   * The refund. consume_agent_request runs immediately before dispatch, so a
   * request the gateway refuses outright has already been charged — that is what
   * release_agent_request exists to undo (20260831000000). It is worth checking
   * end to end rather than by reading the SQL, because both ways it can be wrong
   * are silent: a release that does nothing quietly costs users a request a day,
   * and a release that does too much quietly hands out free ones.
   */
  console.log("\nrelease_agent_request (hands back what was never served)");
  const beforeRow = await usageRow(WALLET);
  const beforeRel = Number(beforeRow?.requests ?? 0);
  const throttledBefore = beforeRow?.throttled_at ?? null;

  const rel1 = await rpc("release_agent_request", {
    p_wallet: WALLET,
    p_limit: LIMIT,
  });
  if (rel1.status === 404)
    return (
      fail(
        "function not found — apply supabase/migrations/20260831000000_release_agent_request.sql",
      ),
      finish()
    );
  if (rel1.status !== 200)
    return (fail(`HTTP ${rel1.status}: ${rel1.text.slice(0, 200)}`), finish());

  const afterRel = Number((await usageRow(WALLET))?.requests ?? 0);
  afterRel === beforeRel - 1
    ? pass(`counter went back ${beforeRel} -> ${afterRel}`)
    : fail(
        `release moved the counter ${beforeRel} -> ${afterRel}, expected ${beforeRel - 1}`,
      );

  /* credits.ts returns this row to the caller so a refused request can still
     report an accurate remaining count. If the function's own report disagrees
     with the table, the UI shows a number that is wrong by one. */
  const relRow = row(rel1.json);
  Number(relRow?.used) === afterRel
    ? pass(`reports the corrected count (used=${relRow.used})`)
    : fail(`reported used=${relRow?.used} but the table says ${afterRel}`);
  Number(relRow?.quota) === LIMIT
    ? pass(`echoes the limit (quota=${relRow.quota})`)
    : fail(`reported quota=${relRow?.quota}, expected ${LIMIT}`);

  /* throttled_at records that this wallet hit its ceiling today, which stays
     true whether or not a later request was handed back. The migration says it
     leaves the stamp alone; this is that claim, checked. The verifier has
     already forced a refusal above, so the stamp should be set. */
  const throttledAfter = (await usageRow(WALLET))?.throttled_at ?? null;
  if (!throttledBefore)
    fail("throttled_at was never stamped — the refusal above should have set it");
  else
    throttledAfter === throttledBefore
      ? pass("throttled_at survived the refund")
      : fail(
          `throttled_at changed from ${throttledBefore} to ${throttledAfter}`,
        );

  /*
   * The floor, which is the entire safety story. There is no request identity in
   * agent_usage_daily, so a release is "subtract one" rather than "undo that
   * consume" — and a bug that releases too often must bottom out at zero rather
   * than manufacture allowance. Drained deliberately, then pushed once more.
   */
  console.log("\nthe refund cannot go below zero");
  let guard = 0;
  let current = afterRel;
  while (current > 0 && guard++ < 60) {
    await rpc("release_agent_request", { p_wallet: WALLET, p_limit: LIMIT });
    current = Number((await usageRow(WALLET))?.requests ?? 0);
  }
  current === 0
    ? pass(`drained to 0 in ${guard} releases`)
    : fail(`could not drain the counter, stuck at ${current}`);

  const past = await rpc("release_agent_request", {
    p_wallet: WALLET,
    p_limit: LIMIT,
  });
  const floored = Number((await usageRow(WALLET))?.requests ?? 0);
  floored === 0
    ? pass("a release against zero stays at zero")
    : fail(`released past zero to ${floored} — negative allowance is spendable`);
  Number(row(past.json)?.used) === 0
    ? pass("and reports zero rather than a negative")
    : fail(`reported used=${row(past.json)?.used} at the floor`);

  /*
   * A release for a wallet with no row today must not create one. The migration
   * is explicit that a release is not a usage event, and it matters beyond
   * tidiness: a created row is a row with requests = 0 and throttled_at null,
   * which is indistinguishable from a wallet that used its allowance and got it
   * all back — so usage data would gain phantom participants.
   */
  console.log("\na refund for an unused wallet records nothing");
  const UNUSED = "0x00000000000000000000000000000000000000c0";
  const relUnused = await rpc("release_agent_request", {
    p_wallet: UNUSED,
    p_limit: LIMIT,
  });
  relUnused.status === 200
    ? pass("accepted without error")
    : fail(`HTTP ${relUnused.status}: ${relUnused.text.slice(0, 200)}`);
  (await usageRow(UNUSED)) === null
    ? pass("no row was created")
    : fail("a row was created for a wallet that never spent anything");
  Number(row(relUnused.json)?.used) === 0
    ? pass("reports used=0")
    : fail(`reported used=${row(relUnused.json)?.used}, expected 0`);

  console.log("\nanon key must NOT be able to spend or refund quota");
  if (ANON) {
    const asAnon = (name) =>
      fetch(`${URL_}/rest/v1/rpc/${name}`, {
        method: "POST",
        headers: {
          apikey: ANON,
          Authorization: `Bearer ${ANON}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ p_wallet: WALLET, p_limit: LIMIT }),
      });

    const leak = await asAnon("consume_agent_request");
    leak.status === 200
      ? fail(
          `anon key executed the function (HTTP 200) — the REVOKE in the migration did not take`,
        )
      : pass(`consume refused for anon (HTTP ${leak.status})`);

    /* The sharper of the two. Postgres grants EXECUTE to public by default, so a
       security-definer refund over a browser-inaccessible table is, without the
       REVOKE, an unlimited quota reset callable with the key that ships in the
       bundle — worse than the consume leak, which at most lets a caller spend
       what it already had. */
    const refundLeak = await asAnon("release_agent_request");
    refundLeak.status === 200
      ? fail(
          "anon key executed release_agent_request (HTTP 200) — the shipped key can refund itself without limit",
        )
      : pass(`release refused for anon (HTTP ${refundLeak.status})`);
  }

  /* Leave no trace: delete the throwaway rows so a rerun starts clean and the
     dead addresses never show up in usage data. UNUSED should have no row at
     all — deleted anyway, so a failed check above does not poison the next run. */
  const today = new Date().toISOString().slice(0, 10);
  for (const w of [WALLET, UNUSED]) {
    await fetch(
      `${URL_}/rest/v1/agent_usage_daily?wallet=eq.${w}&usage_date=eq.${today}`,
      {
        method: "DELETE",
        headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
      },
    ).catch(() => {});
  }

  finish();
}

function finish() {
  console.log(
    failed === 0
      ? "\nAll checks passed — the quota is enforced and the refund is honest.\n"
      : `\n${failed} check(s) failed — the quota is NOT reliably enforced.\n`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\nverifier crashed:", e.message);
  process.exit(1);
});
