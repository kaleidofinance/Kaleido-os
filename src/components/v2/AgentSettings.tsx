"use client";

import { useEffect } from "react";
import {
  useAgentSettings,
  type AgentAction,
} from "@/hooks/v2/useAgentSettings";
import s from "./AgentSettings.module.css";

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

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

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
              <p className={s.delegateBody}>
                Grant a bounded, revocable on-chain permission so an SDK- or
                MCP-connected agent can act within these same limits without you
                signing each step.
              </p>
              <button className={s.delegateBtn} disabled>
                Coming soon
              </button>
              <p className={s.delegateNote}>
                Enforced by the protocol&apos;s agent-permission facet. Not yet
                callable from this interface.
              </p>
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
