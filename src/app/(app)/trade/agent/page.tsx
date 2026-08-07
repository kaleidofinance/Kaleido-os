"use client";

import { useEffect, useRef, useState } from "react";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import { useAgentSettings } from "@/hooks/v2/useAgentSettings";
import { useBorrowV2 } from "@/hooks/v2/useBorrowV2";
import { useV3Positions } from "@/hooks/dex/useV3Positions";
import { useLocalPlanner } from "@/hooks/v2/useLocalPlanner";
import { ACTIVE_TOKENS } from "@/constants/tokens";
import { isDeployed } from "@/constants/registry";
import { getChainMeta } from "@/constants/chains";
import AgentSettings from "@/components/v2/AgentSettings";
import PlanReview from "@/components/v2/PlanReview";
import { intentsFromChat } from "@/lib/v2/intents/fromChat";
import { matchFaq } from "@/lib/ai/faq";
import {
  parseCommand,
  fillSlot,
  COMMAND_HELP,
  type Draft,
  type ParseResult,
  type Slot,
} from "@/lib/v2/intents/fromCommand";
import type { Intent } from "@/lib/v2/intents";
import s from "./agent.module.css";

/**
 * Agent — Luca as a trading mode.
 *
 * Wired to the real /api/chat route (AI engine + server-side auditor gate).
 * When the model returns a plan (context.plan: Intent[]), it's rendered inline
 * as a signable PlanReview through the intent registry — the same flow a manual
 * swap uses. Text-only replies just render as a message. The engine emits
 * intents; the frontend validates and signs them.
 */

interface Msg {
  role: "user" | "assistant";
  text: string;
  /** Present when a turn produced a signable plan. */
  plan?: Intent[];
  /** Which path answered. Surfaced so the cheap path is visible, not implied. */
  via?: "local" | "model";
}

const SUGGESTIONS = [
  "Swap 500 USDC to KLD",
  "What's the cheapest 30-day borrow?",
  "Explain my health factor",
  "Move idle USDC to the best yield",
];

