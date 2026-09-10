"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Agent settings — the guardrails a user sets on Luca.
 *
 * Two audiences, one shape:
 *   1. Luca reads them to shape what it proposes (never suggest past a cap).
 *   2. They're sent to /api/chat so the server-side auditor gate can *enforce*
 *      them — right now that gate is a hardcoded `amount > 1000`; these make it
 *      user-controlled.
 *
 * Persisted to localStorage per address so they survive reloads. This is the
 * off-chain half. The on-chain half — delegating bounded authority to an
 * external/autonomous agent address via AgentPermissionFacet.grantAgentPermission
 * — is a separate, stronger mechanism that isn't in the frontend ABI yet.
 */

export type AgentAction =
  | "swap"
  | "borrow"
  | "lend"
  | "stake"
  | "provideLiquidity";

/** See AgentSettings.stepMode. */
export type StepMode = "manual" | "auto" | "agent";

export interface AgentSettings {
  /** Max USD value Luca may propose for a single action. Mirrors the auditor gate. */
  maxPerAction: number;
  /** Max USD value across a rolling day. */
  maxPerDay: number;
  /** Health factor Luca must never take you below. */
  minHealthFactor: number;
  /** Default max slippage (bps) for agent-proposed swaps. */
  slippageBps: number;
  /** Which products Luca may act in. */
  allowedActions: Record<AgentAction, boolean>;
  /**
   * How much the agent does between your signatures.
   *
   * Replaced a `confirmEachStep` boolean, which was too blunt in one direction
   * and misleading in the other. What it gates is THIS APP'S pause, never the
   * wallet's prompt: every step is its own signature under all three modes, and
   * that is not ours to switch off.
   *
   *   manual  Pause after every step. A four-step plan can be abandoned after
   *           the second with the first two already settled.
   *   auto    Run the plan through. The wallet still prompts per step, so
   *           declining one is still how you stop - this removes an extra
   *           click, not a checkpoint.
   *   agent   The on-chain mandate acts without you, inside bounds you signed
   *           (AgentPermissionFacet). NOT a preference this panel can grant:
   *           selecting it opens the delegation flow, and it stays selected
   *           only while a mandate exists. Lending actions only - swaps,
   *           liquidity, staking and minting have no bit and never will.
   */
  stepMode: StepMode;
  /**
   * Preferred model id, or undefined to let the server choose.
   *
   * A preference, not an instruction: the server re-checks it against its own
   * allow-list, so a stale id left here by a catalogue change is ignored rather
   * than forwarded. Undefined is the honest default — the browser cannot know
   * which keys are configured, and naming a model it has no entitlement for
   * would spend a metered request to find out.
   */
  model?: string;
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  maxPerAction: 1000,
  maxPerDay: 5000,
  minHealthFactor: 1.4,
  slippageBps: 50,
  allowedActions: {
    swap: true,
    borrow: true,
    lend: true,
    stake: true,
    provideLiquidity: false,
  },
  /* Auto, where the boolean defaulted to pausing. The pause was an app-level
     click on top of a wallet prompt that already asks, and testers reported the
     agent as slow. Declining the next prompt is still how a plan is stopped. */
  stepMode: "auto",
};

/** Clears the stored preference back to "let the server choose". */
export const DEFAULT_MODEL = "";

const key = (address?: string) =>
  `kaleido.v2.agentSettings.${address ?? "anon"}`;

export function useAgentSettings(address?: string) {
  const [settings, setSettings] = useState<AgentSettings>(
    DEFAULT_AGENT_SETTINGS,
  );
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key(address));
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<AgentSettings>;
        /*
         * A stored `confirmEachStep` predates stepMode and must not be dropped:
         * someone who deliberately asked to stop between steps would silently
         * be moved to auto by the new default, which is the one direction this
         * migration must not go. Only honoured when stepMode is absent, so it
         * cannot override a mode the user has since chosen, and `agent` is
         * never inferred - that one requires an on-chain grant.
         */
        const legacy = (parsed as { confirmEachStep?: boolean }).confirmEachStep;
        const migrated: Partial<AgentSettings> =
          parsed.stepMode === undefined && typeof legacy === "boolean"
            ? { ...parsed, stepMode: legacy ? "manual" : "auto" }
            : parsed;
        setSettings({
          ...DEFAULT_AGENT_SETTINGS,
          ...migrated,
          allowedActions: {
            ...DEFAULT_AGENT_SETTINGS.allowedActions,
            ...(migrated.allowedActions ?? {}),
          },
        });
      } else {
        setSettings(DEFAULT_AGENT_SETTINGS);
      }
    } catch {
      setSettings(DEFAULT_AGENT_SETTINGS);
    }
    setLoaded(true);
  }, [address]);

  const update = useCallback(
    (patch: Partial<AgentSettings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...patch };
        try {
          localStorage.setItem(key(address), JSON.stringify(next));
        } catch {
          /* storage full or unavailable — settings stay in-memory */
        }
        return next;
      });
    },
    [address],
  );

  const toggleAction = useCallback(
    (action: AgentAction) => {
      setSettings((prev) => {
        const next = {
          ...prev,
          allowedActions: {
            ...prev.allowedActions,
            [action]: !prev.allowedActions[action],
          },
        };
        try {
          localStorage.setItem(key(address), JSON.stringify(next));
        } catch {
          /* noop */
        }
        return next;
      });
    },
    [address],
  );

  return { settings, update, toggleAction, loaded };
}
