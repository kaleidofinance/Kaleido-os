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

/**
 * A reading on a track — a figure you glance at rather than parse. Health
 * factor, a collateral ratio, how much of a range a position still sits in.
 *
 * `fraction` is the ONE number any card in this union carries, and it is
 * geometry, not domain: 0 draws an empty track, 1 a full one, and the emitter is
 * what maps a health factor or a ratio onto it. The figure the reader actually
 * reads is still `value`, a pre-formatted string, so the frame draws the fill and
 * prints the string and interprets neither. Keeping the two separate is what lets
 * a gauge show "1.62" over a bar that is 31% full without the renderer knowing
 * that 1.62 is a health factor or that its safe range runs to 3.
 *
 * `tone` colours the fill — the reading's own verdict (a health factor of 1.05 is
 * `bad` however full its bar). `min`/`max` are optional end captions under the
 * track ("1.0" … "safe"), pre-formatted like everything else.
 */
export interface GaugeCard {
  kind: "gauge";
  label: string;
  value: string;
  /** How full the track is drawn, 0..1. Geometry; the validator clamps it. */
  fraction: number;
  tone: CardTone;
  /** Rendered beside the value: "%", "HF", "days". */
  unit?: string;
  /** End captions under the track, left and right. */
  min?: string;
  max?: string;
  /** One line under the track, for the caveat the reading needs. */
  note?: string;
}

/**
 * The receipt for a plan that ran — one row per step, each with a mark for how
 * it went. The transcript used to report a completed plan as a paragraph of
 * text ("Approve USDC — done · 35.3s · 0xde20…"); this is that same record with
 * a ✓ / – / ✗ on each line instead of the reader parsing a sentence per step.
 *
 * `status` is a small closed set, not a tone: `done` is a step that ran, `skipped`
 * one that needed nothing sent (an allowance already in place), `failed` one that
 * did not land. The renderer maps each to a mark and a colour. `detail` is the
 * pre-formatted tail — a timing and a shortened hash, "13.3s · 0xc377…d7d3c" —
 * carried as text because a card holds no link (a hash is shown, never followed).
 */
export interface StepsCard {
  kind: "steps";
  title?: string;
  steps: {
    label: string;
    status: "done" | "skipped" | "failed";
    detail?: string;
  }[];
}

/**
 * A pasted token, framed as a trading surface — the one card whose buttons act.
 *
 * LOCAL-ONLY, and that is what makes acting safe: it is wire-forbidden (see
 * WIRE_FORBIDDEN in fromChat.ts), so a model can never emit one. This app builds
 * it from on-chain reads when a user pastes a contract, and composes every
 * button's `command` here from the resolved token. A tap SENDS that command —
 * unlike `actions`, which only prefills — and the command still passes through
 * the grammar, the auditor, the plan review and the wallet signature, so the
 * real consent gate is unchanged: the tap saves typing, not a decision.
 *
 * Still data, per rule 1: the address is a display string ("0x08Ad…2A71"),
 * never a link; figures are pre-formatted; `disabled` is how the opening
 * surcharge greys the buys out without the renderer knowing what one is.
 */
export interface TokenCard {
  kind: "token";
  symbol: string;
  name?: string;
  /** Short display form of the contract. Shown, never followed. */
  address: string;
  /** Headline price, pre-formatted ("$0.0000412"). Absent when unknown. */
  price?: string;
  /** Source/status tag: "Argus launch", "Listed on Arc". */
  badge?: { text: string; tone: CardTone };
  /** Label/value facts: market cap, buy tax, sell tax, status. */
  rows: { label: string; value: string; tone?: CardTone }[];
  /** One line of caveat under the facts. */
  note?: string;
  /** Buy presets; `disabled` greys one out (e.g. opening surcharge active). */
  buys: { label: string; command: string; disabled?: boolean }[];
  /** Sell presets, as a share of the wallet's balance. */
  sells: { label: string; command: string }[];
}

export type AgentCard =
  | MetricCard
  | StatsCard
  | BalanceCard
  | NoticeCard
  | ActionsCard
  | GaugeCard
  | StepsCard
  | TokenCard;

export type CardKind = AgentCard["kind"];
