"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { chainTokens } from "@/constants/tokens";
import {
  parseCommand,
  type Command,
  type Draft,
} from "@/lib/v2/intents/fromCommand";
import type { IToken } from "@/constants/types/dex";
import type { Intent, IntentView } from "@/lib/v2/intents";
import { SNAPSHOT, snapshotDeps } from "./planQuotes";
import s from "./LivePlanner.module.css";

/**
 * The live planner — the landing page's centrepiece.
 *
 * This is not a mock, a video, or a scripted transcript. It runs the product's
 * real parser (src/lib/v2/intents/fromCommand.ts), the real planner
 * (src/lib/v2/intents/build.ts) and the real step renderer, against the real
 * Sepolia deployment's addresses. What a visitor types here goes through the
 * same code path as what they would type in /trade/agent.
 *
 * That is only possible because of two properties the app was built with, and
 * both are worth stating because they are what the section is claiming:
 *
 *   1. `parseCommand` is pure and synchronous — no wallet, no network, no chain
 *      reads, no model call. So it cannot fail on a cold visitor, and "a stated
 *      command costs zero model calls" is demonstrable rather than asserted.
 *   2. `renderIntent` is pure. The rows a signing surface shows are computed
 *      from the intent alone, so they render identically with no signer.
 *
 * WHAT IT SHOWS, AND WHY EACH PART IS THERE.
 *
 * The reading, then the plan, then a walkthrough of the plan being signed, then
 * what the wallet and the chain look like afterwards. All four, because a plan
 * on its own does not answer the question a visitor actually has — a list of
 * steps reads as a form, and the product's claim is about what happens when you
 * approve it. The approve-then-act pairing is the specific thing worth seeing:
 * it is why a swap is two signatures and a send is one, and no amount of
 * marketing copy conveys it as well as watching the first tick land.
 *
 * The walkthrough is a walkthrough and says so. Nothing here holds a signer, so
 * no step can be broadcast, and it must never look as though one was — the
 * button says what it is, the timing note says the clock is compressed, and the
 * result block states what the transaction *would* settle to rather than what it
 * did. What is NOT invented is the shape: the statuses, the markers and the
 * ordering are the ones src/components/v2/PlanReview.tsx drives from real
 * receipts, and every figure in the result comes off the command or the intent.
 * Where a figure is only knowable from a chain read — how much stKLD a stake
 * mints, how much kfUSD a deposit backs — the result names the mechanism and
 * omits the number. Inventing one is the single thing this page must not do.
 *
 * It deliberately does NOT reuse PlanReview itself. That component calls
 * useResolverContext(), which would pull the wallet stack onto a public page and
 * give this page a connected and a disconnected state. The steps below are
 * rendered from the same IntentView it renders, and the status machine is the
 * same four states, minus the half that needs a signer.
 *
 * Prices: see ./planQuotes.ts. They are recorded quoter answers rather than live
 * calls, because the one claim this section makes about itself is that nothing it
 * does leaves the tab.
 */

/**
 * The chain the planner resolves symbols and contract addresses against.
 *
 * Sepolia, and unlike the constant this replaced it is load-bearing rather than
 * vocabulary-only. It used to be Ethereum mainnet on the grounds that only the
 * token list mattered — but mainnet has no ChainContracts entry, so every branch
 * of the builder that needs a router, a diamond or a vault refused before it got
 * anywhere, and a visitor who typed `swap` was told swapping was unavailable.
 * The result was a planner that could only ever complete a plain ERC20 transfer.
 *
 * Sepolia is a full deployment: nine tokens including KLD, stKLD and kfUSD, and
 * every contract the grammar can name. So the plans below are the plans the app
 * builds, with the addresses it would actually sign against.
 *
 * This is still NOT the DEFAULT_CHAIN_ID that chains.ts refuses to export.
 * Nothing here sends a transaction, reads a balance, or asks a node anything.
 */
const DEMO_CHAIN_ID = SNAPSHOT.chainId;

/** The app's own defaults — see the agent page and /api/chat. */
const OPTS = { slippageBps: 50, deadlineMin: 20 };

/**
 * Human label per command kind.
 *
 * Typed as an exhaustive Record over the union on purpose, following ACTION_OF
 * in src/lib/ai/auditor.ts: a new command kind will not typecheck until it has a
 * label here, so this cannot silently render a raw camelCase kind at a visitor.
 */
