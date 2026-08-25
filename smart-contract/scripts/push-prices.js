/**
 * Push fresh Pyth prices on-chain, through our own oracle.
 *
 *   npx hardhat run scripts/push-prices.js --network arcTestnet
 *
 * Reads the feeds this chain has bounds for, measures how stale each one is
 * against the bound actually installed on the diamond, fetches a signed update
 * from Hermes for the ones that need it, and relays it via
 * PythPriceOracle.updatePrice.
 *
 * ── Why this script has to exist ───────────────────────────────────────────
 *
 * Pyth is a PULL oracle. Nothing on the chain updates a feed; a transaction has
 * to carry the signed update and pay the Wormhole verification fee. Our
 * `PythPriceOracle.getPrice` reads `getPriceUnsafe`, and ProtocolFacet then
 * enforces a staleness bound on every deposit, borrow, health-factor read and
 * liquidation. So on a chain where nobody relays, the lending market registers
 * fine and then reverts on every priced call — which is exactly the state Arc
 * Testnet (5042002) was left in.
 *
 * The measurements that made this non-optional, all against Arc's Pyth at
 * 0x2880aB155794e7179c9eE2e38200202908C17B43:
 *
 *   Crypto.ETH/USD      4s        2026-08-21   relayed by someone, continuously
 *   Crypto.BTC/USD      4s        2026-08-21   likewise
 *   Crypto.USDC/USD    58,510s    2026-08-21   16h 15m
 *   Crypto.USDC/USD   102,608s    2026-08-22   28h 30m  ← grew by ~44,000s in 24h
 *
 * That growth is the finding. A feed that is merely slow oscillates around some
 * cadence; this one gains a second per second, which means the relayer that once
 * pushed it has stopped. Arc's native currency IS USDC, so the dead feed is the
 * chain's gas token and the asset every borrower there posts.
 *
 * It also breaks the justification recorded in scripts/libraries/aggregator-feeds.js
 * for keeping Arc on the Pyth backend at all: 58,510s fit under
 * Constants.MAX_FEED_PRICE_AGE (90,000), so a per-feed bound could legally cover
 * it where Base Sepolia's 310,163s could not. At 102,608s no legal bound exists —
 * `setFeedMaxAge` would revert Protocol__InvalidPriceBounds at any value that
 * covered it. The bound cannot be widened again. Pushing is the only repair, and
 * the 90,000s bound on that feed is now a ceiling this script has to keep the
 * feed under rather than a description of how the feed behaves.
 *
 * ── Why it relays through our oracle instead of straight to Pyth ───────────
 *
 * `pyth.updatePriceFeeds` would work and would be marginally cheaper. Going
 * through `PythPriceOracle.updatePrice` is deliberate: it is the function that
 * exists for this, it emits PriceUpdated so a run leaves an on-chain trace, and
 * it exercises the same path a borrower's own transaction is meant to take when
 * it carries its own price update. A keeper that bypassed it would leave that
 * path untested.
 *
 * ── What it refuses to do ──────────────────────────────────────────────────
 *
 * Refuses on any chain whose oracle is not a PythPriceOracle. The other four
 * chains in the wave run AggregatorPriceOracle, which has no `updatePrice` and
 * needs none — Chainlink and API3 push their own feeds. Running this there would
 * either revert on a missing selector or, worse, hit a fallback. `oracleKind()`
 * is asked first and answers "pyth" or "aggregator-v3".
 *
 * Refuses to push a feed whose age would still exceed its bound after the push,
 * which can only happen if Hermes itself is serving something stale. Better to
 * report that than to spend the fee and leave the market broken.
 *
 * ── Operating it ───────────────────────────────────────────────────────────
 *
 * One run makes the market usable for `bound` seconds. It is not a daemon: a
 * launched chain needs this on a schedule tighter than its smallest bound
 * (600s on Arc for ETH and BTC), or borrowers need to carry their own updates.
 * Until one of those exists, Arc's /borrow works for as long as the last run's
 * freshness lasts and then stops. Say so plainly rather than treating a green
 * run as the end of the problem.
 *
 * PUSH_FEEDS=ETH,USDC limits the run to named symbols. PUSH_ALL=1 pushes every
 * bounded feed regardless of age, which is what a scheduled keeper wants — the
 * default only pushes what is actually stale, because each push costs a fee.
 */

