import { ethers } from "ethers";
import type { JsonRpcError, JsonRpcPayload, JsonRpcResult } from "ethers";
import { isTransientRpcError } from "@/lib/dex/rpcRetry";

/**
 * A read provider that moves to the next endpoint when the current one stops
 * answering.
 *
 * WHY THIS EXISTS, MEASURED RATHER THAN ASSUMED
 *
 * chains.ts used to say it plainly: "only [0] is ever used … the ones below are
 * measured-good alternates for a human to promote — not a fallback that covers a
 * failing primary. Ordering is the whole mechanism." On 2026-09-09 that mechanism
 * met a primary that failed for one deployment and nobody else. Sepolia's [0] was
 * thirdweb's UNKEYED public RPC, which rate-limits by IP; from a browser that is
 * one visitor's IP and invisible, but from Vercel it is a single shared IP
 * serving every request, and it answered:
 *
 *   429 "You are using a public RPC with rate limits, to lift those limits you
 *        can obtain an api key"
 *
 * Every server-side read on that chain went down together — /api/market/overview's
 * kfUSD-supply and pooled-KLD legs and the whole lending book behind /borrow —
 * while the alternate sitting at [1] was healthy the entire time and one line
 * away. Promoting it by hand (PR #57) fixed that outage; it does not fix the
 * next one, because the next one happens while nobody is looking.
 *
 * So the ordering stays exactly what it was — [0] is still the preferred
 * endpoint and this never load-balances away from it — and it gains the thing it
 * lacked: the ability to fall through on its own.
 *
 * WHAT COUNTS AS "STOPPED ANSWERING"
 *
 * `isTransientRpcError` from lib/dex/rpcRetry.ts, deliberately reused rather than
 * restated. That predicate is where this repo has already worked out the hard
 * cases, and two of them decide this class's behaviour:
 *
 *  - A rate limit can arrive as **HTTP 200 with a JSON-RPC error body**, so the
 *    batch check below inspects the decoded payload rather than trusting the
 *    status code. That is how Base Sepolia (-32016) and Arc (-32005) throttle.
 *  - `-32005` ALSO means "Maximum allowed number of requested blocks is 1000",
 *    which is a permanent property of an endpoint's log window and NOT a reason
 *    to fail over — the caller narrows its range instead. rpcRetry excludes it by
 *    phrase, and inheriting that exclusion is most of the reason this file does
 *    not carry a phrase list of its own. A second copy would drift from the first
 *    and start rotating endpoints over a question none of them will answer.
 *
 * Anything else — a revert, a bad parameter, a nonexistent method — is the node
 * ANSWERING, and it is rethrown from the first endpoint untouched. Trying the
 * others would turn one honest failure into N identical ones and hide which
 * endpoint produced it.
 *
 * WRITES
 *
 * These are read providers; nothing signs through them. That matters, because
 * "the request never reached a node" is exactly the claim you cannot make about
 * a transaction — see rpcRetry's own note on why it is not used for writes. A
 * retried read is free of consequence, which is what makes this safe.
 */

/**
 * How long a fallen-back provider stays on the alternate before trying the
 * preferred endpoint again.
 *
 * Sticky, not round-robin, and that is the point: rotating per call would send
 * every other request to an endpoint we already know is refusing them, and would
 * double the traffic a rate limit is complaining about. Once an alternate works
 * it keeps the traffic until this expires.
 *
 * Five minutes is chosen against what actually recovers: a rate-limit window is
 * usually seconds to a minute, so this is comfortably past it, while being short
 * enough that a deploy is never stuck on a degraded alternate for a whole
 * session. The cost of being wrong is one failed call every five minutes, which
 * then falls back again.
 */
const STICKY_MS = 5 * 60_000;

/** Which endpoint a provider is currently using, and when it moved there. */
export interface FailoverState {
  /** Index into the URL list. 0 is the preferred endpoint. */
  index: number;
  /** When `index` was last set to something other than 0. */
  since: number;
}

export const freshState = (): FailoverState => ({ index: 0, since: 0 });

/**
 * Try `attempt` against each URL in turn, starting from the sticky one.
 *
 * Split out of the provider class so the rotation can be tested without a
 * network, a chain, or ethers' transport — the class below is then thin enough
 * to read in one screen. See rpcFailover.test.ts.
 *
 * `batchError` lets the caller declare a *successful-looking* result to be a
 * failure, which is what catches the HTTP-200-plus-error-body throttles.
 */