const VERB: Record<Command["kind"], string> = {
  swap: "Swap",
  stake: "Stake",
  approve: "Approve",
  send: "Send",
  bridge: "Bridge",
  borrow: "Borrow",
  lend: "Lend",
  deposit: "Deposit collateral",
  withdraw: "Withdraw collateral",
  repay: "Repay",
  takeListing: "Take listing",
  fillRequest: "Fill request",
  cancel: "Cancel",
  mint: "Mint kfUSD",
  redeem: "Redeem kfUSD",
  lock: "Lock into the vault",
  unlock: "Start vault withdrawal",
  completeWithdrawal: "Complete withdrawal",
  claimYield: "Claim yield",
  compoundYield: "Compound yield",
  collectFees: "Collect fees",
  removePosition: "Close position",
  /* Present because the Record is exhaustive, and unreachable from this page for
     the same reason it needs no entry in VERBS: `provideLiquidity` is a
     ToolOnlyKind, so parseCommand never returns it and nothing here can render
     this label. Kept as a label rather than an empty string because the type is
     the only thing forcing the decision, and a blank would read as an oversight. */
  provideLiquidity: "Add liquidity",
  claimTestTokens: "Claim test tokens",
  help: "Help",
  receive: "Receive",
};

/**
 * The two commands that resolve to a panel rather than a transaction.
 *
 * `buildIntents` returns `{ ok: false, error: "help" }` and `"receive"` for
 * these — sentinels for the caller, not messages for a human, so they are
 * intercepted before the builder ever runs rather than rendered as a failure.
 */
const PANEL: Record<"help" | "receive", { title: string; body: string }> = {
  help: {
    title: "Opens the command list",
    body: "No transaction, nothing to sign. Everything the grammar accepts, in one place.",
  },
  receive: {
    title: "Opens your deposit address",
    body: "The one command that works with no contract deployed anywhere: your own address and a QR code. Nothing is signed and nothing is sent.",
  },
};

/**
 * Reading rows, in this order, whichever command produced them.
 *
 * Derived from the command object's own field names rather than a switch per
 * kind, which is what keeps 24 command shapes readable from one table. `target`
 * / `id` are the cancel command's; `refTarget` / `refId` are the same two on a
 * half-filled Draft.
 */
const FIELDS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "amount", label: "Amount" },
  { key: "token", label: "Token" },
  { key: "tokenIn", label: "From" },
  { key: "tokenOut", label: "To" },
  { key: "to", label: "Recipient" },
  { key: "toChain", label: "To chain" },
  { key: "interestPct", label: "Rate" },
  { key: "days", label: "Term" },
  { key: "loanId", label: "Loan" },
  { key: "listingId", label: "Listing" },
  { key: "requestId", label: "Request" },
  { key: "positionId", label: "Position" },
  { key: "target", label: "Target" },
  { key: "refTarget", label: "Target" },
  { key: "id", label: "Id" },
  { key: "refId", label: "Id" },
];

/**
 * Example prompts. Every one is verified against the real parser and the real
 * builder — a chip that did not parse, or that stopped where it looked like it
 * should have completed, would be the most embarrassing possible bug here.
 *
 * `chip` abbreviates the address for display and `text` carries it in full,
 * because an abbreviated address does not parse: it is 40 hex digits or it is
 * not an address. The same asymmetry is why the recipient row below prints the
 * full value while a token address is allowed to be short.
 *
 * The set is an arc rather than a feature list, and the first three are ordered
 * by how much of the mechanism they expose: a swap is an approve plus a trade
 * against a priced pool, a stake is an approve plus a deposit, a loan offer is
 * an approve plus a book entry, and a send is the one action that needs no
 * approve at all. Then one the parser refuses to guess at, and the single case
 * that actually needs a model.
 */
const EXAMPLES: ReadonlyArray<{ text: string; chip: string }> = [
  { text: "swap 500 USDC to KLD", chip: "swap 500 USDC to KLD" },
  { text: "stake 250 KLD", chip: "stake 250 KLD" },
  {
    text: "lend 1000 USDC at 6% for 30 days",
    chip: "lend 1000 USDC at 6% for 30 days",
  },
  {
    text: "send 50 USDC to 0x00000000000000000000000000000000DeaDBeef",
    chip: "send 50 USDC to 0x0000…Beef",
  },
  { text: "send 100 USDC", chip: "send 100 USDC" },
  {
    text: "what should I do with idle stablecoins",
    chip: "what should I do with idle stablecoins",
  },
];

/** How long a placeholder holds before the next example, in ms. */
const ROTATE_MS = 3800;

