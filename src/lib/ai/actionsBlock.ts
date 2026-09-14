/**
 * The channels a model reply has for rendering UI instead of prose.
 *
 * The frontend renders `AgentCard`s — a metric, a stats column, a balance list,
 * a notice, a gauge, a row of chips — and the local paths emit them directly.
 * For a while nothing let a MODEL turn emit one: the reply is text, and text is
 * prose. Two fenced blocks fixed that, and this file is their parser.
 *
 *  - ` ```actions ` carries a titleless list of chips ({label, prompt}), each of
 *    which prefills the prompt box. It predates the other and is unchanged.
 *  - ` ```cards ` carries a JSON array of full card objects (each with its own
 *    `kind`) — the DISPLAY kinds a model may present: metric, stats, balance,
 *    notice, gauge. Not `steps`: that card is a completed plan's receipt, built
 *    locally from real transaction hashes, and a model has no business writing
 *    one. `cardsFromChat` drops it on the wire regardless.
 *
 * A tool call was the obvious channel for both and is the wrong one. `ToolSpec`
 * is "read" (runs another round, demotes the prose to thought) or "execute"
 * (becomes a signable step). Presenting a figure or offering a choice is
 * neither — it is part of the answer, not a reason to go back to the model or
 * something to put in front of a wallet. So the reply carries it, in a block the
 * route removes before the prose is shown.
 *
 * That has one cost worth stating: the blocks stream. They arrive as text like
 * everything else, so the client suppresses everything from the earliest fence
 * onward while the answer is live (see `visibleProse`), and the finished reply
 * that replaces it is the stripped one from here.
 *
 * NOTHING IN THIS FILE IS A TRUST BOUNDARY. It parses; `cardsFromChat` is what
 * validates, caps, rebuilds and (for the wire) forbids `steps`, on the same
 * reasoning it already documents — a card renders immediately and looks like it
 * came from the app. What this guarantees is narrower and worth having anyway:
 * whatever the model wrote between the fences does not reach the reader as prose.
 */

/** Opens the chips block. Tagged, so an ordinary code fence stays in the prose. */
export const ACTIONS_FENCE = "```actions";
/** Opens the display-cards block. Same discipline as the fence above. */
export const CARDS_FENCE = "```cards";

export interface OfferedAction {
  label: string;
  prompt: string;
}

/**
 * The prose with the actions block removed, and whatever it offered.
 *
 * Kept as its own export because the route's older callers and the test read it,
 * and because `actions` is empty for the overwhelming majority of replies — a
 * turn that answers a question offers nothing.
 */
export interface SplitReply {
  text: string;
  actions: OfferedAction[];
}

/**
 * Prose the reader may see, given a possibly-partial reply.
 *
 * Cuts at the earliest of either fence — and at a trailing *prefix* of one, so
 * the three backticks do not render as an empty code block for the delta before
 * the tag arrives. The hold starts at two characters, not one: a single trailing
 * backtick is far more often the close of an inline code span than the start of a
 * fence, and holding it once cost a real answer its last character.
 */
export function visibleProse(partial: string): string {
  let cut = partial.length;
  for (const fence of [CARDS_FENCE, ACTIONS_FENCE]) {
    const at = partial.indexOf(fence);
    if (at >= 0) cut = Math.min(cut, at);
  }
  if (cut < partial.length) return partial.slice(0, cut).trimEnd();

  for (const fence of [CARDS_FENCE, ACTIONS_FENCE]) {
    for (let n = fence.length - 1; n >= 2; n--) {
      if (partial.endsWith(fence.slice(0, n))) {
        return partial.slice(0, partial.length - n).trimEnd();
      }
    }
  }
  return partial;
}

/**
 * Removes one fenced block and returns its body plus the prose without it.
 *
 * The prose is reconstructed so a block in the MIDDLE of a reply keeps the text
 * after it — the block is lifted out, not everything past it. No closing fence
 * means the reply was cut off mid-block: the prose before it is a real answer,
 * everything after is half a data structure and is dropped. `body` is null when
 * the fence is absent, distinct from an empty block.
 */
function cutFence(text: string, fence: string): {
  body: string | null;
  prose: string;
} {
  const at = text.indexOf(fence);
  if (at < 0) return { body: null, prose: text };

  const after = at + fence.length;
  const close = text.indexOf("```", after);
  const body = close >= 0 ? text.slice(after, close) : text.slice(after);
  const rest = close >= 0 ? text.slice(close + 3) : "";
  const prose = `${text.slice(0, at).trimEnd()}${
    rest ? `\n\n${rest.trim()}` : ""
  }`.trim();
  return { body, prose };
}

const looksLikeAction = (v: unknown): v is OfferedAction => {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.label === "string" && typeof o.prompt === "string";
};

/**
 * Parses an actions body. Accepts a bare array or an `{actions: [...]}` wrapper —
 * the other shape a model reaches for unprompted. Malformed JSON yields nothing;
 * the block is removed either way, so raw JSON never reaches the screen.
 */
function parseActions(body: string): OfferedAction[] {
  try {
    const parsed: unknown = JSON.parse(body.trim());
    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { actions?: unknown })?.actions)
        ? (parsed as { actions: unknown[] }).actions
        : [];
    return list.filter(looksLikeAction).map((a) => ({
      label: a.label,
      prompt: a.prompt,
    }));
  } catch {
    return [];
  }
}

/**
 * Parses a cards body into raw card objects — validated downstream by
 * `cardsFromChat`, never here. Accepts a bare array or a `{cards: [...]}` wrapper.
 */
function parseCardArray(body: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(body.trim());
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray((parsed as { cards?: unknown })?.cards)) {
      return (parsed as { cards: unknown[] }).cards;
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Splits a finished reply into prose and offered actions.
 *
 * Malformed JSON loses the actions and keeps the prose: the answer is the part
 * the user asked for, and a block the model got wrong is not a reason to fail the
 * turn.
 */
export function splitActionsBlock(text: string): SplitReply {
  const { body, prose } = cutFence(text, ACTIONS_FENCE);
  return { text: prose, actions: body !== null ? parseActions(body) : [] };
}

/**
 * Splits a finished reply into prose and the raw cards it carried — from a
 * ` ```cards ` block (display kinds) and a ` ```actions ` block (chips, wrapped
 * into an actions card), in that order. Both blocks are removed from the prose.
 *
 * The cards are raw objects on purpose: `cardsFromChat` on the client is the one
 * gate that validates, caps, rebuilds and forbids `steps`. This only decides what
 * is prose and what is a card, never whether a card is allowed.
 */
export function splitCards(text: string): { text: string; cards: unknown[] } {
  const cards: unknown[] = [];

  const c = cutFence(text, CARDS_FENCE);
  if (c.body !== null) cards.push(...parseCardArray(c.body));

  const a = cutFence(c.prose, ACTIONS_FENCE);
  if (a.body !== null) {
    const actions = parseActions(a.body);
    if (actions.length) cards.push({ kind: "actions", actions });
  }

  return { text: a.prose, cards };
}
