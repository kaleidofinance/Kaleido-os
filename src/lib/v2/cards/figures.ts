import type { AgentSettings } from "@/hooks/v2/useAgentSettings";
import type { FaqFigure } from "@/lib/ai/faq";
import { formatBalance } from "@/utils/formatBalance";
import type { AgentCard } from "./types";

/**
 * Builds the live half of an FAQ answer's cards.
 *
 * faq.ts holds static prose with inline provenance; it cannot quote your own
 * settings or your remaining quota, and a lib that hardcoded either would go
 * stale silently — the exact failure that file is written to avoid. So a topic
 * names the figure it wants (`figure: "limits"`) and this turns that name into a
 * card from values read live.
 *
 * Everything here is pre-formatted to a string before it lands in a card, per
 * the contract in types.ts: the frame cannot know that 50 bps is a percentage,
 * or that a cap is dollars rather than tokens.
 *
 * No USD position sizes anywhere in this file. The limits card shows the *caps
 * you set*, which are configuration you typed, not what you hold — the standing
 * rule is about publishing what a wallet is worth, and a self-imposed ceiling
 * says nothing about the balance behind it.
 */

export interface FigureContext {
  settings: AgentSettings;
  /** Remaining model requests today, when known. Null while unmetered. */
  credits: { remaining: number; quota: number } | null;
}

export function figureCards(
  figure: FaqFigure,
  ctx: FigureContext,
): AgentCard[] {
  const { settings, credits } = ctx;

  switch (figure) {
    /* The delegation caps, as they stand on this device right now. Read from the
       same settings object the request body sends to the auditor, so what the
       card claims and what the server enforces cannot disagree. */
    case "limits":
      return [
        {
          kind: "stats",
          title: "Your current caps",
          rows: [
            {
              label: "Per action",
              value: `$${formatBalance(settings.maxPerAction, 0)}`,
            },
            {
              label: "Per day",
              value: `$${formatBalance(settings.maxPerDay, 0)}`,
            },
            {
              label: "Min health factor",
              value: settings.minHealthFactor.toFixed(2),
            },
            /* No tone on this row, and the label says "stop", not "sign".
               It used to read "Signature per step: Required / Off" with a warn
               tone on Off — three problems in one row. Nothing read the setting,
               so both values were claims about behaviour that did not exist; the
               label described the wallet's prompt, which no setting here can
               waive; and the warn tone framed a legitimate preference as a
               weakened guardrail. It now names what PlanReview actually does
               with it, and a preference gets no tone. */
            {
              label: "Stop between plan steps",
              value: settings.confirmEachStep ? "On" : "Off",
            },
          ],
        },
      ];

    /* The floor as one figure, because that is the number the answer is about.
       Tone is a reading of the value, not decoration: below 1.2 the margin is
       thin enough that a normal day's move can reach it. */
    case "healthFloor":
      return [
        {
          kind: "metric",
          label: "Your floor for Luca",
          value: settings.minHealthFactor.toFixed(2),
          note: "Luca won't propose a plan that would take you below this.",
          ...(settings.minHealthFactor < 1.2
            ? { delta: { value: "thin", tone: "warn" as const } }
            : {}),
        },
      ];

    case "slippage":
      return [
        {
          kind: "metric",
          label: "Your max slippage",
          value: (settings.slippageBps / 100).toFixed(2),
          unit: "%",
          note: "Applied to swaps Luca builds. Per-swap settings override it.",
        },
      ];

    /*
     * Quota, and honest when it is unknown.
     *
     * `credits === null` is not zero — it means no wallet is connected, or the
     * count has not come back yet. Rendering "0 left" for either would be a
     * frame around a number nobody measured, which is the one thing these cards
     * must never do.
     */
    case "credits": {
      if (!credits) {
        return [
          {
            kind: "notice",
            tone: "neutral",
            title: "Connect a wallet to see your remaining requests",
            body: "The quota is per wallet per day. Commands never count against it.",
          },
        ];
      }
      const delta =
        credits.remaining === 0
          ? { value: "spent", tone: "bad" as const }
          : credits.remaining <= 2
            ? { value: "low", tone: "warn" as const }
            : null;
      return [
        {
          kind: "metric",
          label: "Reasoning requests left today",
          value: String(credits.remaining),
          unit: `of ${credits.quota}`,
          ...(delta ? { delta } : {}),
          note: "Commands and these direct answers cost nothing.",
        },
      ];
    }
  }
}
