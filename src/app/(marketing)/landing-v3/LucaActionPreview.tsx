"use client";

import { useEffect, useRef, useState } from "react";
import {
  LuArrowUpRight,
  LuCheck,
  LuLoader,
  LuPause,
  LuPlay,
  LuShieldCheck,
  LuWallet,
} from "react-icons/lu";
import ChainIcon from "@/components/v2/ChainIcon";
import { appUrl } from "../landing-v2/navigation";
import s from "./LucaActionPreview.module.css";

interface PlanStep {
  num: string;
  action: string;
  detail: string;
}

interface Scenario {
  id: string;
  tab: string;
  chainId: string;
  chainName: string;
  prompt: string;
  routingLabel: string;
  summaryLeft: string;
  summaryRight: string;
  steps: [PlanStep, PlanStep];
  settlement: string;
}

const SCENARIOS: Scenario[] = [
  {
    id: "swap",
    tab: "Swap",
    chainId: "arc",
    chainName: "Arc · 5042",
    prompt: "Swap 500 USDC to EURC on Arc",
    routingLabel: "Quoted native V3 pool · 0.5% max slippage",
    summaryLeft: "500.00 USDC → 461.80 EURC",
    summaryRight: "Min 459.49 EURC",
    steps: [
      { num: "01", action: "Approve 500 USDC", detail: "Allowance for Kaleido Router" },
      { num: "02", action: "Execute swap on Arc", detail: "Direct settlement to your wallet" },
    ],
    settlement: "461.80 EURC settled directly to your wallet",
  },
  {
    id: "lend",
    tab: "Lend",
    chainId: "elysium",
    chainName: "Elysium · 99901",
    prompt: "Lend 1,000 USDC at 6% for 30 days",
    routingLabel: "Prepared peer-to-peer fixed-term offer",
    summaryLeft: "1,000.00 USDC · 6.00% APR",
    summaryRight: "30-day term",
    steps: [
      { num: "01", action: "Approve 1,000 USDC", detail: "Allowance for P2P Lending Market" },
      { num: "02", action: "Publish lending offer", detail: "Fixed rate locked onchain" },
    ],
    settlement: "Offer live on market · principal under your control",
  },
  {
    id: "bridge",
    tab: "Bridge",
    chainId: "base",
    chainName: "Base → Arc",
    prompt: "Bridge 250 USDC from Base to Arc",
    routingLabel: "Selected CCTP burn-and-mint route",
    summaryLeft: "250.00 USDC · Base (8453)",
    summaryRight: "Dest Arc (5042)",
    steps: [
      { num: "01", action: "Approve 250 USDC on Base", detail: "Allowance for TokenMessenger" },
      { num: "02", action: "Burn & attest to Arc", detail: "Native USDC minted on destination" },
    ],
    settlement: "250.00 native USDC delivered on Arc",
  },
];

// Animation phases:
// 0 = typing prompt
// 1 = routing / simulating
// 2 = plan ready (awaiting signature)
// 3 = step 1 signed
// 4 = step 2 signed & settled
type Phase = 0 | 1 | 2 | 3 | 4;

