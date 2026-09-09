// Checks on RPC endpoint failover. Run with plain node (tsx).
//
// The rotation itself is the easy half. What this suite is really about is the
// three ways failover can be WORSE than no failover:
//
//   1. Rotating on an answer. A revert is the node working; asking the other
//      endpoints the same question turns one honest error into N and hides
//      which endpoint produced it.
//   2. Rotating on a permanent property. `-32005` means both "rate limited"
//      and "Maximum allowed number of requested blocks is 1000". The second is
//      true of that endpoint forever, and rotating over it walks the whole list
//      to be told the same thing three times.
//   3. Leaving the preferred endpoint for good. Ordering is still the design;
//      this must come home when the primary recovers.
//
// The transport is injected, so nothing here touches a network or a chain.
import { sendWithFailover, freshState } from "./rpcFailover.ts";

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} ${detail}`);
  }
};

const URLS = ["https://primary.example", "https://alt.example"] as const;

/** A rate limit as thirdweb actually returned it from Vercel on 2026-09-09. */
const rateLimited = () => {
  const e: Error & { code?: string; info?: unknown } = new Error(
    "exceeded maximum retry limit",
  );
  e.code = "SERVER_ERROR";
  e.info = {
    responseBody:
      "You are using a public RPC with rate limits, to lift those limits you can obtain an api key",
    responseStatus: "429 Too Many Requests",
  };
  return e;
};

/** A node answering: the call reverted. Not a transport failure. */
const reverted = () => {
  const e: Error & { code?: string; info?: unknown } = new Error(
    "execution reverted",
  );
  e.code = "CALL_EXCEPTION";
  e.info = { error: { code: 3, message: "execution reverted" } };
  return e;
};

/** The -32005 that is a permanent property of the endpoint's log window. */
const logWindow = () => {
  const e: Error & { info?: unknown } = new Error("could not coalesce error");
  e.info = {
    error: {
      code: -32005,
      message:
        "Log response size exceeded. Maximum allowed number of requested blocks is 1000",
    },
  };
  return e;
};

/** Records which URLs were dialled, in order. */
function transport(behaviour: Record<string, () => unknown>) {
  const dialled: string[] = [];
  const attempt = async (url: string) => {
    dialled.push(url);
    const out = behaviour[url];
    if (!out) throw new Error(`no behaviour for ${url}`);
    const value = out();
    if (value instanceof Error) throw value;
    return value;
  };
  return { dialled, attempt };
}

async function main() {
  console.log("\n— the outage this was written for —");
  {
    const state = freshState();
    const t = transport({
      [URLS[0]]: rateLimited,
      [URLS[1]]: () => "answered",
    });
    const got = await sendWithFailover(URLS, state, t.attempt);
    check("a rate-limited primary falls through to the alternate", got === "answered", String(got));
    check(
      "and both endpoints were dialled, primary first",
      t.dialled.length === 2 && t.dialled[0] === URLS[0] && t.dialled[1] === URLS[1],
      JSON.stringify(t.dialled),
    );
    check("the alternate becomes sticky", state.index === 1, String(state.index));
  }
  {
    /* The point of stickiness: the second call must not pay for the dead endpoint
       again. A round-robin would send every other request back into the 429 and
       double the traffic the rate limit is complaining about. */
    const state = { index: 1, since: Date.now() };
    const t = transport({
      [URLS[0]]: rateLimited,
      [URLS[1]]: () => "answered",
    });
    await sendWithFailover(URLS, state, t.attempt);
    check(
      "a later call goes straight to the alternate, not through the dead primary",
      t.dialled.length === 1 && t.dialled[0] === URLS[1],
      JSON.stringify(t.dialled),
    );
  }

  console.log("\n— what must NOT cause a rotation —");
  {
    const state = freshState();
    const t = transport({ [URLS[0]]: reverted, [URLS[1]]: () => "answered" });
    let threw: unknown = null;
    try {
      await sendWithFailover(URLS, state, t.attempt);
    } catch (e) {
      threw = e;
    }
    check(
      "a revert is rethrown from the first endpoint",
      threw instanceof Error && threw.message === "execution reverted",
      String(threw),
    );
    check(
      "and the alternate is never asked the same question",
      t.dialled.length === 1,
      JSON.stringify(t.dialled),
    );
    check("so the primary stays preferred", state.index === 0, String(state.index));
  }
  {
    const state = freshState();
    const t = transport({ [URLS[0]]: logWindow, [URLS[1]]: () => "answered" });
    let threw: unknown = null;
    try {
      await sendWithFailover(URLS, state, t.attempt);
    } catch (e) {
      threw = e;
    }
    check(
      "the -32005 that means a log-range ceiling does not rotate",
      threw !== null && t.dialled.length === 1,
      JSON.stringify(t.dialled),
    );
  }

  console.log("\n— HTTP 200 with a JSON-RPC error body —");
  {
    /* How Base Sepolia and Arc throttle: the status code is fine and the refusal
       is in the payload, so a status-only check would never see it. */
    const state = freshState();
    const t = transport({
      [URLS[0]]: () => [{ error: { code: -32016, message: "over rate limit" } }],
      [URLS[1]]: () => [{ result: "0x1" }],
    });
    const got = await sendWithFailover(URLS, state, t.attempt, {
      batchError: (v) => {
        const rows = v as Array<{ error?: unknown }>;
        return rows.every((r) => r.error) ? rows[0].error : null;
      },
    });
    check(
      "a throttle dressed as a 200 still fails over",
      JSON.stringify(got) === JSON.stringify([{ result: "0x1" }]),
      JSON.stringify(got),
    );
  }
  {
    /* A batch where one call reverted and the rest answered is a HEALTHY endpoint.
       Rotating on it would move traffic off a good node every failed staticCall. */
    const state = freshState();
    const t = transport({
      [URLS[0]]: () => [{ error: { code: 3, message: "execution reverted" } }],
      [URLS[1]]: () => [{ result: "0x2" }],
    });
    const got = await sendWithFailover(URLS, state, t.attempt, {
      batchError: (v) => {
        const rows = v as Array<{ error?: unknown }>;
        return rows.every((r) => r.error) ? rows[0].error : null;
      },
    });
    check(
      "a batch of genuine errors is returned, not rotated away from",
      JSON.stringify(got) ===
        JSON.stringify([{ error: { code: 3, message: "execution reverted" } }]),
      JSON.stringify(got),
    );
    check("and it stays on the primary", state.index === 0, String(state.index));
  }

  console.log("\n— coming home —");
  {
    /* Ordering is still the design: [0] is the endpoint chains.ts chose, and a
       provider that never returns to it has quietly changed which node the app
       reads from for the rest of the process's life. */
    const now = 1_000_000;
    const state = { index: 1, since: now - 10 * 60_000 };
    const t = transport({
      [URLS[0]]: () => "primary recovered",
      [URLS[1]]: () => "still on the alternate",
    });
    const got = await sendWithFailover(URLS, state, t.attempt, {
      now: () => now,
      stickyMs: 5 * 60_000,
    });
    check(
      "once the sticky window expires the primary is tried again",
      got === "primary recovered",
      String(got),
    );
    check("and it is preferred again", state.index === 0, String(state.index));
  }
  {
    const now = 1_000_000;
    const state = { index: 1, since: now - 60_000 };
    const t = transport({
      [URLS[0]]: () => "primary",
      [URLS[1]]: () => "alternate",
    });
    const got = await sendWithFailover(URLS, state, t.attempt, {
      now: () => now,
      stickyMs: 5 * 60_000,
    });
    check(
      "but not before it expires — a minute in, the alternate keeps the traffic",
      got === "alternate",
      String(got),
    );
  }

  console.log("\n— exhaustion and edges —");
  {
    const state = freshState();
    const t = transport({ [URLS[0]]: rateLimited, [URLS[1]]: rateLimited });
    let threw: unknown = null;
    try {
      await sendWithFailover(URLS, state, t.attempt);
    } catch (e) {
      threw = e;
    }
    check(
      "every endpoint refusing throws rather than returning nothing",
      threw instanceof Error && t.dialled.length === 2,
      `${String(threw)} ${JSON.stringify(t.dialled)}`,
    );
  }
  {
    const state = freshState();
    const t = transport({ [URLS[0]]: () => "only" });
    const got = await sendWithFailover([URLS[0]], state, t.attempt);
    check("a single-URL list still works", got === "only", String(got));
  }
  {
    let threw: unknown = null;
    try {
      await sendWithFailover([], freshState(), async () => "unreachable");
    } catch (e) {
      threw = e;
    }
    check("an empty list throws rather than hanging", threw instanceof Error, String(threw));
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
