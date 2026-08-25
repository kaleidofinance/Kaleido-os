/**
 * Price-oracle deployment — Pyth-backed or aggregator-backed, per chain.
 *
 *   npx hardhat run scripts/deploy-oracle.js --network arcTestnet       # Pyth
 *   npx hardhat run scripts/deploy-oracle.js --network sepolia          # Chainlink
 *   npx hardhat run scripts/deploy-oracle.js --network robinhoodTestnet # API3
 *
 * Nothing else deploys a price oracle, yet deploy.js requires PYTH_PRICE_ORACLE,
 * getCode-checks it, and refuses to cut the diamond without it. So this is the
 * first step of every chain's deploy, not an optional extra:
 * ProtocolFacet._priceScaled18 reverts with no oracle, which takes deposit,
 * borrow, health factor and liquidation offline together.
 *
 * ── Two backends, one seam ─────────────────────────────────────────────────
 *
 * The diamond asks its oracle for exactly one thing —
 * `getPrice(bytes32) -> PythStructs.Price` — and `_priceScaled18` already handles
 * an arbitrary `expo`. That makes the backend a deployment-time choice rather
 * than a protocol change:
 *
 *   pyth           PythPriceOracle(pythContract). Arc Testnet only, where Pyth is
 *                  deployed and publishing every ~104s.
 *   aggregator-v3  AggregatorPriceOracle + setFeeds(ids, aggregators). Sepolia,
 *                  Base Sepolia and BSC Testnet read Chainlink; Robinhood testnet
 *                  reads an API3 dAPI because Chainlink publishes no feed there —
 *                  it does publish 57 on Robinhood MAINNET, which is what that
 *                  chain's docs mean when they name Chainlink as its oracle. See
 *                  the 46630 note in scripts/libraries/aggregator-feeds.js.
 *
 * Base Sepolia is on the aggregator backend despite having a working Pyth
 * deployment, because Pyth publishes ETH/USD there and does not publish USDC/USD
 * at all — measured 3.6 days stale, which is past the bound the protocol is even
 * able to express. See the 84532 block in aggregator-feeds.js.
 *
 * Which chain gets which is recorded in scripts/libraries/aggregator-feeds.js,
 * with the evidence for each. Override with ORACLE_BACKEND=pyth|aggregator-v3.
 *
 * ── What this script deliberately does NOT do ──────────────────────────────
 *
 * It does not install per-feed staleness bounds. `setFeedMaxAge` lives on the
 * diamond, which does not exist yet at this point in the deploy order, so those
 * bounds are installed by register-tokens.js — which is also where feed ids meet
 * token addresses. This script prints the bounds it expects to be installed so
 * the two can be compared, and records them in its JSON.
 *
 * Writes deployment-oracle-<network>.json, which scripts/gen-registry.mjs reads.
 */

const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");

const {
  backendFor,
  feedPlanFor,
  verifyAggregatorFeed,
  PYTH_CONTRACTS,
  API3_MARKET,
} = require("./libraries/aggregator-feeds.js");
const { PYTH_BOUNDS, pythBoundPlanFor } = require("./libraries/pyth-feeds.js");
const { waitForCode, waitForState } = require("./libraries/rpc.js");

/**
 * Canonical Pyth ETH/USD feed id.
 *
 * Not a guess: this is the value PythPriceOracle.sol:11 already declares as its
 * own `ethPriceId` default. It is repeated here only so the post-deploy probe
 * below can be read without opening the contract, and it is asserted against
 * the deployed contract rather than trusted.
 */
const ETH_USD = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";

const IAGGREGATOR_ABI = [
  "function decimals() view returns (uint8)",
  "function description() view returns (string)",
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
];

/**
 * Wait until the deployed code is actually visible to the RPC we will read from.
 *
 * Thin wrapper so call sites do not each have to pass the provider. The reasoning
 * for why this is needed at all — and the two measured Base Sepolia failures that
 * motivated it — is in scripts/libraries/rpc.js.
 */
function waitForCodeHere(address, label) {
  return waitForCode(ethers.provider, address, label);
}

/* ── Pyth backend ───────────────────────────────────────────────────────── */