export default function AgentPage() {
  const { chainId, address } = useWalletV2();
  const { settings } = useAgentSettings(address);
  const { buildPlan } = useLocalPlanner();
  // Open loans, so "repay" resolves on its own when there's only one. This is
  // also what makes the header's "reads your positions" claim true.
  const { loans } = useBorrowV2();
  // V3 positions, so "collect fees position 42" / "remove position 42" can
  // find the position and its real liquidity value without asking.
  const { positions } = useV3Positions();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** A command awaiting one more slot. Kept so a bare "kld" completes it. */
  const [pending, setPending] = useState<{ draft: Draft; missing: Slot } | null>(null);
  /** Remaining model requests today. Null until known, or when unmetered. */
  const [credits, setCredits] = useState<{ remaining: number; quota: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Read the balance without spending one, so the count is visible before the
  // user finds out the hard way.
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    fetch(`/api/chat?address=${address}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && typeof d?.remaining === "number") {
          setCredits({ remaining: d.remaining, quota: d.quota });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [address]);

  const say = (text: string, extra?: Partial<Msg>) =>
    setMessages((m) => [...m, { role: "assistant", text, ...extra }]);

  const scrollDown = () =>
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    });

  /**
   * Turns a successful parse into a rendered plan. Returns false when the
   * command can't be planned locally, so the caller can fall through.
   */
  const planLocally = async (result: ParseResult): Promise<boolean> => {
    if (result.status === "incomplete") {
      setPending({ draft: result.draft, missing: result.missing });
      say(result.prompt, { via: "local" });
      return true;
    }
    if (result.status !== "ok") return false;

    setPending(null);

    if (result.command.kind === "help") {
      say(
        `Things I can do without using a reasoning request:\n\n${COMMAND_HELP}\n\n` +
          "I can also answer common questions directly — health factor, kfUSD, staking, slippage, agent permissions, which chains are live.",
        { via: "local" },
      );
      return true;
    }

    /*
     * Refuse to build a transaction on a chain with no contracts.
     *
     * Everything past this point resolves addresses out of ACTIVE_TOKENS and
     * the legacy address constants, which still hold the pre-rewrite Abstract
     * Testnet deployment. Those addresses are dead, so a plan built from them
     * would render as a perfectly normal, signable review — and fail (or worse,
     * send value to a contract that isn't there) on submit.
     *
     * A wrong plan that looks right is the expensive failure here, so this
     * fails loudly and early instead. Parsing, slot-filling, `help` and FAQ all
     * still work above: the grammar is worth exercising before a deploy, it just
     * must not produce something signable.
     */
    if (!isDeployed(chainId)) {
      const here = getChainMeta(chainId)?.name;
      say(
        `I parsed that, but I can't build it: Kaleido's contracts aren't deployed${
          here ? ` on ${here}` : " on any chain yet"
        }. They were rewritten and are being redeployed from scratch, testnet ` +
          `first, starting with Arc, Base, Robinhood, BNB Smart Chain and ` +
          `Ethereum. Until then I'd be pointing you at dead addresses, so I'd ` +
          `rather stop here than hand you a plan that looks signable and isn't. ` +
          `Everything else still works — ask me how a product behaves, or run ` +
          `\`help\` to see the commands I'll be able to execute.`,
        { via: "local" },
      );
      return true;
    }

    const built = await buildPlan(result.command, {
      slippageBps: settings.slippageBps,
      deadlineMin: 20,
      loans,
      positions,
    });

    if (!built.ok) {
      say(built.error, { via: "local" });
      return true;
    }

    say(built.build.summary, { via: "local", plan: built.build.intents });
    return true;
  };

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;

    setMessages((m) => [...m, { role: "user", text: content }]);
    setInput("");
    setBusy(true);

    try {
      // Local-first. A stated command is not a reasoning problem, and routing it
      // through a provider costs a credit, adds latency, and introduces the one
      // failure mode a grammar can't have: a confidently wrong number.
      if (pending) {
        const filled = fillSlot(pending.draft, pending.missing, content, ACTIVE_TOKENS);
        if (filled.status !== "unknown") {
          await planLocally(filled);
          return;
        }
        // The reply didn't answer the question, so drop the draft and let the
        // message be read fresh rather than trapping the user in a slot loop.
        setPending(null);
      }

      const parsed = parseCommand(content, ACTIVE_TOKENS);
      if (parsed.status !== "unknown") {
        await planLocally(parsed);
        return;
      }

      // Second local net: static questions with a fixed, known answer. Checked
      // after the parser (a command is never an FAQ) and before the model,
      // since "what is slippage" has one correct answer that doesn't need
      // reasoning. A miss here is silent — most real questions are open-ended,
      // so falling through is the expected case, not a failure.
      const faq = matchFaq(content);
      if (faq) {
        say(faq.answer, { via: "local" });
        return;
      }

      // Only genuine questions reach the model.
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: content,
          // No fallback. The old `?? 11124` silently told the server every
          // disconnected user was on Abstract Testnet, so answers came back
          // confidently scoped to a chain the user wasn't on. Undefined is the
          // truth when no wallet is connected, and the server can say so.
          chainId,
          address,
          // Guardrails travel with the request so the server-side auditor gate
          // can enforce the user's own limits, not a hardcoded threshold.
          limits: {
            maxPerAction: settings.maxPerAction,
            maxPerDay: settings.maxPerDay,
            minHealthFactor: settings.minHealthFactor,
            slippageBps: settings.slippageBps,
            allowedActions: settings.allowedActions,
          },
        }),
      });
      const data = await res.json().catch(() => null);
      const reply =
        data?.response ??
        data?.error ??
        "I couldn't reach the reasoning engine just now. Try again shortly.";
      const used = data?.context?.credits;
      if (used && typeof used.remaining === "number") {
        setCredits({ remaining: used.remaining, quota: used.quota });
      }

      const plan = intentsFromChat(data);
      // A 429 never reached a provider, so it isn't a model answer. Tagging it
      // as one would misreport where the turn was served.
      say(reply, {
        via: res.status === 429 ? "local" : "model",
        plan: plan.length ? plan : undefined,
      });
    } catch {
      // The model being unreachable is no longer a dead end: commands still
      // execute, so say what still works instead of only apologising.
      say(
        `I can't reach the reasoning engine, but I can still act on commands:\n\n${COMMAND_HELP}`,
        { via: "local" },
      );
    } finally {
      setBusy(false);
      scrollDown();
    }
  };

  const empty = messages.length === 0;

  return (
    <div className={s.card}>
      <div className={s.head}>
        <span className={s.avatar} aria-hidden />
        <div>
          <div className={s.name}>Luca Agent</div>
          <div className={s.sub}>
            {credits
              ? `Reads your positions · ${credits.remaining}/${credits.quota} reasoning requests left today`
              : "Reads your positions · signs with your wallet"}
          </div>
        </div>
        <button
          className={s.gear}
          onClick={() => setSettingsOpen(true)}
          aria-label="Agent settings"
        >
          ⚙
        </button>
        <span className={s.dot} />
      </div>

      <AgentSettings
        address={address}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />

      <div className={s.body} ref={scrollRef}>
        {empty ? (
          <div className={s.intro}>
            <div className={s.introTitle}>What do you want to do?</div>
            <div className={s.introBody}>
              Describe it in plain language. Luca compares routes and proposes a
              plan, and nothing executes until you approve and sign. Direct
              commands like <code>swap 500 USDC to KLD</code> run instantly
              without using the reasoning engine.
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={s.turn}>
              <div className={`${s.msg} ${m.role === "user" ? s.me : s.ai}`}>
                {m.text}
              </div>
              {m.via === "local" && (
                <span className={s.viaTag} title="Handled on-device, no model call">
                  Direct
                </span>
              )}
              {m.plan && (
                <div className={s.plan}>
                  <PlanReview
                    intents={m.plan}
                    submitLabel="Sign & run"
                    onComplete={() =>
                      setMessages((prev) =>
                        prev.map((msg, idx) =>
                          idx === i ? { ...msg, plan: undefined } : msg,
                        ),
                      )
                    }
                  />
                </div>
              )}
            </div>
          ))
        )}
        {busy && <div className={`${s.msg} ${s.ai} ${s.typing}`}>Thinking…</div>}
      </div>

      {empty && (
        <div className={s.suggest}>
          {SUGGESTIONS.map((sug) => (
            <button key={sug} className={s.chip} onClick={() => send(sug)}>
              {sug}
            </button>
          ))}
        </div>
      )}

      <form
        className={s.inputRow}
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          className={s.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Tell Luca what you want to do"
          aria-label="Message Luca"
          disabled={busy}
        />
        <button className={s.send} type="submit" disabled={busy || !input.trim()} aria-label="Send">
          ↑
        </button>
      </form>
    </div>
  );
}
