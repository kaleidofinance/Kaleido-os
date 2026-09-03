#!/usr/bin/env node
/**
 * Verifies the Supabase wiring that Luca's model-request quotas depend on.
 *
 * Run after filling the three Supabase vars in .env and applying the
 * migrations, to prove the ceilings are actually enforced rather than failing
 * open. credits.ts returns `unmetered: true` when supabaseAdmin is null, so an
 * unconfigured deployment looks identical to a working one from the outside —
 * the agent answers either way. This script is what tells the two apart.
 *
 * It calls the same RPCs the route calls, with the service-role key, and
 * exercises both ceilings and the refund for real: the per-wallet one against a
 * throwaway wallet, and the shared one — the ceiling that actually bounds the
 * provider bill — against the real row, because there is only one of those.
 * Nothing here touches a provider, so it costs no model credits.
 *
 * WHAT IT LEAVES BEHIND, stated because one of these tables is production data.
 * The throwaway wallet rows are deleted. The shared row cannot be: it is today's
 * real count. So every consume this script makes is paired with a release, the
 * net is asserted at the end, and the `throttled_at` stamp that forcing a
 * refusal necessarily writes is snapshotted and put back.
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
const GLOBAL_LIMIT = Number(env.AGENT_GLOBAL_DAILY_MODEL_REQUESTS || 2000);

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

/** Spend one request. Every call goes through here so no test forgets a ceiling. */
const consume = (wallet, walletLimit = LIMIT, globalLimit = GLOBAL_LIMIT) =>
  rpc("consume_agent_request", {
    p_wallet: wallet,
    p_limit: walletLimit,
    p_global_limit: globalLimit,
  });

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

/**
 * Today's SHARED counter row.
 *
 * Unlike the wallet rows below, this one belongs to production: it is the real
 * count of what the deployment has spent today, and it cannot be deleted at the
 * end of the run the way a throwaway wallet's row can. Everything this script
 * does to it is either paired with its inverse or restored by hand — see
 * `restoreGlobal`.
 */
async function globalRow() {
  const today = new Date().toISOString().slice(0, 10);
  const res = await fetch(
    `${URL_}/rest/v1/agent_global_usage_daily?usage_date=eq.${today}&select=requests,throttled_at`,
    { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } },
  );
  const json = await res.json().catch(() => null);
  return Array.isArray(json) ? (json[0] ?? null) : null;
}

/**
 * Put `throttled_at` on the shared row back the way it was found.
 *
 * Forcing a refusal is the only way to prove the shared ceiling refuses, and a
 * refusal stamps `throttled_at` — which is production's signal that real users
 * were turned away today. Leaving the verifier's stamp behind would be a
 * fabricated incident, so it is snapshotted before and written back after.
 *
 * `requests` is deliberately NOT written back: it is a counter, another instance
 * may legitimately have incremented it mid-run, and clobbering it with a stale
 * value would lose a real request. It is kept honest a different way — every
 * consume this script makes is paired with a release, and the net is asserted at
 * the end.
 */
