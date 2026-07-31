"use client";

import { useRef, useState } from "react";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import s from "./agent.module.css";

/**
 * Agent — Luca as a trading mode.
 *
 * Wired to the real /api/chat route, which forwards to the AI engine and
 * applies the server-side auditor gate (value threshold + per-chain venue
 * allowlist). When the AI engine isn't running the route returns a graceful
 * fallback message, so this page degrades honestly rather than erroring.
 *
 * Plan rendering (turning a returned tool-call into signable steps) is
 * deliberately not here yet — that needs the intent renderer/resolver registry
 * from the component map. For now Luca converses; execution stays behind the
 * per-mode manual flows until that registry exists.
 */

interface Msg {
  role: "user" | "assistant";
  text: string;
}

const SUGGESTIONS = [
  "Swap 500 USDC to KLD",
  "What's the cheapest 30-day borrow?",
  "Explain my health factor",
  "Move idle USDC to the best yield",
];

export default function AgentPage() {
  const { chainId, address } = useWalletV2();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
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
        }),
      });
      const data = await res.json().catch(() => null);
      const reply =
        data?.response ??
        data?.error ??
        "I couldn't reach the reasoning engine just now. Try again shortly.";
      setMessages((m) => [...m, { role: "assistant", text: reply }]);
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
        <span className={s.dot} />
      </div>

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
            <div
              key={i}
              className={`${s.msg} ${m.role === "user" ? s.me : s.ai}`}
            >
              {m.text}
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
