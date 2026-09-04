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
   * Stop between the steps of a plan Luca built, instead of running it through.
   *
   * NOT a switch on signing. Every step is a separate wallet signature whichever
   * way this sits — the wallet owns that prompt and the app cannot waive it, and
   * a setting that appeared to would be the worst kind of guardrail. What it
   * controls is PlanReview's own confirmation between steps: on, a four-step plan
   * hands control back after each one, so it can be abandoned after the second
   * with the first two settled; off, the wallet prompts arrive back to back.
   *
   * Read by the agent panel only. A swap's approve+swap is two steps of one thing
   * the user just filled in a form for, and this setting is about the agent.
   */
  confirmEachStep: boolean;
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
  confirmEachStep: true,
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
        setSettings({
          ...DEFAULT_AGENT_SETTINGS,
          ...parsed,
          allowedActions: {
            ...DEFAULT_AGENT_SETTINGS.allowedActions,
            ...(parsed.allowedActions ?? {}),
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
