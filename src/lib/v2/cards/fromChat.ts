import type { AgentCard, CardKind, CardTone } from "./types";

/**
 * Validates cards arriving from the AI engine under `context.cards`.
 *
 * The sibling of intentsFromChat.ts, and defensive for the same reason: this is
 * model output, so it is untrusted input that happens to be shaped like UI. The
 * difference is what a bad one costs. A hallucinated intent gets caught at the
 * signature — the wallet prompt is a human-readable gate no card has. A
 * hallucinated *card* renders immediately and looks like it came from the app,
 * so the checks here are the only gate it passes through.
 *
 * What that means concretely, in the order the rules matter:
 *
 * - **Unknown kinds are dropped, not passed through.** Same allowlist discipline
 *   as KNOWN_KINDS. A card kind the frontend has no frame for is not a
 *   forward-compatible extension point; it is a shape with no renderer.
 * - **Strings are capped and stripped of control characters.** A 40kB "label"
 *   is not a label, and a newline inside one breaks out of the row it was given.
 *   Prose belongs in `response`, which has its own place in the turn.
 * - **Rows and cards are capped by count.** The transcript is the one scrolling
 *   element on the screen (see agent.module.css); a turn that emits 200 rows
 *   owns the viewport and pushes the prompt out of reach.
 * - **`actions[].prompt` is text for the input box, and is length-capped as
 *   such.** It is never sent, so there is no injection path — but a 2,000
 *   character "prompt" silently replacing what you typed is still a way to waste
 *   your next request.
 *
 * A card that fails any check is dropped with a warning rather than repaired.
 * Half-trusting model output is how you end up rendering the half that lied.
 */

interface ChatResponse {
  response?: string;
  context?: {
    cards?: unknown;
    [k: string]: unknown;
  };
}

const KNOWN_KINDS: CardKind[] = [
  "metric",
  "stats",
  "balance",
  "notice",
  "actions",
];

const TONES: CardTone[] = ["neutral", "good", "warn", "bad"];

/** Per-turn ceiling. Three frames is a rich answer; ten is a dashboard. */
const MAX_CARDS = 3;
/** Rows in one stats/balance card. Beyond this it wants to be a page. */
const MAX_ROWS = 8;
const MAX_ACTIONS = 4;

const LIMITS = {
  label: 40,
  value: 24,
  unit: 12,
  title: 60,
  note: 140,
  body: 280,
  prompt: 120,
} as const;

/**
 * A single-line, length-capped string, or null if there isn't one.
 *
 * The control-character strip is not cosmetic: `\n` in a label wraps a table
 * row, and `\r` and the C0 range can do worse in a log. Rejecting empty means a
 * required field that arrives as `"   "` fails the card instead of rendering a
 * blank row that looks like a loading state.
 */
function str(x: unknown, max: number): string | null {
  if (typeof x !== "string") return null;
  /* eslint-disable-next-line no-control-regex */
  const clean = x.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  if (!clean) return null;
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

const tone = (x: unknown): CardTone =>
  typeof x === "string" && (TONES as string[]).includes(x)
    ? (x as CardTone)
    : "neutral";

/**
 * Validates one card, returning a newly built object rather than the input.
 *
 * Rebuilding is the point: the returned card holds only fields this function
 * wrote, so an extra property riding along on the wire — `onClick`, `href`,
 * `dangerouslySetInnerHTML`, an intent — cannot reach a renderer by being
 * spread into it later.
 */
function validate(raw: unknown): AgentCard | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const kind = c.kind;
  if (typeof kind !== "string" || !(KNOWN_KINDS as string[]).includes(kind)) {
    return null;
  }

  const title = str(c.title, LIMITS.title);

  switch (kind as CardKind) {
    case "metric": {
      const label = str(c.label, LIMITS.label);
      const value = str(c.value, LIMITS.value);
      if (!label || !value) return null;
      const d = c.delta as Record<string, unknown> | undefined;
      const dv = d ? str(d.value, LIMITS.value) : null;
      const unit = str(c.unit, LIMITS.unit);
      const note = str(c.note, LIMITS.note);
      return {
        kind: "metric",
        label,
        value,
        ...(unit ? { unit } : {}),
        ...(dv ? { delta: { value: dv, tone: tone(d?.tone) } } : {}),
        ...(note ? { note } : {}),
      };
    }

    case "stats": {
      if (!Array.isArray(c.rows)) return null;
      const rows: { label: string; value: string; tone?: CardTone }[] = [];
      for (const r of c.rows.slice(0, MAX_ROWS)) {
        if (!r || typeof r !== "object") continue;
        const row = r as Record<string, unknown>;
        const label = str(row.label, LIMITS.label);
        const value = str(row.value, LIMITS.value);
        if (!label || !value) continue;
        const t = tone(row.tone);
        rows.push({ label, value, ...(t !== "neutral" ? { tone: t } : {}) });
      }
      if (!rows.length) return null;
      return { kind: "stats", ...(title ? { title } : {}), rows };
    }

    case "balance": {
      if (!Array.isArray(c.rows)) return null;
      const rows: { symbol: string; amount: string; note?: string }[] = [];
      for (const r of c.rows.slice(0, MAX_ROWS)) {
        if (!r || typeof r !== "object") continue;
        const row = r as Record<string, unknown>;
        const symbol = str(row.symbol, LIMITS.unit);
        const amount = str(row.amount, LIMITS.value);
        if (!symbol || !amount) continue;
        const note = str(row.note, LIMITS.label);
        rows.push({ symbol, amount, ...(note ? { note } : {}) });
      }
      if (!rows.length) return null;
      return { kind: "balance", ...(title ? { title } : {}), rows };
    }

    case "notice": {
      const t = str(c.title, LIMITS.title);
      if (!t) return null;
      const body = str(c.body, LIMITS.body);
      return {
        kind: "notice",
        tone: tone(c.tone),
        title: t,
        ...(body ? { body } : {}),
      };
    }

    case "actions": {
      if (!Array.isArray(c.actions)) return null;
      const actions: { label: string; prompt: string }[] = [];
      for (const a of c.actions.slice(0, MAX_ACTIONS)) {
        if (!a || typeof a !== "object") continue;
        const item = a as Record<string, unknown>;
        const label = str(item.label, LIMITS.label);
        const prompt = str(item.prompt, LIMITS.prompt);
        if (!label || !prompt) continue;
        actions.push({ label, prompt });
      }
      if (!actions.length) return null;
      return { kind: "actions", ...(title ? { title } : {}), actions };
    }
  }
}

export function cardsFromChat(data: unknown): AgentCard[] {
  const chat = data as ChatResponse;
  const raw = chat?.context?.cards;
  if (!Array.isArray(raw)) return [];

  const valid: AgentCard[] = [];
  for (const card of raw) {
    if (valid.length >= MAX_CARDS) {
      console.warn(
        `[cardsFromChat] dropped card beyond the ${MAX_CARDS}-card limit:`,
        card,
      );
      continue;
    }
    const ok = validate(card);
    if (ok) valid.push(ok);
    else console.warn("[cardsFromChat] dropped unrecognised card:", card);
  }
  return valid;
}

/**
 * The same validation, for cards this app builds itself.
 *
 * Local emitters (the FAQ, the grammar, the planner) are trusted code, so this
 * is not a security boundary for them — it is the length and row caps, which a
 * local emitter can breach just as easily by interpolating a long token name.
 * Running everything through one gate also means the frames only ever receive
 * one shape, whoever built it.
 */
export const localCards = (cards: AgentCard[]): AgentCard[] =>
  cardsFromChat({ context: { cards } });
