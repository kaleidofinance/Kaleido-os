const hre = require("hardhat");
const { ethers } = hre;

const {
  backendFor,
  feedPlanFor,
  verifyAggregatorFeed,
} = require("./libraries/aggregator-feeds.js");

/**
 * Everything a deploy depends on, checked before a single wei is spent.
 *
 * Read-only. Sends no transaction and needs no deployed contract, so it is safe
 * to run against a chain where nothing exists yet — which is the only moment it
 * is useful.
 *
 * This exists because the Base Sepolia wave cost three separate failed runs, and
 * every one of them was diagnosable up front:
 *
 *  - A stale `PYTH_PRICE_ORACLE` left over from another chain. deploy.js
 *    getCode-checks it, so it failed loudly — but only after the run started, and
 *    only because that address happened to have no code here. An address that
 *    happens to hold *something* on the new chain passes that check and gives the
 *    lending market an oracle nobody chose.
 *  - USDC/USD publishing on a 24h heartbeat against a 300s bound, which is not
 *    visible until the first priced call reverts, long after the deploy "worked".
 *  - A provider handing out the same nonce twice. Fixed by construction now that
 *    every config call awaits its receipt, but a genuinely stuck pending
 *    transaction still blocks a whole run, and that is visible here.
 *
 * The pattern in all three: a deploy that fails at the *end* of a long sequence,
 * after gas is spent and some contracts exist. Everything below is a read that
 * costs nothing and moves that failure to before the first send.
 *
 * Exits non-zero if anything is wrong, so it can gate a deploy.
 */

const problems = [];
const warnings = [];
const fail = (m) => problems.push(m);
const warn = (m) => warnings.push(m);

