/*
 * Product-specific starting points on the agent's empty card. Clicking one
 * *fills the prompt box* — it does not send. See fillPrompt in page.tsx for why.
 *
 * Its own module, and not for reuse: the page is the only importer. It is here so
 * that `suggestions.test.ts` can run the list through the real parser under plain
 * tsx, which page.tsx cannot offer it — importing the page pulls in React, a CSS
 * module and a dozen wallet hooks. The property being protected is narrow and
 * worth the file: a chip that reads well and parses to "unknown" is a button that
 * silently costs a model credit to fail.
 *
 * Because the text lands in an editable box the user then reads, label and prompt
 * are the same string wherever they honestly can be: showing "Mint kfUSD with 500
 * USDC" and pasting something else would edit the user's words behind their back,
 * which is worse than a slightly awkward template. Mint is the one exception and
 * it is a grammar constraint, not a style choice — the parser binds mint's token
 * as the *collateral*, so "mint 500 kfUSD" resolves to kfUSD-as-collateral and
 * the planner rejects it with "kfUSD isn't accepted as kfUSD collateral". "mint
 * 500 USDC" is the phrasing that plans, so that is what both the chip and the box
 * say.
 *
 * Seven items, one per surface: faucet, swap, stake, stablecoin, lend, borrow,
 * receive. Each completes on a connected wallet — no chip lands at "nothing is
 * deployed yet".
 *
 * Every one is a whole request, not a verb. This list used to end in a bare
 * "receive", and a row of chips reading "claim", "compound", "receive" is the
 * thing it is: a list of the parser's keywords, shown to somebody who does not
 * know there is a parser. "show my address" says what pressing it gets you. The
 * cost of the longer phrasings is width, which this row spends by scrolling
 * sideways rather than by wrapping — see `.suggest` in agent.module.css.
 *
 * Receive still closes the list, because it is the only one needing no signature
 * at all. **It is also the only chip whose phrasing is not free.** RECEIVE_PHRASES
 * is matched as a *leading* phrase, deliberately — "receive" is ordinary trading
 * English and a whole-sentence scan would hijack "how much KLD will I receive" —
 * so the chip has to *be* one of those phrases, near enough. "show my address" is
 * in the list; "show my wallet address" is not, and would fall through to the
 * model. Check fromCommand.ts before rewording this one.
 *
 * The faucet opens it because on a testnet it is genuinely the first step: a
 * whitelisted tester arrives with an empty wallet, and every other chip here
 * needs a balance to spend. "everything" rather than a ticker: it lands in the
 * planner's batch branch and claims every asset currently due in one transaction,
 * which is what somebody starting from zero wants, and it needs no assumption
 * about which assets this chain's faucet stocks. It resolves to claimTestTokens
 * rather than claimYield because `VERBS.claimTestTokens` is scanned ahead of the
 * zero-slot verbs, so the "claim" in it cannot hijack the sentence.
 */
export const SUGGESTIONS = [
  "claim everything from the faucet",
  "swap 500 USDC to KLD",
  "stake 100 KLD",
  "mint 500 USDC",
  "lend 1,000 USDC at 10% for 60 days",
  "borrow 500 USDC at 8% for 30 days",
  "show my address",
];
