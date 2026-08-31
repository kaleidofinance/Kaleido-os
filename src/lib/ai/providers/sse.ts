/**
 * SSE line framing, shared by the streaming adapters.
 *
 * Both providers stream `text/event-stream`, and both need the same unglamorous
 * thing done correctly: a network chunk is not a frame. A single `read()` can
 * deliver six events, or half of one, and the half that arrives is routinely
 * split mid-JSON — so anything that parses per chunk works until the first reply
 * long enough to be interesting. This keeps a buffer and only ever hands on a
 * `data:` line it has seen the end of.
 *
 * Yields the payload text, not a parsed object: the two wire formats disagree
 * about what is inside a frame (Anthropic names the event, OpenAI puts a `[DONE]`
 * sentinel there), so which strings are meaningful is the adapter's business.
 * `event:` and `id:` lines are dropped — Anthropic repeats its event name inside
 * the JSON as `type`, which is the copy an adapter can trust after reconnects.
 */
export async function* sseData(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  const take = (line: string): string | null => {
    if (!line.startsWith("data:")) return null;
    const payload = line.slice(5).trim();
    return payload || null;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      /* `stream: true` so a multi-byte character split across two chunks is
         held back rather than decoded into a replacement character. */
      buf += decoder.decode(value, { stream: true });

      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        const payload = take(line);
        if (payload) yield payload;
      }
    }
    /* A last line with no trailing newline. Well-behaved servers end with one,
       so this is for the ones that do not. */
    const payload = take(buf.trim());
    if (payload) yield payload;
  } finally {
    /* Cancel rather than release: a consumer that stops early (an abort, a
       `[DONE]` sentinel, a throw) should close the connection instead of leaving
       the gateway writing into a socket nobody reads. Already-finished readers
       resolve immediately, so this is safe on the normal path too. */
    await reader.cancel().catch(() => {});
  }
}