/**
 * How long each step holds in the walkthrough, in ms.
 *
 * Compressed, and the card says so. A Sepolia block is about twelve seconds, so
 * an honest clock would put a two-step plan at half a minute of watching a
 * spinner — which nobody does, and which would teach a visitor that the product
 * is slow rather than that it is sequential. What matters here is the ordering:
 * the approve settles before the action starts, because the action spends the
 * allowance the approve granted.
 */
const WALK_MS = 1100;

interface Row {
  label: string;
  value: string;
  note?: string;
  /** Set for the recipient, the one value that must never be abbreviated. */
  whole?: boolean;
}

/** What the plan settles to, once every step in it has been signed. */
interface Settled {
  lines: ReadonlyArray<{ label: string; value: string; whole?: boolean }>;
  note: string;
}

type Result =
  | { kind: "working" }
  | { kind: "unknown" }
  | { kind: "panel"; title: string; body: string }
  | { kind: "asks"; question: string }
  | {
      kind: "steps";
      summary: string;
      steps: IntentView[];
      settled: Settled;
    }
  | { kind: "stopped"; reason: string };

interface Outcome {
  text: string;
  /** Parse time, already formatted. */
  ms: string;
  kind: Command["kind"] | null;
  verb: string | null;
  rows: Row[];
  result: Result;
}

function isToken(v: unknown): v is IToken {
  return (
    typeof v === "object" &&
    v !== null &&
    "symbol" in v &&
    "decimals" in v &&
    "address" in v
  );
}

/**
 * Abbreviates a *token* address. Never a recipient.
 *
 * Safe here because a token address came out of the registry and is only being
 * shown as evidence of that. It is not safe for a recipient: address poisoning
 * works by seeding an address that matches the first and last four digits, so
 * two different addresses render identically once abbreviated. See the transfer
 * renderer in src/lib/v2/intents/definitions.ts.
 */
const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * Thousands separators, six decimals at most.
 *
 * Fixed to en-US rather than the visitor's locale. Everything else on this page
 * is formatted that way, and a figure that arrives grouped one way in the plan
 * summary (which the builder wrote) and another in the result would read as two
 * different numbers.
 */
const num = (v: string | number) => {
  const n = Number(v);
  return Number.isFinite(n)
    ? n.toLocaleString("en-US", { maximumFractionDigits: 6 })
    : String(v);
};

function readingOf(o: Command | Draft): Row[] {
  const rec = o as unknown as Record<string, unknown>;
  const rows: Row[] = [];
  for (const f of FIELDS) {
    const v = rec[f.key];
    if (v === undefined || v === null) continue;
    if (isToken(v)) {
      rows.push({
        label: f.label,
        value: v.symbol,
        note: `${v.decimals} decimals · ${shortAddr(v.address)}`,
      });
    } else if (f.key === "to") {
      rows.push({ label: f.label, value: String(v), whole: true });
    } else if (f.key === "interestPct") {
      rows.push({ label: f.label, value: `${v}%` });
    } else if (f.key === "days") {
      rows.push({ label: f.label, value: `${v} days` });
    } else {
      rows.push({ label: f.label, value: String(v) });
    }
  }
  return rows;
}

/**
 * What the chain and the wallet look like once the plan is signed.
 *
 * Derived from the command and the built intents, never from a template. That is
 * the whole point: "your plan is complete" is what the old footer said for every
 * kind alike, and it is the least informative sentence available — a swap, a
 * loan offer and a collateral deposit leave three completely different states
 * behind, and which one you get is the thing worth knowing before you sign.
 *
 * THE RULE FOR NUMBERS. A figure appears here only if it is in the command or in
 * an intent. `500 USDC` was typed. `16,524.53 KLD` is `amountOutMin`, which the
 * builder computed from a recorded quote and which the transaction enforces. How
 * much stKLD a stake mints, how much kfUSD a deposit backs, what a loan repays
 * at maturity — those are share prices and collateral ratios read off the chain
 * at execution, so the line names the mechanism and gives no number. A plausible
 * one would be indistinguishable from a real one to a reader, which is exactly
 * why it cannot be written.
 *
 * Exhaustive over the union with no `default`, for the reason VERB is: a new
 * command kind should fail to compile until someone has decided what signing it
 * leaves behind.
 */
