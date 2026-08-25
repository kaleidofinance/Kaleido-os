/**
 * Agent cards — the frames Luca renders data into, instead of stating it in
 * prose.
 *
 * A turn that says "your health factor is 1.62, collateral 4,100, borrowed
 * 2,530" makes the reader parse a sentence to find three numbers. The same turn
 * with a stats card puts them in a column with the labels beside them. Nothing
 * about the answer changes; the work of reading it moves from the reader to the
 * layout.
 *
 * Three rules hold this together, and each one is load-bearing:
 *
 * 1. **A card is data, never a component.** No callbacks, no class names, no
 *    HTML, no URLs. The union below is JSON, so the same card can come from the
 *    local FAQ, from the command grammar, or over the wire from the AI engine
 *    under `context.cards` — and the renderer cannot tell which, because there
 *    is nothing to tell apart.
 *
 * 2. **Values are pre-formatted strings.** `value: "1,240.55"`, not
 *    `value: 1240.55`. The emitter knows the token's decimals, whether the
 *    figure is a percentage, and whether it is even a number; the frame knows
 *    none of that and would have to guess. `formatBalance` is what the local
 *    emitters call before filling a card.
 *
 * 3. **A card frames a claim; it does not verify one.** A model-emitted metric
 *    can say anything, exactly as a model-emitted sentence can. What the frames
 *    add is attribution — cards render inside Luca's turn in the transcript,
 *    never as app chrome — and a hard ceiling on how much room a single turn can
 *    take (see the caps in fromChat.ts). What they must never add is authority,
 *    which is why no card kind can carry a link or an intent.
 *
 * The one interactive kind, `actions`, prefills the prompt box and stops there.
 * That is the whole permitted reach of a card: the worst a hostile one can do is
 * type a sentence you can see, into a box you then choose to send.
 */

/** Colour intent. Deliberately not a token name — the frame maps it. */
export type CardTone = "neutral" | "good" | "warn" | "bad";

/**
 * One figure that matters, at the size a figure that matters should be. The
 * slot the swap card gives an amount, given to an answer.
 */
export interface MetricCard {
  kind: "metric";
  label: string;
  value: string;
  /** Rendered smaller and beside the value: "%", "USDC", "days". */
  unit?: string;
  /** A change, tinted by tone. The arrow is the emitter's, in the string. */
  delta?: { value: string; tone: CardTone };
  /** One line under the figure, for the caveat the number needs. */
  note?: string;
}

/**
 * A label/value column. The workhorse: health factor breakdowns, a chain
 * rollout order, quota usage, anything that is two or more related figures.
 */
export interface StatsCard {
  kind: "stats";
  title?: string;
  rows: { label: string; value: string; tone?: CardTone }[];
}

/**
 * Token amounts. Split from `stats` because the symbol is not a label — it is
 * the identity of the row, and it sets its own type treatment and alignment.
 */
export interface BalanceCard {
  kind: "balance";
  title?: string;
  rows: { symbol: string; amount: string; note?: string }[];
}

/**
 * A statement that needs to be seen before the prose around it. Warnings,
 * refusals, and "nothing is deployed on this chain yet".
 */
export interface NoticeCard {
  kind: "notice";
  tone: CardTone;
  title: string;
  body?: string;
}

/**
 * Next steps as chips. `prompt` is put in the prompt box and nothing else — it
 * is not sent, not signed, not navigated to. See rule 3 above.
 */
export interface ActionsCard {
  kind: "actions";
  title?: string;
  actions: { label: string; prompt: string }[];
}

export type AgentCard =
  | MetricCard
  | StatsCard
  | BalanceCard
  | NoticeCard
  | ActionsCard;

export type CardKind = AgentCard["kind"];
