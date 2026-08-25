/**
 * Pyth availability probe. Read-only; spends no gas and needs no deployer key.
 *
 *   PYTH_CONTRACT=0x... npx hardhat run scripts/probe-pyth.js --network arcTestnet
 *
 * Answers the two questions that decide whether a chain can host the lending
 * protocol at all, and that nothing else in this repo asks:
 *
 *  1. Does Pyth exist on this chain, at the address you have?
 *  2. Are its feeds fresh enough?
 *
 * Question 2 is the one that gets missed. PythPriceOracle.getPrice calls
 * pyth.getPriceUnsafe, which has no freshness guarantee whatsoever, and
 * ProtocolFacet then enforces PRICE_MAX_AGE_SECONDS (default 300) on every read.
 * Nothing in this repository pushes prices on-chain — src/lib/points/prices.ts
 * hits Hermes off-chain, for points only. updatePrice is permissionless, so
 * anyone CAN relay a signed update, but nobody is obliged to. So on a chain
 * whose feeds are not kept warm by someone else, every priced operation
 * reverts: deposit, borrow, health factor, liquidation. That is a
 * per-chain launch blocker, not a nicety, and it is invisible until the first
 * user tries to borrow.
 *
 * Which is why this probe measures ages per feed instead of reporting a single
 * verdict per chain: a chain is not uniformly warm. Arc Testnet (5042002)
 * measured ETH/USD at 4s and USDC/USD at 58,510s on the same block — and Arc's
 * native currency is USDC, so the asset every user posts as collateral had the
 * stalest feed on the chain.
 *
 * With no PYTH_CONTRACT set the probe still runs the off-chain half, which
 * verifies the feed-id table against Pyth's own registry. That half is worth
 * running on its own.
 */

const hre = require("hardhat");
const { ethers } = hre;
const {
  FEEDS,
  fetchHermesSymbols,
  HERMES_ENDPOINT,
} = require("./libraries/pyth-feeds.js");

/** Bound we are probing against, matching deploy.js's default. */
const MAX_AGE = Number(process.env.PRICE_MAX_AGE_SECONDS || 300);