function settledOf(
  command: Command,
  intents: Intent[],
  quoted: string | null,
): Settled {
  const approved = intents.find((i) => i.kind === "approve");
  const allowance = approved
    ? [
        {
          label: "Allowance",
          value: `${approved.symbol} spendable by the contract that needs it`,
        },
      ]
    : [];

  switch (command.kind) {
    case "swap": {
      const leg = intents.find((i) => i.kind === "swap");
      return {
        lines: [
          {
            label: "Left your wallet",
            value: `${num(command.amount)} ${command.tokenIn.symbol}`,
          },
          {
            label: "Arrived",
            value: quoted
              ? `≈ ${num(quoted)} ${command.tokenOut.symbol}`
              : command.tokenOut.symbol,
          },
          ...(leg
            ? [
                {
                  label: "Floor",
                  value: `${num(leg.amountOutMin)} ${command.tokenOut.symbol} — below it the swap reverts and you keep your ${command.tokenIn.symbol}`,
                },
              ]
            : []),
          ...allowance,
        ],
        note: `Priced from a quote recorded off the ${SNAPSHOT.chain} pool at block ${num(SNAPSHOT.block)}. The app re-quotes the live pool as you type and the floor moves with it — that is what the ${OPTS.slippageBps / 100}% slippage setting buys you, and why the floor is a number in the transaction rather than a hope.`,
      };
    }

    case "stake":
      return {
        lines: [
          { label: "Left your wallet", value: `${num(command.amount)} KLD` },
          {
            label: "Arrived",
            value: "stKLD, at the vault's current share price",
          },
          {
            label: "To exit",
            value: "request a withdrawal, then wait out the 7-day period",
          },
          ...allowance,
        ],
        note: "No stKLD figure, because there is not one to give until the transaction runs: the vault mints shares against what it already holds, so how many your KLD buys is read at execution. The balance then grows on its own as the vault harvests protocol fees — stKLD rebases rather than paying out. The 7 days is a contract constant, not a setting.",
      };

    case "lend":
      return {
        lines: [
          {
            label: "Escrowed",
            value: `${num(command.amount)} ${command.token.symbol}, held by the protocol`,
          },
          {
            label: "Live in the book",
            value: `an offer at ${command.interestPct}% over ${command.days} days`,
          },
          {
            label: "Next",
            value:
              "a borrower draws it whole, or you close it and take the escrow back",
          },
          ...allowance,
        ],
        note: "Peer-to-peer, so nothing is pooled: your offer sits in the order book at the rate you set, and the borrower who takes it takes your terms rather than a curve's. Drawn in one piece — the contract supports partial draws, and choosing a split is the Borrow page's job rather than something to infer from a sentence.",
      };

    case "borrow":
      return {
        lines: [
          {
            label: "Posted",
            value: `a request for ${num(command.amount)} ${command.token.symbol} at ${command.interestPct}% over ${command.days} days`,
          },
          { label: "Fills when", value: "a lender takes it" },
          ...allowance,
        ],
        note: "A request, not a draw — the rate is the one you asked for rather than one a utilisation curve picked, and it costs nothing until a lender agrees to it.",
      };

    case "send":
      return {
        lines: [
          {
            label: "Left your wallet",
            value: `${num(command.amount)} ${command.token.symbol}`,
          },
          { label: "Arrived", value: command.to, whole: true },
        ],
        note: "One signature and no allowance, because a transfer spends your own balance rather than authorising anyone to spend it. It is also irreversible, which is why the address is printed in full above and never abbreviated.",
      };

    case "deposit":
      return {
        lines: [
          {
            label: "Locked as collateral",
            value: `${num(command.amount)} ${command.token.symbol}`,
          },
          {
            label: "Withdrawable",
            value: "while your health factor allows",
          },
          ...allowance,
        ],
        note: "Collateral does not earn here and is not lent out — it sits against what you borrow, and it is what a lender is looking at when they decide whether to fill your request.",
      };

    case "withdraw":
      return {
        lines: [
          {
            label: "Back in your wallet",
            value: `${num(command.amount)} ${command.token.symbol}`,
          },
          {
            label: "Health factor",
            value: "recomputed, and the withdrawal is refused if it would fall",
          },
        ],
        note: "The check is in the contract, not in this card: a withdrawal that would leave an open loan short is rejected on chain rather than warned about in an interface.",
      };

    case "repay":
      return {
        lines: [
          {
            label: "Left your wallet",
            value: "the loan's full repayment, principal and interest",
          },
          { label: "Closed", value: "the loan, and your collateral unlocks" },
          ...allowance,
        ],
        note: "The amount comes off the loan itself rather than out of an interface, down to the last base unit — a rounded repayment underpays it and the contract will not close it.",
      };

    case "mint":
      return {
        lines: [
          {
            label: "Locked as backing",
            value: `${num(command.amount)} ${command.token.symbol}`,
          },
          {
            label: "Minted",
            value: `kfUSD, 1:1 with the ${command.token.symbol}, less the mint fee`,
          },
          ...allowance,
        ],
        note: `Nominally 1:1 — a 6-decimal collateral is scaled up to kfUSD's 18 so the two figures match. The fee comes off the minted side and is a rate the contract holds in storage, which is why the kfUSD line carries no exact number: reading it is a chain call, and this page makes none.`,
      };

    case "redeem":
      return {
        lines: [
          { label: "Burned", value: `${num(command.amount)} kfUSD` },
          {
            label: "Returned",
            value: `${command.token.symbol}, 1:1, less the redeem fee`,
          },
          ...allowance,
        ],
        note: "The kfUSD approves itself here, which looks odd and is right: the contract transferFroms your balance before burning it, so the allowance target is kfUSD rather than a router. Mint and redeem each take their own fee, so the round trip costs both.",
      };

    case "lock":
      return {
        lines: [
          {
            label: "Locked in the yield vault",
            value: `${num(command.amount)} kfUSD`,
          },
          {
            label: "Arrived",
            value: "kafUSD, 1:1 — the vault's receipt token",
          },
          { label: "Earns", value: "the vault's share of protocol fees" },
          ...allowance,
        ],
        note: "kfUSD in, kafUSD out. Getting back out is two steps and a cooldown rather than one transaction — `unlock` starts it, and `complete withdrawal` claims it once the cooldown is up.",
      };

    case "unlock":
      return {
        lines: [
          {
            label: "Requested",
            value: `withdrawal of ${num(command.amount)} kafUSD`,
          },
          {
            label: "Paid out now",
            value: "nothing — this starts the cooldown",
          },
          {
            label: "Then",
            value: "`complete withdrawal` once the cooldown has elapsed",
          },
        ],
        note: "Two steps on purpose. A vault that can be emptied in one transaction is a vault that can be drained in one block, so the cooldown is the protection and the second signature is you claiming.",
      };

    case "completeWithdrawal":
      return {
        lines: [
          { label: "Back in your wallet", value: "the kfUSD you requested" },
          { label: "Closed", value: "the withdrawal request" },
        ],
        note: "Paid out in kfUSD, because kfUSD is the only thing `lock` ever locks — ask for it in anything else and the planner refuses rather than building a transaction that would revert after the cooldown had already run. It also reverts if the cooldown has not elapsed, so this is a claim rather than a request.",
      };

    case "claimYield":
      return {
        lines: [
          { label: "Paid out", value: "the kfUSD yield accrued to you so far" },
          { label: "Untouched", value: "your principal" },
        ],
        note: "No figure, because accrual is read at execution. Claiming resets the accrual and leaves the position exactly as it was.",
      };

    case "compoundYield":
      return {
        lines: [
          { label: "Paid out", value: "the accrued kfUSD, to your wallet" },
          {
            label: "Then",
            value: "`lock` it back in — that stays a signature of yours",
          },
        ],
        note: "Named compound and it is the treasury's own claimAndCompound, but be clear about what that does: it transfers the yield to you and leaves it ready to re-lock. Nothing here re-deposits on your behalf, and a card that implied otherwise would be describing a vault with more authority over your balance than this one has.",
      };

    case "approve":
      return {
        lines: [
          {
            label: "Allowance",
            value: `${num(command.amount)} ${command.token.symbol}, spendable by the router`,
          },
          { label: "Moved", value: "nothing" },
        ],
        note: "An approve is permission and not a transfer, which is why it is worth understanding as its own step: the tokens are still yours until something spends the allowance.",
      };

    case "takeListing":
      return {
        lines: [
          {
            label: "Drawn",
            value: `${num(command.amount)} from listing #${command.listingId}`,
          },
          {
            label: "Owed",
            value: "the listing's rate over its term, from your collateral",
          },
          ...allowance,
        ],
        note: "You took someone's posted terms rather than a pool's, so the rate is fixed for the term the lender set.",
      };

    case "fillRequest":
      return {
        lines: [
          {
            label: "Lent",
            value: `the principal on request #${command.requestId}`,
          },
          {
            label: "Owed to you",
            value: "the borrower's stated rate and term",
          },
          ...allowance,
        ],
        note: "You accepted a borrower's terms as posted. Nothing is pooled and nothing is shared — this loan is between the two of you.",
      };

    case "cancel":
      return {
        lines: [
          {
            label: "Cancelled",
            value: `${command.target} #${command.id}`,
          },
          {
            label: "Returned",
            value: "anything escrowed against it, in full",
          },
        ],
        note: "Only ever your own, and only while it is unfilled — the contract checks both, so a cancel cannot reach an order someone has already drawn on.",
      };

    case "collectFees":
      return {
        lines: [
          {
            label: "Collected",
            value: `fees earned by position #${command.positionId}`,
          },
          { label: "Untouched", value: "the liquidity itself" },
        ],
        note: "Fees accrue outside the position and are claimed separately, so collecting them does not take you out of range or change what you earn next.",
      };

    case "removePosition":
      return {
        lines: [
          {
            label: "Closed",
            value: `position #${command.positionId}`,
          },
          {
            label: "Returned",
            value: "both tokens, plus any uncollected fees",
          },
        ],
        note: "What comes back depends on where the price sits inside your range at the moment it closes, which is why there are no two figures here.",
      };

    case "claimTestTokens":
      return {
        lines: [
          {
            label: "Claimed",
            value: command.symbol
              ? `the faucet's ${command.symbol} drip`
              : "the faucet's drip, for every asset you are due",
          },
          { label: "Next claim", value: "after the faucet's cooldown" },
        ],
        note: "Testnet only, and the cooldown is enforced on chain rather than by the interface. Assets already inside their cooldown are left out of the plan rather than added and reverted.",
      };

    case "bridge":
      return {
        lines: [
          {
            label: "Left",
            value: `${num(command.amount)} ${command.token.symbol} on this chain`,
          },
          {
            label: "Arrives on",
            value: command.toChain,
          },
          ...allowance,
        ],
        note: "A bridge settles on two chains, so it is the one action where the second half is out of your hands once the first is signed — which is why the route is resolved and shown before anything is.",
      };

    /* Unreachable: both are intercepted before the builder runs, because
       buildIntents answers them with a sentinel rather than a plan. Present so
       the switch stays exhaustive over the union, and so adding a kind here is a
       compile error rather than a silently empty result block. */
    case "help":
    case "receive":
      return { lines: [], note: "" };

    /* Unreachable for the reason given in VERB: a ToolOnlyKind never comes back
       from parseCommand. */
    case "provideLiquidity":
      return { lines: [], note: "" };
  }
}

