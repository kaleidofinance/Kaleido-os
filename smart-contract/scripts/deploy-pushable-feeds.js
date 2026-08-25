/**
 * Deploy the price feeds we publish ourselves, for a chain where no oracle does.
 *
 *   npx hardhat run scripts/deploy-pushable-feeds.js --network robinhoodTestnet
 *
 * This is the FIRST step of the deploy on any chain whose feeds are ours —
 * before deploy-oracle.js, which registers these addresses, and long before the
 * diamond, which reads prices through them. Robinhood Chain Testnet (46630) is
 * the only such chain in the wave: nobody publishes a price there, so we do.
 * The evidence for that, and what publishing our own price costs, is in the
 * 46630 note in scripts/libraries/aggregator-feeds.js — read it before running
 * this. The short version: the price becomes ours, one key writes it, and on
 * this wave that key is public, so ownership must move to the diamond's multisig
 * and a dedicated keeper must be authorised before this is anything but a
 * testnet.
 *
 * ── What it deploys ─────────────────────────────────────────────────────────
 *
 * One PushablePriceFeed per DISTINCT Pyth feed id among the chain's
 * `kaleido-push` entries. ETH and WETH share the ETH/USD id, so they collapse to
 * one contract and one keeper obligation — the same de-dup feedPlanFor does for
 * registration, kept in step here so the deploy and the registration agree on
 * how many feeds exist. Robinhood therefore gets two: ETH/USD (serving ETH and
 * WETH) and USDC/USD.
 *
 * ── Why it seeds a first answer ─────────────────────────────────────────────
 *
 * A freshly deployed feed has no round, so latestRoundData() reports
 * updatedAt == 0 and AggregatorPriceOracle.getPrice reverts RoundNotComplete —
 * which fails closed, correctly, but leaves /borrow dead on the chain until the
 * keeper first runs. Seeding from Hermes here means the oracle's own post-deploy
 * probe in deploy-oracle.js can read a real price, and the market is live the
 * moment the diamond is cut rather than only after the first keeper cycle. The
 * seed is scaled by the same helper the keeper uses, so the first keeper push
 * continues the series instead of jumping it.
 *
 * A feed Hermes cannot serve is refused rather than deployed unseeded, because a
 * deployed-but-dead feed is the silent-broken-market failure these scripts exist
 * to prevent. Pass SEED_OPTIONAL=1 to deploy it unseeded anyway and let the
 * keeper seed it on first run — the market stays closed for that asset until it
 * does.
 *
 * ── The deviation guard it sets ─────────────────────────────────────────────
 *
 * Each feed is deployed with a deviation guard (FEED_MAX_DEVIATION_BPS, default
 * 5000 = 50%). It is deliberately loose: its job is to catch a keeper BUG — a
 * decimals or units error that arrives as an order-of-magnitude jump and would
 * reprice all collateral in one push — not to constrain a hostile pusher, who
 * can walk the price anywhere in steps under the limit. A 10x decimals error is
 * a 900% move and any sane bound rejects it; a real testnet ETH move between
 * hourly pushes is under a few percent. When a genuine gap needs a large step
 * (the keeper was down for days and the price really moved), owner-only
 * forceAnswer is the escape hatch, and it emits a distinct event so bypassing
 * the guard is findable in the logs. Set FEED_MAX_DEVIATION_BPS=0 to disable it.
 *
 * Writes pricefeeds-<network>.json, which scripts/libraries/aggregator-feeds.js
 * (resolveSelfHosted) reads to fill in the addresses the AGGREGATORS table left
 * null, and which push-aggregator.js reads as a fallback when it cannot reach
 * the oracle on-chain.
 */

const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");

const { backendFor, selfHostedPlanFor } = require("./libraries/aggregator-feeds.js");
const { waitForCode } = require("./libraries/rpc.js");
const { fetchScaledPrices, HERMES_ENDPOINT } = require("./libraries/hermes-prices.js");

/** The feed publishes 8-decimal answers — Chainlink's convention, and what the
 *  Robinhood mainnet feeds these stand in for report. See the 46630 note. */
const TARGET_DECIMALS = 8;

