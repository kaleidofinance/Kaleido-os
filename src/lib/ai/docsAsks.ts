/**
 * How people ask for each section of the docs.
 *
 * ---------------------------------------------------------------------------
 * WHY A BANK OF QUESTIONS AND NOT A BETTER SCORER
 * ---------------------------------------------------------------------------
 * The first cut matched a question against section PROSE with BM25 and landed
 * on the right page 14 times in 33. Not because the scorer was bad — because
 * the words people use are not the words the docs use. "How do I get my KLD
 * back", "unstake" and "leave the vault" are one question; the section that
 * answers it is titled "Leaving takes three moves" and never says "unstake".
 * No weighting fixes a vocabulary gap. An alias table would, briefly, and then
 * never end.
 *
 * So each section carries the sentences a newcomer, a DeFi-native and a large
 * holder would type to reach it. The matcher compares the user's question to
 * THESE — short question against short question, where overlap is high — and
 * only falls back to prose scoring when nothing here is close. Writing these is
 * the job a language model is good at and a scorer is not, which is why this
 * file is authored rather than generated.
 *
 * Rules for an entry, because a bad one is worse than none:
 * - Every key is a real section: `slug` from the docs manifest, `anchor` from
 *   the heading the site draws (empty = the page's lead paragraph). The test
 *   fails on a key the index does not contain, so a renamed heading breaks
 *   loudly here instead of silently answering with nothing.
 * - Asks are how the question is TYPED — lowercase, no punctuation needed,
 *   contractions welcome, jargon in every register. Not headings rewritten as
 *   questions.
 * - An ask must be answered by that section's own text. If the honest answer
 *   needs a live number or the user's position, it does not belong here — it
 *   belongs in the FAQ with a `figure`, or with the model.
 * - Imperatives stay out ("stake 100 KLD" is a plan, not a question). The
 *   grammar sees the sentence first and this bank never gets it, but a bank
 *   that would have matched it is a bank waiting for that ordering to change.
 */

export interface DocAsk {
  slug: string;
  anchor: string;
  asks: string[];
}

