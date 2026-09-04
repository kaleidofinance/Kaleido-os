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
import { chainTokens } from "@/constants/tokens";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import Portal from "./Portal";
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
 * Every control here does something, which is worth stating because a panel of
 * this shape is usually half decorative. The caps, the health floor, the slippage
 * default and the action toggles are sent to /api/chat and enforced by the
 * server-side auditor (see lib/ai/auditor.ts, which takes the smaller of each and
 * its own ceiling). "Stop between steps" is read by PlanReview. The model choice
 * is re-checked against the server's allow-list. And "Delegate to an external
 * agent" builds a real `grantAgentPermission` intent and signs it through
 * PlanReview — the resolver is registered (intents/definitions.ts:927) and calls
 * AgentPermissionFacet, so the bounds it carries are enforced by the contract
 * rather than by anything on this device.
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

export default function AgentSettings({
  address,
  open,
  onClose,
}: AgentSettingsProps) {
  const { settings, update, toggleAction } = useAgentSettings(address);
  const { chainId } = useWalletV2();
  const [agentAddr, setAgentAddr] = useState("");
  const [grant, setGrant] = useState<Intent[] | null>(null);
  /**
   * The selectable models, from the server rather than a constant here.
   *
   * The browser cannot know which provider keys are configured, so a hardcoded
   * list would eventually offer a model the server has no entitlement for and
   * spend a metered request discovering it. An empty array is the correct
   * answer when no router key is set, and hides the section entirely.
   */
  const [models, setModels] = useState<{ id: string; label: string }[]>([]);

  useEffect(() => {
    if (!open) return;
    const ac = new AbortController();
    fetch("/api/chat", { signal: ac.signal })
      .then((r) => r.json())
      .then((d) => setModels(Array.isArray(d?.models) ? d.models : []))
      .catch(() => {});
    return () => ac.abort();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const diamond = envVars.lendbitDiamondAddress;
  const validAgent = isAddress(agentAddr);
  // The grant's token allow-list is chain-scoped: it names addresses on the
  // chain the user is signing from. Empty means nothing is deployed here, and
  // an empty allow-list is not something to sign — depending on how the facet
  // reads it, it is either a useless grant or an unbounded one.
  const grantable = chainTokens(chainId);

  const buildGrant = () => {
    if (!validAgent || !diamond || grantable.length === 0) return;
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
      tokens: grantable.map((t) => t.address),
    };
    setGrant([grantIntent]);
  };

  const num = (v: string) => {
    const n = parseFloat(v.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) ? n : 0;
  };

  return (
    <Portal>
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
              Limits Luca works within. It won&apos;t propose anything past
              these, and the protocol enforces them on the actions it drafts.
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
                onChange={(v) =>
                  update({ slippageBps: Math.round(num(v) * 100) })
                }
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
              <div className={s.sectionTitle}>Signing</div>
              <div className={s.toggleRow}>
                <span>Stop between steps</span>
                <button
                  className={`${s.toggle} ${settings.confirmEachStep ? s.toggleOn : ""}`}
                  onClick={() =>
                    update({ confirmEachStep: !settings.confirmEachStep })
                  }
                  role="switch"
                  aria-checked={settings.confirmEachStep}
                  aria-label="Stop between steps"
                >
                  <i />
                </button>
              </div>
              {/* Says what the toggle does not do, because the name invites the
                  stronger reading. Nothing here can waive a wallet prompt, and a
                  panel that let someone believe otherwise would be worse than one
                  with no switch at all. */}
              <p className={s.note}>
                A plan Luca drafts hands control back after each step, so you can
                stop part-way with the earlier steps already settled. Either way
                every step is its own signature in your wallet — that isn&apos;t
                ours to switch off.
              </p>
            </section>

            {/* Hidden entirely when the server offers nothing — an empty picker
                would imply a choice exists where none does. */}
            {models.length > 0 && (
              <section className={s.section}>
                <div className={s.sectionTitle}>Model</div>
                <div className={s.models}>
                  <button
                    className={`${s.model} ${!settings.model ? s.modelOn : ""}`}
                    onClick={() => update({ model: undefined })}
                    aria-pressed={!settings.model}
                  >
                    <span className={s.modelName}>Automatic</span>
                    <span className={s.modelMeta}>Server default</span>
                  </button>
                  {models.map((m) => (
                    <button
                      key={m.id}
                      className={`${s.model} ${settings.model === m.id ? s.modelOn : ""}`}
                      onClick={() => update({ model: m.id })}
                      aria-pressed={settings.model === m.id}
                    >
                      <span className={s.modelName}>{m.label}</span>
                      <span className={s.modelMeta}>{m.id}</span>
                    </button>
                  ))}
                </div>
                <p className={s.note}>
                  Applies to reasoning turns only. Direct commands like{" "}
                  <code>swap 500 USDC to KLD</code> are parsed on this device,
                  cost nothing and don&apos;t use a model.
                </p>
              </section>
            )}

            <section className={s.section}>
              <div className={s.sectionTitle}>
                Delegate to an external agent
              </div>
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
                      Grant a bounded, revocable on-chain permission so an SDK-
                      or MCP-connected agent acts within the limits above —
                      without you signing each step. Uses your spending caps,
                      health floor and allowed actions.
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
                      disabled={
                        !validAgent || !diamond || grantable.length === 0
                      }
                      onClick={buildGrant}
                    >
                      Review delegation
                    </button>
                    <p className={s.delegateNote}>
                      {grantable.length === 0
                        ? "Kaleido carries no tokens on this network, so there's nothing to delegate authority over."
                        : "Enforced on-chain by the agent-permission facet. Revoke any time; the budget resets per day."}
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
    </Portal>
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