export default function LucaActionPreview() {
  const [scenarioIdx, setScenarioIdx] = useState(0);
  const [typedLen, setTypedLen] = useState(0);
  const [phase, setPhase] = useState<Phase>(0);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const timersRef = useRef<number[]>([]);

  const scenario = SCENARIOS[scenarioIdx];

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    timersRef.current.forEach((id) => window.clearTimeout(id));
    timersRef.current = [];

    if (reducedMotion) {
      setTypedLen(scenario.prompt.length);
      setPhase(4);
      return;
    }

    if (paused) return;

    setTypedLen(0);
    setPhase(0);

    const promptLen = scenario.prompt.length;
    const charMs = 28;

    for (let i = 1; i <= promptLen; i++) {
      const id = window.setTimeout(() => setTypedLen(i), i * charMs);
      timersRef.current.push(id);
    }

    const afterType = promptLen * charMs + 220;
    timersRef.current.push(window.setTimeout(() => setPhase(1), afterType));
    timersRef.current.push(window.setTimeout(() => setPhase(2), afterType + 850));
    timersRef.current.push(window.setTimeout(() => setPhase(3), afterType + 2150));
    timersRef.current.push(window.setTimeout(() => setPhase(4), afterType + 3100));
    timersRef.current.push(
      window.setTimeout(() => {
        setScenarioIdx((prev) => (prev + 1) % SCENARIOS.length);
      }, afterType + 5900),
    );

    return () => {
      timersRef.current.forEach((id) => window.clearTimeout(id));
      timersRef.current = [];
    };
  }, [scenarioIdx, paused, reducedMotion, scenario.prompt.length]);

  const selectScenario = (index: number) => {
    setPaused(false);
    setScenarioIdx(index);
  };

  const togglePause = () => {
    setPaused((p) => !p);
  };

  const displayedPrompt = scenario.prompt.slice(0, typedLen);

  return (
    <div className={s.wrap}>
      {/* Scenario Switcher */}
      <div className={s.topRow}>
        <div className={s.tabs} role="tablist" aria-label="Example Luca workflows">
          {SCENARIOS.map((item, idx) => {
            const active = idx === scenarioIdx;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={`${s.tab} ${active ? s.tabActive : ""}`}
                onClick={() => selectScenario(idx)}
              >
                {item.tab}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          className={s.playBtn}
          onClick={togglePause}
          aria-label={paused ? "Resume preview animation" : "Pause preview animation"}
          title={paused ? "Resume" : "Pause"}
        >
          {paused ? <LuPlay size={13} aria-hidden="true" /> : <LuPause size={13} aria-hidden="true" />}
        </button>
      </div>

      {/* Prompt Input Bar */}
      <div className={s.promptBox}>
        <div className={s.promptMeta}>
          <span className={s.promptTag}>INTENT</span>
          <span className={s.chainBadge}>
            <ChainIcon id={scenario.chainId} size={14} />
            {scenario.chainName}
          </span>
        </div>
        <div className={s.promptText} aria-live="polite">
          <span>{displayedPrompt}</span>
          {phase === 0 && !reducedMotion ? <span className={s.cursor} aria-hidden="true" /> : null}
        </div>
      </div>

      {/* Routing & Plan Stage */}
      <div className={s.stage}>
        <div className={`${s.routeRow} ${phase >= 1 ? s.visible : ""}`}>
          <span className={s.routeIcon}>
            {phase === 1 ? (
              <LuLoader size={14} className={s.spin} aria-hidden="true" />
            ) : (
              <LuShieldCheck size={14} aria-hidden="true" />
            )}
          </span>
          <span className={s.routeText}>
            {phase < 1
              ? "Waiting for command…"
              : phase === 1
                ? "Resolving tokens & simulating execution…"
                : scenario.routingLabel}
          </span>
        </div>

        {/* Deterministic Plan Card */}
        <div className={`${s.planCard} ${phase >= 2 ? s.planVisible : ""}`}>
          <div className={s.planSummary}>
            <strong>{scenario.summaryLeft}</strong>
            <span>{scenario.summaryRight}</span>
          </div>

          <ol className={s.steps}>
            {scenario.steps.map((step, idx) => {
              const done = (idx === 0 && phase >= 3) || (idx === 1 && phase >= 4);
              const signing = (idx === 0 && phase === 2) || (idx === 1 && phase === 3);
              return (
                <li
                  key={step.num}
                  className={`${s.stepRow} ${done ? s.stepDone : ""} ${signing ? s.stepActive : ""}`}
                >
                  <span className={s.stepBadge}>
                    {done ? <LuCheck size={12} aria-hidden="true" /> : step.num}
                  </span>
                  <div className={s.stepCopy}>
                    <strong>{step.action}</strong>
                    <span>{step.detail}</span>
                  </div>
                  <span className={s.stepState}>
                    {done ? "Signed" : signing ? "Signing…" : "Queued"}
                  </span>
                </li>
              );
            })}
          </ol>

          <div className={s.planFooter}>
            {phase >= 4 ? (
              <div className={s.settledBar}>
                <LuCheck size={14} aria-hidden="true" />
                <span>{scenario.settlement}</span>
              </div>
            ) : (
              <div className={s.signBar}>
                <span className={s.signHint}>
                  <LuWallet size={14} aria-hidden="true" />
                  Your wallet signs each step
                </span>
                <span className={`${s.signPill} ${phase === 2 || phase === 3 ? s.signPillActive : ""}`}>
                  {phase >= 3 ? "Confirming…" : "Approve & sign"}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer link to real Luca */}
      <div className={s.bottomBar}>
        <span className={s.bottomNote}>Simulated walkthrough · Same execution flow as the app</span>
        <a className={s.openLink} href={`${appUrl}/trade/agent`}>
          Try in Luca
          <LuArrowUpRight size={13} aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}
