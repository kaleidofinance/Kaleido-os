/**
 * Push fresh prices to the feeds we publish ourselves.
 *
 *   npx hardhat run scripts/push-aggregator.js --network robinhoodTestnet
 *
 * The keeper for a chain that has no oracle of its own. deploy-pushable-feeds.js
 * put PushablePriceFeed contracts on the chain and seeded them once;
 * AggregatorPriceOracle reads them; ProtocolFacet enforces a staleness bound on
 * every deposit, borrow, health-factor read and liquidation. Nothing refreshes
 * those feeds but this. On the chains that read Chainlink or Pyth, the provider
 * (or push-prices.js) does that job — this is only for `kaleido-push` feeds,
 * and it refuses to run anywhere else.
 *
 * ── Why it is a separate script from push-prices.js ─────────────────────────
 *
 * push-prices.js relays a Wormhole-signed blob to a Pyth receiver, which
 * verifies it. There is no signature here and nothing to verify: a
 * PushablePriceFeed takes a bare integer we computed. The two share only the
 * Hermes fetch (blobs there, parsed prices here, via libraries/hermes-prices.js),
 * and push-prices.js explicitly REFUSES any oracle whose oracleKind() is not
 * "pyth". This is its mirror image and refuses anything that is not
 * "aggregator-v3" carrying self-hosted feeds.
 *
 * ── Where it reads each feed's address ──────────────────────────────────────
 *
 * From the oracle, on-chain: feedAggregator(feedId). That is the address the
 * protocol actually prices against, so pushing to it is pushing to exactly what
 * a borrower's health factor reads — the two cannot drift. pricefeeds-<net>.json
 * is only a fallback for a feed the oracle has not registered yet, and if the
 * two disagree the on-chain value wins and the divergence is reported, because a
 * stale local file is the realistic mistake and the chain is the source of truth.
 *
 * ── What it will not do ─────────────────────────────────────────────────────
 *
 * It will not bypass a feed's deviation guard. If a push is rejected because the
 * new price is too far from the last one, that is either a keeper bug (the guard
 * doing its job) or a real move after a long outage — and telling those apart is
 * a human decision, not a keeper's. It reports the rejection and names
 * forceAnswer as the owner-only, single-use re-baseline, rather than forcing
 * automatically and defeating the guard on every large move.
 *
 * It will not push a price Hermes is itself serving stale: if the freshest
 * observation available is already older than the bound, the push would land a
 * price that reverts anyway. It says so and skips that feed.
 *
 * ── Operating it ────────────────────────────────────────────────────────────
 *
 * Not a daemon. One run makes each pushed feed good for its bound; a launched
 * chain needs this on a schedule TIGHTER than its smallest bound — 3600s on
 * Robinhood (ETH), so every ~30 minutes with margin. Miss the window and that
 * asset's priced operations revert until the next run. PUSH_ALL=1 pushes every
 * feed regardless of age (what a scheduled keeper wants); the default pushes only
 * what is already stale. PUSH_FEEDS=ETH,USDC limits to named symbols.
 */

const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");

const { backendFor, selfHostedPlanFor } = require("./libraries/aggregator-feeds.js");
const { fetchScaledPrices, HERMES_ENDPOINT } = require("./libraries/hermes-prices.js");

const TARGET_DECIMALS = 8;

/** Seconds -> "28h 30m", for ages that are meaningless as raw seconds. */
function humanAge(seconds) {
  if (seconds === null || seconds === undefined) return "unknown";
  const s = Math.max(0, Math.floor(seconds));
  if (s < 90) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 90) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/**
 * Resolve the oracle address, preferring the deploy record over the env var.
 *
 * Same precedence and same reasoning as push-prices.js: the env var is per-chain
 * and a stale one pointing at another chain's oracle is the realistic mistake,
 * while the record is written per network and cannot be wrong about which chain
 * it describes.
 */
