/**
 * FAQ deflection — the third local-first path, alongside command parsing.
 *
 * fromCommand.ts handles "do this now" (a stated action). This handles "what
 * is this" (a conceptual question about the product). Both exist for the same
 * reason: a fixed, known answer shouldn't cost a model call. The difference is
 * what happens on a miss — a command that doesn't parse is unusual enough to
 * be worth asking about; a question that doesn't match a topic is completely
 * normal (most real questions are genuinely open-ended), so a miss here is
 * silent and falls straight through to the model. This module is a net that
 * catches the common, static, already-answered questions — not a chatbot.
 *
 * Matching is substring-on-trigger-phrase, not fuzzy or embedding-based, for
 * the same reason fromCommand.ts avoids fuzzy verb matching: a wrong action
 * from a near-miss is expensive, and here a wrong-topic answer is actively
 * misleading (stating the swap fee where the user asked about the mint fee).
 * A near-miss should reach the model, which can actually reason about it,
 * rather than confidently answer the wrong fixed paragraph.
 *
 * Every answer below is sourced from a specific place in this codebase or its
 * docs, noted inline — not general DeFi knowledge. If the number cited there
 * ever changes, this file goes stale exactly where the comment says, which is
 * the whole point of writing it that way.
 */

export interface FaqTopic {
  id: string;
  /** Lowercase phrases. A longer trigger beats a shorter one on overlap, so
   * "health factor" outranks a topic that only matched on "factor". */
  triggers: string[];
  answer: string;
}

export const FAQ_TOPICS: FaqTopic[] = [
  {
    id: "health-factor",
    triggers: ["health factor", "healthfactor", "liquidation", "get liquidated"],
    answer:
      "Your health factor is the ratio of your collateral's value to what you've borrowed. Above 1.0 you're solvent; at or below it, your collateral can be liquidated. Agent Settings defaults to a 1.4 floor for anything Luca proposes on your behalf — that's a safety margin you set, not a protocol minimum, and you can tighten or loosen it there.",
  },
  {
    id: "points",
    triggers: ["points system", "how do points work", "point system", "leaderboard", "airdrop"],
    answer:
      "The original points system undercounted or overcounted in several ways — it read localStorage for AI usage, scored raw token amounts instead of USD value, and computed everything client-side — so writes to it are now locked down at the database level. A replacement (server-verified, time-weighted, receipt-anchored) is specified but not yet built. Treat any point total you see today as Season 0 participation evidence, not a balance you can rely on.",
  },
  {
    id: "kfusd",
    triggers: ["what is kfusd", "kfusd stablecoin", "how does kfusd work", "mint kfusd"],
    answer:
      "kfUSD is Kaleido's stablecoin, minted 1:1 against USDC, USDT, or USDe collateral and redeemable back the same way. It's backed by whatever collateral is deposited, part of which is deployed to yield sources — that yield is what funds the kafUSD vault.",
  },
  {
    id: "kafusd",
    triggers: ["what is kafusd", "yield vault", "how does the vault work", "kafusd"],
    answer:
      "kafUSD is the yield-bearing wrapper around kfUSD — lock kfUSD in and you receive kafUSD 1:1. Exiting isn't a single call: you request a withdrawal, wait out a cooldown, then complete it for your chosen output token. Yield comes from lending and pool fees; there's no fixed APY promised.",
  },
  {
    id: "staking",
    triggers: ["stkld", "how does staking work", "liquid staking", "stake kld"],
    answer:
      "Staking KLD mints stKLD, a liquid derivative. There's no advertised APY — the yield shows up as stKLD appreciating against KLD over time as rewards accrue, so the exchange rate is the number that matters, not a percentage.",
  },
  {
    id: "agent-permission",
    triggers: [
      "agent permission",
      "what can luca do",
      "delegate to luca",
      "luca sign for me",
      "grant permission",
    ],
    answer:
      "By default Luca only builds plans for you to review and sign yourself — nothing executes without your signature. Delegating further (letting Luca sign on your behalf) is a separate, explicit step in Agent Settings: you sign an on-chain grant that caps the per-action and per-day USD amount, sets a minimum health factor Luca must respect, and expires after 30 days. It's revocable any time, and the contract enforces the cap — not the app.",
  },
  {
    id: "slippage",
    triggers: ["what is slippage", "slippage tolerance", "max slippage"],
    answer:
      "Slippage is how far the price can move between when you submit a swap and when it executes before the transaction reverts instead of filling at a worse rate. The default here is Auto, currently 0.50%, and it's adjustable per-swap in settings.",
  },
  {
    id: "chains",
    triggers: ["multichain", "which chains", "cross chain", "other networks", "what chains"],
    answer:
      "Kaleido's contracts are being redeployed from scratch after a rewrite, so there is no chain you can trade on right now — including Abstract, which was the old home chain and is no longer a priority. The rollout is testnet first, then mainnet, in this order: Arc, Base, Robinhood Chain, BNB Smart Chain, Ethereum. Until then the wallet can still switch networks and show your balances across all of them, which is portfolio viewing only.",
  },
  {
    id: "model-credits",
    triggers: [
      "reasoning request",
      "model credit",
      "how many requests",
      "run out of credits",
      "quota",
    ],
    answer:
      "Reasoning requests (turns that need the AI model, not a stated command) are rationed per wallet per day — that limit exists to protect the shared model bill, not to restrict your trading. A command like \"swap 500 USDC to KLD\" is parsed locally and never touches that quota, so you can keep trading even after it's used up for the day.",
  },
  {
    id: "audit-status",
    triggers: ["is this audited", "is it safe", "security audit", "has this been tested"],
    answer:
      "A security pass has been done on the stablecoin contracts and the critical issues it found were fixed, but full yield-calculation testing is still pending live verification on testnet as of the last status update — it's not a completed, independent third-party audit. Worth keeping in mind before moving size.",
  },
];

export function matchFaq(text: string): FaqTopic | null {
  const t = text.toLowerCase();
  let best: { topic: FaqTopic; len: number } | null = null;

  for (const topic of FAQ_TOPICS) {
    for (const trigger of topic.triggers) {
      if (t.includes(trigger) && (!best || trigger.length > best.len)) {
        best = { topic, len: trigger.length };
      }
    }
  }

  return best?.topic ?? null;
}