/** Loose by design — see the deviation-guard note in the file header. */
const DEFAULT_MAX_DEVIATION_BPS = 5000;

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = hre.network.name;
  const chainId = Number((await ethers.provider.getNetwork()).chainId);

  console.log("Deploying self-hosted price feeds");
  console.log("  network:  ", net, `(chainId ${chainId})`);
  console.log("  deployer: ", deployer.address);
  console.log(
    "  balance:  ",
    ethers.formatEther(await ethers.provider.getBalance(deployer.address)),
  );

  /* This runs before deploy-oracle.js, which is where the backend is chosen, so
   * report the backend here too — a self-hosted feed on a chain that turns out
   * to read Chainlink would be a dead contract nobody registers. */
  const backend = backendFor(chainId);
  console.log("  backend:  ", backend);

  const plan = selfHostedPlanFor(chainId);
  if (plan.length === 0) {
    throw new Error(
      `Chain ${chainId} has no self-hosted (kaleido-push) feeds in ` +
        "scripts/libraries/aggregator-feeds.js, so there is nothing for this\n" +
        "script to deploy. It is only for chains that price themselves because\n" +
        "no oracle publishes there — currently Robinhood Testnet (46630) alone.\n" +
        "Every other chain reads Chainlink or Pyth and needs deploy-oracle.js\n" +
        "directly.",
    );
  }

  const maxDeviationBps = process.env.FEED_MAX_DEVIATION_BPS
    ? Number(process.env.FEED_MAX_DEVIATION_BPS)
    : DEFAULT_MAX_DEVIATION_BPS;
  if (!Number.isInteger(maxDeviationBps) || maxDeviationBps < 0 || maxDeviationBps > 1_000_000) {
    throw new Error(
      `FEED_MAX_DEVIATION_BPS must be an integer 0..1000000, got ${process.env.FEED_MAX_DEVIATION_BPS}.`,
    );
  }

  const seedOptional = process.env.SEED_OPTIONAL === "1";

  /* ── 1. Prices to seed with, one Hermes request for every feed ─────────── */

  console.log(`\n1. Fetching seed prices from Hermes for ${plan.length} feed(s)`);
  const scaled = await fetchScaledPrices(plan.map((f) => f.id), TARGET_DECIMALS);

  const missing = plan.filter((f) => !scaled.has(f.id));
  if (missing.length && !seedOptional) {
    throw new Error(
      `Hermes served no price for ${missing.length} feed(s):\n` +
        missing.map((f) => `   - ${f.symbols.join("/")} (${f.id})`).join("\n") +
        "\n\nDeploying them unseeded leaves the market closed for those assets\n" +
        "until the keeper first runs. Fix the ids, or pass SEED_OPTIONAL=1 to\n" +
        "deploy unseeded on purpose and let push-aggregator.js seed them.",
    );
  }
  for (const f of plan) {
    const s = scaled.get(f.id);
    console.log(
      s
        ? `   ${f.symbols.join("/").padEnd(11)} ${f.description.padEnd(11)} ` +
            `seed ${s.answer} (raw ${s.rawPrice}e${s.rawExpo}, observed ${s.publishTime})`
        : `   ${f.symbols.join("/").padEnd(11)} ${f.description.padEnd(11)} NO seed — deploy unseeded`,
    );
  }

  /* ── 2. Deploy and seed each feed ──────────────────────────────────────── */

  console.log(
    `\n2. Deploying ${plan.length} PushablePriceFeed(s) ` +
      `(${TARGET_DECIMALS} decimals, deviation guard ${maxDeviationBps}bps)`,
  );

  const Feed = await ethers.getContractFactory("PushablePriceFeed");
  const records = [];

  for (const f of plan) {
    const feed = await Feed.deploy(TARGET_DECIMALS, f.description, maxDeviationBps);
    await feed.waitForDeployment();
    const address = await feed.getAddress();
    console.log(`\n   ${f.symbols.join("/")}  ${f.description}`);
    console.log(`     deployed ${address}`);
    await waitForCode(ethers.provider, address, `PushablePriceFeed ${f.symbols.join("/")}`);

    /* Confirm the constructor took, before seeding. decimals() and
     * description() are what AggregatorPriceOracle.setFeed reads; a mismatch
     * here means setFeed would cache the wrong thing later. */
    const onDecimals = Number(await feed.decimals());
    const onDescription = await feed.description();
    if (onDecimals !== TARGET_DECIMALS) {
      throw new Error(`${address} reports ${onDecimals} decimals, expected ${TARGET_DECIMALS}.`);
    }
    if (onDescription !== f.description) {
      throw new Error(`${address} describes "${onDescription}", expected "${f.description}".`);
    }

    let seededPrice = null;
    let seededAt = null;
    const s = scaled.get(f.id);
    if (s) {
      /* observedAt is Hermes' publish time — the moment the price was OBSERVED,
       * which is what latestRoundData().updatedAt must report. But the feed
       * rejects a timestamp ahead of the block that mines the push (the facet
       * would underflow ageing it), and an L2's clock can trail real time by a
       * second or two. So clamp to the latest block timestamp when that happens,
       * and say so — the tiny understatement of freshness is safe; a revert on
       * the seed is not. */
      const block = await ethers.provider.getBlock("latest");
      let observedAt = s.publishTime;
      if (observedAt > block.timestamp) {
        console.log(
          `     ⚠️  Hermes observed at ${observedAt} but the chain's latest block ` +
            `is ${block.timestamp}; clamping observedAt to block time for the seed.`,
        );
        observedAt = block.timestamp;
      }

      const tx = await feed.pushAnswer(s.answer, observedAt);
      await tx.wait();
      seededPrice = s.answer.toString();
      seededAt = observedAt;

      /* Read it straight back through the AggregatorV3 surface the oracle will
       * use — proves the seed is visible the way getPrice will see it. */
      const [, answer, , updatedAt] = await feed.latestRoundData();
      if (answer.toString() !== seededPrice || Number(updatedAt) !== observedAt) {
        throw new Error(
          `Seed read back wrong on ${address}: answer ${answer} / updatedAt ${updatedAt}, ` +
            `expected ${seededPrice} / ${observedAt}.`,
        );
      }
      const human = Number(answer) / 10 ** TARGET_DECIMALS;
      console.log(`     seeded  $${human} (${answer}, observed ${observedAt})`);
    } else {
      console.log("     unseeded — getPrice fails closed until the keeper pushes");
    }

    records.push({
      symbols: f.symbols,
      feedId: f.id,
      aggregator: address,
      description: f.description,
      decimals: TARGET_DECIMALS,
      maxAge: f.maxAge,
      maxDeviationBps,
      seededPrice,
      seededAt,
    });
  }

  /* ── 3. Record ─────────────────────────────────────────────────────────── */

  const record = {
    network: net,
    chainId,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    hermes: HERMES_ENDPOINT,
    feeds: records,
  };
  const filename = `pricefeeds-${net}.json`;
  fs.writeFileSync(filename, JSON.stringify(record, null, 2));

  console.log("\n============================================================");
  console.log("SELF-HOSTED PRICE FEED SUMMARY");
  console.log("============================================================");
  for (const r of records) {
    console.log(
      `  ${r.symbols.join("/").padEnd(8)} ${r.aggregator}  ${r.description}  ` +
        `bound=${r.maxAge}s  ${r.seededPrice ? "seeded" : "UNSEEDED"}`,
    );
  }
  console.log(
    "\nThese feeds are OURS: one key writes each price. Until ownership moves,\n" +
      `that key is the deployer ${deployer.address}, which the wave treats as\n` +
      "public — it can value all collateral on this chain. Transfer each feed's\n" +
      "owner to the diamond's multisig and authorise a dedicated keeper (setPusher)\n" +
      "before this chain is anything but a testnet.",
  );
  console.log(
    "\nNext:\n" +
      `  1. npx hardhat run scripts/deploy-oracle.js --network ${net}\n` +
      "     (reads these addresses via resolveSelfHosted and registers them)\n" +
      `  2. schedule scripts/push-aggregator.js --network ${net} tighter than the\n` +
      "     smallest bound above — a feed that is not pushed inside its bound\n" +
      "     takes that asset offline. This is not a daemon.",
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