async function deployPythOracle(chainId) {
  /* PYTH_CONTRACT wins; the table is the fallback so a routine deploy needs no
   * env var, while an address that moves does not need a code change. */
  const pythContract = (
    process.env.PYTH_CONTRACT || PYTH_CONTRACTS[chainId] || ""
  ).trim();

  if (!pythContract || !ethers.isAddress(pythContract)) {
    throw new Error(
      "PYTH_CONTRACT is required and must be a valid address.\n" +
        "It is Pyth's own receiver contract on the target chain and differs on\n" +
        "every chain. No address is recorded for this chain in\n" +
        "scripts/libraries/aggregator-feeds.js, so pass one explicitly:\n" +
        `  PYTH_CONTRACT=0x... npx hardhat run scripts/deploy-oracle.js --network ${hre.network.name}\n` +
        "Or switch this chain to the aggregator backend with ORACLE_BACKEND=aggregator-v3.",
    );
  }

  /* The failure this prevents: PythPriceOracle takes the address as an
   * `immutable`, so a wrong value cannot be corrected after deploy — the whole
   * oracle has to be redeployed and setPythOracle called again. And a
   * wrong-chain address deploys perfectly cleanly: the constructor only wraps
   * it in IPyth. The first symptom is every price read reverting on a call to a
   * codeless address, from inside the diamond, which looks nothing like its
   * cause. */
  if ((await ethers.provider.getCode(pythContract)) === "0x") {
    throw new Error(
      `PYTH_CONTRACT ${pythContract} holds no code on ${hre.network.name}.\n` +
        "This is almost always an address copied from another chain. The oracle\n" +
        "stores it as an immutable, so it cannot be fixed after deploy — the\n" +
        "whole contract would have to be redeployed.",
    );
  }

  /* Code is not identity. 0x2880aB…7B43 is Pyth on Arc Testnet and 1,067 bytes
   * of something else on Robinhood, where getValidTimePeriod() reverts — which
   * is exactly how the Robinhood chain was found to have no Pyth at all. */
  try {
    const probe = new ethers.Contract(
      pythContract,
      ["function getValidTimePeriod() view returns (uint256)"],
      ethers.provider,
    );
    const period = await probe.getValidTimePeriod();
    console.log("  pyth:     ", pythContract, `(validTimePeriod ${period}s)`);
  } catch (err) {
    throw new Error(
      `${pythContract} holds code on ${hre.network.name} but does not answer\n` +
        `getValidTimePeriod() (${err.shortMessage || err.message}).\n` +
        "It is not a Pyth receiver. A getCode check proves a contract exists,\n" +
        "never which contract — an address copied from another chain can collide\n" +
        "with an unrelated deployment. Use ORACLE_BACKEND=aggregator-v3 if this\n" +
        "chain has no Pyth.",
    );
  }

  const Oracle = await ethers.getContractFactory("PythPriceOracle");
  const oracle = await Oracle.deploy(pythContract);
  await oracle.waitForDeployment();
  const oracleAddress = await oracle.getAddress();
  console.log("\nPythPriceOracle deployed to:", oracleAddress);
  await waitForCodeHere(oracleAddress, "PythPriceOracle");

  /* Read the immutable back. It is the one field that cannot be changed later,
   * so a mismatch here is worth catching before the diamond is pointed at it. */
  const storedPyth = await oracle.pyth();
  if (ethers.getAddress(storedPyth) !== ethers.getAddress(pythContract)) {
    throw new Error(
      `Oracle stored the wrong Pyth address: ${storedPyth} != ${pythContract}`,
    );
  }

  /* The contract ships with ETH/USD and USDC/USD feed ids baked in as mutable
   * state. Confirm the deployed values, because setEthPriceId/setUsdcPriceId
   * exist and a redeploy of a modified contract would silently change them. */
  const declaredEth = await oracle.ethPriceId();
  if (declaredEth.toLowerCase() !== ETH_USD) {
    console.warn(
      `\n⚠️  ethPriceId is ${declaredEth}, not the canonical ${ETH_USD}.\n` +
        "    The probe below tests whatever the contract declares.",
    );
  }

  /**
   * Does this oracle actually return a price right now?
   *
   * A warning rather than a failure, deliberately. The oracle contract is
   * correct either way — what this measures is whether the CHAIN has a live
   * Pyth feed, which is an operational fact about the deployment and not a
   * defect in what we just deployed. But it is a launch blocker per chain:
   * getPrice calls pyth.getPriceUnsafe, updatePrice is permissionless but nobody
   * is obliged to call it, and ProtocolFacet enforces a staleness bound on every
   * read. On a chain with no live feed and nobody relaying one, /borrow reverts on
   * every action.
   */
  console.log("\nProbing ETH/USD through the deployed oracle...");
  let probed = null;
  try {
    const price = await oracle.getPrice(declaredEth);
    const publishTime = Number(price.publishTime);
    const block = await ethers.provider.getBlock("latest");
    const ageSeconds = block.timestamp - publishTime;
    const human = Number(price.price) * 10 ** Number(price.expo);
    console.log(`   price:       ${human} (raw ${price.price}, expo ${price.expo})`);
    console.log(`   confidence:  ${price.conf}`);
    console.log(`   publishTime: ${publishTime} (${ageSeconds}s before the latest block)`);
    probed = { ageSeconds, expo: Number(price.expo) };

    const maxAge = Number(process.env.PRICE_MAX_AGE_SECONDS || 300);
    if (ageSeconds > maxAge) {
      console.warn(
        `\n⚠️  That price is ${ageSeconds}s old and PRICE_MAX_AGE_SECONDS is ${maxAge}.\n` +
          "    Every priced operation on the diamond will revert until the feed\n" +
          "    is refreshed. Either this chain has a sponsored feed that updates\n" +
          "    faster than it appears to, or you need a pusher calling\n" +
          "    PythPriceOracle.updatePrice on a shorter interval than that bound,\n" +
          "    or this chain belongs on the aggregator backend.",
      );
    }
  } catch (err) {
    console.warn(
      "\n⚠️  getPrice(ETH/USD) reverted. Pyth has no populated ETH/USD feed at\n" +
        `    ${pythContract} on ${hre.network.name}.\n` +
        `    (${err.shortMessage || err.message})\n` +
        "    The oracle is deployed and the diamond can be pointed at it, but\n" +
        "    every priced operation will revert until a price is pushed. Run\n" +
        "    `npm run probe:pyth` to see which feeds this chain does carry.",
    );
  }

  /**
   * The per-feed bounds register-tokens.js will install, and the feeds no bound
   * can cover.
   *
   * Both are reported here because both are decisions an operator has to make
   * before the next script runs, and neither is visible from the probe above: the
   * probe reads ETH/USD, which on Arc is the freshest feed on the chain, while
   * USDC/USD — the native currency there — measured 58,510s. A chain is not
   * uniformly warm, so one probe is not a verdict.
   *
   * The unboundable list is the actionable half. Constants.MAX_FEED_PRICE_AGE is
   * 90,000s, so a feed older than that cannot be bounded at any legal value and
   * register-tokens.js will REFUSE to register a token against it. Leaving those
   * symbols out of COLLATERAL_TOKENS/LOANABLE_TOKENS is the operator's step, and
   * finding that out here is cheaper than finding it out from a failed
   * registration run.
   */
  const boundPlan = pythBoundPlanFor(chainId);
  const unboundable = Object.entries(PYTH_BOUNDS[chainId] || {})
    .filter(([, b]) => b.maxAge === null)
    .map(([symbol, b]) => ({ symbol, observedAgeSeconds: b.observedAgeSeconds, basis: b.basis }));

  if (boundPlan.length > 0) {
    console.log("\nPer-feed bounds recorded for this chain (installed by register-tokens.js):");
    for (const b of boundPlan) {
      console.log(`   ${b.symbols.join("/").padEnd(10)} ${b.symbol.padEnd(18)} ${b.maxAge}s`);
    }
  }
  if (unboundable.length > 0) {
    console.warn(
      `\n⚠️  ${unboundable.length} feed${unboundable.length === 1 ? "" : "s"} on this chain ` +
        "cannot be bounded at their CURRENT age and must NOT be registered:\n" +
        unboundable
          .map(
            (u) =>
              `   ${u.symbol.padEnd(6)} ${
                u.observedAgeSeconds === null
                  ? "never populated on this chain's receiver"
                  : `${u.observedAgeSeconds}s old — ${(u.observedAgeSeconds / 90000).toFixed(1)}x MAX_FEED_PRICE_AGE`
              }`,
          )
          .join("\n") +
        "\n    Leave them out of COLLATERAL_TOKENS and LOANABLE_TOKENS.\n" +
        "    register-tokens.js refuses the whole run otherwise, which is correct:\n" +
        "    the market it would create reverts on every priced call, and nothing\n" +
        "    removes a loanable token once added.\n" +
        "    These ages describe who is RELAYING, not what Pyth publishes. Hermes\n" +
        "    very likely serves all of them within seconds, and a push repairs the\n" +
        "    on-chain age — even for a feed the receiver has never held, since\n" +
        "    updatePriceFeeds writes every id in a verified batch. So this is a\n" +
        "    'not yet' rather than a 'never': run scripts/push-prices.js with\n" +
        "    PUSH_IDS to measure a post-push age, then decide whether we can commit\n" +
        "    to a keeper tight enough for the bound that age allows.",
    );
  }

  return {
    contract: "PythPriceOracle",
    oracleKind: "pyth",
    address: oracleAddress,
    pythContract: ethers.getAddress(pythContract),
    /* Same key and same `maxAge`/`maxAgeBasis` fields the aggregator branch uses,
     * so gen-registry.mjs and the summary print need no backend special-case.
     * `aggregator` is absent rather than null — on this backend there is no feed
     * contract to name; the id IS the data source. */
    feeds: boundPlan.map((b) => ({
      symbols: b.symbols,
      id: b.id,
      pythSymbol: b.symbol,
      provider: "pyth",
      maxAge: b.maxAge,
      maxAgeBasis: b.maxAgeBasis,
    })),
    unboundable,
    probed,
  };
}

