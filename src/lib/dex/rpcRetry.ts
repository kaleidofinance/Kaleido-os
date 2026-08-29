/**
 * Retrying a read the node refused for reasons that have nothing to do with the
 * answer.
 *
 * WHY THIS EXISTS, MEASURED RATHER THAN ASSUMED
 *
 * The pools table sweeps five chains at once, and two of the five endpoints throttle
 * under it. Measured 2026-08-28 against the running app:
 *
 *   sepolia.base.org      HTTP 200, `{"code":-32016,"message":"over rate limit"}`
 *   rpc.testnet.arc.network HTTP 200, `{"code":-32005,"message":"rate limit exceeded"}`
 *
 * Both arrive as **HTTP 200 with a JSON-RPC error body**, which is why nothing
 * upstream retried them: ethers' own `FetchRequest` retries 429s and sees a 200
 * here. Worse, for `eth_call` ethers converts any error carrying no revert data
 * into `CALL_EXCEPTION` / "missing revert data" — so a throttled request and a
 * reverting call are indistinguishable at the call site, and every layer above
 * treats both as "there is nothing there".
 *
 * The visible cost of that was Base Sepolia's three pools vanishing from a table
 * headed "All pools": `getPool` found them, the `balanceOf` batch immediately after
 * was throttled, `buildPool`'s catch returned null, and the rows were dropped with
 * one console line. They reappeared on the next 30s refresh, which is the worst
 * version of the bug — the page was intermittently right.
 *
 * WHAT COUNTS AS TRANSIENT
 *
 * Only a phrase that means "ask again". Deliberately NOT the bare word "exceeded":
 * the same `-32005` code also carries "Log response size exceeded. Maximum allowed
 * number of requested blocks is 1000", which is a permanent property of the
 * endpoint's log window — retrying it burns three requests to be told the same
 * thing. That one belongs to `logWindow.ts`, which narrows the range instead.
 *
 * Numeric codes are not matched at all, for the same reason: `-32005` means both
 * of the above depending on the vendor.
 *
 * WHERE IT IS NOT USED
 *
 * Writes. Every caller here is a `view` call, so a retry is free of consequence —
 * a retried transaction is not, and a `ConnectTimeout` on a write is a client-side
 * event that says nothing about whether the write landed.
 */

/** Attempts in total, including the first. Three tries, two waits. */
const DEFAULT_ATTEMPTS = 3;

/** Base backoff. Doubles per attempt, so 250ms then 500ms, before jitter. */
const BASE_DELAY_MS = 250;

/**
 * Phrases that mean the request was refused rather than answered.
 *
 * Matched against the whole error chain's messages — ethers nests the original
 * JSON-RPC error under `.info.error`, and some providers nest it under `.error` —
 * so a wrapped `CALL_EXCEPTION` still matches on the body it was derived from.
 */
const TRANSIENT_PHRASES = [
  /rate limit/i,
  /ratelimit/i,
  /too many requests/i,
  /request limit/i,
  /throttl/i,
  /\b429\b/,
  /\b50[234]\b/,
  /timed? ?out/i,
  /temporarily unavailable/i,
  /service unavailable/i,
  /bad gateway/i,
  /capacity/i,
  /overloaded/i,
  /try again/i,
];

/** ethers' own coarse codes for "the transport failed", not "the call reverted". */
const TRANSIENT_CODES = new Set([
  "SERVER_ERROR",
  "TIMEOUT",
  "NETWORK_ERROR",
  "BUFFER_OVERRUN",
]);

/** Every message-ish string reachable from an error, one flat haystack. */
function collectText(err: unknown, depth = 0): string {
  if (depth > 4 || err === null || err === undefined) return "";
  if (typeof err === "string") return err;
  if (typeof err !== "object") return String(err);

  const e = err as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof e.message === "string") parts.push(e.message);
  if (typeof e.shortMessage === "string") parts.push(e.shortMessage);
  if (typeof e.reason === "string") parts.push(e.reason);
  for (const key of ["info", "error", "cause"]) {
    if (e[key]) parts.push(collectText(e[key], depth + 1));
  }
  return parts.join(" | ");
}

/**
 * Whether asking the same question again could plausibly get an answer.
 *
 * Exported because a caller that swallows its own errors — `readPoolState` returns
 * null for "no pool" and for "refused" alike — may want to log the difference even
 * where it cannot act on it.
 */
export function isTransientRpcError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "string" && TRANSIENT_CODES.has(code)) return true;

  const text = collectText(err);
  if (!text) return false;
  /* The one -32005 that is not transient. Checked before the phrases below so
     "Maximum allowed number of requested blocks" cannot match /capacity/ or a
     future phrase someone adds. */
  if (/response size exceeded|requested blocks|block range/i.test(text)) {
    return false;
  }
  return TRANSIENT_PHRASES.some((p) => p.test(text));
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Run a read, retrying only while the failure looks like throttling.
 *
 * Jittered, and that is load-bearing rather than folklore: the sweep fires four
 * probes per chain concurrently and they are throttled *together*, so a fixed
 * backoff would send all four again in the same millisecond and be refused again
 * as a group. The jitter spreads them across the window.
 *
 * Anything that is not transient rethrows immediately, on the first attempt, so a
 * genuine revert still costs one request and still reaches the caller unchanged.
 */
export async function retryRpc<T>(
  work: () => Promise<T>,
  attempts: number = DEFAULT_ATTEMPTS,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await work();
    } catch (err) {
      lastError = err;
      if (attempt === attempts - 1 || !isTransientRpcError(err)) throw err;
      const base = BASE_DELAY_MS * 2 ** attempt;
      await sleep(base + Math.random() * base);
    }
  }
  throw lastError;
}
