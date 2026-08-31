/**
 * The chat stream's wire format, and the reader for it.
 *
 * `/api/chat` answers a `{stream: true}` POST with newline-delimited JSON rather
 * than SSE. NDJSON because nothing here needs what SSE adds — no event names, no
 * reconnect ids, no `retry` — and one `JSON.parse` per line is the entire parser.
 * The route's non-streaming JSON reply is unchanged and still the fallback, so
 * this is an addition to the API rather than a break in it.
 *
 * Both sides import the event union from here, which is the point: a field added
 * to a frame is a type error on whichever side forgot about it, instead of an
 * `undefined` that renders as nothing.
 *
 * WHY THE FRAMES LOOK LIKE THIS. A turn is not one model call — it is up to three,
 * with tool work between them, and only the last one's prose is the answer. The
 * earlier rounds are real text the model wrote ("Let me check your balances")
 * that the finished reply does not contain. So a stream cannot simply be text:
 * it has to be able to say "that paragraph was thinking, not answering", which is
 * what `round` does, and it has to be able to hand over the authoritative final
 * text, which is what `done` does. The alternative — appending every round's
 * prose to the bubble — shows the user something that a page reload would not
 * reproduce, because only the final text is persisted.
 */
import type { ReadCall } from "@/lib/ai/types";

export type ChatStreamEvent =
  /** Prose, as the model writes it, for the round currently in flight. */
  | { t: "text"; d: string }
  /**
   * A round ended without being the answer: it asked for tools instead. Its
   * prose is over and should leave the reply — `note` is that prose, condensed
   * into a line for the thought process, and `reads` are the tools that then
   * ran, in the order they ran.
   */
  | { t: "round"; note?: string; reads: ReadCall[] }
  /** The turn, finished. `response` is authoritative — it is what gets saved. */
  | { t: "done"; response: string; context?: Record<string, unknown> }
  /**
   * The turn failed and this is the fallback reply. Same shape as `done` on
   * purpose: the client renders it the same way, and `context.status` is what
   * says which happened.
   */
  | { t: "error"; response: string; context?: Record<string, unknown> };

export interface ChatStreamHandlers {
  /**
   * Called with a run of deltas, not one per delta. The reader batches
   * everything it finds in a single network chunk, so a 400-token reply is a
   * few dozen renders instead of 400.
   */
  onText: (text: string) => void;
  onRound: (note: string | undefined, reads: ReadCall[]) => void;
  onDone: (response: string, context?: Record<string, unknown>) => void;
  onError: (response: string, context?: Record<string, unknown>) => void;
}

/**
 * Reads the stream to completion, calling handlers as frames arrive.
 *
 * Returns whether a terminal frame (`done` or `error`) was seen. False means the
 * body ended early — a dropped connection, a killed server — and the caller
 * still holds whatever text had arrived, which it should keep rather than
 * discard: the user read it.
 */
export async function readChatStream(
  body: ReadableStream<Uint8Array>,
  handlers: ChatStreamHandlers,
): Promise<boolean> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let pending = "";
  let terminal = false;

  const flush = () => {
    if (!pending) return;
    const text = pending;
    pending = "";
    handlers.onText(text);
  };

  const handle = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let ev: ChatStreamEvent;
    try {
      ev = JSON.parse(trimmed) as ChatStreamEvent;
    } catch {
      /* A frame we cannot read is one frame lost, not the turn. */
      return;
    }
    switch (ev.t) {
      case "text":
        pending += ev.d ?? "";
        break;
      /* Everything below is ordered against the text around it, so the buffered
         deltas go out first — otherwise a round's reads would appear above the
         prose that preceded them. */
      case "round":
        flush();
        handlers.onRound(ev.note, Array.isArray(ev.reads) ? ev.reads : []);
        break;
      case "done":
        flush();
        terminal = true;
        handlers.onDone(ev.response ?? "", ev.context);
        break;
      case "error":
        flush();
        terminal = true;
        handlers.onError(ev.response ?? "", ev.context);
        break;
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      /* `stream: true` so a multi-byte character split across two reads is held
         back rather than decoded into a replacement character. */
      buf += decoder.decode(value, { stream: true });

      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        handle(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
      }
      /* One render per network chunk. A frame is not a chunk in either
         direction: a chunk can hold six frames or half of one, and the half is
         routinely split mid-JSON, which is why the remainder stays in `buf`. */
      flush();
    }
    if (buf.trim()) handle(buf);
    flush();
  } finally {
    /* Cancel rather than release, so an early return closes the connection
       instead of leaving the route writing into a socket nobody reads. */
    await reader.cancel().catch(() => {});
  }

  return terminal;
}

/**
 * The longest a single line of thought process may be.
 *
 * Exported because `useChatHistory.reviveThinking` filters on the same number,
 * and it *drops* a line that exceeds it rather than trimming it. Two literals
 * that had to agree, in files that don't reference each other: raise one alone
 * and the longer lines look right until the page is reloaded, then disappear.
 *
 * 320 rather than the original 160 because the fold is opt-in — it is closed
 * until someone asks for it, and someone who has asked wants the line, not a
 * peek at the front of it.
 */
export const MAX_THINKING_LINE = 320;

/**
 * A round's prose, reduced to one line of thought process.
 *
 * Markdown comes off first. This prose was written to be rendered as an answer,
 * but a trace line is rendered as text, so `- **Lending collateral:** $0`
 * reached the screen with its asterisks still in it. Stripping before the cap
 * also means the cap counts characters a reader can see rather than syntax they
 * cannot.
 *
 * List markers are line-anchored, so they have to go before the newlines
 * collapse: by the time the prose is one line, a bullet that opened a line is
 * sitting in the middle of it and no longer looks like a marker.
 */
export function condenseNote(prose: string, max = MAX_THINKING_LINE): string {
  const flat = prose
    /* A fenced block is not a line of thought process — drop it whole rather
       than flatten code into the sentence around it. */
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`\n]*)`/g, "$1")
    /* Images and links: keep the label, drop the target. A trace line is not
       clickable, so a URL in it is 60 characters of the cap spent on nothing. */
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
    .replace(/(\*\*|__)(.*?)\1/gs, "$2")
    .replace(/\*([^*\n]+)\*/g, "$1")
    /* Underscores only when the pair brackets a word, so `min_health_factor`
       keeps the middle it needs and does not become `minhealthfactor`. */
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s.,;:!?)]|$)/g, "$1$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1).trimEnd()}…`;
}