const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");

const { pythBoundPlanFor, feedFor, FEEDS } = require("./libraries/pyth-feeds");

const HERMES_ENDPOINT =
  process.env.HERMES_ENDPOINT || "https://hermes.pyth.network";

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
 * The env var is per-chain and this file holds one chain's worth at a time, so
 * a stale PYTH_PRICE_ORACLE pointing at another chain's oracle is the realistic
 * mistake. The deploy record is written per network and cannot be wrong about
 * which chain it describes, so it wins; the env var is the fallback for a chain
 * deployed before the records existed.
 *
 * Every deploy script nests its addresses under `contracts`, which is where this
 * has to look — reading the top level finds nothing, falls through to the env
 * var, and reports the env var's address as if the record had confirmed it.
 * That is the precedence above inverted in the one case it exists for.
 */
function resolveOracle(network) {
  const file = `deployment-oracle-${network}.json`;
  if (fs.existsSync(file)) {
    const record = JSON.parse(fs.readFileSync(file, "utf8"));
    const addr = record?.contracts?.priceOracle;
    if (addr && ethers.isAddress(addr)) return { address: addr, from: file };
  }
  const env = (process.env.PYTH_PRICE_ORACLE || "").trim();
  if (env && ethers.isAddress(env)) {
    return { address: env, from: ".env:PYTH_PRICE_ORACLE" };
  }
  throw new Error(
    `No oracle address for ${network}.\n` +
      `Expected ${file} (written by deploy-oracle.js) or PYTH_PRICE_ORACLE in .env.`,
  );
}

/**
 * Resolve the diamond, only so the bounds can be read off the chain.
 *
 * Optional on purpose: a keeper can usefully refresh feeds on a chain whose
 * diamond it cannot find, it just has to fall back to the intended bounds
 * instead of the installed ones and say so. `contracts.diamond` is where
 * deploy.js writes it, matching verify-diamond.js:101.
 */
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