async function restoreGlobal(throttledAt) {
  const today = new Date().toISOString().slice(0, 10);
  await fetch(
    `${URL_}/rest/v1/agent_global_usage_daily?usage_date=eq.${today}`,
    {
      method: "PATCH",
      headers: {
        apikey: SERVICE,
        Authorization: `Bearer ${SERVICE}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ throttled_at: throttledAt }),
    },
  ).catch(() => {});
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

  /* The shared row as found. Everything below is measured against this, and the
     run is expected to hand back exactly what it spends — asserted at the end,
     because a verifier that quietly eats a few of the day's real allowance every
     time it runs is a verifier that makes the thing it checks worse. */
  console.log("\nthe shared counter, as found");
  const gpeek = await rpc("peek_global_agent_usage", {});
  if (gpeek.status === 404)
    return (
      fail(
        "peek_global_agent_usage not found — apply supabase/migrations/20260903000000_global_agent_request_cap.sql",
      ),
      finish()
    );
  if (gpeek.status !== 200)
    return (
      fail(`HTTP ${gpeek.status}: ${gpeek.text.slice(0, 200)}`),
      finish()
    );
  const globalBefore = await globalRow();
  const globalStart = Number(row(gpeek.json)?.used ?? 0);
  const globalThrottledStart = globalBefore?.throttled_at ?? null;
  /* The RPC and the table have to agree, or one of the two is reading a
     different day — `current_date` is the server's, and this script's `today` is
     the client's UTC. A mismatch here is the tell. */
  Number(globalBefore?.requests ?? 0) === globalStart
    ? pass(
        `${globalStart}/${GLOBAL_LIMIT} spent today` +
          (globalThrottledStart
            ? `, and it already refused someone at ${globalThrottledStart}`
            : ""),
      )
    : fail(
        `peek says ${globalStart} but the table says ${globalBefore?.requests ?? 0} — check the server's date against UTC`,
      );

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
  const c1 = await consume(WALLET);
  if (c1.status === 404)
    return (
      fail(
        "3-argument consume_agent_request not found — apply supabase/migrations/20260903000000_global_agent_request_cap.sql",
      ),
      finish()
    );
  if (c1.status !== 200)
    return (fail(`HTTP ${c1.status}: ${c1.text.slice(0, 200)}`), finish());
  const r1 = row(c1.json);
  r1?.allowed === true
    ? pass(`allowed=true, used=${r1.used}, quota=${r1.quota}`)
    : fail(`expected allowed=true, got ${JSON.stringify(r1)}`);
  r1?.refused_by === null
    ? pass("refused_by is null when nothing refused")
    : fail(
        `refused_by=${JSON.stringify(r1?.refused_by)} on an allowed request`,
      );

  /* The shared counter has to move too, or the ceiling is a table nobody writes
     to — which would pass every per-wallet check in this file while bounding
     nothing. */
  const g1 = Number((await globalRow())?.requests ?? 0);
  g1 === globalStart + 1
    ? pass(`shared counter advanced ${globalStart} -> ${g1}`)
    : fail(
        `shared counter went ${globalStart} -> ${g1}, expected ${globalStart + 1}`,
      );

  const peek3 = await rpc("peek_agent_usage", { p_wallet: WALLET });
  const spent = Number(row(peek3.json)?.used ?? row(peek3.json) ?? 0);
  spent === after + 1
    ? pass(`counter advanced ${after} -> ${spent}`)
    : fail(`counter went ${after} -> ${spent}, expected ${after + 1}`);

  /* The ceiling, proven rather than assumed. p_limit=1 against a row already at
     >=1 must refuse WITHOUT incrementing — that combination is the whole
     contract, and a function that merely counts would pass every check above
     while enforcing nothing. */
  console.log("\nthe per-wallet ceiling actually refuses");
  const denied = await consume(WALLET, 1);
  const rd = row(denied.json);
  rd?.allowed === false
    ? pass(`allowed=false at the limit (used=${rd.used})`)
    : fail(`expected refusal at p_limit=1, got ${JSON.stringify(rd)}`);
  rd?.refused_by === "wallet"
    ? pass('refused_by="wallet"')
    : fail(`refused_by=${JSON.stringify(rd?.refused_by)}, expected "wallet"`);

  /* One row, not two. RETURN QUERY appends and carries on, so a refusal branch
     that forgets its bare RETURN falls through to the success row and the
     function answers allowed=false AND allowed=true. Every caller happens to
     read row[0], so the bug this catches is invisible until someone uses
     .single() or reads the last row — at which point it is a free pass through
     the ceiling. */
  Array.isArray(denied.json) && denied.json.length === 1
    ? pass("a refusal returns exactly one row")
    : fail(
        `a refusal returned ${Array.isArray(denied.json) ? denied.json.length : "a bare object"} — the branch is missing its RETURN`,
      );

  const peek4 = await rpc("peek_agent_usage", { p_wallet: WALLET });
  const held = Number(row(peek4.json)?.used ?? row(peek4.json) ?? 0);
  held === spent
    ? pass("a refused request spent nothing")
    : fail(`refusal still incremented ${spent} -> ${held}`);

  /* And it must not have spent shared allowance either. The wallet ceiling is
     checked first precisely so that a refusal there never reaches the shared
     counter; if it did, one wallet hammering its own exhausted limit would drain
     the deployment's day. */
  const g2 = Number((await globalRow())?.requests ?? 0);
  g2 === g1
    ? pass("and spent no shared allowance")
    : fail(`a per-wallet refusal moved the shared counter ${g1} -> ${g2}`);

  /*
   * The shared ceiling — the one that actually bounds the bill, since a wallet
   * costs nothing to mint and 25 of them times N is unbounded.
   *
   * Forced by passing p_global_limit equal to what the counter already holds,
   * rather than by spending 2,000 requests. That is not a shortcut: `requests <
   * p_global_limit` is the entire gate, so a limit already met exercises exactly
   * the branch a real exhaustion takes, and it does it without spending a single
   * unit of the day's real allowance.
   */
  console.log("\nthe shared ceiling refuses, and refunds the wallet");
  const rowBeforeGlobal = await usageRow(WALLET);
  const walletBeforeGlobal = Number(rowBeforeGlobal?.requests ?? 0);
  const walletStampBefore = rowBeforeGlobal?.throttled_at ?? null;
  const gDenied = await consume(WALLET, LIMIT, g2);
  const rg = row(gDenied.json);
  rg?.allowed === false
    ? pass(`allowed=false at the shared limit (global_used=${rg.global_used})`)
    : fail(
        `expected refusal at p_global_limit=${g2}, got ${JSON.stringify(rg)}`,
      );
  rg?.refused_by === "global"
    ? pass('refused_by="global", so the route can say which ceiling it was')
    : fail(`refused_by=${JSON.stringify(rg?.refused_by)}, expected "global"`);
  Array.isArray(gDenied.json) && gDenied.json.length === 1
    ? pass("one row")
    : fail("more than one row — the global branch is missing its RETURN");

  /* The rollback, and it is the property that makes the whole thing honest. The
     wallet was charged before the shared counter was consulted, so a shared
     refusal that kept the charge would bill users for requests nobody served —
     and on a busy day it would silently eat all 25 of everyone's allowance. */
  const walletAfterGlobal = Number((await usageRow(WALLET))?.requests ?? 0);
  walletAfterGlobal === walletBeforeGlobal
    ? pass(`the wallet's request was handed back (still ${walletAfterGlobal})`)
    : fail(
        `the wallet was charged for a shared refusal: ${walletBeforeGlobal} -> ${walletAfterGlobal}`,
      );
  Number(rg?.used) === walletBeforeGlobal
    ? pass(`and reported honestly (used=${rg.used})`)
    : fail(`reported used=${rg?.used} but the table says ${walletAfterGlobal}`);

  const g3 = Number((await globalRow())?.requests ?? 0);
  g3 === g2
    ? pass("the shared counter did not move either")
    : fail(`a shared refusal moved the shared counter ${g2} -> ${g3}`);

  /* throttled_at on the shared row is the operational signal that real users
     were turned away today. It is restored at the end of the run, but it has to
     be written in the first place or nobody finds out the ceiling is too low. */
  (await globalRow())?.throttled_at
    ? pass("throttled_at was stamped on the shared row")
    : fail(
        "throttled_at was not stamped — a shared exhaustion leaves no signal",
      );

  /* And the wallet's own throttled_at must NOT have moved for a shared refusal.
     The wallet was not throttled, the deployment was; stamping it would put a
     shared outage into the per-user data and make it look like every user on the
     testnet abusing their allowance on the same day. It was already stamped by
     the per-wallet refusal above, so the check is that it is the SAME stamp — a
     new `now()` would be a different value. */
  const walletStampAfter = (await usageRow(WALLET))?.throttled_at ?? null;
  walletStampAfter === walletStampBefore
    ? pass("the wallet's own throttled_at was left alone")
    : fail(
        `a shared refusal stamped the wallet's throttled_at: ${walletStampBefore} -> ${walletStampAfter}`,
      );

  /* Concurrency: five simultaneous calls against a limit of used+3 must grant
     exactly 3. This is the race the migration's single-statement UPDATE exists
     to close, and a read-then-write implementation fails here specifically. */
  console.log("\nconcurrent calls cannot overspend");
  const room = 3;
  const burst = await Promise.all(
    Array.from({ length: 5 }, () => consume(WALLET, walletAfterGlobal + room)),
  );
  const granted = burst.filter((b) => row(b.json)?.allowed === true).length;
  granted === room
    ? pass(`5 concurrent calls, exactly ${room} granted`)
    : fail(`5 concurrent calls granted ${granted}, expected ${room}`);

  /* The same race on the shared counter, which is the one that matters more: it
     is a single row every request in the deployment contends for, so an
     implementation that read it and then wrote it back would let a burst
     overspend by however many arrived at once. Limited to +2 of where it stands
     so this costs two units, both handed back below. The per-wallet limit is
     left wide open on purpose, so that what refuses these is unambiguously the
     shared ceiling and not the wallet's. */
  console.log("\nconcurrent calls cannot overspend the SHARED counter");
  const gNow = Number((await globalRow())?.requests ?? 0);
  const walletBeforeGBurst = Number((await usageRow(WALLET))?.requests ?? 0);
  const gRoom = 2;
  const gBurst = await Promise.all(
    Array.from({ length: 5 }, () => consume(WALLET, LIMIT, gNow + gRoom)),
  );
  const gGranted = gBurst.filter((b) => row(b.json)?.allowed === true).length;
  const gAfterBurst = Number((await globalRow())?.requests ?? 0);
  gGranted === gRoom && gAfterBurst === gNow + gRoom
    ? pass(
        `5 concurrent calls, exactly ${gRoom} granted (${gNow} -> ${gAfterBurst})`,
      )
    : fail(
        `5 concurrent calls granted ${gGranted} and moved the counter ${gNow} -> ${gAfterBurst}, expected ${gRoom}`,
      );

  /* Every call the shared ceiling turned away must have given its wallet charge
     back, or a contended counter quietly bills each loser of the race — and
     under real contention that is most of them. */
  const walletAfterBurst = Number((await usageRow(WALLET))?.requests ?? 0);
  walletAfterBurst === walletBeforeGBurst + gRoom
    ? pass(`the ${5 - gRoom} refused calls were all refunded`)
    : fail(
        `wallet went ${walletBeforeGBurst} -> ${walletAfterBurst}, expected ${walletBeforeGBurst + gRoom}`,
      );

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
  const gBeforeRel = Number((await globalRow())?.requests ?? 0);

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

  /* A successful consume charged BOTH counters, so a refund that returns only
     the wallet's is a leak: the shared counter would climb by one on every
     gateway refusal and never come down, until the deployment sat at a ceiling
     nobody had actually reached. The failure is silent for weeks and then
     everything stops at once, which is why it is checked here rather than
     reasoned about. */
  const gAfterRel = Number((await globalRow())?.requests ?? 0);
  gAfterRel === gBeforeRel - 1
    ? pass(`and the shared counter went back ${gBeforeRel} -> ${gAfterRel}`)
    : fail(
        `the shared counter went ${gBeforeRel} -> ${gAfterRel}, expected ${gBeforeRel - 1} — refunds leak`,
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
    fail(
      "throttled_at was never stamped — the refusal above should have set it",
    );
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
  const gBeforeDrain = Number((await globalRow())?.requests ?? 0);
  let guard = 0;
  let current = afterRel;
  while (current > 0 && guard++ < 60) {
    await rpc("release_agent_request", { p_wallet: WALLET, p_limit: LIMIT });
    current = Number((await usageRow(WALLET))?.requests ?? 0);
  }
  current === 0
    ? pass(`drained to 0 in ${guard} releases`)
    : fail(`could not drain the counter, stuck at ${current}`);

  /* One shared unit per wallet unit given back, no more and no less. Fewer and
     the shared counter drifts up forever; more and a loop of releases mints
     shared allowance out of nothing. */
  const gAfterDrain = Number((await globalRow())?.requests ?? 0);
  gAfterDrain === gBeforeDrain - afterRel
    ? pass(
        `the shared counter followed it down ${gBeforeDrain} -> ${gAfterDrain}`,
      )
    : fail(
        `the shared counter went ${gBeforeDrain} -> ${gAfterDrain}, expected ${gBeforeDrain - afterRel}`,
      );

  const past = await rpc("release_agent_request", {
    p_wallet: WALLET,
    p_limit: LIMIT,
  });
  const floored = Number((await usageRow(WALLET))?.requests ?? 0);
  floored === 0
    ? pass("a release against zero stays at zero")
    : fail(
        `released past zero to ${floored} — negative allowance is spendable`,
      );
  Number(row(past.json)?.used) === 0
    ? pass("and reports zero rather than a negative")
    : fail(`reported used=${row(past.json)?.used} at the floor`);

  /* The sharper half of the floor, now that there are two counters. A release
     with nothing to give back must not decrement the SHARED one either — if it
     did, a loop of releases against a spent wallet would be a way to mint
     deployment-wide allowance from a wallet that had none, which is exactly the
     ceiling this whole change exists to hold. */
  const gAfterFloor = Number((await globalRow())?.requests ?? 0);
  gAfterFloor === gAfterDrain
    ? pass("and left the shared counter alone")
    : fail(
        `a release with nothing to refund moved the shared counter ${gAfterDrain} -> ${gAfterFloor} — shared allowance is mintable`,
      );

  /*
   * A release for a wallet with no row today must not create one. The migration
   * is explicit that a release is not a usage event, and it matters beyond
   * tidiness: a created row is a row with requests = 0 and throttled_at null,
   * which is indistinguishable from a wallet that used its allowance and got it
   * all back — so usage data would gain phantom participants.
   */
  console.log("\na refund for an unused wallet records nothing");
  const UNUSED = "0x00000000000000000000000000000000000000c0";
  const gBeforeUnused = Number((await globalRow())?.requests ?? 0);
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
  /* And it must not have paid itself out of the shared counter. This is the same
     hole as the floor check, reached by a different door: a wallet with no row at
     all rather than a row at zero. Both have to close, because either one turns
     an unauthenticated-looking loop into a way to mint the deployment's day. */
  Number((await globalRow())?.requests ?? 0) === gBeforeUnused
    ? pass("and left the shared counter alone")
    : fail(
        "a refund for a wallet that never spent anything decremented the shared counter",
      );

  console.log("\nanon key must NOT be able to spend, refund or read quota");
  if (ANON) {
    const asAnon = (name, body = { p_wallet: WALLET, p_limit: LIMIT }) =>
      fetch(`${URL_}/rest/v1/rpc/${name}`, {
        method: "POST",
        headers: {
          apikey: ANON,
          Authorization: `Bearer ${ANON}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

    const leak = await asAnon("consume_agent_request", {
      p_wallet: WALLET,
      p_limit: LIMIT,
      p_global_limit: GLOBAL_LIMIT,
    });
    leak.status === 200
      ? fail(
          `anon key executed the function (HTTP 200) — the REVOKE in the migration did not take`,
        )
      : pass(`consume refused for anon (HTTP ${leak.status})`);

    /* The sharper of the two. Postgres grants EXECUTE to public by default, so a
       security-definer refund over a browser-inaccessible table is, without the
       REVOKE, an unlimited quota reset callable with the key that ships in the
       bundle — worse than the consume leak, which at most lets a caller spend
       what it already had. Now doubly so: it refunds the shared counter too, so
       one loop from the browser would keep the deployment's day permanently
       topped up. */
    const refundLeak = await asAnon("release_agent_request");
    refundLeak.status === 200
      ? fail(
          "anon key executed release_agent_request (HTTP 200) — the shipped key can refund itself without limit",
        )
      : pass(`release refused for anon (HTTP ${refundLeak.status})`);

    /* Read-only, so this one leaks a number rather than allowance — but the
       number is how much reasoning the whole deployment has left today, which is
       precisely the thing worth knowing before deciding to drain it. */
    const peekLeak = await asAnon("peek_global_agent_usage", {});
    peekLeak.status === 200
      ? fail(
          "anon key read peek_global_agent_usage (HTTP 200) — the shared counter is public",
        )
      : pass(`shared peek refused for anon (HTTP ${peekLeak.status})`);

    /* The table itself, not just the functions. RLS is enabled on it with no
       policy, which is what makes a direct select return nothing rather than
       everything — the same arrangement agent_usage_daily has. */
    const tableLeak = await fetch(
      `${URL_}/rest/v1/agent_global_usage_daily?select=requests`,
      { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } },
    );
    const tableBody = await tableLeak.json().catch(() => null);
    tableLeak.status === 200 && Array.isArray(tableBody) && tableBody.length > 0
      ? fail(
          "anon key read agent_global_usage_daily directly — RLS is off or a policy allows it",
        )
      : pass(
          `direct table read returns nothing for anon (HTTP ${tableLeak.status})`,
        );
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

  /*
   * The shared row cannot be deleted — it is production's count for today — so
   * it is put back instead, and then checked.
   *
   * The stamp first: forcing a refusal above necessarily wrote throttled_at, and
   * leaving it would be a fabricated incident. Then the count, which should
   * already be where it started because every consume here was paired with a
   * release. Reported rather than corrected: an off-by-a-few is a bug in this
   * script or in the SQL, and silently patching the number over it is how the
   * bug survives.
   */
  console.log("\nthe shared counter, put back");
  await restoreGlobal(globalThrottledStart);
  const globalEnd = await globalRow();
  const drift = Number(globalEnd?.requests ?? 0) - globalStart;
  drift === 0
    ? pass(`net zero — still ${globalStart}/${GLOBAL_LIMIT}`)
    : fail(
        `drifted by ${drift > 0 ? "+" : ""}${drift} (${globalStart} -> ${globalEnd?.requests ?? 0}). ` +
          "Every consume here is meant to be paired with a release; if this is positive, " +
          "this run ate that much of today's real allowance.",
      );
  (globalEnd?.throttled_at ?? null) === globalThrottledStart
    ? pass("throttled_at restored to what it was")
    : fail(
        `throttled_at left at ${globalEnd?.throttled_at} instead of ${globalThrottledStart}`,
      );

  finish();
}

function finish() {
  console.log(
    failed === 0
      ? "\nAll checks passed — both ceilings are enforced and the refund is honest.\n"
      : `\n${failed} check(s) failed — the quotas are NOT reliably enforced.\n`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\nverifier crashed:", e.message);
  process.exit(1);
});
