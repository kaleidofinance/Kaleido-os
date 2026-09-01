/**
 * Grant (or revoke) the pusher role on the feeds we publish ourselves.
 *
 * ── Why this exists ───────────────────────────────────────────────────────────
 *
 * `PushablePriceFeed.pushAnswer` accepts the owner OR any address in `isPusher`,
 * and `setPusher` is the owner's way of naming the second kind. Until this script
 * ran, only the owner could push — and the owner is the deployer, the key that
 * owns every contract on every chain. That made the routine act of refreshing a
 * price something only the most powerful key we hold could do, so the price-keeper
 * workflow either holds that key in CI or does not run at all. It did not run: the
 * ETH/USD feed on Robinhood sat 3.2 hours past its one-hour bound, and the diamond
 * answered `Protocol__StalePrice` for WETH and for native ETH while USDC — a
 * 25-hour bound — still priced. Lending against ETH was down for want of a signer.
 *
 * A pusher can do exactly one thing: submit an answer that passes the feed's own
 * validation (bounds, monotonic timestamp, deviation ceiling). It cannot change a
 * bound, cannot re-baseline with `forceAnswer`, cannot name another pusher and
 * cannot move ownership. So a leaked keeper key costs us a wrong price inside the
 * deviation ceiling until the owner revokes it — which is the trade push-aggregator.js
 * already names as the intended end state ("move each feed's owner off the deployer
 * key to a keeper + multisig").
 *
 * ── What it reads ─────────────────────────────────────────────────────────────
 *
 * The same chain the keeper does: `oracle.feedAggregator(feedId)`, not the local
 * pricefeeds-<net>.json. Granting on an address the protocol no longer prices
 * against would report success and leave the live feed ungranted, which is the one
 * failure this script must not have — and it is a real risk, since the record file
 * on Robinhood is a bare array where recordAddressFor() expects `{feeds: [...]}`,
 * so the fallback silently finds nothing.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *
 *   PUSHER_ADDRESS=0x… npx hardhat run scripts/grant-pusher.js --network robinhoodTestnet
 *   PUSHER_ADDRESS=0x… PUSHER_REVOKE=1 npx hardhat run scripts/grant-pusher.js --network …
 *
 * Idempotent: a feed that already agrees is reported and skipped, so re-running
 * after adding a feed costs one read per existing feed and nothing else.
 */

const fs = require("fs");
const hre = require("hardhat");
const { ethers } = hre;
const { selfHostedPlanFor, backendFor } = require("./libraries/aggregator-feeds.js");

function resolveOracle(network) {
  const file = `deployment-oracle-${network}.json`;
  if (fs.existsSync(file)) {
    const record = JSON.parse(fs.readFileSync(file, "utf8"));
    const addr = record?.contracts?.priceOracle;
    if (addr && ethers.isAddress(addr)) return { address: addr, from: file };
  }
  const env = (process.env.PRICE_ORACLE || process.env.PYTH_PRICE_ORACLE || "").trim();
  if (env && ethers.isAddress(env)) return { address: env, from: ".env" };
  throw new Error(
    `No oracle address for ${network}.\n` +
      `Expected deployment-oracle-${network}.json or PRICE_ORACLE in .env.`,
  );
}

async function main() {
  const net = hre.network.name;
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const [signer] = await ethers.getSigners();

  const target = (process.env.PUSHER_ADDRESS || "").trim();
  if (!ethers.isAddress(target)) {
    throw new Error(
      "PUSHER_ADDRESS must be the address to grant. It is passed rather than\n" +
        "derived so the keeper's private key never has to be present to grant it.",
    );
  }
  const allow = process.env.PUSHER_REVOKE !== "1";

  console.log(`\n🔑 ${allow ? "Granting" : "Revoking"} the pusher role on ${net} (chain ${chainId})`);
  console.log(`   owner-signer ${signer.address}`);
  console.log(`   pusher       ${ethers.getAddress(target)}`);

  if (ethers.getAddress(target) === signer.address) {
    console.log(
      "\n   Nothing to do: `pushAnswer` permits the owner whatever the mapping says,\n" +
        "   so granting the owner its own entry changes nothing — and revoking it\n" +
        "   would not lock the owner out either. Pass the keeper's address.",
    );
    return;
  }

  const plan = selfHostedPlanFor(chainId);
  if (plan.length === 0) {
    throw new Error(
      `Chain ${chainId} has no self-hosted (kaleido-push) feeds in\n` +
        "scripts/libraries/aggregator-feeds.js. Only feeds we publish ourselves\n" +
        "have a pusher role — Chainlink, API3 and Pyth publish their own.",
    );
  }
  console.log(`   backend ${backendFor(chainId)} (${plan.length} self-hosted feed(s))`);

  const { address: oracleAddress, from } = resolveOracle(net);
  if ((await ethers.provider.getCode(oracleAddress)) === "0x") {
    throw new Error(`No contract at ${oracleAddress} on ${net} (from ${from}).`);
  }
  const oracle = await ethers.getContractAt("AggregatorPriceOracle", oracleAddress, signer);
  console.log(`   oracle  ${oracleAddress} (${from})`);

  let changed = 0;
  let already = 0;
  const refused = [];

  for (const entry of plan) {
    const label = entry.symbols.join("/");
    let address = ethers.ZeroAddress;
    try {
      address = await oracle.feedAggregator(entry.id);
    } catch {
      /* handled below — an oracle that cannot answer is not a feed we can grant on */
    }
    if (!address || address === ethers.ZeroAddress) {
      refused.push(`${label}: the oracle has no aggregator for ${entry.id}`);
      continue;
    }

    const feed = await ethers.getContractAt("PushablePriceFeed", address, signer);
    const owner = await feed.owner();
    if (owner !== signer.address) {
      /* Loud rather than a revert: the signer being the wrong key is the one
         mistake worth naming, since every other failure here is a missing feed. */
      refused.push(
        `${label} at ${address}: owned by ${owner}, not this signer — ` +
          "run with the key that owns the feed",
      );
      continue;
    }

    const current = await feed.isPusher(target);
    if (current === allow) {
      already++;
      console.log(`   ${label.padEnd(9)} ${address} already ${allow ? "granted" : "revoked"}`);
      continue;
    }

    const tx = await feed.setPusher(target, allow);
    await tx.wait();
    changed++;
    console.log(
      `   ${label.padEnd(9)} ${address} ${allow ? "granted" : "revoked"} — ${tx.hash}`,
    );
  }

  /* Read back rather than trust the receipts: the point of the exercise is that a
     keeper CAN push, and only the mapping says so. */
  console.log("\n   verifying on chain:");
  for (const entry of plan) {
    let address = ethers.ZeroAddress;
    try {
      address = await oracle.feedAggregator(entry.id);
    } catch {
      continue;
    }
    if (!address || address === ethers.ZeroAddress) continue;
    const feed = await ethers.getContractAt("PushablePriceFeed", address, signer);
    console.log(
      `   ${entry.symbols.join("/").padEnd(9)} isPusher[${target.slice(0, 8)}…] = ${await feed.isPusher(target)}`,
    );
  }

  console.log(
    `\n   ${changed} changed, ${already} already correct${refused.length ? `, ${refused.length} refused` : ""}`,
  );
  if (refused.length) {
    for (const r of refused) console.log(`   ⚠️  ${r}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