const fmtAge = (s) => {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${s}s (${(s / 60).toFixed(1)}m)`;
  return `${s}s (${(s / 3600).toFixed(1)}h)`;
};

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

const AGGREGATOR_ABI = [
  "function description() view returns (string)",
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
];

/**
 * What each chain's native currency actually is.
 *
 * This table exists because NATIVE_FEED_SYMBOL is the most dangerous value in the
 * whole deploy and was the only chain-specific one nothing checked. It selects the
 * price feed the native sentinel (Constants.NATIVE_TOKEN, address(1)) is registered
 * against, and a wrong-but-real feed does not revert — it misprices every native
 * deposit on the chain, permanently, for every health-factor read and every
 * liquidation.
 *
 * Arc Testnet is what makes this concrete. Its native currency is USDC. Carrying
 * NATIVE_FEED_SYMBOL=ETH over from the previous chain would price one native unit
 * at ether's price — roughly 2,400x its real value — and let a borrower post $10
 * of collateral and draw thousands. Nothing on the path would object: ETH/USD is a
 * real feed, it is fresh on Arc (4s when measured), the symbol check in
 * register-tokens.js compares the TOKEN's symbol and the native sentinel has none,
 * and preflight itself printed a green tick for it because it was set.
 *
 * BSC Testnet has the same shape at a smaller multiple — BNB priced as ether is
 * several-fold high. Two of the five chains, so this is the common case rather
 * than an Arc curiosity.
 *
 * NATIVE_LABEL is checked against the same table but is only cosmetic-ish: it is
 * baked into every V3 position NFT's SVG through the descriptor's immutable
 * `nativeCurrencyLabelBytes`, so a wrong value is permanent and visible and
 * nothing more. It gets a warning; NATIVE_FEED_SYMBOL gets a refusal.
 */
const NATIVE_CURRENCY = {
  11155111: { label: "ETH", feedSymbol: "ETH" },
  84532: { label: "ETH", feedSymbol: "ETH" },
  97: { label: "BNB", feedSymbol: "BNB" },
  46630: { label: "ETH", feedSymbol: "ETH" },
  /* Not a typo and not a placeholder: Arc's gas token is USDC. WETH9 wrapping it
   * therefore reports "Wrapped Ether"/"WETH" for a wrapped dollar, which is
   * cosmetically wrong and functionally right — recorded in the deploy plan rather
   * than papered over. */
  5042002: { label: "USDC", feedSymbol: "USDC" },
};

/**
 * Prove an address is the ERC20 the env var claims it is.
 *
 * `isAddress` only says the string is well-formed, and every wrong address in
 * this class is also well-formed — the failure mode is a counterparty token
 * copied from another chain's block, which is well-formed, has code on both
 * chains often enough to be dangerous, and is a different asset.
 *
 * Decimals are printed rather than merely checked because they silently drive
 * arithmetic downstream: kfUSD scales redemptions by the collateral's decimals,
 * so a "USDC" reporting 18 is a different asset from one reporting 6 and the
 * difference is a factor of 10^12, not a rounding error.
 */
async function checkToken(label, address, expectSymbol, expectDecimals) {
  if (!address) {
    fail(`${label} is not set in smart-contract/.env`);
    return;
  }
  if (!ethers.isAddress(address)) {
    fail(`${label} is not a usable address: ${address}`);
    return;
  }

  const code = await ethers.provider.getCode(address);
  if (code === "0x") {
    fail(
      `${label} ${address} has no code on this chain. It almost certainly belongs ` +
        `to another network — this is the single most common way a deploy ends up ` +
        `wired to a token nobody chose.`,
    );
    return;
  }

  const token = new ethers.Contract(address, ERC20_ABI, ethers.provider);
  let symbol;
  let decimals;
  try {
    [symbol, decimals] = await Promise.all([token.symbol(), token.decimals()]);
  } catch (err) {
    fail(
      `${label} ${address} has code but does not answer symbol()/decimals(), so ` +
        `it is not an ERC20: ${err.shortMessage || err.message}`,
    );
    return;
  }

  decimals = Number(decimals);
  console.log(`   ✅ ${label.padEnd(16)} ${symbol.padEnd(8)} ${decimals} dec  ${address}`);

  if (expectSymbol && symbol.toUpperCase() !== expectSymbol.toUpperCase()) {
    /* A warning, not a failure. Wrapped native legitimately disagrees: Arc's
     * native currency is USDC and WETH9 hardcodes "WETH", so a correct
     * deployment there reports a symbol that does not match the chain's native
     * label. The mismatch is worth seeing; it is not automatically wrong. */
    warn(
      `${label} reports symbol "${symbol}", expected "${expectSymbol}". Verify this ` +
        `is the intended token before deploying against it.`,
    );
  }
  if (expectDecimals !== undefined && decimals !== expectDecimals) {
    fail(
      `${label} reports ${decimals} decimals, expected ${expectDecimals}. That is a ` +
        `factor of 10^${Math.abs(decimals - expectDecimals)} in every amount ` +
        `converted against it.`,
    );
  }
}

async function main() {
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);
  const [deployer] = await ethers.getSigners();

  console.log(`\n🔍 Preflight for ${hre.network.name} (chain ${chainId})`);
  console.log(`   deployer ${deployer.address}\n`);

  /* ── Funding ─────────────────────────────────────────────────────────────
   * Balance and gas price together, because neither means anything alone: the
   * Base Sepolia run finished on 0.0076 ETH only because gas there is ~0.008
   * gwei, and the same balance on Sepolia proper would not deploy the diamond. */
  console.log("── Funding ──");
  const balance = await ethers.provider.getBalance(deployer.address);
  const feeData = await ethers.provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas ?? 0n;

  /* ~11M gas covers the full per-chain sequence measured on Base Sepolia:
   * oracle + diamond with five facets + V3 periphery + V2 + the stablecoin
   * suite and its wiring. Deliberately an estimate with the basis stated rather
   * than a precise number that would rot. */
  const GAS_BUDGET = 11_000_000n;
  const estimate = gasPrice * GAS_BUDGET;

  console.log(`   balance    ${ethers.formatEther(balance)} (native)`);
  console.log(`   gas price  ${ethers.formatUnits(gasPrice, "gwei")} gwei`);
  console.log(`   estimate   ${ethers.formatEther(estimate)} for ~${GAS_BUDGET} gas`);

  if (balance === 0n) {
    fail("deployer balance is zero — fund it before deploying");
  } else if (gasPrice > 0n && balance < estimate) {
    fail(
      `balance ${ethers.formatEther(balance)} is under the ~${ethers.formatEther(estimate)} ` +
        `the full sequence is estimated to cost. A run that stops halfway leaves ` +
        `orphaned contracts and a diamond that may not be fully cut.`,
    );
  }

  /* ── Nonce ───────────────────────────────────────────────────────────────
   * A pending count above the mined count means transactions are stuck in the
   * mempool. Every subsequent send queues behind them, so a deploy started now
   * hangs rather than fails, which is the worse outcome — it looks like a slow
   * chain until someone reads the mempool. */
  const [mined, pending] = await Promise.all([
    ethers.provider.getTransactionCount(deployer.address, "latest"),
    ethers.provider.getTransactionCount(deployer.address, "pending"),
  ]);
  console.log(`   nonce      ${mined} mined, ${pending} pending`);
  if (pending > mined) {
    fail(
      `${pending - mined} transaction(s) are stuck pending for this account. A deploy ` +
        `started now queues behind them. Clear them (resend with a higher fee) first.`,
    );
  }

  /* ── Environment ─────────────────────────────────────────────────────────
   * The four values that are chain-specific and therefore the four that get
   * left pointing at the previous chain. */
  console.log("\n── Environment ──");
  const env = (k) => (process.env[k] || "").trim();

  for (const key of [
    "KALEIDO_FEE_VAULT",
    "NATIVE_LABEL",
    "NATIVE_FEED_SYMBOL",
    "PRICE_MAX_AGE_SECONDS",
    "PRICE_MAX_CONF_BPS",
  ]) {
    const v = env(key);
    if (!v) fail(`${key} is not set`);
    else console.log(`   ✅ ${key.padEnd(24)} ${v}`);
  }

  /* Both native values against what the chain's gas token actually is. See
   * NATIVE_CURRENCY above for why the feed symbol refuses and the label warns. */
  const native = NATIVE_CURRENCY[chainId];
  if (!native) {
    warn(
      `No native currency recorded for chain ${chainId}, so NATIVE_FEED_SYMBOL ` +
        `("${env("NATIVE_FEED_SYMBOL")}") is unchecked. Add the chain to ` +
        "NATIVE_CURRENCY in scripts/preflight.js — a wrong feed symbol misprices " +
        "every native deposit on the chain and never reverts.",
    );
  } else {
    const feedSym = env("NATIVE_FEED_SYMBOL").toUpperCase();
    if (feedSym && feedSym !== native.feedSymbol) {
      fail(
        `NATIVE_FEED_SYMBOL is "${env("NATIVE_FEED_SYMBOL")}" but chain ${chainId}'s ` +
          `native currency is ${native.feedSymbol}. This selects the price feed the ` +
          `native sentinel is registered against, so deploying would price every ` +
          `native deposit off ${feedSym} instead of ${native.feedSymbol} — ` +
          `permanently, with no revert, for every health factor and every ` +
          `liquidation. Set NATIVE_FEED_SYMBOL=${native.feedSymbol}.`,
      );
    }
    const label = env("NATIVE_LABEL").toUpperCase();
    if (label && label !== native.label) {
      warn(
        `NATIVE_LABEL is "${env("NATIVE_LABEL")}" but chain ${chainId}'s native ` +
          `currency is ${native.label}. This is baked into every V3 position NFT's ` +
          `SVG through the descriptor's immutable nativeCurrencyLabelBytes, so it ` +
          `cannot be corrected without redeploying the descriptor and every ` +
          `position minted before then keeps the wrong label.`,
      );
    }
  }

  await checkToken("WRAPPED_NATIVE", env("WRAPPED_NATIVE"), env("NATIVE_LABEL") ? `W${env("NATIVE_LABEL")}` : null, 18);
  await checkToken("USDC_ADDRESS", env("USDC_ADDRESS"), "USDC", 6);

  /* PYTH_PRICE_ORACLE is the one env var that MUST be empty at the start of a
   * new chain and filled partway through, so it is the one most likely to still
   * hold the previous chain's value. deploy.js getCode-checks it, which catches
   * the common case; this also asks it which chain's backend it is, because an
   * address with code on both chains passes a getCode check and is still wrong. */
  const oracleEnv = env("PYTH_PRICE_ORACLE");
  if (!oracleEnv) {
    console.log(
      `   ○  PYTH_PRICE_ORACLE      empty — correct before deploy-oracle.js runs; ` +
        `fill it from that script's output before deploy.js`,
    );
  } else {
    const code = await ethers.provider.getCode(oracleEnv);
    if (code === "0x") {
      fail(
        `PYTH_PRICE_ORACLE ${oracleEnv} has no code on chain ${chainId}. This is ` +
          `last chain's oracle — clear it, run deploy-oracle.js, and paste the new one.`,
      );
    } else {
      const probe = new ethers.Contract(
        oracleEnv,
        ["function oracleKind() view returns (string)"],
        ethers.provider,
      );
      let kind = null;
      try {
        kind = await probe.oracleKind();
      } catch {
        /* Pre-dates oracleKind(), or is not one of our oracles at all. */
      }
      const expected = backendFor(chainId);
      if (kind === null) {
        warn(
          `PYTH_PRICE_ORACLE ${oracleEnv} has code but does not answer oracleKind(). ` +
            `Either it predates that function or it is not one of our oracles.`,
        );
      } else if (kind !== expected) {
        fail(
          `PYTH_PRICE_ORACLE ${oracleEnv} reports oracleKind() "${kind}" but chain ` +
            `${chainId} is configured for "${expected}". The lending market would ` +
            `price off the wrong backend.`,
        );
      } else {
        console.log(`   ✅ PYTH_PRICE_ORACLE      ${oracleEnv} (${kind})`);
      }
    }
  }

  /* ── Feeds ───────────────────────────────────────────────────────────────
   * The check that has to happen before the deploy rather than after it: an
   * aggregator that does not exist, or publishes slower than its declared bound,
   * produces a protocol that deploys cleanly and reverts on every priced call.
   * Measured against the same `block.timestamp - updatedAt` the contract uses. */
  console.log("\n── Feeds ──");
  const backend = backendFor(chainId);
  console.log(`   backend    ${backend}`);

  if (backend !== "aggregator-v3") {
    console.log(
      `   ○  chain ${chainId} runs the Pyth backend; run probe-pyth.js for its ` +
        `per-feed freshness. There is no aggregator table to check here.`,
    );
  } else {
    let plan = [];
    try {
      plan = feedPlanFor(chainId);
    } catch (err) {
      fail(`could not build the feed plan for chain ${chainId}: ${err.message}`);
    }

    if (!plan.length) {
      fail(
        `chain ${chainId} is configured for the aggregator backend but has no feed ` +
          `table in scripts/libraries/aggregator-feeds.js. deploy-oracle.js would ` +
          `deploy an oracle with no feeds, and every token registration would fail.`,
      );
    }

    for (const feed of plan) {
      const label = feed.symbols.join("/");
      const code = await ethers.provider.getCode(feed.aggregator);
      if (code === "0x") {
        fail(
          `${label}: aggregator ${feed.aggregator} has no code on chain ${chainId}. ` +
            `Fix the address in aggregator-feeds.js before deploying.`,
        );
        console.log(`   ❌ ${label.padEnd(10)} no code at ${feed.aggregator}`);
        continue;
      }

      const agg = new ethers.Contract(feed.aggregator, AGGREGATOR_ABI, ethers.provider);

      /* Identity — decimals and description — delegated to the library rather than
       * re-checked here. The first draft of this compared description() itself and
       * got it wrong in the direction that produces false failures: the canonical
       * comparison strips slashes as well as whitespace and uppercases both sides,
       * so "ETH / USD" vs "ETH/USD" matches there and did not match here. A
       * preflight that cries wolf is worse than no preflight, and there is no reason
       * for two implementations of one rule.
       *
       * `oracle: null` because none is deployed yet — that is the whole premise of
       * running this before deploy-oracle.js. The library documents that null skips
       * only its price probe, which is exactly the part that needs an oracle. */
      const verdict = await verifyAggregatorFeed({
        oracle: null,
        aggregatorContract: agg,
        feedId: feed.id,
        feed,
        blockTime: 0,
      });

      /* Staleness, measured straight off the aggregator. This is the part the
       * library cannot do pre-deploy, and it is the check worth having most: a feed
       * slower than its declared bound deploys perfectly and then reverts on every
       * priced call. latestRoundData().updatedAt is the same timestamp the oracle
       * relays as publishTime, so this is what the contract will compute against. */
      let age = null;
      let updatedAt = null;
      try {
        const round = await agg.latestRoundData();
        updatedAt = Number(round[3]);
        /* Sampled after the read so the age is never optimistic — the same reason
         * verify-diamond.js samples per feed rather than once per run. */
        const block = await ethers.provider.getBlock("latest");
        age = Number(block.timestamp) - updatedAt;
      } catch (err) {
        /* Not fatal on its own: an API3 dAPI with no active plan reverts here by
         * design and must still be registerable, which is exactly Robinhood's
         * situation until the plan is bought. Reported so it is a known state
         * rather than a surprise at first price read. */
        warn(
          `${label}: latestRoundData() reverted (${err.shortMessage || err.message}). ` +
            `Expected for an API3 dAPI with no active plan; for a Chainlink feed it ` +
            `means this address is not serving data on chain ${chainId}.`,
        );
      }

      const bound = feed.maxAge || Number(env("PRICE_MAX_AGE_SECONDS") || 0);
      const fresh = age !== null && age <= bound;
      const mark = !verdict.ok ? "❌" : age === null ? "⚠️ " : fresh ? "✅" : "❌";

      console.log(
        `   ${mark} ${label.padEnd(10)} ` +
          `${(verdict.decimals === null ? "?" : `${verdict.decimals}dec`).padEnd(6)} ` +
          `age ${(age === null ? "unreadable" : fmtAge(age)).padEnd(16)} bound ${bound}s`,
      );

      for (const reason of verdict.reasons) fail(`${label}: ${reason}`);
      for (const w of verdict.warnings) warn(`${label}: ${w}`);

      if (updatedAt === 0) {
        fail(
          `${label}: ${feed.aggregator} has never published a round (updatedAt is 0), ` +
            `so there is no price to read at all.`,
        );
      } else if (age !== null && !fresh) {
        fail(
          `${label} is ${fmtAge(age)} old against the ${bound}s bound that will apply` +
            (feed.maxAge ? "" : " (the global default — this feed has no override)") +
            `. Either the bound is tighter than this feed's real heartbeat, or the ` +
            `feed has stopped. Registering a token against it produces a market that ` +
            `reverts on every deposit, borrow, health-factor read and liquidation.`,
        );
      }
    }
  }

  /* ── Verdict ─────────────────────────────────────────────────────────── */
  console.log("\n" + "─".repeat(60));
  if (warnings.length) {
    console.log(`\n⚠️  ${warnings.length} warning(s):`);
    warnings.forEach((w, i) => console.log(`   ${i + 1}. ${w}`));
  }
  if (problems.length) {
    console.log(`\n❌ ${problems.length} problem(s) — do not deploy:`);
    problems.forEach((p, i) => console.log(`   ${i + 1}. ${p}`));
    process.exitCode = 1;
    return;
  }
  console.log(`\n✅ ${hre.network.name} is ready to deploy.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
