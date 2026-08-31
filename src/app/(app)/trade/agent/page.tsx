"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import { useAgentSettings } from "@/hooks/v2/useAgentSettings";
import { useBorrowV2 } from "@/hooks/v2/useBorrowV2";
import { useV3Positions } from "@/hooks/dex/useV3Positions";
import { useLocalPlanner } from "@/hooks/v2/useLocalPlanner";
import { useChatHistory, type Msg } from "@/hooks/v2/useChatHistory";
import { chainTokens } from "@/constants/tokens";
import AgentSettings from "@/components/v2/AgentSettings";
import AgentCards from "@/components/v2/AgentCards";
import Answer from "@/components/v2/Answer";
import PlanReview from "@/components/v2/PlanReview";
import ReceivePanel from "@/components/v2/ReceivePanel";
import SwapRoute from "@/components/v2/SwapRoute";
import { ChartToggle, usePublishChartPair } from "@/components/v2/ChartPanel";
import chart from "@/components/v2/ChartPanel.module.css";
import TxHistory from "@/components/v2/TxHistory";
import hist from "@/components/v2/TxHistory.module.css";
import Headline from "./Headline";
import { getChainMeta } from "@/constants/chains";
import { intentsFromChat } from "@/lib/v2/intents/fromChat";
import { traceFromChat } from "@/lib/v2/agentTurn";
import { readChatStream } from "@/lib/v2/chatStream";
import { renderIntent } from "@/lib/v2/intents";
import { cardsFromChat, figureCards, localCards } from "@/lib/v2/cards";
import { matchFaq } from "@/lib/ai/faq";
import { visibleProse } from "@/lib/ai/actionsBlock";
import {
  parseCommand,
  fillSlot,
  COMMAND_HELP,
  type Draft,
  type ParseResult,
  type Slot,
} from "@/lib/v2/intents/fromCommand";
import { SUGGESTIONS } from "./suggestions";
import s from "./agent.module.css";

/**
 * Agent — Luca as a trading mode, shaped like a conversation.
 *
 * One well: a header naming who you are talking to, a transcript that owns the
 * leftover height, and a composer docked at the bottom.
 *
 * It used to wear the swap card's shape — prompt well, ↓ connector, plan well,
 * one full-width CTA — on the claim that describing a trade and filling the swap
 * form are the same act with a different input method. The claim is true and the
 * layout still failed, because a form's proportions gave the answer whatever
 * height five stacked non-shrinking controls left over: about one turn. Which
 * element is the content is not a style question.
 *
 * Wired to the real /api/chat route (AI engine + server-side auditor gate). When
 * a turn produces intents they render as numbered steps inside that turn and
 * sign through PlanReview — the same registry path a manual swap uses. The
 * engine emits intents; the frontend validates and signs them.
 */

/**
 * What the transcript's box is currently showing.
 *
 * It was already a surface that swaps its contents — it just had exactly one
 * thing to swap to, behind a `reviewing` boolean. Naming the state instead of
 * flagging it lets any surface land in that slot: receive today, send and
 * activity next, without another boolean each time.
 *
 * These are panels, not modals, and the distinction is behavioural. There is no
 * scrim and no focus trap; the composer below stays live, so typing a fresh
 * command is a valid way out and every panel also carries a Back control. The
 * one genuinely blocking step is signing, which PlanReview already owns.
 */
type Panel = { kind: "idle" } | { kind: "plan" } | { kind: "receive" };

/**
 * Where the expanded/compact preference lives.
 *
 * localStorage, matching agent *settings* rather than the transcript: how wide
 * you like the conversation is a standing preference about this screen, not
 * something about the conversation in it, and it should survive closing the tab
 * the way the slippage cap does. Nothing about a wallet is in it, so unlike the
 * thread it is not scoped per address.
 */
const WIDE_KEY = "kaleido.v2.agentExpanded";

/*
 * The empty card's starting points live in ./suggestions, so that a plain tsx
 * test can run all seven through the real parser — see the comment there. The
 * list is short and the reasoning behind each item is long, which is the other
 * reason it is not inline.
 */

