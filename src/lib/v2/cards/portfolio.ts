import type { Portfolio } from "@/hooks/usePortfolio";
import { DASH, usd } from "@/lib/format/figures";
import type { AgentCard, CardTone, GaugeCard } from "./types";

/**
 * "What are my balances" — answered from the app's own portfolio, not the model.
 *
 * WHY THIS IS LOCAL AT ALL
 *
 * The model has a `getPortfolio` tool, so this could have been left to it. Two
 * reasons it is here instead. The cheap one: it was the single most-asked question
 * with no local answer, and every asking spent one of a wallet's 25 daily
 * reasoning requests to read data the browser was already holding. The real one:
 * `getPortfolio` returns collateral and health only (see planDeps.ts), while
 * `usePortfolio` stitches wallet balances, lending, borrowing, the stable vaults
 * and liquidity into one net figure — the same hook /portfolio renders. So the
 * local answer is not a degraded version of the model's. It is the complete one,
 * and it cannot disagree with the page.
 *
 * PURE, AND HERE RATHER THAN IN THE PAGE
 *
 * Takes a `Portfolio` and returns prose plus cards, so a test can assert what a
 * given position produces without mounting seven hooks and a wallet. The page
 * supplies the data and does the talking.
 *
 * NULL IS NOT ZERO, AND THAT SURVIVES INTO THE PROSE
 *
 * usePortfolio's contract is that an unpriced holding keeps its amount and
 * reports `valueUsd: null`, because summing it as zero would understate a
 * portfolio while looking like a measurement. The same rule applies to the
 * sentence at the top: a null net value is never written as "$0.00", and a
 * partial one says what it left out. KLD has no price feed, and KLD is the token
 * every invited tester holds first — so the state where the total is real but
 * incomplete is the common state here, not an edge case.
 */

export interface PortfolioAnswer {
  text: string;
  cards: AgentCard[];
}

/** Rows in a balance card, per the validator in fromChat.ts. */
const MAX_ROWS = 8;

/** Same bands as the health-factor FAQ card, so the two cannot drift apart. */
const healthTone = (h: number | null): CardTone =>
  h === null ? "neutral" : h <= 1 ? "bad" : h <= 1.4 ? "warn" : "good";

/** Matches /portfolio's own header: ∞ where there is no debt to divide by. */
const healthText = (h: number | null): string =>
  h === null ? DASH : h === Infinity ? "∞" : h.toFixed(2);

/**
 * Health as a gauge — full and green when safe, a red sliver near liquidation.
 *
 * The track is a reading, not a scale: 1.0 (liquidation) sits at empty, 3.0 at
 * full, and anything above 3 is simply full — past there the exact number stops
 * being the thing you act on. `fraction` is that mapping; the number the reader
 * reads is `value`, and the tone is the same `healthTone` the FAQ card and
 * /portfolio use, so the bar and the figure can never disagree.
 *
 * Only ever built when there is debt, so `h` is a finite number here — a wallet
 * with no loan has health ∞, which is not a reading a gauge can place.
 */
function healthGauge(h: number | null): GaugeCard {
  const known = typeof h === "number" && Number.isFinite(h);
  return {
    kind: "gauge",
    label: "Health factor",
    value: healthText(h),
    /* (h − 1) / 2: 1.0 → 0, 3.0 → 1, clamped. */
    fraction: known ? Math.min(1, Math.max(0, (h! - 1) / 2)) : 0,
    tone: healthTone(h),
    min: "1.0",
    max: "3.0+",
    note:
      known && h! <= 1.4
        ? "Below 1.0 your collateral can be liquidated. Add collateral or repay to lift it."
        : "Above 1.0 you are solvent; higher is safer.",
  };
}

const positive = (n: number | null): boolean => typeof n === "number" && n > 0;

/** The prompt the empty state offers, which is also the answer to "no gas". */
const FAUCET_PROMPT = "claim everything from the faucet";

/**
 * A question about the reader's OWN health factor, as opposed to the concept.
 *
 * "what is health factor" wants the definition — the static FAQ answers it well
 * and cheaply. "what is MY health factor", "am I safe", "will I get liquidated"
 * want the live number, which the FAQ cannot know. This is the split, and it is
 * deliberately two conditions: a health/liquidation/safety term AND a personal
 * marker. The personal marker is what keeps the definitional question on the FAQ,
 * and the topic term is what keeps "is my swap safe" or "my balance" off this
 * path — a personal sentence with no health word is not a health question.
 */
export function isPersonalHealthQuestion(text: string): boolean {
  const t = ` ${text.toLowerCase()} `;
  const personal =
    /\bmy\b|\bam i\b|\bi'?m\b|\bwill i\b|\bcan i\b|\bi get\b|\bi be\b/.test(t);
  if (!personal) return false;
  return /health\s*factor|\bhealth\b|liquidat|\bhf\b|under\s?water|\bsafe\b/.test(
    t,
  );
}