export default function LivePlanner() {
  const vocabulary = useMemo(() => chainTokens(DEMO_CHAIN_ID), []);
  const [input, setInput] = useState("");
  const [out, setOut] = useState<Outcome | null>(null);
  const [focused, setFocused] = useState(false);
  const [tick, setTick] = useState(0);
  const fieldRef = useRef<HTMLInputElement>(null);

  /**
   * How far the walkthrough has got: null before it starts, otherwise the index
   * of the step currently signing. It equals the step count when every step is
   * through, which is what shows the result.
   *
   * One number rather than an array of statuses, because the statuses are
   * derivable from it and two sources of truth for "which step are we on" is how
   * a spinner ends up left running under a tick.
   */
  const [walkAt, setWalkAt] = useState<number | null>(null);

  /* A submit counter, so a second Enter while the first plan's chunk is still
     loading cannot let the earlier result overwrite the later one. */
  const seq = useRef(0);

  /* The placeholder cycles the examples, but only while the field is empty and
     unfocused — text changing under a cursor is disorienting, and it is motion,
     so a reduced-motion preference switches it off entirely and leaves the
     first example in place. */
  useEffect(() => {
    if (focused || input) return;
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    const id = window.setInterval(
      () => setTick((t) => (t + 1) % EXAMPLES.length),
      ROTATE_MS,
    );
    return () => window.clearInterval(id);
  }, [focused, input]);

  /**
   * Advances the walkthrough one step per tick.
   *
   * A timeout per step rather than one interval, so the cleanup on a new plan
   * cannot leave a stale tick queued against a shorter step list. The guard is
   * on the *current* result, which is what stops a walkthrough started on one
   * plan from continuing over the next one.
   */
  const steps = out?.result.kind === "steps" ? out.result.steps : null;
  useEffect(() => {
    if (!steps || walkAt === null || walkAt >= steps.length) return;
    const id = window.setTimeout(() => setWalkAt(walkAt + 1), WALK_MS);
    return () => window.clearTimeout(id);
  }, [steps, walkAt]);

  const run = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text) return;
      const mine = ++seq.current;

      /* Every new plan resets the walkthrough. Without this, planning a
         one-step send while a two-step swap sat finished would show the send
         already signed. */
      setWalkAt(null);

      /* Measured around the parse alone, which is the claim being made. The
         build is excluded on purpose: the first one pays for a dynamic import,
         and a number that includes a chunk fetch would not be the parser's. */
      const t0 = performance.now();
      const parsed = parseCommand(text, vocabulary);
      const ms = (performance.now() - t0).toFixed(2);

      if (parsed.status === "unknown") {
        setOut({
          text,
          ms,
          kind: null,
          verb: null,
          rows: [],
          result: { kind: "unknown" },
        });
        return;
      }

      if (parsed.status === "incomplete") {
        setOut({
          text,
          ms,
          kind: parsed.draft.kind,
          verb: VERB[parsed.draft.kind],
          rows: readingOf(parsed.draft),
          result: { kind: "asks", question: parsed.prompt },
        });
        return;
      }

      const command = parsed.command;
      if (command.kind === "help" || command.kind === "receive") {
        setOut({
          text,
          ms,
          kind: command.kind,
          verb: VERB[command.kind],
          rows: [],
          result: { kind: "panel", ...PANEL[command.kind] },
        });
        return;
      }

      const base = {
        text,
        ms,
        kind: command.kind,
        verb: VERB[command.kind],
        rows: readingOf(command),
      };
      /* The reading is on screen before the builder is even loaded, which is
         the honest ordering: understanding the sentence is instant, and turning
         it into steps is the part that can need a chain. */
      setOut({ ...base, result: { kind: "working" } });

      /* Loaded on first use rather than imported at the top, because both of
         these pull in ethers and this is a public page whose LCP matters. The
         parser above has no runtime dependencies at all, so the interactive
         half of this section costs almost nothing until someone uses it. */
      const [{ buildIntents }, { renderIntent }] = await Promise.all([
        import("@/lib/v2/intents/build"),
        import("@/lib/v2/intents"),
      ]);
      /* Fresh deps per plan, because they carry the winning quote back out —
         see snapshotDeps. Sharing one instance across plans would let a swap's
         price survive into the result of the next command. */
      const { deps, quoted } = snapshotDeps();
      const built = await buildIntents(command, OPTS, deps);
      if (seq.current !== mine) return;

      setOut({
        ...base,
        result: built.ok
          ? {
              kind: "steps",
              summary: built.build.summary,
              steps: built.build.intents.map(renderIntent),
              settled: settledOf(command, built.build.intents, quoted()),
            }
          : { kind: "stopped", reason: built.error },
      });
    },
    [vocabulary],
  );

  const useExample = (text: string) => {
    setInput(text);
    fieldRef.current?.focus();
    void run(text);
  };

  /* Which marker a step gets. The same three the app's PlanReview draws from
     real receipts, so a visitor who signs one later recognises it. */
  const markerFor = (i: number) => {
    if (walkAt === null || i > walkAt) return i + 1;
    if (i < walkAt) return "✓";
    return <span className={s.spin} aria-hidden="true" />;
  };

  return (
    <div className={s.wrap}>
      <form
        className={s.bar}
        onSubmit={(e) => {
          e.preventDefault();
          void run(input);
        }}
      >
        <input
          ref={fieldRef}
          className={s.field}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={EXAMPLES[tick].text}
          aria-label="Type a command"
          autoComplete="off"
          spellCheck={false}
        />
        <button
          className={s.go}
          type="submit"
          disabled={!input.trim() || out?.result.kind === "working"}
        >
          Plan it
        </button>
      </form>

      <div className={s.chips}>
        {EXAMPLES.map((e) => (
          <button
            key={e.text}
            type="button"
            className={s.chip}
            onClick={() => useExample(e.text)}
            title={e.text}
          >
            {e.chip}
          </button>
        ))}
      </div>

      <div className={s.out} aria-live="polite">
        {!out ? (
          <p className={s.hint}>
            Type one of those, or something of your own. It runs here, in this
            tab — the parser is the same one the app uses.
          </p>
        ) : (
          <>
            <div className={s.stat}>
              Parsed locally in <span className="tabular">{out.ms} ms</span> —
              no model call, no network, nothing left this tab.
            </div>

            {out.verb && (
              <div className={s.reading}>
                <div className={s.readHead}>
                  <span className={s.readLabel}>Read as</span>
                  <span className={s.verb}>{out.verb}</span>
                </div>
                {out.rows.length > 0 && (
                  <dl className={s.rows}>
                    {out.rows.map((r, i) => (
                      <div className={s.row} key={i}>
                        <dt className={s.rowKey}>{r.label}</dt>
                        <dd
                          className={`${s.rowVal} ${r.whole ? s.rowWhole : ""}`}
                        >
                          {r.value}
                          {r.note && (
                            <span className={s.rowNote}>{r.note}</span>
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            )}

            {out.result.kind === "working" && (
              <div className={s.note}>Building the plan…</div>
            )}

            {out.result.kind === "steps" && (
              <div className={s.plan}>
                <div className={s.summary}>{out.result.summary}</div>

                <ol className={s.steps}>
                  {out.result.steps.map((v, i) => (
                    <li
                      className={`${s.step} ${
                        walkAt !== null && i < walkAt ? s.stepDone : ""
                      }`}
                      key={i}
                    >
                      <span className={s.marker}>{markerFor(i)}</span>
                      <div>
                        <div className={s.stepTitle}>{v.title}</div>
                        {v.detail && (
                          <div className={s.stepDetail}>{v.detail}</div>
                        )}
                      </div>
                      {v.chain && (
                        <span className={s.stepChain}>{v.chain}</span>
                      )}
                    </li>
                  ))}
                </ol>

                {/* Before the walkthrough: what signing would cost in
                    signatures, and the invitation to watch it. */}
                {walkAt === null && (
                  <div className={s.act}>
                    <button
                      type="button"
                      className={s.walk}
                      onClick={() => setWalkAt(0)}
                    >
                      Walk it through
                    </button>
                    <p className={s.actNote}>
                      {out.result.steps.length === 1
                        ? "One signature, yours."
                        : `${out.result.steps.length} signatures, all yours, in this order.`}{" "}
                      In the app this is the point where you sign. Nothing on
                      this page holds a key, so nothing here can send anything.
                    </p>
                  </div>
                )}

                {/* During: which step, of how many. */}
                {walkAt !== null && walkAt < out.result.steps.length && (
                  <div className={s.act}>
                    <p className={s.actNote}>
                      Signing step {walkAt + 1} of {out.result.steps.length} —{" "}
                      {out.result.steps[walkAt].title}. Each one waits for the
                      last to confirm, because the step after an approve spends
                      the allowance it granted.
                    </p>
                  </div>
                )}

                {/* After: what the wallet and the chain now look like. */}
                {walkAt !== null &&
                  walkAt >= out.result.steps.length &&
                  out.result.settled.lines.length > 0 && (
                    <div className={s.settled}>
                      <div className={s.settledHead}>
                        <span className={s.settledLabel}>Result</span>
                        <span className={s.settledTag}>
                          walkthrough · clock compressed
                        </span>
                      </div>
                      <dl className={s.rows}>
                        {out.result.settled.lines.map((l, i) => (
                          <div className={s.row} key={i}>
                            <dt className={s.rowKey}>{l.label}</dt>
                            <dd
                              className={`${s.rowVal} ${
                                l.whole ? s.rowWhole : ""
                              }`}
                            >
                              {l.value}
                            </dd>
                          </div>
                        ))}
                      </dl>
                      <p className={s.foot}>{out.result.settled.note}</p>
                      <button
                        type="button"
                        className={s.again}
                        onClick={() => setWalkAt(null)}
                      >
                        Run it again
                      </button>
                    </div>
                  )}

                {out.kind === "send" && (
                  <p className={s.foot}>
                    That address passed its EIP-55 checksum. Change one letter
                    and re-run it — the plan is refused rather than built,
                    because a mistyped address is unrecoverable once signed.
                  </p>
                )}
              </div>
            )}

            {out.result.kind === "asks" && (
              <div className={s.ask}>
                <div className={s.askQ}>{out.result.question}</div>
                <p className={s.foot}>
                  It asks instead of guessing, and it asks without a model call.
                  An invented amount or an invented address is the one failure a
                  grammar cannot have.
                </p>
              </div>
            )}

            {out.result.kind === "panel" && (
              <div className={s.ask}>
                <div className={s.askQ}>{out.result.title}</div>
                <p className={s.foot}>{out.result.body}</p>
              </div>
            )}

            {out.result.kind === "stopped" && (
              <div className={s.stop}>
                <div className={s.stopWhy}>{out.result.reason}</div>
                <p className={s.foot}>
                  That is the real planner talking, not a placeholder. It plans
                  against {SNAPSHOT.chain}&apos;s deployment and stops wherever
                  a step needs something only your wallet can answer — an open
                  order, a position you hold, a live bridge route. Those work in
                  the app; here there is no address to ask about.
                </p>
              </div>
            )}

            {out.result.kind === "unknown" && (
              <div className={s.stop}>
                <div className={s.stopWhy}>Not a stated command.</div>
                <p className={s.foot}>
                  Which is the correct answer — this one is a question, not an
                  instruction, and it is exactly where the agent earns its keep.
                  In the app it goes to the model with your portfolio and the
                  live markets, comes back with a strategy, and every step it
                  proposes is built by the same planner and audited before you
                  see it.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