export async function sendWithFailover<T>(
  urls: readonly string[],
  state: FailoverState,
  attempt: (url: string) => Promise<T>,
  opts: {
    now?: () => number;
    stickyMs?: number;
    /** Return an error to treat an otherwise-successful value as a failure. */
    batchError?: (value: T) => unknown;
  } = {},
): Promise<T> {
  if (urls.length === 0) throw new Error("no RPC URL configured");

  const now = opts.now ?? Date.now;
  const stickyMs = opts.stickyMs ?? STICKY_MS;

  /* Back to the preferred endpoint once the stickiness expires. Done here rather
     than on a timer so a provider nobody is calling costs nothing. */
  if (state.index !== 0 && now() - state.since > stickyMs) {
    state.index = 0;
    state.since = 0;
  }

  let lastError: unknown;
  for (let i = 0; i < urls.length; i += 1) {
    const index = (state.index + i) % urls.length;
    try {
      const value = await attempt(urls[index]);

      const batch = opts.batchError?.(value);
      if (batch !== undefined && batch !== null) {
        lastError = batch;
        /* A throttle dressed as a 200. Only rotate when it is transient; a batch
           of genuine JSON-RPC errors is an answer and belongs to the caller. */
        if (!isTransientRpcError(batch)) return value;
        continue;
      }

      /* Stick to whatever answered, so the next call starts here instead of
         paying for the dead endpoint again. */
      if (index !== state.index) {
        state.index = index;
        state.since = now();
      }
      return value;
    } catch (err) {
      lastError = err;
      /* The node answered, and the answer was an error. Surface it from the
         endpoint that produced it rather than asking the others the same
         question — see the header. */
      if (!isTransientRpcError(err)) throw err;
    }
  }

  throw lastError;
}

/**
 * True when every entry in a JSON-RPC response carries an error.
 *
 * All of them, not any: a batch where one call reverted and the rest answered is
 * a working endpoint, and rotating on it would move traffic off a healthy node
 * every time a `staticCall` failed. A throttle refuses the whole batch.
 */
function batchRejection(results: JsonRpcResult[]): unknown | null {
  if (results.length === 0) return null;
  const errors = results
    .map((r) => (r as unknown as JsonRpcError).error)
    .filter((e) => e !== undefined && e !== null);
  if (errors.length !== results.length) return null;
  return errors[0];
}

/**
 * `JsonRpcProvider` that dials a list of URLs instead of one.
 *
 * Every URL must serve the SAME chain — they come from one `chains.ts` record,
 * which is what keeps `staticNetwork: true` sound here: ethers takes the declared
 * network on trust and never calls `eth_chainId`, so a list mixing chains would
 * label one chain's data with another's id and nothing would catch it. That is
 * the failure config/provider.ts's header describes at length, and the reason
 * this constructor takes a list rather than a caller assembling one.
 */
export class FailoverJsonRpcProvider extends ethers.JsonRpcProvider {
  readonly #urls: readonly string[];
  readonly #state: FailoverState = freshState();

  constructor(
    urls: readonly string[],
    network?: ethers.Networkish,
    options?: ethers.JsonRpcApiProviderOptions,
  ) {
    if (urls.length === 0) throw new Error("FailoverJsonRpcProvider: no URLs");
    super(urls[0], network, options);
    this.#urls = urls;
  }

  /** The endpoint currently in use — for diagnostics and tests, not for callers. */
  get activeUrl(): string {
    return this.#urls[this.#state.index];
  }

  /**
   * ethers' single transport seam: every call, batched or not, goes through here.
   *
   * The body mirrors `JsonRpcProvider._send` — take the configured connection,
   * set the JSON body, send, assert, normalise to an array — with the URL swapped
   * per attempt. Reusing `_getConnection()` rather than building a bare
   * `FetchRequest` keeps whatever timeouts, headers and retry settings the
   * provider was constructed with.
   */
  async _send(
    payload: JsonRpcPayload | Array<JsonRpcPayload>,
  ): Promise<JsonRpcResult[]> {
    /* The base signature says `JsonRpcResult[]`, though a JSON-RPC batch may
       legitimately carry `JsonRpcError` entries and ethers itself handles them
       downstream. The cast keeps the override assignable without pretending the
       errors are not there — `batchRejection` reads them before this returns. */
    return sendWithFailover(
      this.#urls,
      this.#state,
      async (url) => {
        const request = this._getConnection();
        request.url = url;
        request.body = JSON.stringify(payload);
        request.setHeader("content-type", "application/json");

        const response = await request.send();
        response.assertOk();

        const result = response.bodyJson;
        return (Array.isArray(result) ? result : [result]) as JsonRpcResult[];
      },
      { batchError: batchRejection },
    );
  }
}
