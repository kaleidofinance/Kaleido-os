import type { StepsCard } from "./types";

/**
 * What receiptFromSettled needs from a settled step — structurally a PlanReview
 * `SettledStep`, but named here so this stays a pure lib with no import from a
 * "use client" component (and so its test loads no React).
 */
export interface SettledLike {
  title: string;
  /** Absent for a step that broadcast nothing — a skipped approve, a
   *  signature-only step. */
  hash?: string;
  skipped: boolean;
  /** Wall-clock ms for the step, when measured. */
  ms?: number;
}

const secs = (ms: number | undefined) =>
  ms === undefined ? "" : `${(ms / 1000).toFixed(1)}s`;

/** A hash is shown, never followed — so it is shortened for the row, not linked. */
const shortHash = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;

/**
 * A settled plan as a headline plus a receipt card.
 *
 * The headline is prose ("Done — 2 transactions confirmed in 48.5s"); the card
 * is the per-step record with a mark on each — which the transcript used to
 * render as a paragraph, one text line per step. Split so a completed plan reads
 * as a sentence with a card under it, the shape every other local answer takes,
 * and so the per-step outcome is a glyph rather than a clause to parse.
 *
 * A step that broadcast nothing says so rather than being dropped: a skipped
 * approve and a signature-only step are both legitimately hashless, and a list
 * that omitted them would not add up to the plan the user just signed. `card` is
 * null only for an empty plan, where the headline stands alone.
 */
export function receiptFromSettled(settled: SettledLike[]): {
  head: string;
  card: StepsCard | null;
} {
  const sent = settled.filter((st) => st.hash && !st.skipped).length;
  const totalMs = settled.reduce((n, st) => n + (st.ms ?? 0), 0);
  const head =
    settled.length === 0
      ? "Done."
      : sent === 0
        ? "Done — nothing needed to be sent."
        : `Done — ${sent} transaction${sent === 1 ? "" : "s"} confirmed${
            totalMs ? ` in ${(totalMs / 1000).toFixed(1)}s` : ""
          }.`;

  if (settled.length === 0) return { head, card: null };

  const steps: StepsCard["steps"] = settled.map((st) => {
    if (st.skipped) {
      return {
        label: st.title,
        status: "skipped",
        detail: "already in place",
      };
    }
    const parts: string[] = [];
    const t = secs(st.ms);
    if (t) parts.push(t);
    parts.push(st.hash ? shortHash(st.hash) : "no transaction needed");
    return { label: st.title, status: "done", detail: parts.join(" · ") };
  });

  return { head, card: { kind: "steps", steps } };
}
