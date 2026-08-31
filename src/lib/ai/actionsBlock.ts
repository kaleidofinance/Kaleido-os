/**
 * The one channel a model reply has for offering buttons.
 *
 * The frontend has rendered `actions` cards — a titled row of chips that each
 * prefill the prompt box — since AgentCards was written, and the local paths use
 * them: the help command answers with five. Nothing populated them from a model
 * turn, because nothing in the wire format let a model say "offer these two
 * choices". `context.cards` existed and arrived empty on every model reply.
 *
 * A tool call was the obvious channel and is the wrong one. `ToolSpec.kind` is
 * "read" or "execute": a read makes the loop run another round and demotes the
 * round's prose to a line of thought process, and an execute becomes a signable
 * step. Offering a choice is neither — it is part of the answer, not a reason to
 * go back to the model or something to put in front of a wallet.
 *
 * So the reply carries it, in a fenced block the route removes before the prose
 * is shown. That has one cost worth stating: the block streams. It arrives as
 * text like everything else, so the client suppresses everything from the fence
 * onward while the answer is live (see `visibleProse`), and the finished reply
 * that replaces it is the stripped one from here.
 *
 * Nothing in this file is a trust boundary. It parses; `cardsFromChat` is what
 * validates, caps and rebuilds, on the same reasoning it already documents — a
 * card renders immediately and looks like it came from the app. What this
 * guarantees is narrower and worth having anyway: whatever the model wrote
 * between those fences does not reach the reader as prose.
 */

/** Opens the block. Tagged, so an ordinary code fence in an answer is untouched. */
export const ACTIONS_FENCE = "```actions";

export interface OfferedAction {
  label: string;
  prompt: string;
}

/**
 * The prose with the block removed, and whatever the block offered.
 *
 * `actions` is empty for the overwhelming majority of replies, which is the
 * intended shape: a turn that answers a question offers nothing, and a row of
 * buttons under every reply would be the follow-up-suggestion feature that was
 * deliberately deleted rather than a choice the answer actually presents.
 */
export interface SplitReply {
  text: string;
  actions: OfferedAction[];
}

/**
 * Prose the reader may see, given a possibly-partial reply.
 *
 * Used while streaming, when the text is whatever has arrived so far. Cuts at
 * the fence — and also at a trailing *prefix* of it, so the three backticks do
 * not render as an empty code block for the delta before `actions` arrives.
 *
 * The hold starts at two characters, not one. A single trailing backtick is far
 * more often the close of an inline code span than the start of a fence, and
 * holding it cost a real answer its last character: `run \`swap\`` came out as
 * `run \`swap`. One stray backtick for one delta is the smaller artifact.
 */
export function visibleProse(partial: string): string {
  const at = partial.indexOf(ACTIONS_FENCE);
  if (at >= 0) return partial.slice(0, at).trimEnd();
  for (let n = ACTIONS_FENCE.length - 1; n >= 2; n--) {
    if (partial.endsWith(ACTIONS_FENCE.slice(0, n))) {
      return partial.slice(0, partial.length - n).trimEnd();
    }
  }
  return partial;
}

const looksLikeAction = (v: unknown): v is OfferedAction => {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.label === "string" && typeof o.prompt === "string";
};

/**
 * Splits a finished reply into prose and offered actions.
 *
 * Malformed JSON loses the actions and keeps the prose: the answer is the part
 * the user asked for, and a block the model got wrong is not a reason to fail
 * the turn. The block is removed either way — leaving it in on a parse failure
 * would put raw JSON on screen, which is the exact outcome the block exists to
 * avoid.
 */
export function splitActionsBlock(text: string): SplitReply {
  const at = text.indexOf(ACTIONS_FENCE);
  if (at < 0) return { text, actions: [] };

  const after = at + ACTIONS_FENCE.length;
  const close = text.indexOf("```", after);
  /* No closing fence means the reply was cut off mid-block. The prose before it
     is still a real answer; everything after is half a data structure. */
  const body = close >= 0 ? text.slice(after, close) : text.slice(after);
  const rest = close >= 0 ? text.slice(close + 3) : "";

  const prose = `${text.slice(0, at).trimEnd()}${rest ? `\n\n${rest.trim()}` : ""}`;

  let actions: OfferedAction[] = [];
  try {
    const parsed: unknown = JSON.parse(body.trim());
    const list = Array.isArray(parsed)
      ? parsed
      : /* An object with an `actions` array is the other shape a model reaches
           for unprompted, and rejecting it would drop a well-formed offer over
           a wrapper. */
        Array.isArray((parsed as { actions?: unknown })?.actions)
        ? (parsed as { actions: unknown[] }).actions
        : [];
    actions = list.filter(looksLikeAction).map((a) => ({
      label: a.label,
      prompt: a.prompt,
    }));
  } catch {
    /* Deliberately silent. `cardsFromChat` warns about cards it drops, and this
       is the same class of event: a model wrote something malformed and the user
       gets the answer without it. */
  }

  return { text: prose.trim(), actions };
}