export function portfolioAnswer(
  p: Portfolio,
  opts: { connected: boolean },
): PortfolioAnswer {
  if (!opts.connected) {
    return {
      text: "A portfolio is read off an address, and there isn't one connected yet. Connect a wallet — the button is top right — and ask me again.",
      cards: [],
    };
  }

  /*
   * Empty means every group returned no rows, which is a measurement rather than
   * a failure — and for an invited tester on their first minute it is the
   * expected one. So it gets the funding answer instead of a table of zeros, in
   * the same order the docs put it: gas from outside first, everything else in
   * one claim.
   */
  if (p.groups.every((g) => g.rows.length === 0)) {
    return {
      text: "Nothing yet — no balances, no collateral, no debt, no positions. Funding is two steps and only the first happens off Kaleido: the chain's own gas token has to come from that network's public faucet, because claiming from ours is itself a transaction. Once you have gas, everything else comes in one claim.",
      cards: [
        {
          kind: "actions",
          title: "Get funded",
          actions: [
            { label: "Claim testnet tokens", prompt: FAUCET_PROMPT },
            { label: "Then one swap", prompt: "swap 500 USDC to EURC" },
          ],
        },
      ],
    };
  }

  /* What every subtotal left out, named. `netValuePartial` is the flag; this is
     the list behind it, and it is why the metric carries a note. */
  const unpriced = [...new Set(p.groups.flatMap((g) => g.unpriced))];
  const unpricedNote =
    p.netValuePartial && unpriced.length
      ? `A floor, not a total — ${unpriced.slice(0, 3).join(", ")}${unpriced.length > 3 ? ` and ${unpriced.length - 3} more` : ""} have no price feed to sum.`
      : null;

  const lines: string[] = [];
  if (p.netValue === null) {
    lines.push(
      "I can see your positions, but nothing in them has a price feed I can sum — so there is no total to give you. The amounts below are exact.",
    );
  } else {
    lines.push(`${usd(p.netValue, 2)} net across everything I can see.`);
  }
  if (positive(p.debtUsd)) {
    lines.push(
      `${usd(p.debtUsd, 2)} borrowed against ${usd(p.collateralUsd, 2)} of collateral, health factor ${healthText(p.health)} — above 1.0 you are solvent.`,
    );
  }
  if (positive(p.unclaimedYieldUsd)) {
    lines.push(
      `${usd(p.unclaimedYieldUsd, 2)} of yield is sitting unclaimed. Say "claim yield" and I will build it.`,
    );
  }

  const cards: AgentCard[] = [
    /*
     * With a loan open, health is the headline risk, so it leads as a gauge
     * rather than a stat — and it takes the first card from the net-value metric,
     * which the prose above already opens with, to stay inside the three-card
     * budget the validator enforces. With no debt there is nothing for a health
     * gauge to place (health is ∞), so the net figure keeps the slot.
     */
    positive(p.debtUsd)
      ? healthGauge(p.health)
      : {
          kind: "metric",
          label: "Net value",
          value: usd(p.netValue, 2),
          ...(unpricedNote ? { note: unpricedNote } : {}),
        },
  ];

  /*
   * The five subtotals, in the hook's order, which is /portfolio's order. Health
   * is no longer one of them: it is the gauge above when there is a loan to
   * describe, and ∞ — a number answering a question nobody asked — when there is
   * not.
   */
  const rows: { label: string; value: string; tone?: CardTone }[] =
    p.groups.map((g) => ({ label: g.title, value: usd(g.subtotalUsd, 2) }));
  cards.push({ kind: "stats", title: "Positions", rows });

  /*
   * The wallet itself, as amounts rather than dollars, because "what are my
   * balances" is asking for the quantities. Largest first, and if there are more
   * than the card can hold the title says so — the validator truncates silently
   * past MAX_ROWS, and a list that has quietly dropped a holding is a wrong
   * answer wearing the shape of a complete one.
   */
  const wallet = p.groups.find((g) => g.id === "wallet");
  if (wallet?.rows.length) {
    const sorted = [...wallet.rows].sort(
      (a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1),
    );
    const shown = sorted.slice(0, MAX_ROWS);
    cards.push({
      kind: "balance",
      title:
        sorted.length > shown.length
          ? `Wallet — largest ${shown.length} of ${sorted.length}`
          : "Wallet",
      rows: shown.map((r) => ({
        symbol: r.label,
        amount: r.amount ?? DASH,
        /* An em dash alone in this slot reads as a loading state. The row is
           real and its amount is exact; it is the dollar figure that does not
           exist, so the note says which. */
        note: r.valueUsd === null ? "no price feed" : usd(r.valueUsd, 2),
      })),
    });
  }

  return { text: lines.join("\n\n"), cards };
}

/**
 * "What's my health factor" — the live number as a gauge, not the definition.
 *
 * The focused sibling of portfolioAnswer: it answers only the health question,
 * so it renders one card (the gauge) rather than the whole balance sheet. The
 * FAQ still owns "what IS health factor"; this owns the possessive form, routed
 * to by isPersonalHealthQuestion.
 *
 * Every not-a-number case is stated rather than drawn — a gauge is only built
 * for a real reading. No wallet, no read, and no loan are three different facts
 * and each gets its own sentence; an ∞ health factor in particular is not a
 * failure to report but the correct answer to "am I safe" with nothing borrowed.
 */
export function healthAnswer(
  p: Portfolio,
  opts: { connected: boolean },
): PortfolioAnswer {
  if (!opts.connected) {
    return {
      text: "Health factor is read off your positions, and there's no wallet connected yet. Connect one — the button is top right — and ask me again.",
      cards: [],
    };
  }
  const h = p.health;
  if (h === null) {
    return {
      text: "I couldn't read your health factor just now — the position read didn't come back. Try again in a moment.",
      cards: [],
    };
  }
  if (h === Infinity || !positive(p.debtUsd)) {
    return {
      text: "You have no loan open, so there's nothing that can be liquidated — your health factor is effectively infinite. It becomes a number to watch once you borrow against collateral.",
      cards: [],
    };
  }
  /* A live number, so the gauge draws. The sentence names the same reading the
     gauge's tone shows, in the same three bands, so the two cannot disagree. */
  const verdict =
    h <= 1
      ? "at or below 1.0, your collateral can be liquidated — add collateral or repay to lift it"
      : h <= 1.4
        ? "thin — a normal day's move could bring it toward 1.0"
        : "comfortable — well above the 1.0 line where liquidation begins";
  return {
    text: `Your health factor is ${healthText(h)} — ${verdict}.`,
    cards: [healthGauge(h)],
  };
}
