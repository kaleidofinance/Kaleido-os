"use client";

import { useEffect, useState } from "react";
import { isAddress } from "ethers";
import {
  useAgentSettings,
  type AgentAction,
} from "@/hooks/v2/useAgentSettings";
import PlanReview from "@/components/v2/PlanReview";
import { AGENT_ACTIONS, type Intent } from "@/lib/v2/intents";
import { envVars } from "@/constants/envVars";
import { ABSTRACT_TOKENS } from "@/constants/tokens";
import s from "./AgentSettings.module.css";

/** Maps the settings' action toggles onto the facet's on-chain bitmask. */
const ACTION_BITS: Record<AgentAction, number> = {
  borrow: AGENT_ACTIONS.BORROW,
  lend: AGENT_ACTIONS.LEND,
  stake: AGENT_ACTIONS.DEPOSIT_COLLATERAL,
  swap: AGENT_ACTIONS.WITHDRAW_COLLATERAL,
  provideLiquidity: AGENT_ACTIONS.DEPOSIT_COLLATERAL,
};

/**
 * Agent settings panel — the guardrails on Luca, plus the on-chain delegation
 * surface for external agents.
 *
 * The limits/actions/slippage here are the off-chain guardrails (persisted per
 * address, fed to /api/chat). The "Delegate to an agent" section is the
 * on-chain grant — bounded authority for an autonomous or SDK-connected agent —
 * which maps to AgentPermissionFacet but isn't callable from the frontend yet,
 * so it's shown and honestly disabled.
 */
interface AgentSettingsProps {
  address?: string;
  open: boolean;
  onClose: () => void;
}

const ACTION_LABELS: Record<AgentAction, string> = {
  swap: "Swap",
  borrow: "Borrow",
  lend: "Lend",
  stake: "Stake",
  provideLiquidity: "Provide liquidity",
};

export default function AgentSettings({ address, open, onClose }: AgentSettingsProps) {
  const { settings, update, toggleAction } = useAgentSettings(address);
  const [agentAddr, setAgentAddr] = useState("");
  const [grant, setGrant] = useState<Intent[] | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const diamond = envVars.lendbitDiamondAddress;
  const validAgent = isAddress(agentAddr);

  const buildGrant = () => {
    if (!validAgent || !diamond) return;
    // Bitmask from the enabled action toggles.
    let bits = 0;
    (Object.keys(settings.allowedActions) as AgentAction[]).forEach((a) => {
      if (settings.allowedActions[a]) bits |= ACTION_BITS[a];
    });
    const grantIntent: Intent = {
      kind: "grantAgentPermission",
      diamond,
      agent: agentAddr,
      maxNotionalPerAction: String(settings.maxPerAction),
      maxNotionalPerEpoch: String(settings.maxPerDay),
      epochDurationSec: 86_400, // one day, matching "max per day"
      expiryUnix: Math.floor(Date.now() / 1000) + 30 * 86_400, // 30-day grant
      maxInterestBps: 0, // no rate cap by default
      minHealthFactorBps: Math.round(settings.minHealthFactor * 10_000),
      allowedActions: bits,
      tokens: ABSTRACT_TOKENS.map((t) => t.address),
    };
    setGrant([grantIntent]);
  };

  const num = (v: string) => {
    const n = parseFloat(v.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) ? n : 0;
  };

  return (
    <div className={s.overlay} onClick={onClose} role="presentation">
      <div
        className={s.modal}
        role="dialog"
        aria-modal="true"
        aria-label="Agent settings"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={s.head}>
          <span className={s.title}>Agent settings</span>
          <button className={s.x} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className={s.body}>
          <p className={s.lede}>
            Limits Luca works within. It won&apos;t propose anything past these,
            and the protocol enforces them on the actions it drafts.
          </p>

          <section className={s.section}>
            <div className={s.sectionTitle}>Spending limits</div>
            <Field
              label="Max per action"
              suffix="USD"
              value={settings.maxPerAction}
              onChange={(v) => update({ maxPerAction: num(v) })}
            />
            <Field
              label="Max per day"
              suffix="USD"
              value={settings.maxPerDay}
              onChange={(v) => update({ maxPerDay: num(v) })}
            />
          </section>

          <section className={s.section}>
            <div className={s.sectionTitle}>Risk</div>
            <Field
              label="Never drop health factor below"
              value={settings.minHealthFactor}
              step="0.05"
              onChange={(v) => update({ minHealthFactor: num(v) })}
            />
            <Field
              label="Default max slippage"
              suffix="%"
              value={settings.slippageBps / 100}
              step="0.1"
              onChange={(v) => update({ slippageBps: Math.round(num(v) * 100) })}
            />
          </section>

          <section className={s.section}>
            <div className={s.sectionTitle}>Allowed actions</div>
            {(Object.keys(ACTION_LABELS) as AgentAction[]).map((a) => (
              <div key={a} className={s.toggleRow}>
                <span>{ACTION_LABELS[a]}</span>
                <button
                  className={`${s.toggle} ${settings.allowedActions[a] ? s.toggleOn : ""}`}
                  onClick={() => toggleAction(a)}
                  role="switch"
                  aria-checked={settings.allowedActions[a]}
                  aria-label={ACTION_LABELS[a]}
                >
                  <i />
                </button>
              </div>
            ))}
          </section>

          <section className={s.section}>
            <div className={s.sectionTitle}>Delegate to an external agent</div>
            <div className={s.delegate}>
              {grant ? (
                <PlanReview
                  intents={grant}
                  submitLabel="Grant permission"
                  onComplete={() => setGrant(null)}
                  onCancel={() => setGrant(null)}
                />
              ) : (
                <>
                  <p className={s.delegateBody}>
                    Grant a bounded, revocable on-chain permission so an SDK- or
                    MCP-connected agent acts within the limits above — without you
                    signing each step. Uses your spending caps, health floor and
                    allowed actions.
                  </p>
                  <input
                    className={s.delegateInput}
                    placeholder="Agent wallet address (0x…)"
                    value={agentAddr}
                    onChange={(e) => setAgentAddr(e.target.value.trim())}
                    aria-label="Agent address"
                  />
                  <button
                    className={s.delegateBtn}
                    disabled={!validAgent || !diamond}
                    onClick={buildGrant}
                  >
                    Review delegation
                  </button>
                  <p className={s.delegateNote}>
                    Enforced on-chain by the agent-permission facet. Revoke any
                    time; the budget resets per day.
                  </p>
                </>
              )}
            </div>
          </section>
        </div>

        <div className={s.footer}>
          <button className={s.done} onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  suffix,
  step,
}: {
  label: string;
  value: number;
  onChange: (v: string) => void;
  suffix?: string;
  step?: string;
}) {
  return (
    <label className={s.field}>
      <span className={s.fieldLabel}>{label}</span>
      <span className={s.fieldInput}>
        <input
          inputMode="decimal"
          value={String(value)}
          step={step}
          onChange={(e) => onChange(e.target.value)}
          className="tabular"
        />
        {suffix && <span className={s.fieldSuffix}>{suffix}</span>}
      </span>
    </label>
  );
}
