import type { IToken } from "@/constants/types/dex";
/* The `.ts` extension is deliberate: this module is imported by the agent page
   through the bundler (which tolerates it), and by nextSuggestions.test.ts
   through plain node, which does not resolve extensionless paths. */
import { parseCommand, type Command } from "./fromCommand.ts";

/**
 * Suggestion chips derived from the user's own thread.
 *
 * The empty card offers a fixed set, one per product. Once there is a
 * conversation, a fixed set is the wrong thing to show: it still says "here is
 * what exists" to someone who has already found out. This module answers the
 * later question — given what you just did, what comes next.
 *
 * Derived locally, from text already on the device, and that is a decision worth
 * naming three times over:
 *
 * 1. It is free. A model-generated chip set costs a credit every time the thread
 *    changes, which is per turn — you would pay for the *offer* of an action, not
 *    the action, and pay again for offers you never press.
 * 2. It is private. The alternative ships a transcript of your positions and your
 *    questions about them to a provider for the sake of decorating a button row.
 * 3. It cannot hallucinate. Everything here is either a phrase the user typed or
 *    a template from a fixed table, and every one is checked against the real
 *    grammar before it is offered — see `nextSuggestions.test.ts`. A model asked
 *    for "the next likely command" will happily return a confident, unparseable
 *    one, and a chip that fails on click is worse than no chip.
 *
 * Pure and synchronous, with the token registry passed in, for the same reasons
 * fromCommand.ts is: no runtime dependency, so `node nextSuggestions.test.ts`
 * runs it directly, and no assumption about which chain's tokens are live.
 */

/** Just the shape this needs from a `Msg` — role and text, nothing persisted. */
export interface HistoryTurn {
  role: "user" | "assistant";
  text: string;
}

/**
 * What plausibly follows a completed command, as a phrasing the parser accepts.
 *
 * A table rather than inference, and shallow on purpose: one hop. Chaining
 * further ("you swapped, so you will stake, so you will lock") compounds a guess
 * into a story, and by the second hop the chip is describing a plan the user
 * never indicated.
 *
 * Amounts are deliberately *not* carried across a hop where the number changes
 * meaning. "swap 500 USDC to KLD" does not yield 500 KLD, so a "stake 500 KLD"
 * chip would state a balance the user does not have. Round templates are honest
 * about being templates; a precise wrong number is not. Where a hop needs no
 * amount at all — `repay`, `claim` — the sequel is exact, because the planner
 * resolves the target itself.
 */
const SEQUELS: Partial<Record<Command["kind"], (c: Command) => string[]>> = {
  /* Into KLD, the reason to swap is usually to stake it. Into anything else the
     next move is not predictable from the swap alone, so offer nothing rather
     than guess — an empty result here falls through to the user's own history. */
  swap: (c) =>
    c.kind === "swap" && c.tokenOut.symbol.toUpperCase() === "KLD"
      ? ["stake 100 KLD"]
      : [],

  /* Staked KLD accrues, and the two things you can do with the accrual are take
     it or roll it up. Both are zero-slot verbs, so both are exact. */
  stake: () => ["claim", "compound"],

  /* A loan's only certain sequel is ending it. `repay` with no id parses: the
     planner resolves the loan when there is exactly one open. */
  borrow: () => ["repay"],

  /* Collateral is posted in order to borrow against it. The amount is a template
     — what you can borrow depends on the collateral factor, not the deposit. */
  deposit: (c) =>
    c.kind === "deposit"
      ? [`borrow 500 ${c.token.symbol} at 8% for 30 days`]
      : [],

  /* Minted kfUSD earns by being locked. Redeeming is the exit, and it takes the
     collateral symbol the mint was made against. */
  mint: (c) =>
    c.kind === "mint" ? ["lock 100 kfUSD", `redeem 100 ${c.token.symbol}`] : [],

  /* Locked kfUSD is the yield-bearing side, so the accrual verbs apply again. */
  lock: () => ["claim"],

  /* No `send` entry, and it is not an oversight. push() below only offers text
     the grammar fully accepts, and a send does not parse without a recipient —
     so any send chip would have to carry a 40-hex address invented by this
     table. There is no safe address to invent: every one is either a burn hole
     or a stranger's wallet, and it would arrive pre-filled in a money command.
     A send is offered by the user typing one. */
};

/**
 * Commands worth re-offering from history, and the exclusion is the point.
 *
 * `help` and `receive` are answered once and stay answered — a chip offering to
 * show you the address you are already looking at is filler. Everything with a
 * slot is fair game, because the numbers are the part you change.
 *
 * `send` is excluded for a different reason: a past send only parses again with
 * its address attached, which is 42 characters of chip in a row budgeted for
 * three of them, and it re-offers a transfer to one specific person rather than
 * a shape the user can adjust. The amount is the changeable part of a swap; the
 * recipient is not a knob, it is the whole decision.
 */
const REPEATABLE = (c: Command): boolean =>
  c.kind !== "help" && c.kind !== "receive" && c.kind !== "send";

/** Chips shown at once. Three fits one row at these lengths; the agent card has
    a no-scroll budget, and a wrapped third row of chips spends it on furniture. */
const LIMIT = 3;

/**
 * Predicts the next few things this user might want, newest signal first.
 *
 * Three sources, in falling order of how much they know about *this* user:
 *
 * 1. The sequel to their most recent completed command — the only source that
 *    knows what they just did.
 * 2. Their own recent commands, verbatim, newest first. Weaker as a prediction,
 *    but it is the phrasing they chose and it is guaranteed to parse, because it
 *    already did. This is what carries a thread of "swap, swap, swap".
 * 3. `fallback` — the fixed product list, to top up. Without it a thread made
 *    entirely of questions ("explain my health factor") would show an empty row,
 *    which reads as broken rather than as "nothing to suggest".
 *
 * Deduped case-insensitively across all three, so a sequel the user has already
 * typed does not appear twice under different capitalisation.
 */
export function nextSuggestions(
  history: HistoryTurn[],
  tokens: IToken[],
  fallback: string[] = [],
): string[] {
  /* Newest first. Only the user's own turns: Luca's prose is full of verbs and
     token symbols ("you would receive 4,812 KLD") and parsing it would mine our
     own answers for commands the user never asked for. */
  const said = history
    .filter((m) => m.role === "user" && m.text.trim())
    .map((m) => m.text.trim())
    .reverse();

  const parsed = said
    .map((text) => ({ text, res: parseCommand(text, tokens) }))
    .filter(
      (p): p is { text: string; res: { status: "ok"; command: Command } } =>
        p.res.status === "ok",
    );

  const out: string[] = [];
  const seen = new Set<string>();
  const push = (s: string) => {
    const k = s.trim().toLowerCase();
    if (!k || seen.has(k) || out.length >= LIMIT) return;
    /* Never offer a chip the grammar would reject. The table above is written
       against the parser, but it is written by hand, and this is the line that
       keeps a future edit to it from shipping a dead button. */
    if (parseCommand(s, tokens).status !== "ok") return;
    seen.add(k);
    out.push(s);
  };

  const latest = parsed[0];
  if (latest) {
    for (const s of SEQUELS[latest.res.command.kind]?.(latest.res.command) ??
      [])
      push(s);
    /* The command just issued is excluded from its own repeat list — the most
       recent thing you did is the least likely thing you want offered back. */
    seen.add(latest.text.toLowerCase());
  }

  for (const p of parsed) if (REPEATABLE(p.res.command)) push(p.text);
  for (const s of fallback) push(s);

  return out;
}