function resolveOracle(network) {
  const file = `deployment-oracle-${network}.json`;
  if (fs.existsSync(file)) {
    const record = JSON.parse(fs.readFileSync(file, "utf8"));
    const addr = record?.contracts?.priceOracle;
    if (addr && ethers.isAddress(addr)) return { address: addr, from: file };
  }
  const env = (process.env.PRICE_ORACLE || process.env.PYTH_PRICE_ORACLE || "").trim();
  if (env && ethers.isAddress(env)) {
    return { address: env, from: ".env" };
  }
  throw new Error(
    `No oracle address for ${network}.\n` +
      `Expected ${file} (written by deploy-oracle.js) or PRICE_ORACLE in .env.`,
  );
}

/** The diamond, only so bounds can be read from the chain rather than the table. */
function resolveDiamond(network) {
  const env = (process.env.KALEIDO_DIAMOND || "").trim();
  if (env && ethers.isAddress(env)) return { address: env, from: ".env" };
  const file = `deployment-diamond-${network}.json`;
  if (fs.existsSync(file)) {
    const record = JSON.parse(fs.readFileSync(file, "utf8"));
    const addr = record?.contracts?.diamond;
    if (addr && ethers.isAddress(addr)) return { address: addr, from: file };
  }
  return null;
}

/** Address for a feed id from pricefeeds-<net>.json — the fallback only. */
function recordAddressFor(network, feedId) {
  const file = `pricefeeds-${network}.json`;
  if (!fs.existsSync(file)) return null;
  try {
    const record = JSON.parse(fs.readFileSync(file, "utf8"));
    const hit = (record?.feeds || []).find(
      (f) => String(f.feedId).toLowerCase() === feedId.toLowerCase(),
    );
    return hit?.aggregator && ethers.isAddress(hit.aggregator) ? hit.aggregator : null;
  } catch {
    return null;
  }
}

