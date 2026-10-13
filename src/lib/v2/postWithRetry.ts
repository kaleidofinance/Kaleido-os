/**
 * A fire-and-forget POST that retries while the server can't see the chain yet.
 *
 * PlanReview tells two endpoints about a confirmed transaction the moment the
 * wallet reports it: the waitlist task verifier and the LI.FI bridge recorder.
 * Both re-read the transaction on chain, and right after confirmation the node
 * they ask may not have the receipt yet — the verifier answers 409 "successful
 * wallet transaction not found", the recorder 404 "tx not found" or 502. Those
 * calls used to be one attempt with `.catch(() => {})`, so a lagging node meant
 * the bridge task was never credited and the bridge never recorded, silently.
 *
 * Retries only what can change with time: a network error, 5xx, 404, 408, 429,
 * and a 409 whose error says the transaction was not found. A definite answer
 * (a 2xx, or any other 4xx such as "not a recognized bridge route" or 410
 * retired) stops immediately. Never throws; resolves to whether it succeeded.
 */
export interface RetryPostOptions {
  /** Waits before each retry, in ms. Length = number of retries. */
  delaysMs?: readonly number[];
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_DELAYS = [3_000, 10_000, 25_000];

/** Whether a response is worth asking again for. Exported for tests. */
export function isRetryableResponse(status: number, body: unknown): boolean {
  if (status >= 500) return true;
  if (status === 404 || status === 408 || status === 429) return true;
  if (status === 409) {
    const err =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : "";
    return /not found/i.test(err);
  }
  return false;
}

export async function postWithRetry(
  url: string,
  payload: unknown,
  opts: RetryPostOptions = {},
): Promise<boolean> {
  const delays = opts.delaysMs ?? DEFAULT_DELAYS;
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (attempt > 0) await sleep(delays[attempt - 1]);
    try {
      const res = await doFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) return true;
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      if (!isRetryableResponse(res.status, body)) return false;
    } catch {
      // Network failure — worth another try.
    }
  }
  return false;
}