export const DOC_ASKS: DocAsk[] = [
  /* ---------------------------------------------------------------- overview */
  {
    slug: "overview",
    anchor: "",
    asks: [
      "what is kaleido",
      "what does kaleido do",
      "what is this protocol",
      "explain kaleido to me",
      "what can i do here",
      "what products do you have",
      "is this a dex or a lending protocol",
      "is kaleido a fork",
      "are these your own contracts",
      "whats the pitch",
      "give me the overview",
    ],
  },
  {
    slug: "overview",
    anchor: "the-five-products",
    asks: [
      "what are the five products",
      "list the products",
      "what can i trade lend or stake here",
      "what markets are there",
      "do you have a stablecoin",
      "is there liquidity provision",
      "what is the difference between the products",
    ],
  },
  {
    slug: "overview",
    anchor: "luca",
    asks: [
      "how do i use the protocol",
      "do i have to use the app",
      "is the agent different from the app",
      "does luca use the same contracts as the pages",
      "three ways in",
    ],
  },
  {
    slug: "overview",
    anchor: "the-contracts",
    asks: [
      "can i call the contracts directly",
      "where are the addresses for each network",
      "can i integrate against the contracts",
    ],
  },
  {
    slug: "overview",
    anchor: "what-is-the-same-on-every-chain",
    asks: [
      "which chains are supported",
      "what networks do you run on",
      "is the code the same on every chain",
      "what is different per chain",
      "why does arc use usdc for gas",
      "does arc work differently",
      "is it deployed on base",
      "supported networks",
    ],
  },

  /* --------------------------------------------------------- getting-started */
  {
    slug: "getting-started",
    anchor: "",
    asks: [
      "how do i start",
      "how do i get started",
      "im new where do i begin",
      "first steps",
      "walk me through my first swap",
      "what do i need to begin",
      "beginner guide",
    ],
  },
  {
    slug: "getting-started",
    anchor: "connect-a-wallet",
    asks: [
      "how do i connect",
      "which network should i pick",
      "can i see my positions from another chain",
      "why cant i see my loan on sepolia",
      "are positions per chain",
      "do i need to stay on one network",
    ],
  },
  {
    slug: "getting-started",
    anchor: "gas-comes-first-and-it-has-to-come-from-outside",
    asks: [
      "how do i get gas",
      "i have no eth for gas",
      "why cant the faucet give me gas",
      "my wallet is at zero how do i claim",
      "where do i get testnet eth",
      "the faucet claim fails with no gas",
      "what is the gas token on arc",
      "why is my eth balance empty on arc",
      "i need tbnb",
    ],
  },
  {
    slug: "getting-started",
    anchor: "claim-everything-else-from-the-faucet",
    asks: [
      "what does the faucet give",
      "which tokens can i claim",
      "is the faucet a contract",
      "how much does the faucet give per claim",
      "where is the faucet",
      "how do i get usdc on testnet",
    ],
  },
  {
    slug: "getting-started",
    anchor: "make-one-swap",
    asks: [
      "why do i sign twice for a swap",
      "why two signatures",
      "what is the approve for",
      "why does the quote cost nothing",
      "is the quote a transaction",
      "what is the deadline on a swap",
      "do i have to withdraw after a swap",
      "where does my output go after a swap",
    ],
  },

  /* ------------------------------------------------------------------- trade */
  {
    slug: "trade",
    anchor: "",
    asks: [
      "how does swapping work",
      "how do swaps work",
      "am i trading against kaleido",
      "who is on the other side of my swap",
      "is this an order book",
      "is the dex like uniswap",
      "what kind of pool is it",
    ],
  },
  {
    slug: "trade",
    anchor: "the-four-steps-two-of-which-you-sign",
    asks: [
      "what are the steps of a swap",
      "why is approve separate from swap",
      "will it ask me to approve every time",
      "is there a settlement step",
      "does kaleido hold my tokens after a swap",
    ],
  },
  {
    slug: "trade",
    anchor: "fee-tiers-and-which-one-you-get",
    asks: [
      "what are the fee tiers",
      "whats the swap fee tier",
      "which fee tier does the swap page use",
      "why does the agent get a better price than the swap page",
      "does luca check all fee tiers",
      "what is the 0.05 pool for",
      "which pool do i trade in",
      "500 3000 10000 tiers",
      "how do i pick a fee tier",
    ],
  },
  {
    slug: "trade",
    anchor: "slippage-and-the-deadline",
    asks: [
      "what is slippage",
      "what does slippage mean",
      "what is the default slippage",
      "why did my swap revert",
      "what happens if the price moves",
      "what is the deadline for",
      "slippage on swaps",
      "can i change slippage",
      "why did i pay gas for a swap that didnt happen",
    ],
  },
  {
    slug: "trade",
    anchor: "more-than-one-hop",
    asks: [
      "what is a multi hop swap",
      "what if there is no direct pool",
      "does it route through another token",
      "can i choose the intermediate token",
      "two hop swap",
    ],
  },
  {
    slug: "trade",
    anchor: "when-there-is-no-price",
    asks: [
      "why is there no quote",
      "why does it say no route",
      "no pool for this pair",
      "swapping is unavailable on this chain",
      "why cant i swap here",
    ],
  },
  {
    slug: "trade",
    anchor: "where-the-fee-goes",
    asks: [
      "who gets the swap fee",
      "does kaleido take a cut of swaps",
      "where does the trading fee go",
      "do lps get all the fee",
    ],
  },

  /* ---------------------------------------------------------------- liquidity */
  {
    slug: "liquidity",
    anchor: "",
    asks: [
      "how does providing liquidity work",
      "how do i provide liquidity",
      "how do i become an lp",
      "how do i lp",
      "what is a liquidity position",
      "what is a price range",
      "why does my position only earn sometimes",
      "what is concentrated liquidity",
      "is lp a deposit into a pool",
      "narrow vs wide range",
    ],
  },
  {
    slug: "liquidity",
    anchor: "inside-outside-and-what-you-are-holding",
    asks: [
      "what happens when price leaves my range",
      "my position is out of range",
      "why am i holding only one token",
      "do i lose money out of range",
      "does an out of range position get liquidated",
      "what do i hold inside the range",
    ],
  },
  {
    slug: "liquidity",
    anchor: "choosing-the-range",
    asks: [
      "how do i choose a range",
      "what is full range",
      "what does plus minus 10 percent mean",
      "why is the band refused on a new pool",
      "how do i set explicit prices",
      "which range earns the most",
      "first position in a pool",
    ],
  },
  {
    slug: "liquidity",
    anchor: "why-your-bounds-are-not-the-ones-you-asked-for",
    asks: [
      "why are my bounds different from what i typed",
      "what is a tick",
      "what is tick spacing",
      "why did the range snap",
      "my range collapsed to a single price",
      "widen the range or use a finer tier",
      "tick spacing per fee tier",
    ],
  },
  {
    slug: "liquidity",
    anchor: "slippage-on-the-way-in",
    asks: [
      "why did the amounts change when i added liquidity",
      "slippage when opening a position",
      "why is there a minimum on both tokens",
      "front running a new pool",
      "setting the opening price",
    ],
  },
  {
    slug: "liquidity",
    anchor: "collecting-and-closing",
    asks: [
      "how do i collect lp fees",
      "how do i claim my fees",
      "do lp fees auto compound",
      "how do i close my position",
      "how do i remove liquidity",
      "what do i get back when i close",
      "closing out of range",
    ],
  },
  {
    slug: "liquidity",
    anchor: "where-the-fee-comes-from",
    asks: [
      "where do lp fees come from",
      "how do liquidity providers earn",
      "does the protocol take lp fees",
    ],
  },

  /* ------------------------------------------------------------------ borrow */
  {
    slug: "borrow",
    anchor: "",
    asks: [
      "how does lending work",
      "how does borrowing work",
      "is this peer to peer",
      "is there a utilisation curve",
      "who sets the interest rate",
      "is it pooled lending like aave",
      "what is the lending book",
    ],
  },
  {
    slug: "borrow",
    anchor: "requests-and-listings",
    asks: [
      "what is a borrow request",
      "what is a lend listing",
      "what is the difference between a request and a listing",
      "if i fill a request am i the lender",
      "if i take a listing am i the borrower",
      "can i take part of a listing",
      "can the rate change after i agree",
    ],
  },
  {
    slug: "borrow",
    anchor: "the-rate-is-an-apr-and-the-interest-is-fixed-at-origination",
    asks: [
      "is the rate apr or apy",
      "how is interest calculated",
      "does interest compound",
      "does interest change if i repay early",
      "does interest change if i repay late",
      "how much interest on 5000 usdc for 30 days",
      "why was my loan refused for rounding to zero",
      "is it a fixed rate",
    ],
  },
  {
    slug: "borrow",
    anchor: "collateral-and-the-health-factor",
    asks: [
      "what is a health factor",
      "how is the health factor calculated",
      "what happens if i get liquidated",
      "when do i get liquidated",
      "how much can i borrow against my collateral",
      "how is collateral valued",
      "what is my collateral worth",
      "how do you price my collateral",
      "what is the liquidation threshold",
      "what is the max ltv",
      "can i withdraw collateral while i have a loan",
      "why is 1.07 thin",
      "is collateral per loan or one balance",
      "does the app check my health factor or the contract",
    ],
  },
  {
    slug: "borrow",
    anchor: "floors",
    asks: [
      "what is the minimum loan",
      "what is the shortest term",
      "smallest loan size",
      "minimum borrow amount",
    ],
  },
  {
    slug: "borrow",
    anchor: "repaying",
    asks: [
      "how do i repay",
      "can i repay part of a loan",
      "how is a partial repayment split",
      "does repaying go to interest first",
      "what fee is taken on repayment",
      "how do i see the repayment split before i send it",
      "what does the lender receive",
    ],
  },
  {
    slug: "borrow",
    anchor: "liquidation",
    asks: [
      "what is the liquidation penalty",
      "how is the liquidation penalty split",
      "who can liquidate me",
      "what does a liquidator get",
      "why is the liquidator paid more than the protocol",
      "what happens to the lender in a liquidation",
      "where does seized collateral go",
      "can i be a liquidator",
    ],
  },
  {
    slug: "borrow",
    anchor: "doing-it-by-asking",
    asks: [
      "can luca borrow for me",
      "can the agent lend for me",
      "can luca repay my loan",
      "which lending actions can the agent do",
    ],
  },

  /* ------------------------------------------------------------------- stake */
  {
    slug: "stake",
    anchor: "",
    asks: [
      "how does staking work",
      "what is stkld",
      "what apy does staking pay",
      "why is there no apy shown",
      "is staking a lock up",
      "what do i earn from staking",
      "staking rewards",
    ],
  },
  {
    slug: "stake",
    anchor: "depositing-and-what-you-get-back",
    asks: [
      "what do i get when i stake",
      "why does my stkld balance change",
      "is stkld rebasing",
      "do i have to claim staking rewards",
      "is there a deposit fee for staking",
      "is there a withdrawal fee for staking",
      "can someone buy in cheap after a harvest",
      "does a later deposit dilute me",
    ],
  },
  {
    slug: "stake",
    anchor: "where-the-yield-comes-from",
    asks: [
      "where does staking yield come from",
      "why is my staking yield zero",
      "why hasnt my stkld grown",
      "what is a harvest",
      "who calls the harvest",
      "why is staking yield lumpy",
      "when does staking pay out",
      "is the staking rate smooth",
    ],
  },
  {
    slug: "stake",
    anchor: "leaving-takes-three-moves",
    asks: [
      "how do i unstake",
      "how do i get my kld back",
      "how long is the unstaking cooldown",
      "how long is the unstake cooldown",
      "what is the withdrawal waiting period",
      "can i withdraw part of my stake",
      "do i keep earning during the cooldown",
      "can i cancel an unstake request",
      "why does a second withdrawal restart the clock",
      "seven day wait",
      "how do i leave the vault",
    ],
  },
  {
    slug: "stake",
    anchor: "one-asset-deliberately",
    asks: [
      "can i stake other tokens",
      "can i stake usdc",
      "why does the vault only take kld",
    ],
  },
  {
    slug: "stake",
    anchor: "getting-kld-to-stake",
    asks: [
      "how do i get kld to stake",
      "how much kld does the faucet give",
      "can luca unstake for me",
      "why cant the agent withdraw my stake",
      "is kld on every chain",
    ],
  },

  /* ------------------------------------------------------------------ stable */
  {
    slug: "stable",
    anchor: "",
    asks: [
      "what is kfusd",
      "what is kafusd",
      "what is the difference between kfusd and kafusd",
      "which one earns yield kfusd or kafusd",
      "is kfusd backed",
      "what backs kfusd",
      "is kfusd a stablecoin",
      "does holding kfusd earn anything",
    ],
  },
  {
    slug: "stable",
    anchor: "minting-kfusd",
    asks: [
      "how do i mint kfusd",
      "what collateral can i mint with",
      "what is the mint fee",
      "can i mint with usde",
      "why is minting role gated",
      "can anyone redeem kfusd",
      "how much kfusd do i get per usdc",
    ],
  },
  {
    slug: "stable",
    anchor: "where-your-collateral-sits",
    asks: [
      "where does my collateral go when i mint",
      "is my collateral deployed",
      "what does 50 50 mean",
      "can kfusd always pay redemptions",
      "why keep half idle",
    ],
  },
  {
    slug: "stable",
    anchor: "redeeming",
    asks: [
      "how do i redeem kfusd",
      "what is the redeem fee",
      "can i redeem into any collateral",
      "why did my redemption fail",
      "what is the minimum redemption",
      "what does a round trip cost",
      "why 0.001 minimum",
    ],
  },
  {
    slug: "stable",
    anchor: "locking-for-kafusd",
    asks: [
      "how do i lock kfusd",
      "how do i get kafusd",
      "how do i unlock kafusd",
      "how long is the kafusd cooldown",
      "does unlocking give me my collateral back",
      "why did unlocking return kfusd not usdc",
      "how do i exit the stablecoin completely",
      "request wait complete",
    ],
  },
  {
    slug: "stable",
    anchor: "how-the-yield-actually-reaches-you",
    asks: [
      "how does kafusd yield work",
      "why doesnt my kafusd balance grow",
      "is kafusd yield claimed or rebased",
      "what is the performance fee",
      "what is the yield performance fee",
      "can i compound my yield",
      "how do i claim yield",
      "what is an accumulator",
      "is the performance fee retroactive",
    ],
  },
  {
    slug: "stable",
    anchor: "what-feeds-the-treasury",
    asks: [
      "what feeds the yield treasury",
      "where does kafusd yield come from",
      "where do the fees go",
      "what is the yield treasury",
      "does the staking vault use the treasury",
    ],
  },

  /* ------------------------------------------------------------------- agent */
  {
    slug: "agent",
    anchor: "",
    asks: [
      "how does the agent work",
      "how does luca work",
      "what is luca",
      "is luca a smart wallet",
      "does luca hold my keys",
      "does the agent have custody",
      "is luca a separate protocol",
    ],
  },
  {
    slug: "agent",
    anchor: "what-it-can-actually-do",
    asks: [
      "what can luca do",
      "what can the agent do",
      "what actions does the agent support",
      "how many actions does luca have",
      "can luca do anything i ask",
      "will the agent call arbitrary contracts",
      "what are the read tools",
      "can the agent stake",
      "can luca provide liquidity",
    ],
  },
  {
    slug: "agent",
    anchor: "an-incomplete-sentence-is-asked-about-not-guessed-at",
    asks: [
      "what if i forget the amount",
      "does luca guess missing numbers",
      "why does it ask me for the amount",
      "why does luca ask follow up questions",
    ],
  },
  {
    slug: "agent",
    anchor: "the-second-pass",
    asks: [
      "how is the plan checked",
      "what is the auditor",
      "what is the second pass",
      "is there a limit per action",
      "what is the 25000 limit",
      "does the check run in my browser",
      "can i raise the ceiling",
      "why was my plan blocked",
    ],
  },
  {
    slug: "agent",
    anchor: "what-actually-protects-you",
    asks: [
      "is luca safe",
      "how do i know the agent wont drain my wallet",
      "what protects me",
      "can i stop a plan halfway",
      "do i sign every step",
      "is the agent the security boundary",
      "what if the model is hacked",
    ],
  },
  {
    slug: "agent",
    anchor: "where-the-numbers-come-from",
    asks: [
      "where does luca get prices",
      "are agent quotes the same as the page",
      "why is the agent price better",
      "does the agent use a different oracle",
      "what if a quote fails",
    ],
  },
  {
    slug: "agent",
    anchor: "getting-started-with-it",
    asks: [
      "how do i use luca",
      "where is the agent",
      "does the agent need a wallet",
      "why does luca need me to connect",
      "can i use the agent without connecting",
    ],
  },

  /* -------------------------------------------------------------- delegation */
  {
    slug: "delegation",
    anchor: "",
    asks: [
      "what is delegation",
      "can luca act without me",
      "how do i let the agent act automatically",
      "what is a mandate",
      "can the agent trade while im away",
      "where are the limits stored",
      "autonomous agent",
    ],
  },
  {
    slug: "delegation",
    anchor: "the-nine-parameters",
    asks: [
      "what limits can i set on the agent",
      "what are the nine parameters",
      "what is max notional per action",
      "what is the epoch cap",
      "what is the health floor",
      "why did my grant revert",
      "can the per action cap exceed the epoch cap",
      "what does an empty allowlist do",
      "what is the token allowlist",
    ],
  },
  {
    slug: "delegation",
    anchor: "which-actions-can-be-delegated",
    asks: [
      "which actions can be delegated",
      "can i delegate swaps",
      "can i delegate staking",
      "can the agent swap without me",
      "can the agent swap on its own",
      "can luca trade while im away",
      "can it act while im asleep",
      "will it swap automatically",
      "why cant i delegate a swap",
      "what are the action flags",
      "what does the bitmask mean",
      "can a mandate move my tokens",
    ],
  },
  {
    slug: "delegation",
    anchor: "how-the-epoch-actually-behaves",
    asks: [
      "how does the epoch work",
      "is the epoch a calendar day",
      "does unused budget roll over",
      "what happens when the epoch cap is spent",
      "does regranting reset the budget",
    ],
  },
  {
    slug: "delegation",
    anchor: "revoking",
    asks: [
      "how do i revoke the agent",
      "how do i stop the mandate",
      "is there a timelock on revoking",
      "can the owner revoke for me",
      "panic button",
      "can i remove one token from the allowlist",
    ],
  },
  {
    slug: "delegation",
    anchor: "what-the-app-fills-in",
    asks: [
      "what are the default delegation limits",
      "what does the settings panel let me set",
      "what is the default health floor",
      "why is max interest zero",
      "how do i raise my delegation limits",
      "can the agent widen its own mandate",
      "how long does a mandate last",
    ],
  },

  /* -------------------------------------------------------------------- fees */
  {
    slug: "fees",
    anchor: "",
    asks: [
      "how do fees work",
      "what are the fees",
      "what does kaleido charge",
      "list every fee",
      "which fees are on",
      "is there a hidden fee",
      "whats the catch on fees",
    ],
  },
  {
    slug: "fees",
    anchor: "what-you-pay-when-you-trade",
    asks: [
      "what does it cost to swap",
      "what is the swap fee",
      "is there a protocol fee on swaps",
      "what is the v3 protocol fee",
      "is the protocol fee switch on",
      "does kaleido take a cut of trading",
    ],
  },
  {
    slug: "fees",
    anchor: "what-you-pay-when-you-borrow-or-lend",
    asks: [
      "what does it cost to borrow",
      "what does it cost to lend",
      "what is the protocol fee on interest",
      "is there an origination fee",
      "is there a fee to post collateral",
      "is there a fee to cancel a request",
      "is lending free",
      "what is the fee on repayment",
    ],
  },
  {
    slug: "fees",
    anchor: "what-you-pay-on-the-stablecoin",
    asks: [
      "what does it cost to mint kfusd",
      "what does a kfusd round trip cost",
      "is there a fee to lock kfusd",
      "is there a fee to claim yield",
      "what is the yield performance fee rate",
      "who gets the mint fee",
    ],
  },
  {
    slug: "fees",
    anchor: "what-you-pay-to-stake",
    asks: [
      "is there a fee to stake",
      "does the vault take a cut",
      "what does it cost to unstake",
      "is there a performance fee on staking",
      "staking fees",
    ],
  },

  /* ------------------------------------------------------------ architecture */
  {
    slug: "architecture",
    anchor: "",
    asks: [
      "how is the protocol built",
      "what is the architecture",
      "what is the diamond",
      "why one address per chain",
      "how are the contracts wired together",
    ],
  },
  {
    slug: "architecture",
    anchor: "one-address-five-facets",
    asks: [
      "what is a facet",
      "what is eip 2535",
      "does upgrading change the address",
      "do my approvals survive an upgrade",
      "which facet handles lending",
      "is storage shared between facets",
    ],
  },
  {
    slug: "architecture",
    anchor: "what-lives-beside-it",
    asks: [
      "what contracts are there",
      "is there a v2 dex",
      "does the app use v2 or v3",
      "which contracts are outside the diamond",
    ],
  },
  {
    slug: "architecture",
    anchor: "the-registry-is-the-only-place-addresses-live",
    asks: [
      "where are the contract addresses",
      "how do i find the addresses",
      "what is deployments generated",
      "can i edit the registry by hand",
    ],
  },
  {
    slug: "architecture",
    anchor: "prices-one-wrapper-two-backends",
    asks: [
      "what oracle do you use",
      "how are prices sourced",
      "where do prices come from",
      "do you use chainlink or pyth",
      "how fresh are prices",
      "what is the max price age",
      "what is a confidence interval",
      "is the price stale",
      "which chains use pyth",
    ],
  },
  {
    slug: "architecture",
    anchor: "why-a-chain-whose-gas-is-usdc-works",
    asks: [
      "why does arc work",
      "how does arc use usdc as gas",
      "is anything hardcoded per chain",
      "why no forks per chain",
    ],
  },
  {
    slug: "architecture",
    anchor: "reading-it-yourself",
    asks: [
      "where is the source code",
      "where are the contracts on github",
      "can i read the contracts",
      "is it open source",
    ],
  },

  /* ------------------------------------------------------------------- token */
  {
    slug: "token",
    anchor: "",
    asks: [
      "what is the kld token",
      "what is kld",
      "what is the max supply of kld",
      "how many kld are there",
      "is the supply fixed",
      "is kld an erc20",
      "does kld have permit",
    ],
  },
  {
    slug: "token",
    anchor: "the-eight-buckets",
    asks: [
      "what is the token allocation",
      "what are the eight buckets",
      "how much goes to the team",
      "how much goes to the community",
      "what is the vesting schedule",
      "what is the seed round allocation",
      "can the allocation exceed the supply",
      "tokenomics",
    ],
  },
  {
    slug: "token",
    anchor: "what-unlocks-and-when",
    asks: [
      "when is the token unlock",
      "how much unlocks at tge",
      "what is the unlock schedule",
      "what is circulating at launch",
      "is the team unlocked at tge",
      "what is the cliff",
      "unlock curve",
      "how long until fully unlocked",
    ],
  },
  {
    slug: "token",
    anchor: "circulating-supply-is-a-subtraction-not-a-report",
    asks: [
      "how do i compute circulating supply",
      "what is the circulating supply",
      "can the admin move vested tokens",
      "who can claim vested tokens",
      "is there a pause on the token",
    ],
  },
  {
    slug: "token",
    anchor: "why-the-ceiling-is-a-constructor-argument",
    asks: [
      "can the supply cap change",
      "who can mint kld",
      "can kld be minted on every chain",
      "does burning free up supply",
      "how does bridging affect supply",
      "what is the bridge role",
      "is issuance capped",
    ],
  },
  {
    slug: "token",
    anchor: "deliberately-not-a-voting-token",
    asks: [
      "is kld a governance token",
      "can i vote with kld",
      "why no voting",
      "is there a dao",
    ],
  },
  {
    slug: "token",
    anchor: "what-the-token-does-here",
    asks: [
      "what is kld used for",
      "what is the token utility",
      "do points become tokens",
      "does kld earn protocol revenue",
    ],
  },
  {
    slug: "token",
    anchor: "where-it-is-deployed",
    asks: [
      "what is the kld contract address",
      "is kld the same token on every chain",
      "is there a bridge for kld",
      "kld address on base",
    ],
  },

  /* ----------------------------------------------------------------- roadmap */
  {
    slug: "roadmap",
    anchor: "",
    asks: [
      "what is on the roadmap",
      "what is the roadmap",
      "what is coming next",
      "what has shipped",
      "what are the dates",
    ],
  },
  {
    slug: "roadmap",
    anchor: "september-2026-mainnet",
    asks: [
      "when is mainnet",
      "when does mainnet launch",
      "is there an audit before mainnet",
      "when can i use real money",
      "when does season 1 start",
    ],
  },
  {
    slug: "roadmap",
    anchor: "late-september-2026-tge",
    asks: [
      "when is tge",
      "when is the token launch",
      "when do points become tokens",
      "how are points converted",
      "when is the airdrop",
      "is there an airdrop",
    ],
  },
  {
    slug: "roadmap",
    anchor: "q4-2026-listings",
    asks: [
      "when is the exchange listing",
      "which exchanges",
      "when is the cex listing",
      "is there a mobile app",
      "when is season 2",
    ],
  },
  {
    slug: "roadmap",
    anchor: "what-is-deliberately-not-on-this-list",
    asks: [
      "is there a dao coming",
      "why no governance date",
      "which exchange will list kld",
      "what is the tvl target",
    ],
  },
];