/* ── Aggregator backend ─────────────────────────────────────────────────── */

async function deployAggregatorOracle(chainId) {
  const plan = feedPlanFor(chainId);
  if (plan.length === 0) {
    throw new Error(
      `Chain ${chainId} uses the aggregator backend but no feeds are recorded for\n` +
        "it in scripts/libraries/aggregator-feeds.js. An AggregatorPriceOracle with\n" +
        "no feeds reverts FeedNotSet on every price, which would take the whole\n" +
        "lending market offline on this chain — so this refuses rather than\n" +
        "deploying something unusable.",
    );
  }

  /* Everything checked before anything is deployed. `setFeed` already validates
   * code and decimals on-chain, but it cannot know which ASSET an aggregator
   * prices, and a wrong-but-real feed does not revert — it misprices the
   * collateral permanently. So the description check runs here, off-chain,
   * before any gas is spent. */
  console.log(`\n1. Verifying ${plan.length} aggregator${plan.length === 1 ? "" : "s"}`);
  const block = await ethers.provider.getBlock("latest");
  const failures = [];

  for (const feed of plan) {
    const label = `${feed.symbols.join("/")} @ ${feed.aggregator}`;

    if ((await ethers.provider.getCode(feed.aggregator)) === "0x") {
      failures.push(`${label}: holds no code on ${hre.network.name}`);
      continue;
    }

    const aggregatorContract = new ethers.Contract(
      feed.aggregator,
      IAGGREGATOR_ABI,
      ethers.provider,
    );

    const verdict = await verifyAggregatorFeed({
      oracle: null, // pre-registration: getPrice cannot answer yet
      aggregatorContract,
      feedId: feed.id,
      feed,
      blockTime: block.timestamp,
    });

    if (!verdict.ok) {
      failures.push(`${label}: ${verdict.reasons.join("; ")}`);
      continue;
    }
    for (const w of verdict.warnings) console.warn(`   ⚠️  ${label}: ${w}`);
    console.log(
      `   ✓ ${label} — ${verdict.decimals} decimals, ` +
        `${feed.provider}, bound ${feed.maxAge}s`,
    );
  }

  if (failures.length > 0) {
    throw new Error(
      `${failures.length} feed${failures.length === 1 ? "" : "s"} failed verification:\n` +
        failures.map((f) => `   - ${f}`).join("\n") +
        "\n\nNothing was deployed. Fix the table in " +
        "scripts/libraries/aggregator-feeds.js, or override with\n" +
        "AGGREGATOR_<SYMBOL>=0x… for a one-off.",
    );
  }

  const Oracle = await ethers.getContractFactory("AggregatorPriceOracle");
  const oracle = await Oracle.deploy();
  await oracle.waitForDeployment();
  const oracleAddress = await oracle.getAddress();
  console.log("\nAggregatorPriceOracle deployed to:", oracleAddress);
  await waitForCodeHere(oracleAddress, "AggregatorPriceOracle");

  /* One atomic call, not one per feed. A partially configured oracle is a market
   * where some collateral prices and some reverts, which is harder to diagnose
   * than one that fails uniformly — and re-running a per-feed loop after a
   * mid-way failure leaves the operator guessing which ones landed. */
  console.log(`\n2. Registering ${plan.length} feed${plan.length === 1 ? "" : "s"}`);
  const tx = await oracle.setFeeds(
    plan.map((f) => f.id),
    plan.map((f) => f.aggregator),
  );
  await tx.wait();
  console.log("   setFeeds:", tx.hash);

  /* Read every one back. `setFeed` caches `decimals()` at registration, and that
   * cached value is what every subsequent rescale uses — so it is the number
   * worth confirming, not the one the aggregator reports now. */
  console.log("\n3. Reading feeds back and probing prices");
  /* A fresh block, not the one step 1 measured against. Deploying and calling
   * setFeeds takes tens of seconds, and Chainlink kept publishing throughout —
   * so reusing the pre-deploy timestamp reported ages of -8s and -18s for the two
   * feeds that had refreshed in the meantime, and those numbers were written into
   * the JSON record as provenance. A negative age is obviously wrong; worse is
   * that the same stale reference point makes the staleness warning below compare
   * against a moment that has passed. */
  const readBlock = await ethers.provider.getBlock("latest");
  const recorded = [];
  for (const feed of plan) {
    /* Polled, not read once. `setFeeds` was confirmed above, but the read can
     * still be served by a node behind that block — and a lagging node answers
     * `address(0)` rather than erroring, which is exactly what an unregistered
     * feed looks like. Measured on Base Sepolia 2026-08-21: this read reported
     * the zero address for ETH/USD on a setFeeds that had status 1 and four
     * logs, and the same call from a fresh process returned all four feeds. The
     * accept test asks only "is it set", so a genuinely wrong address still
     * fails the equality check below rather than being polled for. */
    const storedAggregator = await waitForState({
      read: () => oracle.feedAggregator(feed.id),
      accept: (a) => a !== ethers.ZeroAddress,
      label: `feed ${feed.symbols.join("/")}`,
      hint:
        `setFeeds tx: ${tx.hash}\n` +
        "That transaction is idempotent — every setFeed is a plain mapping write — " +
        "so re-running this script is safe, but it deploys a NEW oracle. To re-check " +
        "this one instead, read feedAggregator on it directly.",
    });
    const storedDecimals = Number(await oracle.feedDecimals(feed.id));
    if (ethers.getAddress(storedAggregator) !== ethers.getAddress(feed.aggregator)) {
      throw new Error(
        `Feed ${feed.id} stored ${storedAggregator}, expected ${feed.aggregator}`,
      );
    }
    if (feed.decimals !== null && storedDecimals !== feed.decimals) {
      throw new Error(
        `Feed ${feed.id} cached ${storedDecimals} decimals, expected ${feed.decimals}. ` +
          "Every price from it would be off by a power of ten.",
      );
    }

    const verdict = await verifyAggregatorFeed({
      oracle,
      aggregatorContract: new ethers.Contract(feed.aggregator, IAGGREGATOR_ABI, ethers.provider),
      feedId: feed.id,
      feed,
      blockTime: readBlock.timestamp,
    });

    let human = null;
    let ageSeconds = verdict.ageSeconds;
    try {
      const price = await oracle.getPrice(feed.id);
      human = Number(price.price) * 10 ** Number(price.expo);
      console.log(
        `   ${feed.symbols.join("/")}: $${human} ` +
          `(raw ${price.price}, expo ${price.expo}, ${ageSeconds}s old)`,
      );
    } catch {
      console.warn(
        `   ⚠️  ${feed.symbols.join("/")}: no price yet. ` +
          (feed.provider === "api3"
            ? "Buy a plan on Api3Market to activate this dAPI — the feed is " +
              "registered and will start answering with no further deploy."
            : "This Chainlink feed is not serving data on this chain."),
      );
    }
    for (const w of verdict.warnings) console.warn(`   ⚠️  ${feed.symbols.join("/")}: ${w}`);

    recorded.push({
      feedId: feed.id,
      symbols: feed.symbols,
      aggregator: ethers.getAddress(feed.aggregator),
      provider: feed.provider,
      decimals: storedDecimals,
      /* Recorded so register-tokens.js can be checked against the same figure,
       * and so a later reader can see WHY the bound is what it is rather than
       * finding an unexplained number in storage. */
      maxAge: feed.maxAge,
      maxAgeBasis: feed.maxAgeBasis,
      priceAtDeploy: human,
      ageSecondsAtDeploy: ageSeconds,
    });
  }

  if (API3_MARKET[chainId]) {
    const m = API3_MARKET[chainId];
    console.log(
      `\n   API3 market on this chain:\n` +
        `     market:       ${m.market}\n` +
        `     proxyFactory: ${m.proxyFactory}\n` +
        `     ${m.note}`,
    );
  }

  return {
    contract: "AggregatorPriceOracle",
    oracleKind: "aggregator-v3",
    address: oracleAddress,
    pythContract: null,
    feeds: recorded,
    probed: null,
  };
}