async function main() {
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);

  console.log("Pyth probe");
  console.log("  network:", hre.network.name, `(chainId ${chainId})`);
  console.log("  bound:  PRICE_MAX_AGE_SECONDS =", MAX_AGE, "seconds");

  /* ---- off-chain half: is the feed-id table right? --------------------- */

  console.log(`\n1. Verifying feed ids against Pyth's registry (${HERMES_ENDPOINT})`);
  const hermes = await fetchHermesSymbols();
  let tableProblems = 0;

  if (hermes) {
    console.log(`   Hermes lists ${hermes.size} crypto feeds.\n`);
    console.log(
      "   " +
        "token".padEnd(7) +
        "expected".padEnd(20) +
        "provenance".padEnd(11) +
        "verdict",
    );
    for (const [token, feed] of Object.entries(FEEDS)) {
      const actual = hermes.get(feed.id.toLowerCase());
      let verdict;
      if (!actual) {
        verdict = "NOT LISTED as a crypto feed";
        tableProblems++;
      } else if (actual.toUpperCase() !== feed.symbol.toUpperCase()) {
        verdict = `MISMATCH — Pyth calls it ${actual}`;
        tableProblems++;
      } else {
        verdict = "ok";
      }
      console.log(
        "   " +
          token.padEnd(7) +
          feed.symbol.padEnd(20) +
          feed.source.padEnd(11) +
          verdict,
      );
    }
  } else {
    console.log(
      "   Skipped — Hermes unreachable. The ids will be checked on-chain\n" +
        "   below, which proves they exist but not which asset they name.",
    );
  }

  /* ---- on-chain half: does this chain serve them, and how stale? -------- */

  const pythContract = (process.env.PYTH_CONTRACT || "").trim();
  if (!pythContract) {
    console.log(
      "\n2. Skipped — PYTH_CONTRACT is not set.\n" +
        "   Find Pyth's address for this chain in their contract-address list\n" +
        `   and re-run:  PYTH_CONTRACT=0x... npx hardhat run scripts/probe-pyth.js --network ${hre.network.name}\n` +
        "\n   If Pyth has no deployment on this chain at all, that is the answer:\n" +
        "   the lending protocol cannot price anything here, and this chain\n" +
        "   should carry the DEX only until a price source exists.",
    );
    process.exitCode = tableProblems > 0 ? 1 : 0;
    return;
  }

  if (!ethers.isAddress(pythContract)) {
    throw new Error(`PYTH_CONTRACT is not a valid address: ${pythContract}`);
  }

  console.log(`\n2. Probing Pyth at ${pythContract} on ${hre.network.name}`);
  const code = await ethers.provider.getCode(pythContract);
  if (code === "0x") {
    console.error(
      `   ✗ No contract code at that address on ${hre.network.name}.\n` +
        "     Almost always an address copied from another chain. Deploying the\n" +
        "     oracle against it would succeed and then revert on every price\n" +
        "     read, from inside the diamond, where the cause is invisible.",
    );
    process.exitCode = 1;
    return;
  }
  console.log(`   code present (${(code.length - 2) / 2} bytes)`);

  const pyth = await ethers.getContractAt("IPyth", pythContract);
  const block = await ethers.provider.getBlock("latest");
  console.log(
    `   latest block ${block.number}, timestamp ${block.timestamp}\n`,
  );

  console.log(
    "   " +
      "token".padEnd(7) +
      "price".padEnd(16) +
      "age".padEnd(12) +
      "conf (bps)".padEnd(12) +
      "verdict",
  );

  /* One entry per distinct feed id: ETH and WETH share one, so probing both
   * would double the calls and report the same feed twice. */
  const byId = new Map();
  for (const [token, feed] of Object.entries(FEEDS)) {
    if (!byId.has(feed.id)) byId.set(feed.id, { tokens: [], feed });
    byId.get(feed.id).tokens.push(token);
  }

  let live = 0;
  let stale = 0;
  let missing = 0;

  for (const { tokens, feed } of byId.values()) {
    const label = tokens.join("/");
    try {
      const p = await pyth.getPriceUnsafe(feed.id);
      const age = block.timestamp - Number(p.publishTime);
      const human = Number(p.price) * 10 ** Number(p.expo);
      /* Pyth's conf is in the same units as price, so bps of price is the
       * comparable figure — it is what ProtocolFacet bounds via
       * priceMaxConfBps. */
      const confBps =
        Number(p.price) === 0
          ? Infinity
          : (Number(p.conf) / Number(p.price)) * 10000;

      let verdict;
      if (age > MAX_AGE) {
        verdict = `STALE by ${age - MAX_AGE}s — every priced op reverts`;
        stale++;
      } else {
        verdict = "ok";
        live++;
      }

      console.log(
        "   " +
          label.padEnd(7) +
          human.toPrecision(8).padEnd(16) +
          `${age}s`.padEnd(12) +
          confBps.toFixed(1).padEnd(12) +
          verdict,
      );
    } catch (err) {
      missing++;
      console.log(
        "   " +
          label.padEnd(7) +
          "-".padEnd(16) +
          "-".padEnd(12) +
          "-".padEnd(12) +
          `NOT SERVED (${err.shortMessage || err.message})`,
      );
    }
  }

  /* ---- verdict ---------------------------------------------------------- */

  console.log("\n============================================================");
  console.log(`VERDICT for ${hre.network.name} (chainId ${chainId})`);
  console.log("============================================================");
  console.log(`  feeds live and fresh:  ${live}`);
  console.log(`  feeds live but stale:  ${stale}`);
  console.log(`  feeds not served:      ${missing}`);
  if (hermes) console.log(`  table problems:        ${tableProblems}`);

  if (live === 0) {
    console.log(
      "\n  Nothing on this chain can be priced right now. Before deploying the\n" +
        "  lending protocol here you need either a sponsored feed that stays\n" +
        `  inside ${MAX_AGE}s, or a pusher calling PythPriceOracle.updatePrice on\n` +
        "  a shorter interval. Without one, /borrow reverts on every action.",
    );
  } else if (stale > 0) {
    console.log(
      "\n  Some feeds are outside the bound. Either raise PRICE_MAX_AGE_SECONDS\n" +
        "  (understanding that every second of slack is a second in which a\n" +
        "  liquidation can be priced off a number that has stopped being true),\n" +
        "  or run a pusher, or register only the assets whose feeds stay fresh.",
    );
  } else {
    console.log(
      "\n  Every feed in the table is live and inside the bound. Note this is a\n" +
        "  snapshot: re-run it before registering tokens, and understand that a\n" +
        "  feed being fresh now is not a commitment that it stays fresh.",
    );
  }
  console.log("============================================================");

  process.exitCode = tableProblems > 0 || live === 0 ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
