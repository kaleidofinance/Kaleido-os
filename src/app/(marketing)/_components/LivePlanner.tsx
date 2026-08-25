"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { chainTokens } from "@/constants/tokens";
import {
  parseCommand,
  type Command,
  type Draft,
} from "@/lib/v2/intents/fromCommand";
import type { IToken } from "@/constants/types/dex";
import type { IntentView } from "@/lib/v2/intents";
import type { PlanDeps } from "@/lib/v2/intents/build";
import s from "./LivePlanner.module.css";

/**
 * The live planner — the landing page's centrepiece.
 *
 * This is not a mock, a video, or a scripted transcript. It runs the product's
 * real parser (src/lib/v2/intents/fromCommand.ts) and, when the command can be
 * built without a chain, the real planner and the real step renderer. What a
 * visitor types here goes through the same code path as what they would type in
 * /trade/agent.
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
 * What it deliberately does NOT do is reuse src/components/v2/PlanReview.tsx.
 * That component calls useResolverContext(), which would pull the wallet stack
 * onto a public page and give this page a connected and a disconnected state.
 * The steps below are rendered from the same IntentView it renders, minus the
 * signing half.
 *
 * It also does not fabricate a quote. `buildIntents` asks its caller for prices
 * through PlanDeps, and the deps below answer "no price" honestly, so a swap
 * stops where the real planner stops when it cannot price a pool. Making the
 * demo look complete by inventing an output amount is the one thing this page
 * must not do — see src/lib/ai/bridgeQuotes.ts, which refuses to invent a fee
 * for the same reason.
 */

/**
 * The chain whose token list the parser resolves symbols against here.
 *
 * Same reasoning as PREVIEW_CHAIN_ID in the swap page, and the same caveat: this
 * is NOT the DEFAULT_CHAIN_ID that chains.ts refuses to export. Nothing here
 * sends a transaction, reads a balance, or asks a node anything — the id only
 * selects a vocabulary, so the worst it can do is resolve "usdc" to Ethereum's
 * USDC rather than some other chain's.
 *
 * Ethereum because its registry entry is the fullest (ETH, WETH, USDC, USDT,
 * DAI, WBTC) and because those addresses and decimals are the ones a reader is
 * most likely to recognise, which is the whole point of showing them.
 */
const DEMO_CHAIN_ID = 1;

/** The app's own defaults — see the agent page and /api/chat. */
const OPTS = { slippageBps: 50, deadlineMin: 20 };

/**
 * Deps that admit what they don't know.
 *
 * Every one of these is a real RPC round trip in the app. Here they return the
 * empty answer, which is not a stub standing in for a real one: it is the same
 * answer the app gets on a chain where nothing is deployed, and it produces the
 * same messages. A swap therefore stops at "no price for this pair" and a loan
 * at "the protocol address isn't configured", both of which are true today.
 */
const OFFLINE: PlanDeps = {
  chainId: DEMO_CHAIN_ID,
  quote: async () => null,
  marketRow: async () => null,
  positions: async () => [],
  loans: async () => [],
  /* Never consulted: DEMO_CHAIN_ID is Ethereum mainnet, which has no faucet
     recorded, so the builder refuses on the address before it asks. */
  faucetAssets: async () => [],
  /* Null, and it is the honest answer rather than the lazy one: Ethereum mainnet
     has no ChainContracts entry here, so there is no factory to ask and no pool
     to find. The mint branch reads null as "this pool does not exist yet", which
     is what makes a band refuse instead of centring on a guess — see
     ticksForRange. Nothing on this page can reach it anyway: `provideLiquidity`
     has no typed form, and this component only ever plans what parseCommand
     returned. */
  poolState: async () => null,
  /* A bridge route resolves against a live provider — a canonical portal for the
     exact corridor, or an aggregator quote otherwise — which is a network round
     trip the app makes and this page will not. So it answers as the app does on
     a corridor it cannot reach: a named stop, not a fabricated route. A send, by
     contrast, needs nothing external and still builds in full right here. */
  bridgeRoute: async () => ({
    error:
      "A bridge route resolves against a live provider, which this page does not call.",
  }),
};

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
 * Example prompts. Every one is verified against the real parser — a chip that
 * did not parse would be the most embarrassing possible bug on this page.
 *
 * `chip` abbreviates the address for display and `text` carries it in full,
 * because an abbreviated address does not parse: it is 40 hex digits or it is
 * not an address. The same asymmetry is why the recipient row below prints the
 * full value while a token address is allowed to be short.
 *
 * The set is an arc rather than a feature list: a plan that completes, one the
 * chain isn't ready for, one the parser refuses to guess at, a panel, and the
 * single case that actually needs a model.
 */
const EXAMPLES: ReadonlyArray<{ text: string; chip: string }> = [
  {
    text: "send 50 USDC to 0x00000000000000000000000000000000DeaDBeef",
    chip: "send 50 USDC to 0x0000…Beef",
  },
  { text: "swap 500 USDC to WETH", chip: "swap 500 USDC to WETH" },
  {
    text: "borrow 1000 USDC at 5% for 30 days",
    chip: "borrow 1000 USDC at 5% for 30 days",
  },
  { text: "send 100 USDC", chip: "send 100 USDC" },
  { text: "my wallet address", chip: "my wallet address" },
  {
    text: "what should I do with idle stablecoins",
    chip: "what should I do with idle stablecoins",
  },
];

/** How long a placeholder holds before the next example, in ms. */
const ROTATE_MS = 3800;

interface Row {
  label: string;
  value: string;
  note?: string;
  /** Set for the recipient, the one value that must never be abbreviated. */
  whole?: boolean;
}

type Result =
  | { kind: "working" }
  | { kind: "unknown" }
  | { kind: "panel"; title: string; body: string }
  | { kind: "asks"; question: string }
  | { kind: "steps"; summary: string; steps: IntentView[] }
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

export default function LivePlanner() {
  const vocabulary = useMemo(() => chainTokens(DEMO_CHAIN_ID), []);
  const [input, setInput] = useState("");
  const [out, setOut] = useState<Outcome | null>(null);
  const [focused, setFocused] = useState(false);
  const [tick, setTick] = useState(0);
  const fieldRef = useRef<HTMLInputElement>(null);

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

  const run = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text) return;
      const mine = ++seq.current;

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
      const built = await buildIntents(command, OPTS, OFFLINE);
      if (seq.current !== mine) return;

      setOut({
        ...base,
        result: built.ok
          ? {
              kind: "steps",
              summary: built.build.summary,
              steps: built.build.intents.map(renderIntent),
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
              no model call, no price lookup, nothing left this tab.
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
                    <li className={s.step} key={i}>
                      <span className={s.marker}>{i + 1}</span>
                      <div>
                        <div className={s.stepTitle}>{v.title}</div>
                        {v.detail && (
                          <div className={s.stepDetail}>{v.detail}</div>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
                <p className={s.foot}>
                  {out.result.steps.length === 1
                    ? "One signature, yours."
                    : `${out.result.steps.length} signatures, all yours.`}{" "}
                  In the app this is the point where you sign. Nothing on this
                  page can send anything.
                </p>
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
                  That is the real planner talking, not a placeholder. It stops
                  wherever a step needs a pool or an address it cannot resolve
                  from this page — so the sentence is understood and the steps
                  wait on the chain. Sends are the exception: they touch no
                  Kaleido contract, so they build in full right here.
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
                  proposes is priced and audited before you see it.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