export default function AgentPage() {
  const { chainId, address } = useWalletV2();
  const { settings } = useAgentSettings(address);
  const { buildPlan } = useLocalPlanner();
  // Open loans, so "repay" resolves on its own when there's only one.
  const { loans } = useBorrowV2();
  // V3 positions, so "collect fees position 42" / "remove position 42" can
  // find the position and its real liquidity value without asking.
  const { positions } = useV3Positions();
  /*
   * The transcript, persisted per wallet and capped — see useChatHistory. It
   * lives in a hook rather than here because this route unmounts whenever you
   * step over to /trade/swap, so an in-memory thread was lost on a tab change,
   * not only on a reload.
   */
  const { messages, setMessages, clear: clearThread } = useChatHistory(address);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>({ kind: "idle" });
  /** A command awaiting one more slot. Kept so a bare "kld" completes it. */
  const [pending, setPending] = useState<{
    draft: Draft;
    missing: Slot;
  } | null>(null);
  /** Remaining model requests today. Null until known, or when unmetered. */
  const [credits, setCredits] = useState<{
    remaining: number;
    quota: number;
  } | null>(null);

  /*
   * Expanded mode.
   *
   * The card is 520px wide because it was designed to stand beside the chart and
   * to read like one column of a trading screen. That is the right default and
   * the wrong ceiling: a plan with four steps, a route with two legs and a
   * paragraph of reasoning is a document, and reading it 520px at a time is the
   * complaint. This widens the same card in place rather than opening a second
   * surface — same transcript, same composer, same scroll position — so the
   * toggle is a view of the conversation and never a different one.
   *
   * Starts compact and is corrected in an effect rather than read during render:
   * localStorage does not exist on the server, so seeding state from it directly
   * makes the first client render disagree with the markup Next sent.
   */
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    try {
      setExpanded(localStorage.getItem(WIDE_KEY) === "1");
    } catch {
      /* storage unavailable — compact is the safe default, and it fits */
    }
  }, []);
  const toggleWide = () => {
    const next = !expanded;
    setExpanded(next);
    try {
      localStorage.setItem(WIDE_KEY, next ? "1" : "0");
    } catch {
      /* the preference just doesn't outlive the tab */
    }
  };

  /** The connected wallet as of this render, readable from a stale closure. */
  const addrRef = useRef(address);
  addrRef.current = address;

  /**
   * Reads the balance without spending one, so the count is visible before the
   * user finds out the hard way.
   *
   * Called on connect and again after a stopped request — an aborted turn never
   * receives the reply that carries the new count, but the credit is gone all
   * the same, so the number on screen would otherwise be a lie until reload.
   */
  const refreshCredits = useCallback((addr?: string) => {
    if (!addr) return;
    fetch(`/api/chat?address=${addr}`)
      .then((r) => r.json())
      .then((d) => {
        // Only apply if this is still the connected wallet. A slow reply for an
        // account you have since switched away from must not overwrite the
        // count being shown for the current one.
        if (typeof d?.remaining === "number" && addrRef.current === addr) {
          setCredits({ remaining: d.remaining, quota: d.quota });
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshCredits(address);
  }, [address, refreshCredits]);

  /*
   * What this turn is doing, as it does it.
   *
   * "Thinking…" was one static word for a wait that can be a parse, a chain read,
   * a quote, or a model round-trip that reads your portfolio and then prices
   * something — four very different waits reported identically, so the only
   * information in it was "still busy".
   *
   * Two layers, and both are things this page can actually witness. Live: the
   * stages below, recorded as they happen and rendered in the turn that is
   * coming — for a model turn that includes each read tool the moment the server
   * says it ran, and the preamble the model wrote before calling it. Afterwards:
   * how the turn ended, appended from the reply (see traceFromChat). What is
   * deliberately NOT here is invented reasoning — no provider thinking is
   * requested, so there are no reasoning tokens to show, and paraphrasing the
   * model's job into "considering your options…" would be a caption written by
   * the UI and read as a quote from the agent.
   *
   * A ref alongside the state because `say` needs to read the turn's record at
   * the moment it appends the message, and every entry is a fresh array so the
   * snapshot a message keeps can't be mutated by a later stage.
   */
  const [thinking, setThinking] = useState<string[]>([]);
  const traceRef = useRef<string[]>([]);
  const note = useCallback((line: string) => {
    traceRef.current = [...traceRef.current, line];
    setThinking(traceRef.current);
  }, []);

  const say = (text: string, extra?: Partial<Msg>) =>
    setMessages((m) => [
      ...m,
      {
        role: "assistant",
        text,
        /* Attached here rather than at each call site: every answer is the end of
           some sequence of steps, and there is no reply this page can produce
           that shouldn't be able to say how it got there. Spread first, so a
           caller can still override or drop it. */
        ...(traceRef.current.length ? { thinking: traceRef.current } : {}),
        ...extra,
      },
    ]);

  /**
   * Turns a successful parse into a rendered plan. Returns false when the
   * command can't be planned locally, so the caller can fall through.
   *
   * Takes the turn's abort signal so a plan built against chain reads can be
   * thrown away if the user stopped while it was being assembled.
   */
  const planLocally = async (
    result: ParseResult,
    signal: AbortSignal,
  ): Promise<boolean> => {
    if (result.status === "incomplete") {
      setPending({ draft: result.draft, missing: result.missing });
      note("Needs one more detail before it can be built");
      say(result.prompt, { via: "local" });
      return true;
    }
    if (result.status !== "ok") return false;

    setPending(null);

    if (result.command.kind === "help") {
      note("Answered from the command reference");
      say(
        `Things I can do without using a reasoning request:\n\n${COMMAND_HELP}\n\n` +
          "I can also answer common questions directly — health factor, kfUSD, staking, slippage, agent permissions, which chains are live.",
        {
          via: "local",
          /* Five of the list above as chips. The list is reference — you read it
             to find out what exists — and these are a way in, which is a
             different job that a line of text cannot do.

             Labels name the product, not the verb: "Swap" alone repeats the
             word already sitting in the reference list above it, where "Swap
             USDC to KLD" says which market. The prompts are the parser's own
             phrasing and are verified against it — which is why mint's label
             and prompt name different tokens: the parser binds mint's token as
             the *collateral*, so "mint 500 kfUSD" resolves to kfUSD-as-
             collateral and the planner rejects it. "mint 500 USDC" is the
             phrasing that plans. The faucet's prompt asks for everything due
             rather than a named asset, because which assets a faucet stocks
             differs per chain and a card cannot know. Clicking fills the box;
             nothing sends. */
          cards: localCards([
            {
              kind: "actions",
              title: "Try one",
              actions: [
                {
                  label: "Claim testnet tokens",
                  prompt: "claim everything from the faucet",
                },
                { label: "Swap USDC to KLD", prompt: "swap 500 USDC to KLD" },
                { label: "Stake KLD for stKLD", prompt: "stake 100 KLD" },
                { label: "Mint kfUSD", prompt: "mint 500 USDC" },
                {
                  label: "Explain my health factor",
                  prompt: "explain my health factor",
                },
              ],
            },
          ]),
        },
      );
      return true;
    }

    /*
     * Receive resolves to a panel, not a plan. It is the only command here that
     * builds no intents and needs no contract — an address and a QR are true on
     * every chain today — so it short-circuits ahead of the planner rather than
     * asking it for a transaction that does not exist.
     */
    if (result.command.kind === "receive") {
      note("Opened your receive panel");
      setPanel({ kind: "receive" });
      return true;
    }

    /*
     * No deployment gate here.
     *
     * This used to refuse to build anything unless `isDeployed(chainId)`, on the
     * reasoning that a plan assembled from the dead pre-rewrite addresses would
     * look signable and fail on submit. That reasoning was right about the risk
     * and wrong about where to put the guard: refusing at *build* time meant the
     * plan well never rendered, so the component this screen exists to design
     * could not be looked at on any chain — and the app is pre-integration, so
     * that is every chain.
     *
     * The signature is the real gate, and it is the user's own. PlanReview
     * already requires a connected wallet and sends each step individually, so
     * an address with no code fails there, loudly, at the one moment the failure
     * is informative. Rendering the steps costs nothing and is the whole point
     * of the screen.
     */
    note("Reading balances and quotes to price the steps");
    const built = await buildPlan(result.command, {
      slippageBps: settings.slippageBps,
      deadlineMin: 20,
      loans,
      positions,
    });

    /*
     * Stopped while the planner was reading chain state.
     *
     * `buildPlan` awaits quotes and balances, so it is cancellable in the only
     * sense that matters here: the result can be discarded. Rendering a plan
     * after the user pressed Stop would put signable steps on screen for a turn
     * they abandoned — the one outcome a stop button must prevent.
     */
    if (signal.aborted) return true;

    if (!built.ok) {
      note("Couldn't build it — the reply says why");
      say(built.error, { via: "local" });
      return true;
    }

    const n = built.build.intents.length;
    note(`Built ${n} step${n === 1 ? "" : "s"} to sign`);
    say(built.build.summary, { via: "local", plan: built.build.intents });
    return true;
  };

  /**
   * Cancels the in-flight model request (if any) and resets the busy state.
   *
   * The credit is spent the moment the server receives the POST — before
   * `runAgent` runs — so stopping doesn't refund it. The count is refreshed
   * explicitly rather than waiting for the next turn, since the aborted request
   * never returns its updated balance.
   */
  const abortRef = useRef<AbortController | null>(null);
  const stop = () => {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = null;
    setBusy(false);
    refreshCredits(address);
  };

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;

    // The vocabulary the parser resolves symbols against, scoped to the chain
    // the user is on. "swap 500 usdc" names a different contract on each chain,
    // so there is no chain-free answer to what "usdc" means.
    const vocabulary = chainTokens(chainId);

    setMessages((m) => [...m, { role: "user", text: content }]);
    setInput("");
    setBusy(true);
    /* A turn's record starts empty. Cleared here and not when the turn ends, so
       the lines stay readable in the busy row until its answer replaces them. */
    traceRef.current = [];
    setThinking([]);
    // A new question invalidates whatever panel is open, so drop back to the
    // steps view rather than leaving a stale signing flow open over it. Any
    // panel the turn goes on to open (receive, below) is set after this and
    // therefore wins.
    setPanel({ kind: "idle" });

    // A fresh controller per request. The old one (if any) is already spent.
    const abort = new AbortController();
    abortRef.current = abort;

    /*
     * The bubble a streamed answer is being written into, when there is one.
     *
     * Declared out here so the catch below can tell a stop that interrupted an
     * answer already on screen from a stop that interrupted the wait for one —
     * two different things to leave behind, and only the second one deserves a
     * turn of its own that says "Stopped."
     */
    let live: { text: string; open: boolean } | null = null;

    try {
      // Local-first. A stated command is not a reasoning problem, and routing it
      // through a provider costs a credit, adds latency, and introduces the one
      // failure mode a grammar can't have: a confidently wrong number.
      if (pending) {
        const filled = fillSlot(
          pending.draft,
          pending.missing,
          content,
          vocabulary,
        );
        if (filled.status !== "unknown") {
          note("Took this as the answer to what I asked");
          await planLocally(filled, abort.signal);
          return;
        }
        // The reply didn't answer the question, so drop the draft and let the
        // message be read fresh rather than trapping the user in a slot loop.
        setPending(null);
      }

      const parsed = parseCommand(content, vocabulary);
      if (parsed.status !== "unknown") {
        note("Read it as a direct command — no reasoning request needed");
        await planLocally(parsed, abort.signal);
        return;
      }

      // Second local net: static questions with a fixed, known answer. Checked
      // after the parser (a command is never an FAQ) and before the model,
      // since "what is slippage" has one correct answer that doesn't need
      // reasoning. A miss here is silent — most real questions are open-ended,
      // so falling through is the expected case, not a failure.
      const faq = matchFaq(content);
      if (faq) {
        note("Matched a question I already know the answer to");
        /*
         * The answer, plus its frames. Static cards come from the topic; a
         * `figure` is filled here because faq.ts is a lib and these values —
         * your caps, your floor, your remaining quota — are only knowable from
         * the hooks on this page. Both halves go through the same validator the
         * engine's cards do, so the frames only ever receive one shape.
         */
        const cards = localCards([
          ...(faq.cards ?? []),
          ...(faq.figure ? figureCards(faq.figure, { settings, credits }) : []),
        ]);
        say(faq.answer, {
          via: "local",
          ...(cards.length ? { cards } : {}),
        });
        return;
      }

      /* Only genuine questions reach the model.
       *
       * No trace line for crossing that boundary. The one that used to be here
       * — "Not a command I know — asking the reasoning engine" — reported the
       * app's own dispatch: which of two code paths the sentence had fallen
       * down, named after the machinery at the bottom of it. The reads that
       * follow are things that happened to the user's positions, which is what
       * a record is for; this was only ever a note about us. */
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abort.signal,
        body: JSON.stringify({
          message: content,
          // No fallback. The old `?? 11124` silently told the server every
          // disconnected user was on Abstract Testnet, so answers came back
          // confidently scoped to a chain the user wasn't on. Undefined is the
          // truth when no wallet is connected, and the server can say so.
          chainId,
          address,
          // The model chosen in settings, when one is. Omitted rather than sent
          // empty so the server's own default answers — and re-checked there
          // against its allow-list either way, since this arrives from a client.
          ...(settings.model ? { model: settings.model } : {}),
          // Guardrails travel with the request so the server-side auditor gate
          // can enforce the user's own limits, not a hardcoded threshold.
          limits: {
            maxPerAction: settings.maxPerAction,
            maxPerDay: settings.maxPerDay,
            minHealthFactor: settings.minHealthFactor,
            slippageBps: settings.slippageBps,
            allowedActions: settings.allowedActions,
          },
          /* Ask for frames. The server answers them only on the provider path;
             a quota refusal, the legacy proxy and anything that fails before
             dispatch still reply in plain JSON, which is why the content type
             below decides how to read this and not the flag above. */
          stream: true,
        }),
      });

      /*
       * The streamed turn.
       *
       * Prose lands in the transcript as the model writes it instead of after
       * the whole turn — which, with up to three model calls and chain reads
       * between them, is the difference between the first sentence appearing in
       * a few seconds and the screen sitting still for most of a minute.
       *
       * Wire format and the reader are in src/lib/v2/chatStream.ts. What is left
       * here is the part only this page can do: deciding where each frame goes
       * in a transcript.
       */
      if (
        res.body &&
        (res.headers.get("content-type") ?? "").includes("ndjson")
      ) {
        live = { text: "", open: false };

        /* Opens the bubble on the first delta and patches it after. The decision
           and the mutation both happen out here so the updater stays pure —
           React may call it twice, and an updater that flipped `open` itself
           would append a second bubble the second time.

           What goes on screen is `visibleProse`, not the raw accumulation: a
           reply that ends by offering choices carries them as a fenced block
           (src/lib/ai/actionsBlock.ts), and that block streams like any other
           text. Cutting it here is the difference between the answer ending on
           its last sentence and ending on a second of raw JSON. `finish`
           replaces all of this with the server's stripped reply either way, so
           this is only about what the live view shows.

           Opening waits for prose rather than for the first delta, since a reply
           whose first characters are the fence has nothing to put in a bubble
           yet. */
        const write = (chunk: string) => {
          live!.text += chunk;
          const text = visibleProse(live!.text);
          if (!text) return;
          const first = !live!.open;
          live!.open = true;
          setMessages((m) =>
            first
              ? [...m, { role: "assistant", text, via: "model" }]
              : m.map((msg, i) =>
                  i === m.length - 1 ? { ...msg, text } : msg,
                ),
          );
        };

        /* The end of the turn, streamed or not: the server's text is what gets
           saved, so it replaces whatever accumulated — it carries the build
           notes and any refusal, which the deltas never included. */
        const finish = (
          response: string,
          context: Record<string, unknown> | undefined,
        ) => {
          const data = { response, context };
          const credit = (context as any)?.credits;
          if (credit && typeof credit.remaining === "number") {
            setCredits({ remaining: credit.remaining, quota: credit.quota });
          }
          const plan = intentsFromChat(data);
          const cards = cardsFromChat(data);
          /* The outcome line only. `context.reads` is sent on this path too, but
             every one of them was already noted as it ran — passing the payload
             through whole would print the whole trace a second time. */
          for (const line of traceFromChat({
            ...data,
            context: { ...(context ?? {}), reads: [] },
          })) {
            note(line);
          }
          const extra: Partial<Msg> = {
            via: "model",
            ...(plan.length ? { plan } : {}),
            ...(cards.length ? { cards } : {}),
          };
          if (!live?.open) {
            say(response, extra);
            return;
          }
          /* Patched, not appended — the bubble is already on screen. `thinking`
             has to be attached here rather than at open time, because most of
             it happened after the bubble existed. */
          const thinking = traceRef.current;
          setMessages((m) =>
            m.map((msg, i) =>
              i === m.length - 1
                ? {
                    ...msg,
                    text: response,
                    ...(thinking.length ? { thinking } : {}),
                    ...extra,
                  }
                : msg,
            ),
          );
        };

        const terminal = await readChatStream(res.body, {
          onText: write,
          onRound: (preamble, reads) => {
            if (preamble) note(preamble);
            /* Server-reported and validated on the way in — the names come from
               a reply, so traceFromChat drops anything that isn't one of the
               read tools with a plausible name rather than printing it. */
            for (const line of traceFromChat({ context: { reads } }))
              note(line);
            /* That round's prose was preamble, and it is a line of thought
               process now. The bubble it was going into gets dropped: the answer
               is the round that follows, and the saved reply will not contain
               what was in there. */
            if (live!.open) {
              live!.open = false;
              live!.text = "";
              setMessages((m) =>
                m.length && m[m.length - 1].role === "assistant"
                  ? m.slice(0, -1)
                  : m,
              );
            } else {
              live!.text = "";
            }
          },
          onDone: finish,
          onError: finish,
        });

        if (!terminal) {
          /* The body ended with no final frame, so the connection dropped. The
             text that arrived is real and stays on screen; what is missing is
             any confirmation that it was the whole answer, and presenting half a
             sentence as finished would be the one thing worse than saying so.

             `visibleProse` again, because this is the one path that saves the
             streamed text instead of replacing it with the server's: nothing is
             coming to strip a half-arrived actions block, so it has to be cut
             here or it is what gets persisted. */
          const partial = visibleProse(live.text).trim();
          if (live.open && partial) {
            finish(
              `${partial}\n\n---\n\nThe connection dropped before that answer finished.`,
              undefined,
            );
          } else {
            say(
              "The connection dropped before that answer finished. Try again shortly.",
              { via: "local" },
            );
          }
        }
        return;
      }

      const data = await res.json().catch(() => null);
      const reply =
        data?.response ??
        data?.error ??
        "I couldn't work that out just now. Try again shortly.";
      const used = data?.context?.credits;
      if (used && typeof used.remaining === "number") {
        setCredits({ remaining: used.remaining, quota: used.quota });
      }

      const plan = intentsFromChat(data);
      const cards = cardsFromChat(data);
      /* What the model read, and how the turn ended, appended to the stages this
         page recorded itself. Server-reported and validated on the way in — the
         names come from a reply, so traceFromChat drops anything that isn't one
         of the read tools with a plausible name rather than printing it. */
      for (const line of traceFromChat(data)) note(line);
      // A 429 never reached a provider, so it isn't a model answer. Tagging it
      // as one would misreport where the turn was served.
      say(reply, {
        via: res.status === 429 ? "local" : "model",
        plan: plan.length ? plan : undefined,
        cards: cards.length ? cards : undefined,
      });
    } catch (err) {
      /*
       * A stop is not a failure, and must not be reported as one.
       *
       * `fetch` rejects with an AbortError when the controller fires, which is
       * the same catch that handles a dead network. Falling through would print
       * "I can't think that through" to someone who pressed Stop —
       * blaming the infrastructure for the user's own decision, and offering
       * help nobody asked for. The stopped turn says so itself, once.
       */
      if (err instanceof DOMException && err.name === "AbortError") {
        /* A stop during a streamed answer already has a bubble on screen with
           real text in it. A second turn saying "Stopped." would leave that
           partial answer looking finished, so the note goes on the turn it
           interrupted instead. Stripped, for the same reason as the dropped
           connection above: this text is kept, not replaced. */
        const stoppedAt = live ? visibleProse(live.text).trim() : "";
        if (live?.open && stoppedAt) {
          const text = `${stoppedAt}\n\n— Stopped.`;
          const thinking = traceRef.current;
          setMessages((m) =>
            m.map((msg, i) =>
              i === m.length - 1
                ? {
                    ...msg,
                    text,
                    ...(thinking.length ? { thinking } : {}),
                  }
                : msg,
            ),
          );
          return;
        }
        say("Stopped.", { via: "local" });
        return;
      }
      // The model being unreachable is no longer a dead end: commands still
      // execute, so say what still works instead of only apologising.
      say(
        `I can't think that through right now, but I can still act on commands:\n\n${COMMAND_HELP}`,
        { via: "local" },
      );
    } finally {
      /*
       * Only the request that is still current may clear the flag. `stop()`
       * already cleared it and nulled the ref; if a newer turn has since started,
       * this stale `finally` would otherwise unset *its* spinner.
       */
      if (abortRef.current === abort) {
        abortRef.current = null;
        setBusy(false);
      }
    }
  };

  /*
   * The newest assistant turn. Not for placement — every turn renders where it
   * falls in the transcript — but because the plan and the "Direct" provenance
   * tag belong to *this* turn specifically, and an older turn that also carried a
   * plan must not claim the review button, which can only act on the current one.
   */
  const latest = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return messages[i];
    }
    return undefined;
  }, [messages]);

  /*
   * Pins the transcript to the newest turn.
   *
   * Keyed on the message *count*, not the array: `onComplete` rewrites the array
   * to drop a spent plan, and yanking someone to the bottom because a signature
   * finished would fight them mid-read. A new turn is always something the user
   * just asked for, so following it is what they expect.
   */
  const threadRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    /* Stage count too, for the same reason: the turn in flight grows a line at a
       time now, and a wait that reports its progress below the fold reports it to
       nobody. */
  }, [messages.length, thinking.length]);

  /*
   * The composer grows with the sentence in it, from one line to the four-line
   * cap `.inp`'s max-height sets.
   *
   * Done in JS because a textarea has no content-driven height of its own: `rows`
   * is a fixed number of lines, so the old `rows={2}` was two lines whether you
   * had typed one word or six. `field-sizing: content` will replace this outright,
   * but it is Chromium-only today and a composer that only sizes itself in one
   * browser is worse than one that sizes itself everywhere.
   *
   * The height is cleared before it is read: `scrollHeight` on an element already
   * fixed at 88px reports 88px, so growing would work and shrinking never would —
   * delete a paragraph and the box would keep the height of the text you removed.
   */
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  const plan = latest?.plan;
  const steps = useMemo(() => (plan ? plan.map(renderIntent) : []), [plan]);

  /*
   * What the chart beside this card follows.
   *
   * There is no pair to read here the way Swap has one, so it follows the
   * conversation: a plan carrying a swap charts that swap's two sides, and with
   * nothing proposed it falls back to the chain's own asset. That makes the panel
   * answer the question the turn just raised — ask Luca to swap ETH for USDC and
   * the price you would be trading at is already on screen.
   */
  const charted = useMemo(() => {
    const swap = plan?.find((i) => i.kind === "swap");
    if (swap && swap.kind === "swap") {
      return { base: swap.tokenIn, quote: swap.tokenOut };
    }
    const native = getChainMeta(chainId)?.nativeCurrency.symbol ?? "ETH";
    return { base: native, quote: null };
  }, [plan, chainId]);
  usePublishChartPair(charted.base, charted.quote);

  /**
   * Puts a suggestion in the prompt box rather than sending it.
   *
   * A chip is a starting point, not a decision: "Lend 1,000 USDC at 10% for 60
   * days" is a template whose numbers are almost certainly not the ones you
   * want, and firing it on one click spends the turn — and past the parser, a
   * model credit — on a request nobody actually made. Pasting leaves the send
   * button as the only control that commits, which is the same contract the rest
   * of this screen keeps: Luca proposes, you approve.
   *
   * Focus moves with the text and the caret goes to the end. Without that the
   * words appear in a box the user is not in, so editing the amount costs a
   * second click to reach a caret that would otherwise sit at position zero,
   * in front of the verb.
   */
  const fillPrompt = (text: string) => {
    setInput(text);
    const el = inputRef.current;
    el?.focus();
    el?.setSelectionRange(text.length, text.length);
  };

  const onComplete = () => {
    setPanel({ kind: "idle" });
    // Clearing the plan leaves the summary text in place, so the well still
    // says what was done instead of emptying itself out.
    setMessages((prev) =>
      prev.map((m) => (m === latest ? { ...m, plan: undefined } : m)),
    );
  };

  /*
   * The plan handoff's label. Its own control now, rather than a third meaning
   * for the send button.
   *
   * That button used to be the send, the stop and the review at once, so its
   * label was a three-way expression and `busy` had to be checked first — a turn
   * in flight owned the button no matter what was on screen behind it, or a plan
   * from the previous turn would keep the "Review and sign" label and leave no way
   * to stop the running request. Splitting the controls removes the precedence
   * question rather than answering it: the send button sends or stops, and this
   * appears only when there is a plan to open.
   */
  const planLabel = plan
    ? `Review and sign · ${plan.length} transaction${plan.length === 1 ? "" : "s"}`
    : "";

  return (
    <div className={`${s.card} ${expanded ? s.wide : ""}`}>
      <AgentSettings
        address={address}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />

      <div className={`${s.box} ${s.raised} ${s.chat}`}>
        {/* Names who you are talking to, and carries everything that qualifies
            the conversation rather than participating in it: the credit count,
            Clear, the chart toggle and the settings gear.

            This is one row where there were two label rows plus a subline, and
            the consolidation is most of the height the transcript gained. The
            gear and the toggle keep the corner they had — the swap card keeps its
            own gear in the same place — but they are no longer sitting on top of
            a <label> for a textarea that is now three regions away. */}
        <div className={s.head}>
          <span className={s.avatar} aria-hidden />
          {/* Rotates through what Luca can do while the thread is empty, and is a
              fixed label the moment there is one — the header must not advertise
              over the answer you are reading. Headline.tsx carries the rest. */}
          <span className={s.headName}>
            <Headline rotate={messages.length === 0} />
          </span>
          <span className={s.headMeta}>
            {credits && (
              <span className="tabular" title="Reasoning requests left today">
                {credits.remaining}/{credits.quota}
                <span className={s.creditsWord}> left</span>
              </span>
            )}
            {/* A persisted thread needs a way out, and it is a safety control
                rather than a convenience: this transcript survives reloads and
                route changes, and it holds what you asked about your own
                positions. On a shared machine the only honest answer to "how do I
                get rid of this" cannot be "close the tab".

                Clears storage as well as state — `clear` empties the array, and
                the hook removes the key when the array is empty. */}
            {messages.length > 0 && (
              <button
                type="button"
                className={s.clear}
                onClick={() => {
                  clearThread();
                  setPending(null);
                  setPanel({ kind: "idle" });
                }}
                title="Delete this conversation from this device"
              >
                Clear
              </button>
            )}
            {/* Compact ↔ expanded. A view control, so it sits with the other view
                controls rather than in settings: it changes nothing about the
                conversation or the account, and it is the sort of thing you press
                mid-read and press back. Hidden below 721px, where the card is
                already the width of the screen and there is nothing to widen
                into — see the media query in agent.module.css. */}
            <button
              type="button"
              className={`${s.expand} ${expanded ? s.expandOn : ""}`}
              onClick={toggleWide}
              aria-pressed={expanded}
              aria-label={
                expanded
                  ? "Collapse the conversation"
                  : "Expand the conversation"
              }
              title={expanded ? "Compact view" : "Expanded view"}
            >
              <svg
                viewBox="0 0 16 16"
                width="13"
                height="13"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                focusable="false"
              >
                {expanded ? (
                  /* Arrows pointing in: pressing this makes it smaller. */
                  <>
                    <path d="M9.5 6.5h4M9.5 6.5v-4M9.5 6.5 14 2" />
                    <path d="M6.5 9.5h-4M6.5 9.5v4M6.5 9.5 2 14" />
                  </>
                ) : (
                  <>
                    <path d="M10 2.5h3.5V6M13.5 2.5 9.5 6.5" />
                    <path d="M6 13.5H2.5V10M2.5 13.5l4-4" />
                  </>
                )}
              </svg>
            </button>
            <ChartToggle className={chart.toggleRound} />
            {/* Same log the swap card shows — a swap Luca signed for you is still
                your swap, so both surfaces read one history rather than each
                keeping its own. `.triggerRound` is TxHistory's own 30px variant,
                the same escape hatch ChartToggle offers above, because this
                header's controls are circles. */}
            <TxHistory className={hist.triggerRound} />
            <button
              className={s.gear}
              onClick={() => setSettingsOpen(true)}
              aria-label="Agent settings"
            >
              ⚙
            </button>
          </span>
        </div>

        {/* The panels take the transcript's box rather than appearing below it.
            They are modes of the conversation, not additions to it: you are
            reviewing what Luca just proposed, and Back returns you to the words
            that proposed it. The composer stays live underneath either way. */}
        {panel.kind === "plan" && plan ? (
          <div className={s.panelScroll}>
            <PlanReview
              intents={plan}
              submitLabel="Sign & run"
              onComplete={onComplete}
              onCancel={() => setPanel({ kind: "idle" })}
            />
          </div>
        ) : panel.kind === "receive" ? (
          <div className={s.panelScroll}>
            <ReceivePanel onBack={() => setPanel({ kind: "idle" })} />
          </div>
        ) : (
          /* The conversation, scrolling inside its own bounded box.

             It used to sit above both wells as one clipped line per turn, so
             every exchange pushed the prompt and the plan further down the page
             until they left the viewport — the wells got smaller as the session
             got longer, which is backwards. Then it moved into the lower well and
             was bounded but starved: five non-shrinking controls in the well above
             left it about one turn's worth of height. It now takes the leftover
             height of the card itself, so turn fifty costs exactly what turn one
             did. */
          <div className={s.thread} ref={threadRef}>
            {messages.length === 0 ? (
              /* Chips only. The paragraph that used to sit above them explained
                 that Luca proposes and you sign — which the numbered steps and
                 the footnote under the composer both say again, in the place
                 where they matter. Seven tappable examples teach the same thing
                 by being pressed, and cost a third of the height. */
              <div className={s.empty}>
                <div className={s.emptyTitle}>Try one</div>
                <div className={s.suggest}>
                  {SUGGESTIONS.map((sug) => (
                    <button
                      key={sug}
                      className={s.chip}
                      onClick={() => fillPrompt(sug)}
                      disabled={busy}
                    >
                      {sug}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m, i) =>
                m.role === "user" ? (
                  /* Clickable, to put a past prompt back in the box. Only user
                     turns are — the previous version made Luca's lines buttons
                     too, with a handler that deliberately did nothing. */
                  <button
                    key={i}
                    className={`${s.turn} ${s.turnUser}`}
                    onClick={() => fillPrompt(m.text)}
                    title="Put this back in the prompt"
                  >
                    <span className={s.who}>You</span>
                    <span className={s.said}>{m.text}</span>
                  </button>
                ) : (
                  <div key={i} className={s.turn}>
                    <span className={`${s.who} ${s.whoAgent}`}>Luca</span>
                    <div className={s.said}>
                      {/* How the turn got here, folded away. Above the answer,
                          in the place the live stages occupied while it was
                          being written, so the reply doesn't shift when it
                          lands and the record stays where you watched it.

                          Two lines or more, or nothing: a single line is not a
                          process, and the "Direct" tag below already reports
                          the one thing a one-step turn has to say. Closed by
                          default — the answer is the content, and this is
                          available rather than presented. */}
                      {m.thinking && m.thinking.length >= 2 && (
                        <details className={s.think}>
                          <summary className={s.thinkHead}>
                            {m.thinking.length} steps
                          </summary>
                          <ol className={s.thinkList}>
                            {m.thinking.map((line, k) => (
                              <li key={k} className={s.thinkLine}>
                                {line}
                              </li>
                            ))}
                          </ol>
                        </details>
                      )}

                      <Answer text={m.text} />

                      {/* Frames for the turn's data — rendered on every turn
                          that carries them, not only the newest. Unlike a plan
                          they can't be acted on, so an older one is a record of
                          what was said rather than a control that has gone stale.
                          They don't survive a reload; see revive() for why. */}
                      {m.cards && m.cards.length > 0 && (
                        <AgentCards cards={m.cards} onPrompt={fillPrompt} />
                      )}

                      {/* Steps render on the turn that proposed them, and only on
                          the newest one. An older plan left on screen would sit
                          above a review button that can no longer act on it. */}
                      {m === latest && plan && steps.length > 0 && (
                        <>
                          {/* The pool and the floor, above the steps, when the
                              plan swaps. A route is a property of the plan
                              rather than of any one step — with two legs it is
                              the thing neither step can state alone — and it is
                              read off the intents themselves, so what it draws
                              is what the signature does. Renders nothing when no
                              step is a swap. */}
                          <SwapRoute intents={plan} />
                          <ol className={s.steps}>
                            {steps.map((v, j) => (
                              <li key={j} className={s.step}>
                                <span className={s.marker}>{j + 1}</span>
                                <div className={s.stepBody}>
                                  <div className={s.stepTitle}>{v.title}</div>
                                  {v.detail && (
                                    <div className={s.stepDetail}>
                                      {v.detail}
                                    </div>
                                  )}
                                </div>
                                <span className={s.stepMeta}>
                                  {v.chain ?? "—"}
                                </span>
                              </li>
                            ))}
                          </ol>
                        </>
                      )}

                      {/* Newest turn only. Tagging every local turn is more
                          literally accurate, but five identical "Which token…"
                          replies in a row meant five chips, each costing a line —
                          and this tag is provenance, not a feature. It answers
                          "did that one cost a credit", which is a question about
                          the turn you just took. */}
                      {m === latest && m.via === "local" && (
                        <span
                          className={s.viaTag}
                          title="Handled on-device, no model call"
                        >
                          Direct
                        </span>
                      )}
                    </div>
                  </div>
                ),
              )
            )}

            {/* The turn in flight, standing where its answer will appear.

                The wait used to be reported on the button, as a spinner and the
                word "Thinking…" in place of "Ask Luca". That put the status on the
                control instead of in the conversation, and it meant the button had
                to say two things at once — which is also how Stop ended up hidden
                behind a hover. Here the transcript says it is waiting, in the
                shape of the turn that is coming, and the button is free to be a
                stop button. */}
            {busy && (
              <div className={s.turn}>
                <span className={`${s.who} ${s.whoAgent}`}>Luca</span>
                {/* The stages, as they happen, with the spinner on the newest —
                    it is the one still running, and the ones above it are done.
                    Falls back to "Thinking…" for the instant before the first
                    stage is recorded, so the row never appears empty.

                    aria-live, because this is the only place the wait is
                    reported now that the button is a plain ■: a screen reader
                    otherwise hears nothing between the question and the answer. */}
                <div
                  className={`${s.said} ${s.thinking}`}
                  aria-live="polite"
                  aria-atomic="false"
                >
                  {(thinking.length > 0 ? thinking : ["Thinking…"]).map(
                    (line, i, all) => {
                      const now = i === all.length - 1;
                      return (
                        <div
                          key={i}
                          className={`${s.thinkLine} ${now ? s.thinkNow : ""}`}
                        >
                          {now ? (
                            <span className={s.spin} aria-hidden="true">
                              ↻
                            </span>
                          ) : (
                            <span className={s.thinkDone} aria-hidden="true">
                              ✓
                            </span>
                          )}
                          {line}
                        </div>
                      );
                    },
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* The composer. `flex: none`, so it stays where you left it however long
            the conversation runs — the transcript is what absorbs the height. */}
        <div className={s.composer}>
          {/* The plan handoff, and nothing else in this slot.

              A row of predicted chips used to share it — the sequel to your last
              command, then your own past phrasings — and it is gone on purpose.
              Suggestions belong to the empty card, where the question is "what
              can this do". Once you have typed one sentence you have answered
              that, and a standing row of guesses above the field stops being an
              offer and becomes competition for the thing you were already
              writing. It also spent the composer's height on furniture on every
              turn of the conversation, not just the first.

              Hidden while a panel is open, because "Review 3 steps" above an open
              review is a button pointing at itself. */}
          {plan && panel.kind === "idle" ? (
            <button
              type="button"
              className={s.ctaPlan}
              onClick={() => setPanel({ kind: "plan" })}
            >
              {planLabel}
            </button>
          ) : null}

          <div className={s.sendRow}>
            <textarea
              ref={inputRef}
              className={s.inp}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends, Shift+Enter breaks the line. A textarea is here
                // for wrapping, not for composing paragraphs.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder="Move my idle USDC to the best yield"
              aria-label="Tell Luca what you want to do"
            />
            {/* Send, and stop while a turn is in flight — the same button,
                deliberately, because the cancel has to be where the eye already
                is. Never disabled while busy: that was the old behaviour and it is
                exactly what made a running request uncancellable.

                The stop state is a plain ■ rather than a spinner that reveals
                "Stop" on hover. A cancel you have to point at to discover is one
                most people never find, and the transcript above is already
                reporting the wait. */}
            <button
              type="button"
              className={s.send}
              disabled={!busy && !input.trim()}
              onClick={() => (busy ? stop() : send(input))}
              title={busy ? "Stop this request" : "Send"}
              aria-label={busy ? "Stop this request" : "Send"}
            >
              <span aria-hidden="true">{busy ? "■" : "↑"}</span>
            </button>
          </div>

          {/* The signature caveat belongs to whichever surface is asking for the
              signatures. While the plan sits unopened in the transcript that is
              this footnote, because the CTA above is the only thing offering to
              sign. Once the review panel takes the box it prints the same
              sentence itself (PlanReview.tsx:184), and both were rendering — the
              identical line twice, a few rows apart, on the one surface where a
              reader is being asked to trust what it says. */}
          {plan && panel.kind !== "plan" ? (
            <p className={s.foot}>
              Each step is a separate signature. Nothing runs until you approve
              it, and a failure stops the rest.
            </p>
          ) : (
            /* The trust claim that used to ride a header row of its own above the
               card. It belongs under the field anyway — it qualifies what sending
               does, and a footnote is a cheaper shape for that than a row. */
            <p className={`${s.foot} ${s.live}`}>
              <span className={s.dot} />
              Reads your positions · signs with your wallet
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
