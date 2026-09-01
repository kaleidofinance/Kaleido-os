// Checks on the transient-RPC classifier. Run with plain node (tsx).
//
// The whole value of `retryRpc` is in what it declines to retry. Two of the five
// endpoints the pools sweep reads return HTTP 200 with a JSON-RPC error body, and
// one of them uses the SAME error code (-32005) for a rate limit — retry it — and
// for its permanent log-range ceiling — retrying that burns three requests to be
// told the same thing. The strings below are the ones actually observed on
// 2026-08-28, plus the shapes ethers wraps them in.
import { isTransientRpcError, retryRpc } from "./rpcRetry.ts";

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

/** How ethers v6 hands back a JSON-RPC error from an eth_call: the original body
 *  is buried under `.info.error` and the surface message says nothing useful. */
const ethersCallException = (code, message) => {
  const e = new Error(
    'missing revert data (action="call", data=null, reason=null)',
  );
  e.code = "CALL_EXCEPTION";
  e.info = { error: { code, message } };
  return e;
};

console.log("\n— the two refusals measured on live endpoints —");
{
  check(
    "Base Sepolia's -32016 over rate limit, as ethers wraps it",
    isTransientRpcError(ethersCallException(-32016, "over rate limit")),
  );
  check(
    "Arc's -32005 rate limit exceeded, as ethers wraps it",
    isTransientRpcError(ethersCallException(-32005, "rate limit exceeded")),
  );
  check(
    "and unwrapped, straight off the wire",
    isTransientRpcError({ code: -32005, message: "rate limit exceeded" }),
  );
}

console.log("\n— the -32005 that must NOT be retried —");
{
  const logRange = ethersCallException(
    -32005,
    "Log response size exceeded. Maximum allowed number of requested blocks is 1000",
  );
  check("thirdweb's log-range ceiling is permanent, not throttling", !isTransientRpcError(logRange));
  check(
    "and so is the same fact phrased as a block range",
    !isTransientRpcError({ message: "exceed maximum block range: 10000" }),
  );
}

console.log("\n— a real revert is not transient —");
{
  check(
    "execution reverted",
    !isTransientRpcError({
      code: "CALL_EXCEPTION",
      message: 'execution reverted (action="call")',
    }),
  );
  check(
    "a decode failure",
    !isTransientRpcError(
      new Error('could not decode result data (value="0x")'),
    ),
  );
  check("nothing at all", !isTransientRpcError(null));
  check("a bare string with no signal", !isTransientRpcError("nope"));
}

console.log("\n— transport failures, which are transient —");
{
  check("ethers TIMEOUT", isTransientRpcError({ code: "TIMEOUT" }));
  check("ethers SERVER_ERROR", isTransientRpcError({ code: "SERVER_ERROR" }));
  check(
    "an HTTP 429 surfaced as text",
    isTransientRpcError(new Error("server response 429 Too Many Requests")),
  );
  check(
    "a nested cause",
    isTransientRpcError({
      message: "failed to fetch",
      cause: { message: "503 Service Unavailable" },
    }),
  );
}

/*
 * The endpoint that is not there at all, which is a different failure from the
 * endpoint that refuses. Measured 2026-09-01 by pointing ethers at a dead port and
 * at an unresolvable host: it rethrows the SYSTEM error, so what arrives has a
 * Node code and no ethers code, and none of the phrases above match its message.
 * Every one of these classified as a revert until then — and the orders keeper's
 * quote loop, which treats a non-transient failure as "this tier has no pool",
 * reported an unreachable RPC as an empty market.
 */
console.log("\n— an endpoint that never answered at all —");
{
  check(
    "a refused connection, as ethers rethrows it",
    isTransientRpcError(
      Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:1"), {
        code: "ECONNREFUSED",
      }),
    ),
  );
  check(
    "a host that does not resolve",
    isTransientRpcError(
      Object.assign(new Error("getaddrinfo ENOTFOUND rpc.example.invalid"), {
        code: "ENOTFOUND",
      }),
    ),
  );
  check(
    "a DNS failure that may pass next time",
    isTransientRpcError({ code: "EAI_AGAIN" }),
  );
  check(
    "undici's connect timeout, by code",
    isTransientRpcError({ code: "UND_ERR_CONNECT_TIMEOUT" }),
  );
  check(
    "undici's wrapper with the system error underneath",
    isTransientRpcError(
      Object.assign(new TypeError("fetch failed"), {
        cause: Object.assign(new Error("read ECONNRESET"), {
          code: "ECONNRESET",
        }),
      }),
    ),
  );
  check(
    "and flattened to its message alone, which is how this repo rethrows",
    isTransientRpcError(new Error("fetch failed")),
  );
  /* The control the whole set depends on: if a revert reached this predicate as
     transient, the keeper would retry three times and then call an empty pool an
     outage. */
  check(
    "a revert still is not one of these",
    !isTransientRpcError(
      Object.assign(new Error("execution reverted"), { code: "CALL_EXCEPTION" }),
    ),
  );
}

console.log("\n— retryRpc's behaviour —");
{
  const run = async () => {
    let calls = 0;
    const recovered = await retryRpc(async () => {
      calls += 1;
      if (calls < 3) throw ethersCallException(-32016, "over rate limit");
      return "answered";
    });
    check(
      "a throttled read is retried until it answers",
      recovered === "answered" && calls === 3,
      `${recovered} after ${calls}`,
    );

    let revertCalls = 0;
    let threw = null;
    try {
      await retryRpc(async () => {
        revertCalls += 1;
        throw new Error("execution reverted: insufficient liquidity");
      });
    } catch (e) {
      threw = e;
    }
    check(
      "a revert costs exactly one request and reaches the caller",
      revertCalls === 1 && threw !== null,
      `${revertCalls} call(s), threw=${threw !== null}`,
    );

    let giveUp = 0;
    let lastThrown = null;
    try {
      await retryRpc(async () => {
        giveUp += 1;
        throw ethersCallException(-32005, "rate limit exceeded");
      });
    } catch (e) {
      lastThrown = e;
    }
    check(
      "an endpoint refusing throughout gives up after the attempt budget",
      giveUp === 3 && lastThrown !== null,
      `${giveUp} call(s)`,
    );

    check(
      "the attempt budget is a parameter",
      await (async () => {
        let n = 0;
        try {
          await retryRpc(async () => {
            n += 1;
            throw ethersCallException(-32016, "over rate limit");
          }, 1);
        } catch {}
        return n === 1;
      })(),
    );
  };

  /* Not `await run()`: tsx compiles this to CJS, where top-level await is a syntax
     error. The report is chained instead of following the call. */
  run().then(() => {
    console.log(`\n${pass} passed, ${fail} failed\n`);
    if (fail > 0) process.exit(1);
  });
}