/* ── Entry point ────────────────────────────────────────────────────────── */

async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const backend = backendFor(chainId);

  console.log("Deploying price oracle");
  console.log("  network:  ", hre.network.name, `(chainId ${chainId})`);
  console.log("  backend:  ", backend, process.env.ORACLE_BACKEND ? "(from ORACLE_BACKEND)" : "");
  console.log("  deployer: ", deployer.address);
  console.log(
    "  balance:  ",
    ethers.formatEther(await ethers.provider.getBalance(deployer.address)),
  );

  const result =
    backend === "pyth"
      ? await deployPythOracle(chainId)
      : await deployAggregatorOracle(chainId);

  /* Confirm the deployed contract agrees about what it is. Both backends answer
   * oracleKind(), so this is a positive identification rather than an inference
   * from which script branch ran — and it is what register-tokens.js will read to
   * decide how to verify feeds. */
  const kindProbe = new ethers.Contract(
    result.address,
    ["function oracleKind() view returns (string)"],
    ethers.provider,
  );
  const reportedKind = await kindProbe.oracleKind();
  if (reportedKind !== result.oracleKind) {
    throw new Error(
      `Deployed ${result.contract} reports oracleKind() "${reportedKind}", ` +
        `expected "${result.oracleKind}".`,
    );
  }

  const deploymentInfo = {
    network: hre.network.name,
    chainId,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    oracleKind: result.oracleKind,
    contracts: {
      priceOracle: result.address,
      /* Kept under its original key so gen-registry.mjs and anything else
       * reading these files does not have to special-case the backend. Null on
       * aggregator chains, which is the honest value — there is no Pyth there. */
      pythContract: result.pythContract,
    },
    feeds: result.feeds,
    /* Absent on aggregator chains, where every recorded feed is boundable by
     * construction — aggregator-feeds.js has no way to express "unboundable"
     * because a feed that stale is moved off the table, not annotated on it. */
    ...(result.unboundable?.length ? { unboundable: result.unboundable } : {}),
  };

  const filename = `deployment-oracle-${hre.network.name}.json`;
  fs.writeFileSync(filename, JSON.stringify(deploymentInfo, null, 2));

  console.log("\n============================================================");
  console.log("ORACLE DEPLOYMENT SUMMARY");
  console.log("============================================================");
  console.log(`${result.contract}: `, result.address);
  console.log("oracleKind:      ", reportedKind, "(read back from the contract)");
  if (result.pythContract) console.log("Pyth contract:   ", result.pythContract);
  for (const f of result.feeds) {
    /* Two backends, two things worth naming. An aggregator feed is identified by
     * the contract it reads; a Pyth feed has no such contract — the id is the
     * source — so printing `undefined undefinedp undefined` there would be worse
     * than useless, it would read like a missing address. */
    console.log(
      f.aggregator
        ? `  ${f.symbols.join("/").padEnd(8)} ${f.aggregator} ` +
            `${f.decimals}dp ${f.provider} bound=${f.maxAge}s`
        : `  ${f.symbols.join("/").padEnd(8)} ${f.id} ` +
            `${f.pythSymbol} bound=${f.maxAge}s`,
    );
  }

  const needBounds = result.feeds.filter(
    (f) => f.maxAge > Number(process.env.PRICE_MAX_AGE_SECONDS || 300),
  );
  if (needBounds.length > 0) {
    console.log(
      `\n${needBounds.length} feed${needBounds.length === 1 ? "" : "s"} need a per-feed ` +
        "staleness bound above the global default.\n" +
        "register-tokens.js installs these via setFeedMaxAge after the diamond is\n" +
        "cut — this script cannot, the diamond does not exist yet. Without them\n" +
        "every priced operation on these assets reverts:\n" +
        needBounds
          .map((f) => `   ${f.symbols.join("/")}: ${f.maxAge}s`)
          .join("\n"),
    );
  }

  console.log(
    "\nNext: deploy the diamond with this address.\n" +
      `  PYTH_PRICE_ORACLE=${result.address} \\\n` +
      "  KALEIDO_FEE_VAULT=0x... \\\n" +
      `  npx hardhat run scripts/deploy.js --network ${hre.network.name}`,
  );
  console.log("Saved to:", filename);
  console.log("============================================================");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