async function main() {
  const net = hre.network.name;
  const chainId = Number(
    (await ethers.provider.getNetwork()).chainId,
  );
  const [signer] = await ethers.getSigners();

  console.log(`\n📡 Pushing Pyth prices on ${net} (chain ${chainId})`);
  console.log(`   signer ${signer.address}`);

  /* ── 1. The oracle, and that it is the kind that can be pushed to ──────── */

  const { address: oracleAddress, from: oracleFrom } = resolveOracle(net);
  if ((await ethers.provider.getCode(oracleAddress)) === "0x") {
    throw new Error(
      `No contract at ${oracleAddress} on ${net} (from ${oracleFrom}).\n` +
        "That address belongs to another chain, or the oracle was never deployed here.",
    );
  }

  const oracle = await ethers.getContractAt(
    "PythPriceOracle",
    oracleAddress,
    signer,
  );

  let kind;
  try {
    kind = await oracle.oracleKind();
  } catch (err) {
    throw new Error(
      `${oracleAddress} does not answer oracleKind() — it is not one of ours.\n` +
        `(${err.shortMessage || err.message})`,
    );
  }
  if (kind !== "pyth") {
    throw new Error(
      `${net}'s oracle reports oracleKind() = "${kind}", not "pyth".\n` +
        "This script relays Pyth updates and only a PythPriceOracle can take them.\n" +
        "An AggregatorPriceOracle has no updatePrice function to relay to. If it\n" +
        "reads Chainlink or API3 the provider publishes the feed and nothing here\n" +
        "needs pushing; if it reads a PushablePriceFeed we publish ourselves\n" +
        "(Robinhood 46630), the keeper is scripts/push-aggregator.js, which pushes\n" +
        "the feed rather than the oracle.",
    );
  }
  console.log(`   oracle ${oracleAddress}  (${oracleFrom}, kind "${kind}")`);

  const pythAddress = await oracle.pyth();
  const pyth = await ethers.getContractAt("IPyth", pythAddress, signer);
  console.log(`   pyth   ${pythAddress}`);

  /* ── 2. What to push, and what bound each feed is actually judged against ─ */

  /* PUSH_IDS is the probe mode, and it answers a question the bounds table
   * cannot: "could this chain carry this feed at all?"
   *
   * It exists because PYTH_BOUNDS records three Arc feeds as unusable —
   * USDT/USDE at 8,375,146s and WBTC as "not served, getPriceUnsafe reverts
   * PriceFeedNotFound" — and both verdicts were drawn from the CURRENT on-chain
   * state, which on a pull oracle is not a property of the chain. Hermes serves
   * all three at 1s. So the real question is whether relaying creates a feed the
   * receiver has never held, and that has to be measured rather than assumed.
   *
   * Ids rather than symbols on purpose: a symbol goes through feedFor(), which
   * throws for anything in NO_FEED, and NO_FEED is exactly the set worth probing.
   * No bound is applied and nothing is registered — this reports before/after and
   * stops. Deciding to lend against the result is a separate, deliberate step.
   */
  const rawIds = (process.env.PUSH_IDS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  for (const id of rawIds) {
    if (!/^0x[0-9a-f]{64}$/.test(id)) {
      throw new Error(
        `PUSH_IDS entry is not a 32-byte hex id: ${id}\n` +
          "Pyth feed ids are 66 characters including the 0x prefix.",
      );
    }
  }

  const plan =
    rawIds.length > 0
      ? rawIds.map((id) => {
          /* Label it from the table when the id is recognised, so the log names
           * the asset rather than a hash. An unrecognised id is still pushed. */
          const known = Object.entries(FEEDS).find(
            ([, f]) => f.id.toLowerCase() === id,
          );
          return {
            id,
            symbol: known ? known[1].symbol : "(unrecognised id)",
            symbols: [known ? known[0] : `${id.slice(0, 10)}…`],
            maxAge: null,
            probeOnly: true,
          };
        })
      : pythBoundPlanFor(chainId);

  if (plan.length === 0) {
    throw new Error(
      `No feed bounds recorded for chain ${chainId} in scripts/libraries/pyth-feeds.js.\n` +
        "Nothing to push. Add a PYTH_BOUNDS entry, or probe a raw feed with\n" +
        "PUSH_IDS=0x… to find out whether this chain can carry it at all.",
    );
  }

  const only = (process.env.PUSH_FEEDS || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const pushAll = process.env.PUSH_ALL === "1";

  /* The bound comes off the chain, not out of the bounds table. The table says
   * what register-tokens.js meant to install; s_feedMaxAge says what a priced
   * call will actually be judged against, and a run that reported success
   * against the wrong number would be worse than no run. */
  const diamondRef = resolveDiamond(net);
  let globalMaxAge = null;
  let protocol = null;
  if (diamondRef && (await ethers.provider.getCode(diamondRef.address)) !== "0x") {
    protocol = await ethers.getContractAt(
      "ProtocolFacet",
      diamondRef.address,
      signer,
    );
    globalMaxAge = Number(await protocol.getPriceMaxAge());
    console.log(
      `   bounds read from the diamond at ${diamondRef.address} (global ${globalMaxAge}s)`,
    );
  } else {
    console.log(
      "   ⚠️  no diamond found — falling back to the bounds table in pyth-feeds.js.\n" +
        "      Those are the bounds we intended, not necessarily the ones installed.",
    );
  }

  const block = await ethers.provider.getBlock("latest");
  const blockTime = Number(block.timestamp);

  console.log(`\n1. Measuring ${plan.length} feed(s) against their installed bounds`);

  const feeds = [];
  for (const entry of plan) {
    if (only.length && !entry.symbols.some((s) => only.includes(s.toUpperCase()))) {
      continue;
    }

    let bound = entry.maxAge;
    let boundFrom = "pyth-feeds.js";
    if (entry.probeOnly) {
      /* Deliberately NOT the global default. getFeedMaxAge returns 0 for an
       * unregistered feed, and reporting the global 300s here would describe a
       * bound that governs nothing — the token is not a lending asset, so no
       * priced call reads this feed at all. Probing asks whether the feed can
       * exist, not whether it would pass. */
      bound = null;
      boundFrom = "probe — no bound applies, feed is unregistered";
    } else if (protocol) {
      const onChain = Number(await protocol.getFeedMaxAge(entry.id));
      /* 0 means no per-feed override, so the global applies — the same fallback
       * _priceScaled18 does. */
      bound = onChain === 0 ? globalMaxAge : onChain;
      boundFrom = onChain === 0 ? "global default" : "per-feed override";
    }

    let age = null;
    let served = true;
    try {
      const price = await pyth.getPriceUnsafe(entry.id);
      age = blockTime - Number(price.publishTime);
    } catch {
      /* Never populated on this chain. Pushing is exactly the repair for that,
       * so this is a reason to push rather than to skip. */
      served = false;
    }

    /* A probe always pushes — measuring the before/after is the point of it. */
    const stale = entry.probeOnly || !served || age > bound;
    feeds.push({ ...entry, bound, boundFrom, age, served, stale });

    const label = entry.symbols.join("/").padEnd(11);
    if (!served) {
      console.log(
        `   ⬜ ${label} never populated on this chain` +
          (bound === null ? "" : ` — bound ${bound}s`),
      );
    } else if (bound === null) {
      console.log(`   ▫️  ${label} ${humanAge(age)} old (${age}s) — ${boundFrom}`);
    } else if (stale) {
      console.log(
        `   ⚠️  ${label} ${humanAge(age)} old (${age}s) vs bound ${bound}s (${boundFrom}) — STALE`,
      );
    } else {
      console.log(
        `   ✅ ${label} ${humanAge(age)} old (${age}s) vs bound ${bound}s (${boundFrom})`,
      );
    }
  }

  if (feeds.length === 0) {
    throw new Error(
      `PUSH_FEEDS=${process.env.PUSH_FEEDS} matched none of the bounded feeds ` +
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

  /* ── 3. Signed updates from Hermes ─────────────────────────────────────── */

  console.log(
    `\n2. Fetching signed updates from Hermes for ${targets.length} feed(s)`,
  );

  const { HermesClient } = require("@pythnetwork/hermes-client");
  const client = new HermesClient(HERMES_ENDPOINT, { timeout: 20000 });

  /* One request for all of them. The blob Hermes returns for N ids is a single
   * batch that updatePriceFeeds processes in one call, so this is also one
   * transaction and one fee rather than N. */
  const ids = targets.map((f) => f.id);
  let updates;
  try {
    updates = await client.getLatestPriceUpdates(ids, { encoding: "hex" });
  } catch (err) {
    throw new Error(
      `Hermes at ${HERMES_ENDPOINT} would not serve updates for these ids: ${err.message}\n` +
        "Without a signed update there is nothing to relay — the chain cannot\n" +
        "manufacture a price. Check outbound HTTPS, or set HERMES_ENDPOINT.",
    );
  }

  const blobs = (updates?.binary?.data || []).map((d) =>
    d.startsWith("0x") ? d : `0x${d}`,
  );
  if (blobs.length === 0) {
    throw new Error(
      "Hermes returned no binary update data for " +
        `${ids.length} id(s). The ids may be wrong, or Hermes may not carry them.`,
    );
  }

  /* Hermes reports what it is actually serving, which is not necessarily fresh.
   * A blob that is itself older than the bound would cost a fee and leave the
   * market exactly as broken, so it is checked before anything is sent. */
  const parsed = updates?.parsed || [];
  const hermesAges = new Map();
  for (const p of parsed) {
    const id = p.id.startsWith("0x") ? p.id.toLowerCase() : `0x${p.id.toLowerCase()}`;
    hermesAges.set(id, Math.max(0, blockTime - Number(p.price?.publish_time ?? 0)));
  }

  const hopeless = [];
  for (const f of targets) {
    const hermesAge = hermesAges.get(f.id.toLowerCase());
    if (hermesAge === undefined) {
      console.log(
        `   ⚠️  ${f.symbols.join("/")}: Hermes did not report a parsed price — ` +
          "pushing the blob anyway, the update may still land",
      );
      continue;
    }
    console.log(
      `   ${f.symbols.join("/").padEnd(11)} Hermes has it at ${humanAge(hermesAge)} old (${hermesAge}s)`,
    );
    /* `f.bound` is null for a probe. `hermesAge > null` coerces to a comparison
     * against 0 and would flag every probe as hopeless, so the null case is
     * excluded explicitly rather than left to JavaScript. */
    if (f.bound !== null && hermesAge > f.bound) hopeless.push({ ...f, hermesAge });
  }

  if (hopeless.length > 0 && hopeless.length === targets.length) {
    throw new Error(
      "Every update Hermes is serving is already staler than the bound it would " +
        "be judged against:\n" +
        hopeless
          .map(
            (f) =>
              `   ${f.symbols.join("/")}: Hermes ${f.hermesAge}s vs bound ${f.bound}s`,
          )
          .join("\n") +
        "\n\nPushing would spend the fee and leave the market reverting. Pyth's own\n" +
        "publishers have stopped for these assets on this chain's price service;\n" +
        "a keeper cannot fix that. The asset needs a different backend or must not\n" +
        "be a lending asset here.",
    );
  }
  for (const f of hopeless) {
    console.log(
      `   ⚠️  ${f.symbols.join("/")} will still be over its bound after the push ` +
        `(Hermes ${f.hermesAge}s vs bound ${f.bound}s) — pushed anyway because ` +
        "other feeds in this batch need it",
    );
  }

  /* ── 4. Relay ──────────────────────────────────────────────────────────── */

  console.log(`\n3. Relaying ${blobs.length} blob(s) through updatePrice`);

  const fee = await pyth.getUpdateFee(blobs);
  const balance = await ethers.provider.getBalance(signer.address);
  console.log(`   fee ${ethers.formatEther(fee)}  balance ${ethers.formatEther(balance)}`);
  if (balance < fee) {
    throw new Error(
      `Signer holds ${ethers.formatEther(balance)} and the update fee is ` +
        `${ethers.formatEther(fee)}. Fund ${signer.address} on ${net}.`,
    );
  }

  /* `updatePrice` names one feed id for its event and pushes the whole blob
   * regardless, so the id passed is the first target and the rest land silently.
   * The re-measurement below is what actually confirms all of them. */
  const named = targets[0];
  let receipt;
  try {
    const tx = await oracle.updatePrice(blobs, named.id, { value: fee });
    console.log(`   tx ${tx.hash}`);
    receipt = await tx.wait();
  } catch (err) {
    /* The failure that matters most is Pyth itself rejecting the update — a
     * guardian set this chain's receiver does not know, or a data source it does
     * not accept. That is not something a keeper can retry past, and it means
     * this chain's Pyth deployment cannot be pushed to at all. */
    throw new Error(
      `updatePrice reverted: ${err.shortMessage || err.message}\n\n` +
        "If Pyth rejected the update itself (an unknown guardian set, or a data\n" +
        "source the receiver does not accept), this chain's Pyth deployment cannot\n" +
        "be relayed to and no keeper will fix it. Check whether\n" +
        `${pythAddress} is a current Pyth receiver before assuming a transient fault.`,
    );
  }
  console.log(`   ✅ mined in block ${receipt.blockNumber}, gas ${receipt.gasUsed}`);

  /* ── 5. Prove it landed, per feed ──────────────────────────────────────── */

  console.log("\n4. Re-measuring");

  const afterBlock = await ethers.provider.getBlock("latest");
  const afterTime = Number(afterBlock.timestamp);
  const results = [];
  let stillStale = 0;

  for (const f of targets) {
    let age = null;
    let served = true;
    try {
      const price = await pyth.getPriceUnsafe(f.id);
      age = afterTime - Number(price.publishTime);
    } catch {
      served = false;
    }
    /* For a probe the question is only whether the feed is served at all after
     * the push — there is no bound to be inside of, and `age <= null` would
     * report a successful probe as a failure and exit non-zero. */
    const ok = f.bound === null ? served : served && age <= f.bound;
    if (!ok) stillStale++;
    results.push({
      symbols: f.symbols,
      feedId: f.id,
      bound: f.bound,
      probeOnly: Boolean(f.probeOnly),
      ageBefore: f.age,
      servedBefore: f.served,
      ageAfter: age,
      served,
      withinBound: ok,
    });
    const label = f.symbols.join("/").padEnd(11);
    const before = f.served ? `${f.age}s` : "unserved";
    if (!served) {
      console.log(`   ❌ ${label} still not served`);
    } else if (f.bound === null) {
      /* The interesting probe result is the transition, so it is named. */
      console.log(
        `   ✅ ${label} ${age}s old (was ${before})` +
          (f.served ? "" : " — the push CREATED a feed this chain had never held"),
      );
    } else if (ok) {
      console.log(`   ✅ ${label} ${age}s old (was ${before}) — inside ${f.bound}s`);
    } else {
      console.log(`   ❌ ${label} ${age}s old — still over ${f.bound}s`);
    }
  }

  /* ── 6. Record ─────────────────────────────────────────────────────────── */

  const record = {
    network: net,
    chainId,
    signer: signer.address,
    timestamp: Date.now(),
    oracle: oracleAddress,
    pyth: pythAddress,
    hermes: HERMES_ENDPOINT,
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    feeWei: fee.toString(),
    pushed: results,
  };
  /* Deliberately NOT named deployment-*.json. gen-registry.mjs globs that
   * pattern to build src/constants/deployments.generated.ts, and a price push is
   * an operational event rather than a deployment — it deploys nothing and holds
   * no address the frontend needs. Every run would otherwise add a record the
   * generator has to recognise and drop. */
  const filename = `pushprices-${net}.json`;
  fs.writeFileSync(filename, JSON.stringify(record, null, 2));

  console.log(`\n${"=".repeat(60)}`);
  console.log("PRICE PUSH SUMMARY");
  console.log("=".repeat(60));
  console.log(`Pushed ${results.length} feed(s) for ${ethers.formatEther(fee)} in fees.`);

  const bounded = targets.filter((f) => f.bound !== null).map((f) => f.bound);
  const probes = results.filter((r) => r.probeOnly);
  if (stillStale > 0) {
    console.log(
      `\n⚠️  ${stillStale} feed(s) are still over their bound after a successful push.\n` +
        "    The relay worked, so this is Pyth's publishers being stale rather than\n" +
        "    a chain or keeper problem. Those assets cannot be priced here.",
    );
  } else if (bounded.length === 0) {
    /* A probe-only run. It proves what the chain CAN carry and changes nothing
     * about what the protocol prices — saying so stops a green run being read as
     * "these assets are now lending assets". */
    const created = probes.filter((r) => !r.servedBefore && r.served);
    console.log(
      `\nProbe only — nothing was registered and no bound was applied.\n` +
        `${probes.length} feed(s) are now live on this chain's Pyth receiver` +
        (created.length
          ? `, ${created.length} of which it had never held before the push.\n`
          : ".\n") +
        "That means these assets COULD be priced here, at a bound chosen from a\n" +
        "post-push age rather than the stale age they show when nobody relays.\n" +
        "Registering them is a separate decision, and it takes on a keeper\n" +
        "dependency at whatever bound is chosen — see register-tokens.js.",
    );
  } else {
    const tightest = Math.min(...bounded);
    console.log(
      `\nEvery pushed feed is inside its bound. Priced operations work now.\n` +
        `They stop working again in ${tightest}s unless something pushes again —\n` +
        "this script is not a daemon. A launched chain needs it on a schedule\n" +
        "tighter than that, or borrowers carrying their own updates.",
    );
  }
  console.log(`\nSaved to: ${filename}`);
  console.log("=".repeat(60));

  if (stillStale > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`\n❌ ${err.message}`);
  process.exitCode = 1;
});