async function main() {
  const net = hre.network.name;
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const [signer] = await ethers.getSigners();

  console.log(`\n📡 Pushing self-hosted prices on ${net} (chain ${chainId})`);
  console.log(`   signer ${signer.address}`);

  /* ── 1. Is this even a self-hosting chain? ─────────────────────────────── */

  const plan = selfHostedPlanFor(chainId);
  if (plan.length === 0) {
    throw new Error(
      `Chain ${chainId} has no self-hosted (kaleido-push) feeds in ` +
        "scripts/libraries/aggregator-feeds.js.\n" +
        "This keeper only refreshes feeds we publish ourselves. Chainlink, API3\n" +
        "and Pyth publish their own — a Pyth chain that needs relaying uses\n" +
        "scripts/push-prices.js instead.",
    );
  }
  /* Informational: backendFor honours the ORACLE_BACKEND override, and a chain
   * flipped to Pyth for a one-off while still carrying kaleido-push entries would
   * be a contradiction worth seeing. */
  console.log(`   backend ${backendFor(chainId)} (${plan.length} self-hosted feed(s))`);

  /* ── 2. The oracle, and that it is the kind these feeds sit behind ─────── */

  const { address: oracleAddress, from: oracleFrom } = resolveOracle(net);
  if ((await ethers.provider.getCode(oracleAddress)) === "0x") {
    throw new Error(
      `No contract at ${oracleAddress} on ${net} (from ${oracleFrom}).\n` +
        "That address belongs to another chain, or the oracle was never deployed here.",
    );
  }
  const oracle = await ethers.getContractAt("AggregatorPriceOracle", oracleAddress, signer);

  let kind;
  try {
    kind = await oracle.oracleKind();
  } catch (err) {
    throw new Error(
      `${oracleAddress} does not answer oracleKind() — it is not one of ours.\n` +
        `(${err.shortMessage || err.message})`,
    );
  }
  if (kind !== "aggregator-v3") {
    throw new Error(
      `${net}'s oracle reports oracleKind() = "${kind}", not "aggregator-v3".\n` +
        "This keeper pushes to PushablePriceFeed contracts behind an\n" +
        "AggregatorPriceOracle. A PythPriceOracle takes signed relays instead —\n" +
        "use scripts/push-prices.js for that.",
    );
  }
  console.log(`   oracle ${oracleAddress}  (${oracleFrom}, kind "${kind}")`);

  /* ── 3. Bounds, off the chain where possible ───────────────────────────── */

  const diamondRef = resolveDiamond(net);
  let globalMaxAge = null;
  let protocol = null;
  if (diamondRef && (await ethers.provider.getCode(diamondRef.address)) !== "0x") {
    protocol = await ethers.getContractAt("ProtocolFacet", diamondRef.address, signer);
    globalMaxAge = Number(await protocol.getPriceMaxAge());
    console.log(`   bounds read from the diamond at ${diamondRef.address} (global ${globalMaxAge}s)`);
  } else {
    console.log(
      "   ⚠️  no diamond found — using the bounds table in aggregator-feeds.js.\n" +
        "      Those are the bounds we intended, not necessarily the ones installed.",
    );
  }

  /* ── 4. Resolve each feed's address on-chain, and measure it ───────────── */

  const only = (process.env.PUSH_FEEDS || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const pushAll = process.env.PUSH_ALL === "1";

  const block = await ethers.provider.getBlock("latest");
  const blockTime = Number(block.timestamp);

  console.log(`\n1. Measuring ${plan.length} feed(s) against their installed bounds`);

  const feeds = [];
  for (const entry of plan) {
    if (only.length && !entry.symbols.some((s) => only.includes(s.toUpperCase()))) {
      continue;
    }

    /* The address the protocol actually reads. */
    let onChain = ethers.ZeroAddress;
    try {
      onChain = await oracle.feedAggregator(entry.id);
    } catch {
      /* leave zero — handled below */
    }
    const recorded = recordAddressFor(net, entry.id);

    let address = null;
    let addressFrom = null;
    if (onChain && onChain !== ethers.ZeroAddress) {
      address = onChain;
      addressFrom = "oracle.feedAggregator";
      if (recorded && ethers.getAddress(recorded) !== ethers.getAddress(onChain)) {
        console.log(
          `   ⚠️  ${entry.symbols.join("/")}: pricefeeds-${net}.json records ${recorded} ` +
            `but the oracle points at ${onChain}. Pushing to the oracle's — it is what\n` +
            "      the protocol prices against. The local file is stale.",
        );
      }
    } else if (recorded) {
      address = recorded;
      addressFrom = `pricefeeds-${net}.json (oracle has no feed for this id yet)`;
    } else {
      throw new Error(
        `${entry.symbols.join("/")} (${entry.id}): the oracle has no aggregator for it ` +
          `and pricefeeds-${net}.json has no record either.\n` +
          "Run deploy-pushable-feeds.js then deploy-oracle.js before this keeper.",
      );
    }

    /* The bound this feed is actually held to. Prefer the chain: getFeedMaxAge
     * returns 0 when there is no per-feed override, in which case the global
     * applies — the same fallback the facet's own ageing uses. Without a diamond
     * to ask, fall back to the intended bound in the table, and say so. */
    let installedBound;
    let boundFrom;
    if (protocol) {
      const perFeed = Number(await protocol.getFeedMaxAge(entry.id));
      installedBound = perFeed === 0 ? globalMaxAge : perFeed;
      boundFrom = perFeed === 0 ? "global default" : "per-feed override";
    } else {
      installedBound = entry.maxAge;
      boundFrom = "aggregator-feeds.js";
    }

    const feed = await ethers.getContractAt("PushablePriceFeed", address, signer);
    let age = null;
    let seeded = true;
    try {
      const [, , , updatedAt] = await feed.latestRoundData();
      const u = Number(updatedAt);
      if (u === 0) {
        seeded = false;
      } else {
        age = blockTime - u;
      }
    } catch (err) {
      throw new Error(
        `${entry.symbols.join("/")} at ${address}: latestRoundData() reverted ` +
          `(${err.shortMessage || err.message}). That address is not a PushablePriceFeed.`,
      );
    }

    const stale = !seeded || age > installedBound;
    feeds.push({ ...entry, address, addressFrom, feed, bound: installedBound, boundFrom, age, seeded, stale });

    const label = entry.symbols.join("/").padEnd(11);
    if (!seeded) {
      console.log(`   ⬜ ${label} never seeded — bound ${installedBound}s (${boundFrom})`);
    } else if (stale) {
      console.log(
        `   ⚠️  ${label} ${humanAge(age)} old (${age}s) vs bound ${installedBound}s (${boundFrom}) — STALE`,
      );
    } else {
      console.log(
        `   ✅ ${label} ${humanAge(age)} old (${age}s) vs bound ${installedBound}s (${boundFrom})`,
      );
    }
  }

  if (feeds.length === 0) {
    throw new Error(
      `PUSH_FEEDS=${process.env.PUSH_FEEDS} matched none of the self-hosted feeds ` +
        `on chain ${chainId}.\n` +
        `Available: ${plan.map((p) => p.symbols.join("/")).join(", ")}`,
    );
  }

  const targets = pushAll ? feeds : feeds.filter((f) => f.stale);
  if (targets.length === 0) {
    console.log(
      "\nEvery feed is inside its bound. Nothing to push.\n" +
        "Freshness expires, so this is true now and not a property of the chain — " +
        "the tightest bound here is " +
        `${Math.min(...feeds.map((f) => f.bound))}s. Use PUSH_ALL=1 to push anyway.`,
    );
    return;
  }

  /* ── 5. Fresh prices from Hermes ───────────────────────────────────────── */

  console.log(`\n2. Fetching prices from Hermes for ${targets.length} feed(s)`);
  const scaled = await fetchScaledPrices(targets.map((f) => f.id), TARGET_DECIMALS);

  /* Skip a feed Hermes is itself serving stale — pushing it lands a price that
   * reverts on the bound anyway. Unlike push-prices.js this is per-feed (each is
   * its own contract and its own transaction), so a hopeless feed is skipped, not
   * a reason to abort the batch. */
  const pushable = [];
  for (const f of targets) {
    const s = scaled.get(f.id.toLowerCase());
    if (!s) {
      console.log(`   ⚠️  ${f.symbols.join("/")}: Hermes served no price — skipped`);
      continue;
    }
    const hermesAge = Math.max(0, blockTime - s.publishTime);
    if (hermesAge > f.bound) {
      console.log(
        `   ⚠️  ${f.symbols.join("/")}: Hermes' freshest is ${humanAge(hermesAge)} old ` +
          `(${hermesAge}s), already over the ${f.bound}s bound. Pushing it would still ` +
          "revert — skipped. Pyth's publishers are stale for this asset.",
      );
      continue;
    }
    console.log(
      `   ${f.symbols.join("/").padEnd(11)} $${Number(s.answer) / 10 ** TARGET_DECIMALS} ` +
        `(${s.answer}), observed ${humanAge(hermesAge)} ago`,
    );
    pushable.push({ ...f, scaled: s });
  }

  if (pushable.length === 0) {
    throw new Error(
      "No feed could be pushed: Hermes served nothing fresh enough for any of them.\n" +
        "This is Pyth's off-chain publishers being stale, which a keeper cannot fix.",
    );
  }

  /* ── 6. Push each one ──────────────────────────────────────────────────── */

  console.log(`\n3. Pushing ${pushable.length} answer(s)`);
  const results = [];
  let failures = 0;

  for (const f of pushable) {
    /* observedAt is the observation time. Clamp to block time if the chain's
     * clock trails Hermes — the feed rejects a future timestamp because the
     * facet would underflow ageing it. */
    let observedAt = f.scaled.publishTime;
    if (observedAt > blockTime) observedAt = blockTime;

    try {
      const tx = await f.feed.pushAnswer(f.scaled.answer, observedAt);
      const receipt = await tx.wait();
      console.log(
        `   ✅ ${f.symbols.join("/").padEnd(11)} tx ${tx.hash} (block ${receipt.blockNumber})`,
      );
      results.push({
        symbols: f.symbols,
        feedId: f.id,
        aggregator: f.address,
        answer: f.scaled.answer.toString(),
        observedAt,
        bound: f.bound,
        txHash: tx.hash,
      });
    } catch (err) {
      failures++;
      const name = err?.revert?.name || "";
      if (name === "DeviationTooLarge" || /DeviationTooLarge/.test(err.message || "")) {
        console.error(
          `   ❌ ${f.symbols.join("/")}: deviation guard rejected the push. The new price is ` +
            "too far from the last one.\n" +
            "      This is the guard working — either a units/decimals bug in the price, or a\n" +
            "      real move after a long outage. A keeper must not decide which. If the move\n" +
            "      is real, an owner re-baselines ONCE with forceAnswer(answer, observedAt),\n" +
            "      which emits AnswerForced so the bypass is on the record. Do not loosen the\n" +
            "      guard to make a keeper push land.",
        );
      } else {
        console.error(`   ❌ ${f.symbols.join("/")}: ${err.shortMessage || err.message}`);
      }
    }
  }

  /* ── 7. Re-measure ─────────────────────────────────────────────────────── */

  console.log("\n4. Re-measuring");
  const afterBlock = await ethers.provider.getBlock("latest");
  const afterTime = Number(afterBlock.timestamp);
  let stillStale = 0;

  for (const r of results) {
    const feed = await ethers.getContractAt("PushablePriceFeed", r.aggregator, signer);
    const [, answer, , updatedAt] = await feed.latestRoundData();
    const age = afterTime - Number(updatedAt);
    const ok = age <= r.bound && answer.toString() === r.answer;
    if (!ok) stillStale++;
    const label = r.symbols.join("/").padEnd(11);
    console.log(
      ok
        ? `   ✅ ${label} ${age}s old — inside ${r.bound}s`
        : `   ❌ ${label} ${age}s old (answer ${answer}) — expected ${r.answer} inside ${r.bound}s`,
    );
  }

  /* ── 8. Record ─────────────────────────────────────────────────────────── */

  const record = {
    network: net,
    chainId,
    signer: signer.address,
    timestamp: new Date().toISOString(),
    oracle: oracleAddress,
    hermes: HERMES_ENDPOINT,
    pushed: results,
  };
  /* pushfeeds-, not deployment- and not pricefeeds-: gen-registry.mjs globs
   * deployment-*.json, resolveSelfHosted reads pricefeeds-*.json for addresses,
   * and this is neither — it is an operational log of a refresh that deploys
   * nothing and moves no address. Same reasoning push-prices.js uses for
   * pushprices-*.json. */
  const filename = `pushfeeds-${net}.json`;
  fs.writeFileSync(filename, JSON.stringify(record, null, 2));

  console.log(`\n${"=".repeat(60)}`);
  console.log("SELF-HOSTED PRICE PUSH SUMMARY");
  console.log("=".repeat(60));
  console.log(`Pushed ${results.length} of ${pushable.length} attempted feed(s).`);
  if (failures > 0) {
    console.log(
      `\n⚠️  ${failures} push(es) failed — see above. A deviation rejection is the guard\n` +
        "    working and needs an owner's forceAnswer, not a retry.",
    );
  }
  if (stillStale > 0) {
    console.log(
      `\n⚠️  ${stillStale} feed(s) are still over their bound after a push landed.\n` +
        "    The write worked, so the observation Hermes gave was already old.",
    );
  }
  if (results.length > 0) {
    const tightest = Math.min(...results.map((r) => r.bound));
    console.log(
      `\nEvery pushed feed is fresh now. It stops being fresh in ${tightest}s unless\n` +
        "something pushes again — this is not a daemon. Schedule it tighter than that,\n" +
        "and move each feed's owner off the deployer key to a keeper + multisig.",
    );
  }
  console.log(`\nSaved to: ${filename}`);
  console.log("=".repeat(60));

  if (failures > 0 || stillStale > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`\n❌ ${err.message}`);
  process.exitCode = 1;
});
