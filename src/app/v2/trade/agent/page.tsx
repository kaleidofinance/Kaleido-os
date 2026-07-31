"use client";

import { useRef, useState } from "react";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import { useAgentSettings } from "@/hooks/v2/useAgentSettings";
import AgentSettings from "@/components/v2/AgentSettings";
import PlanReview from "@/components/v2/PlanReview";
import { intentsFromChat } from "@/lib/v2/intents/fromChat";
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
  /** Present when the model returned a signable plan. */
  plan?: Intent[];
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
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;

    setMessages((m) => [...m, { role: "user", text: content }]);
    setInput("");
    setBusy(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: content,
          chainId: chainId ?? 11124,
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
      const plan = intentsFromChat(data);
      setMessages((m) => [
        ...m,
        { role: "assistant", text: reply, plan: plan.length ? plan : undefined },
      ]);
    } catch {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: "I couldn't reach the reasoning engine just now. Try again shortly.",
        },
      ]);
    } finally {
      setBusy(false);
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
      });
    }
  };

  const empty = messages.length === 0;

  return (
    <div className={s.card}>
      <div className={s.head}>
        <span className={s.avatar}>L</span>
        <div>
          <div className={s.name}>Luca</div>
          <div className={s.sub}>Reads your positions · signs with your wallet</div>
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
              plan — nothing executes until you approve and sign.
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={s.turn}>
              <div className={`${s.msg} ${m.role === "user" ? s.me : s.ai}`}>
                {m.text}
              </div>
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
