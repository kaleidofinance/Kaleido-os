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

import type { AgentCard } from "@/lib/v2/cards/types";

/**
 * A live figure a topic wants beside its answer, filled in by the caller.
 *
 * Declared here rather than built here on purpose: this file is static data with
 * inline provenance, and a card holding the user's own settings or their
 * remaining quota is neither static nor knowable from a lib. The topic names the
 * figure; the page, which has the hooks, supplies it. That keeps the "goes stale
 * exactly where the comment says" property intact — a topic asking for `limits`
 * cannot quote a default that has drifted from the real one.
 */
export type FaqFigure = "limits" | "healthFloor" | "slippage" | "credits";

export interface FaqTopic {
  id: string;
  /** Lowercase phrases. A longer trigger beats a shorter one on overlap, so
   * "health factor" outranks a topic that only matched on "factor". */
  triggers: string[];
  answer: string;
  /**
   * Frames rendered under the answer. Static facts only — the rollout order, a
   * standing caveat — because anything user-specific belongs in `figure`.
   */
  cards?: AgentCard[];
  /** One live figure to render as a card alongside `cards`. */
  figure?: FaqFigure;
}

export const FAQ_TOPICS: FaqTopic[] = [
  {
    id: "health-factor",
    triggers: [
      "health factor",
      "healthfactor",
      "liquidation",
      "get liquidated",
    ],
    answer:
      "Your health factor is the ratio of your collateral's value to what you've borrowed. Above 1.0 you're solvent; at or below it, your collateral can be liquidated. Agent Settings defaults to a 1.4 floor for anything Luca proposes on your behalf — that's a safety margin you set, not a protocol minimum, and you can tighten or loosen it there.",
    /* The thresholds as a table, because the answer is three bands and a
       sentence makes you hold all three in your head to compare them. */
    cards: [
      {
        kind: "stats",
        title: "Health factor bands",
        rows: [
          { label: "Liquidatable", value: "at or below 1.0", tone: "bad" },
          { label: "Thin", value: "1.0 – 1.4", tone: "warn" },
          { label: "Comfortable", value: "above 1.4", tone: "good" },
        ],
      },
    ],
    figure: "healthFloor",
  },
  {
    /*
     * The first question an invited tester has, and the only one whose answer is
     * not guessable: funding is two steps and the first one happens off Kaleido.
     * Sourced from docs/product/getting-started.md, "Gas comes first, and it has
     * to come from outside" — which is the canonical version of this paragraph.
     */
    id: "test-funds",
    triggers: [
      "get test tokens",
      "get testnet tokens",
      "get some test",
      "test tokens",
      "testnet funds",
      "how do i get funds",
      "how do i get gas",
      "where do i get gas",
      "no eth for gas",
      "no gas",
      "out of gas",
      "why is my balance 0",
      "why is my balance zero",
      "balance is empty",
      "wallet is empty",
      "empty wallet",
      /* The phrasings that are a request rather than a question: "I need test
         ETH", "need some gas", "give me USDC". They reach this file because the
         grammar finds no verb in them — "faucet" is its only faucet word — so
         without these they were a miss on both nets and landed on the model.

         "give me USDC" stops here rather than becoming a faucet claim in the
         grammar, and that is a choice: making "give" a faucet verb would turn
         every sentence that starts with it and names a token into a transaction
         proposal, "give me the price of KLD" included. A paragraph with a chip on
         it costs one click; a wrong transaction proposal costs trust.

         "fund my wallet" is here now that the grammar declines it. `fund` is
         fillRequest's verb, so it used to claim the sentence and ask which
         request to fill — a confident wrong question. See SELF_WORDS in
         fromCommand.ts: a fill points at someone's row, and this names none. */
      "need test",
      "need gas",
      "need some gas",
      "give me",
      "fund my wallet",
      "fund me",
      "how do i fund",
      "how do i add funds",
      "limit on the faucet",
      "how often can i claim",
      "how much does the faucet",
    ],
    answer:
      "Two steps, and only the first happens off Kaleido. The chain's own gas token has to come from that network's public faucet, because claiming from ours is itself a transaction — a wallet at zero cannot pay for the claim that would fund it. The faucet page names the operator for whichever chain you are on and links straight to it, and says so louder once it can see your balance is zero. With gas in hand everything else is claimable in one go: USDC, USDT, USDe, the wrapped native and KLD, one claim per address every 12 hours. Or just say \"claim everything from the faucet\" and I will build it.",
    /* The last sentence of that answer names a phrasing, so the chip is the same
       sentence in one click — a card can only fill the prompt box, which is
       exactly the reach this needs. Ordered as the answer is: gas is a link on
       /faucet that no card here can carry, so the first chip is the step after
       it, and the second is what the whole exercise was for. */
    cards: [
      {
        kind: "actions",
        title: "Once you have gas",
        actions: [
          {
            label: "Claim testnet tokens",
            prompt: "claim everything from the faucet",
          },
          { label: "Then one swap", prompt: "swap 500 USDC to KLD" },
        ],
      },
    ],
    /* Twelve hours is the cooldown set on all five faucet contracts, not a
       constant in this repo — the /faucet page reads drip, stock and remaining
       wait from the contract, so that page is authoritative and this sentence is
       the one place the number can go stale. The asset list is
       getting-started.md's; KLD was added to all five faucets separately. */
  },
  {
    id: "points",
    triggers: [
      "points system",
      "how do points work",
      "point system",
      "earn points",
      "get points",
      "how many points",
      "leaderboard",
      "airdrop",
    ],
    answer:
      "Points come from lending, borrowing, staking, providing liquidity and swapping, weighted by how long you hold a position rather than by a snapshot. Two things worth knowing about the totals: they are written server-side only — the browser can read your score but never compute or set it — and a Season 0 total is participation credit rather than a measured balance, so treat it as evidence you were here, not as an entitlement. The verified version, where every point traces back to a receipt, is the next thing on the points roadmap.",
  },
  {
    id: "kfusd",
    triggers: [
      "what is kfusd",
      "kfusd stablecoin",
      "how does kfusd work",
      "mint kfusd",
    ],
    answer:
      "kfUSD is Kaleido's stablecoin, minted 1:1 against USDC, USDT, or USDe collateral and redeemable back the same way. It's backed by whatever collateral is deposited, part of which is deployed to yield sources — that yield is what funds the kafUSD vault.",
  },
  {
    id: "kafusd",
    triggers: [
      "what is kafusd",
      "yield vault",
      "how does the vault work",
      "kafusd",
    ],
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
    figure: "limits",
  },
  {
    id: "slippage",
    triggers: ["what is slippage", "slippage tolerance", "max slippage"],
    /* Says what the tolerance is not counted against, because the two costs look
       identical on a receipt and only one of them is a risk. A user who reads
       0.50% as covering the fee too will set it far wider than they need to. */
    answer:
      "Slippage is how far the price can move between when you submit a swap and when it executes before the transaction reverts instead of filling at a worse rate. The default here is Auto, currently 0.50%, and it's adjustable per-swap in settings. It's measured on top of the pools' own trading fees, which are a fixed, quoted cost rather than a risk — so a route through two 0.30% pools doesn't spend your tolerance on them.",
    figure: "slippage",
  },
  {
    id: "chains",
    triggers: [
      "multichain",
      "which chains",
      "cross chain",
      "other networks",
      "what chains",
      "which network should i",
      "which chain should i",
      "what network should i",
      "best network",
    ],
    answer:
      "Kaleido is multichain: swaps, loans, liquidity and kfUSD run on Arc, Base, Robinhood Chain, BNB Smart Chain and Ethereum. Your wallet can also sit on Polygon, Arbitrum, Hyperliquid or Abstract, where the app reads your balances but the products don't open. Whichever network you're on, each page tells you if it needs a different one. If you are picking one to start on, use Base Sepolia — it is the fastest of the five to get funded on, and positions are per chain, so it is worth staying on one while you learn the app.",
    /* A nine-item list read out in prose is a list you have to re-read to count,
       and the split that matters — where the products open versus where only
       balances read — is the thing prose buries. It mirrors the `tradable` flag
       in chains.ts, so this card and the network picker can't disagree.

       Grouped into seven rows because `cardsFromChat` caps a stats card at
       MAX_ROWS = 8 and silently truncates past it (fromChat.ts:128), and a
       truncated network list is a wrong one. Row values stay inside LIMITS.value
       = 24 characters for the same reason. */
    cards: [
      {
        kind: "stats",
        title: "Networks",
        rows: [
          { label: "Arc", value: "products" },
          { label: "Base", value: "products" },
          { label: "Robinhood Chain", value: "products" },
          { label: "BNB Smart Chain", value: "products" },
          { label: "Ethereum", value: "products" },
          { label: "Polygon, Arbitrum", value: "balances only" },
          { label: "Hyperliquid, Abstract", value: "balances only" },
        ],
      },
    ],
  },
  {
    id: "model-credits",
    triggers: [
      "reasoning request",
      "model credit",
      "how many requests",
      "run out of credits",
      "quota",
      "stopped answering",
      "stop answering",
      "used up my requests",
      "no more requests",
    ],
    answer:
      'Reasoning requests (turns that need the AI model, not a stated command) are rationed per wallet per day — that limit exists to protect the shared model bill, not to restrict your trading. A command like "swap 500 USDC to KLD" is parsed locally and never touches that quota, so you can keep trading even after it\'s used up for the day.',
    figure: "credits",
  },
  {
    id: "audit-status",
    triggers: [
      "is this audited",
      "is it safe",
      "security audit",
      "has this been tested",
    ],
    answer:
      "A security pass has been done on the stablecoin contracts and the critical issues it found were fixed, but the yield-calculation paths have not been through full verification, and it is not a completed, independent third-party audit. Worth keeping in mind before moving size.",
  },
  {
    /*
     * "Who are you", "what is this", "how do I start". Static, asked by everyone
     * once, and currently a reasoning request each time. The product line mirrors
     * the overview blurb in (marketing)/docs/docs.ts; the sequence is
     * getting-started.md's, in its order, because that ordering is load-bearing.
     */
    id: "orientation",
    triggers: [
      "who are you",
      "are you an ai",
      "are you a bot",
      "what is luca",
      "who is luca",
      "what is this app",
      "what is this site",
      "what is kaleido",
      "what does this do",
      "how do i start",
      "where do i start",
      "where should i start",
      "how do i get started",
      "what should i do first",
      "what do i do first",
      "im new",
      "i'm new",
    ],
    answer:
      "I'm Luca, the agent inside Kaleido: tell me what you want in plain language and I build the transactions for you to review and sign. Nothing executes without your signature. Kaleido itself is five products behind one wallet connection — swaps, concentrated liquidity, peer-to-peer lending, the kfUSD stablecoin and KLD staking — across five networks. The shortest path from here: connect a wallet, get a little of the chain's gas token from its public faucet, claim the rest from the faucet page, then do one swap. That first ten minutes is written up under Getting started in the docs.",
  },
  {
    /*
     * Wallet support is src/config/wallets.ts, in its order, including the in-app
     * wallet that exists for people who arrive without one. The seed-phrase
     * sentence is deliberately the same promise the invite email closes with:
     * a shared access code going out to 3,000 people is exactly the conditions
     * phishing waits for, and the agent is the surface most likely to be asked.
     */
    id: "wallet",
    triggers: [
      "connect my wallet",
      "connect a wallet",
      "how do i connect",
      "which wallet",
      "what wallet",
      "which wallets",
      "dont have a wallet",
      "don't have a wallet",
      "no wallet",
      "wallet safe",
      "seed phrase",
      "private key",
      "add base sepolia",
      "add the network",
      "wrong network",
    ],
    answer:
      "MetaMask, Coinbase Wallet, Rainbow, and anything that speaks WalletConnect. If you have no wallet at all, there is an in-app one you can open with Google, an email code or a passkey. Connecting only shows the app your address — every action after it is a separate prompt you approve one at a time. The network selector offers only chains that have a deployment, and switching there asks your wallet to add the network if it does not have it yet. Kaleido will never ask for your seed phrase or your private key: nothing here needs them, and any message that asks is not from us.",
  },
  {
    /*
     * The roadmap dates are the landing page's own, (marketing)/page.tsx — "Mainnet
     * in September, TGE by month end". Stated as a date rather than softened,
     * because a dated milestone is what the site already publishes.
     */
    id: "mainnet",
    triggers: [
      "when is mainnet",
      "when does mainnet",
      "mainnet launch",
      "is this real money",
      "real money",
      "is this real",
      "real eth",
      "real funds",
      "am i on mainnet",
      "when is the token",
      "when is tge",
      "is this a testnet",
    ],
    answer:
      "You are on a testnet. The five networks live today are Sepolia, Base Sepolia, BNB Smart Chain Testnet, Robinhood Chain Testnet and Arc Testnet; the tokens come from a faucet and none of it is real money, which is the point — you can borrow, get liquidated and find out what that feels like without risking anything. Mainnet is September 2026, with the token event by the end of the same month. That is the roadmap on the landing page.",
  },
  {
    /*
     * KLD itself, as opposed to staking it — the staking topic answers stKLD and
     * was matching neither "what is KLD" nor "how do I get KLD". Deployment
     * footprint and the two seeded pools are recorded in the multichain plan; the
     * faucet drips it on all five.
     */
    id: "kld",
    triggers: [
      "what is kld",
      "how do i get kld",
      "get kld",
      /* Asking how to buy it is asking for the explanation, not for the trade. The
         grammar would take these as an incomplete swap and ask which token to
         spend — a fair reply, but the answer below names both routes and hands
         over the same chip, so the question form belongs here. Kept specific to
         KLD: "how do i buy" alone would answer for every token with this
         paragraph. */
      "how do i buy kld",
      "where can i buy kld",
      "can i buy kld",
      "kld token",
      "do you have a token",
      "is there a token",
      "your own token",
    ],
    answer:
      "KLD is Kaleido's own token, deployed on all five networks. Two ways to get it on testnet: claim it from the faucet page along with the other test assets, or swap for it — there is a KLD/USDC pool on Sepolia and Base Sepolia. Staking it mints stKLD; ask me how staking works for that part.",
    /* Both routes as chips, because this is the one topic where the answer is two
       things you can do rather than something to know. The purchase phrasing is
       the parser's own — "buy X with N Y" is the shape that resolves in one line,
       since a swap is priced by what you spend. */
    cards: [
      {
        kind: "actions",
        title: "Two ways",
        actions: [
          {
            label: "Claim KLD from the faucet",
            prompt: "claim everything from the faucet",
          },
          { label: "Buy KLD with USDC", prompt: "buy KLD with 500 USDC" },
        ],
      },
    ],
  },
  {
    id: "docs-support",
    triggers: [
      "where are the docs",
      "where is the documentation",
      "read the docs",
      "documentation",
      "report a bug",
      "found a bug",
      "something is broken",
      "contact support",
      "how do i contact",
      "who do i contact",
    ],
    answer:
      "The docs sit on the main site under /docs and need no access code — Getting started is the first page, and there is one page per product. If something looks broken, or you have found a bug, reply to the email your access code came from; replies to that address reach us.",
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

/**
 * Does this read as a question rather than an instruction?
 *
 * The page asks the command grammar first, and that order is right for anything
 * imperative: someone typing "stake kld" wants a plan, and a paragraph about
 * staking would be an insult. But the grammar finds its verb anywhere in the
 * sentence, so "is there a limit on the faucet" parses as a faucet claim and
 * "how often can I claim" as a yield claim — and the answer to a question
 * arrives as a transaction to sign.
 *
 * So text that OPENS with an interrogative gives the FAQ first refusal. A miss
 * still falls through to the grammar, which is why "how do I swap" continues to
 * open a swap draft: that is the right answer to that question, and there is no
 * topic to steal it. Measured against the corpus, the chips and every trigger in
 * this file, exactly two phrasings change hands and both improve.
 *
 * Leading-word only, on purpose. Matching an interrogative anywhere would flip
 * "swap 100 USDC to KLD when you can" into a question, and this test has to stay
 * cheap enough to run before every turn.
 */
export function isQuestionShaped(text: string): boolean {
  return /^\s*(what|whats|what's|why|when|where|who|which|how|is|are|was|were|do|does|did|can|could|should|will|would|am|any)\b/i.test(
    text,
  );
}
