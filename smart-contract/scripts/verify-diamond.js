/**
 * Post-deploy verification for one chain's diamond. Read-only — sends nothing.
 *
 *   npx hardhat run scripts/verify-diamond.js --network baseTestnet
 *
 * Run this after deploy.js and again after register-tokens.js. It answers the one
 * question neither `tsc` nor a successful deploy can: is the thing on-chain
 * actually wired the way the deploy claimed?
 *
 * ── Why a separate script and not more asserts inside deploy.js ─────────────
 *
 * deploy.js verifies what it just did, in the same process, against the same
 * provider, with the same assumptions. That catches a failed transaction and
 * misses a wrong one. This script starts from nothing but a chain and an address,
 * re-derives every expectation from the artifacts and the feed tables, and so can
 * disagree with the deploy record — which is the entire point. It is also the only
 * way to check a diamond deployed by an earlier run, on a different machine, or
 * before an edit to the very tables the deploy read.
 *
 * ── What it checks, and why each one is worth a check ───────────────────────
 *
 * 1. SELECTOR ROUTING, per facet, ABI vs loupe. A diamond cut that drops a
 *    selector still reports success. The absence surfaces as the call reverting
 *    with no reason string — indistinguishable from a require failing — on
 *    whichever feature happened to need it, possibly weeks later. Checked in both
 *    directions: a declared selector that is not routed, and a routed selector
 *    that no facet artifact declares (which means the deployed bytecode is not
 *    the bytecode in artifacts/, i.e. someone recompiled after deploying).
 *
 * 2. ONE FACET PER SELECTOR. `facetAddress(selector)` is the router's own answer,
 *    and it must agree with the facet enumeration. Disagreement means a later cut
 *    replaced a selector without the record being updated.
 *
 * 3. OWNERSHIP. Every setter here is `enforceIsContractOwner`. If ownership has
 *    moved, register-tokens.js cannot run, and the deployer key can no longer fix
 *    anything — worth knowing before sending a transaction, not after it reverts.
 *
 * 4. THE ORACLE IS REACHABLE AND ANSWERS. `setPythOracle` stores whatever address
 *    it is given; the read-back in deploy.js confirms the value stuck, not that
 *    code lives there. `_priceScaled18` calling a codeless address reverts, which
 *    takes deposit, borrow, repay and every health-factor read offline at once.
 *    So: getCode, then oracleKind(), then an actual getPrice per registered feed.
 *
 * 5. EVERY REGISTERED FEED IS INSIDE ITS BOUND, RIGHT NOW. This is the check with
 *    a shelf life. A feed that was 20s old at deploy and is 30 hours old today
 *    prices nothing, and the protocol reverts rather than returning a stale
 *    number. Reported per feed against the bound actually installed on-chain
 *    (getFeedMaxAge, falling back to the global getPriceMaxAge when it is 0),
 *    not against the bound the table wanted.
 *
 * 6. REGISTRATION STATE. Before register-tokens.js this is empty and that is
 *    correct; after it, a token missing from the arrays means the lending market
 *    silently lacks that asset. Also flags the duplicate that addLoanableToken's
 *    missing guard allows.
 *
 * Exits non-zero on any failure, so it can gate a deploy sequence.
 */

const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");

const { getSelectors } = require("./libraries/diamond.js");
const { feedFor } = require("./libraries/pyth-feeds.js");
const { backendFor, feedPlanFor } = require("./libraries/aggregator-feeds.js");

/**
 * The facets that are cut into the diamond.
 *
 * DiamondInit is deliberately absent: it is delegatecalled once during the cut to
 * write initial storage and is never registered, so `facets()` correctly omits it
 * while the deploy record correctly lists it as deployed. Treating it as a facet
 * would report a false failure on every healthy diamond.
 */
const CUT_FACETS = [
  "DiamondCutFacet",
  "DiamondLoupeFacet",
  "OwnershipFacet",
  "ProtocolFacet",
  "AgentPermissionFacet",
];

const failures = [];
const warnings = [];
const fail = (m) => failures.push(m);
const warn = (m) => warnings.push(m);

/** Same resolution order as register-tokens.js: env override, then the record. */
function resolveDiamond() {
  const fromEnv = (process.env.KALEIDO_DIAMOND || "").trim();
  if (fromEnv) {
    if (!ethers.isAddress(fromEnv)) {
      throw new Error(`KALEIDO_DIAMOND is not a valid address: ${fromEnv}`);
    }
    return { address: ethers.getAddress(fromEnv), source: "KALEIDO_DIAMOND" };
  }

  const file = `deployment-diamond-${hre.network.name}.json`;
  if (fs.existsSync(file)) {
    const record = JSON.parse(fs.readFileSync(file, "utf8"));
    const addr = record?.contracts?.diamond;
    if (addr && ethers.isAddress(addr)) {
      return { address: ethers.getAddress(addr), source: file, record };
    }
  }

  throw new Error(
    `No diamond address. Set KALEIDO_DIAMOND, or run scripts/deploy.js on ` +
      `${hre.network.name} so it writes ${file}.`,
  );
}

function fmtAge(seconds) {
  if (seconds < 90) return `${seconds}s`;
  if (seconds < 5400) return `${seconds}s (${(seconds / 60).toFixed(1)}m)`;
  return `${seconds}s (${(seconds / 3600).toFixed(1)}h)`;
}

async function main() {
  const { address: diamondAddress, source, record } = resolveDiamond();
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);

  console.log(`\n🔍 Verifying diamond on ${hre.network.name} (chain ${chainId})`);
  console.log(`   ${diamondAddress}`);
  console.log(`   address from: ${source}\n`);

  if ((await ethers.provider.getCode(diamondAddress)) === "0x") {
    throw new Error(
      `No code at ${diamondAddress} on ${hre.network.name}. Either this address is ` +
        "from a different chain's deploy, or the record was written for a network " +
        "whose RPC now points somewhere else. Nothing else can be checked.",
    );
  }

  /* ── 1 & 2. Selector routing ──────────────────────────────────────────── */
  const loupe = await ethers.getContractAt("DiamondLoupeFacet", diamondAddress);
  const onChainFacets = await loupe.facets();

  console.log("── Selector routing ──");

  /* Flatten the loupe's view once: selector -> facet address, per the router. */
  const routedTo = new Map();
  for (const f of onChainFacets) {
    for (const sel of f.functionSelectors) {
      const key = sel.toLowerCase();
      if (routedTo.has(key)) {
        fail(
          `selector ${key} is listed under two facets (${routedTo.get(key)} and ` +
            `${f.facetAddress}). The loupe should never report this; treat the ` +
            "diamond's storage as corrupt and do not send it transactions.",
        );
      }
      routedTo.set(key, ethers.getAddress(f.facetAddress));
    }
  }

  const declaredBy = new Map(); // selector -> facet name, from artifacts
  let checkedFacets = 0;

  for (const name of CUT_FACETS) {
    /* The record is a hint, not the source of truth: fall back to matching by
     * declared selectors so a diamond with no record can still be checked. */
    const expected = record?.facets?.[name];
    const factory = await ethers.getContractFactory(name);
    const declared = getSelectors(factory).map((s) => s.toLowerCase());

    for (const sel of declared) {
      if (declaredBy.has(sel)) {
        /* Two facets declaring one selector cannot both be cut in — the second
         * Add reverts. Usually a shared inherited function. */
        warn(
          `selector ${sel} is declared by both ${declaredBy.get(sel)} and ${name}; ` +
            "only one can be routed, so check the cut used the one you meant.",
        );
      } else {
        declaredBy.set(sel, name);
      }
    }

    const unrouted = declared.filter((s) => !routedTo.has(s));
    const addresses = new Set(
      declared.filter((s) => routedTo.has(s)).map((s) => routedTo.get(s)),
    );

    if (unrouted.length) {
      const iface = factory.interface;
      const named = unrouted.map((sel) => {
        const frag = iface.fragments.find(
          (f) => f.type === "function" && f.selector.toLowerCase() === sel,
        );
        return `${sel} ${frag ? frag.format("sighash") : "(unknown)"}`;
      });
      fail(
        `${name}: ${unrouted.length} of ${declared.length} selectors are not routed:\n` +
          named.map((n) => `        ${n}`).join("\n"),
      );
      console.log(`   ❌ ${name.padEnd(21)} ${declared.length - unrouted.length}/${declared.length} routed`);
      continue;
    }

    if (addresses.size > 1) {
      fail(
        `${name}: its selectors are split across ${addresses.size} addresses ` +
          `(${[...addresses].join(", ")}). A partial re-cut left the facet in two ` +
          "versions, so behaviour depends on which function is called.",
      );
    }

    const at = [...addresses][0];
    if (expected && at && ethers.getAddress(expected) !== at) {
      warn(
        `${name} is routed to ${at} but the record says ${expected}. The record is ` +
          "stale, or this diamond was cut from a different build than the record " +
          "describes — the chain is right and the file is wrong.",
      );
    }

    console.log(`   ✅ ${name.padEnd(21)} ${declared.length}/${declared.length} routed  ${at}`);
    checkedFacets++;
  }

  /* Direction two: anything routed that no artifact declares. */
  const undeclared = [...routedTo.keys()].filter((s) => !declaredBy.has(s));
  if (undeclared.length) {
    fail(
      `${undeclared.length} routed selector(s) are declared by none of the known ` +
        `facet artifacts: ${undeclared.join(", ")}.\n` +
        "        Either a facet outside CUT_FACETS is cut into this diamond, or " +
        "contracts/ has been edited and recompiled since this deploy — in which " +
        "case artifacts/ no longer describes the deployed bytecode and every ABI " +
        "the frontend generates from it is suspect.",
    );
  }

  /* The router's own lookup must agree with the enumeration. Sampled rather than
   * exhaustive: one facetAddress() call per facet, not per selector, because this
   * catches a corrupt router and 80 extra round-trips would not catch more. */
  const sample = new Map(); // facet address -> one of its selectors
  for (const [sel, addr] of routedTo) {
    if (!sample.has(addr)) sample.set(addr, sel);
  }

  for (const [addr, sel] of sample) {
    const answered = ethers.getAddress(await loupe.facetAddress(sel));
    if (answered !== addr) {
      fail(
        `facetAddress(${sel}) answers ${answered} but facets() lists it under ` +
          `${addr}. The two loupe views disagree, which means selectorToFacet and ` +
          "the facet array are out of sync.",
      );
    }
  }

  /* ── 3. Ownership ─────────────────────────────────────────────────────── */
  console.log("\n── Ownership ──");
  const ownership = await ethers.getContractAt("OwnershipFacet", diamondAddress);
  const owner = ethers.getAddress(await ownership.owner());
  const [signer] = await ethers.getSigners();
  const signerAddress = signer ? ethers.getAddress(signer.address) : null;

  console.log(`   owner  ${owner}`);
  console.log(`   signer ${signerAddress ?? "(none configured)"}`);

  if (signerAddress && owner !== signerAddress) {
    warn(
      `the configured signer is not the owner, so every owner-gated script ` +
        "(register-tokens.js, setFeedMaxAge, setPriceBounds) will revert against " +
        "this diamond. Correct if ownership has already moved to a multisig; a " +
        "problem if it has not.",
    );
  }
  if (owner === ethers.ZeroAddress) {
    fail("owner is the zero address — the diamond can never be reconfigured again.");
  }

  /* ── 4. Oracle reachability ───────────────────────────────────────────── */
  console.log("\n── Oracle ──");
  const protocol = await ethers.getContractAt("ProtocolFacet", diamondAddress);
  const oracleAddress = ethers.getAddress(await protocol.getPythPriceOracle());
  const globalMaxAge = Number(await protocol.getPriceMaxAge());
  const globalConfBps = Number(await protocol.getPriceMaxConfBps());

  console.log(`   oracle           ${oracleAddress}`);
  console.log(`   global max age   ${globalMaxAge}s`);
  console.log(`   max confidence   ${globalConfBps} bps`);

  if (oracleAddress === ethers.ZeroAddress) {
    fail("no price oracle is set; every priced operation reverts.");
  }
  if (globalMaxAge === 0 || globalConfBps === 0) {
    fail(
      `price bounds are unset (maxAge ${globalMaxAge}, conf ${globalConfBps}). ` +
        "_priceScaled18 treats zero as unconfigured and reverts, so the protocol " +
        "is entirely offline until setPriceBounds runs.",
    );
  }

  let oracle = null;
  if (oracleAddress !== ethers.ZeroAddress) {
    if ((await ethers.provider.getCode(oracleAddress)) === "0x") {
      fail(
        `the oracle address ${oracleAddress} holds no code on this chain. ` +
          "setPythOracle accepted it because it does not getCode-check, and every " +
          "priced call now reverts on a call to an empty address.",
      );
    } else {
      /* Which wrapper is installed decides how to read it, and the contract will
       * say so itself rather than being inferred from the chain id. */
      let kind = "(no oracleKind())";
      try {
        const probe = new ethers.Contract(
          oracleAddress,
          ["function oracleKind() view returns (string)"],
          ethers.provider,
        );
        kind = await probe.oracleKind();
      } catch {
        /* PythPriceOracle predates oracleKind(); absence is not a failure. */
      }
      console.log(`   oracleKind()     ${kind}`);

      const expectedBackend = backendFor(chainId);
      if (kind !== "(no oracleKind())" && kind !== expectedBackend) {
        warn(
          `the deployed oracle reports "${kind}" but scripts/libraries/` +
            `aggregator-feeds.js selects "${expectedBackend}" for chain ${chainId}. ` +
            "The table has moved since this oracle was deployed; the feeds it " +
            "serves are the ones from the old backend.",
        );
      }

      oracle = new ethers.Contract(
        oracleAddress,
        [
          "function getPrice(bytes32) view returns (tuple(int64 price,uint64 conf,int32 expo,uint256 publishTime))",
        ],
        ethers.provider,
      );
    }
  }

  /* ── 5. Per-feed freshness, against the bound actually installed ───────── */
  let plan = [];
  try {
    plan = feedPlanFor(chainId);
  } catch (err) {
    warn(`could not build the feed plan for chain ${chainId}: ${err.message}`);
  }

  /* Which feeds actually price something.
   *
   * An oracle can hold more feeds than the protocol uses: deploy-oracle.js
   * installs every feed in the chain's table so that adding a market later needs
   * no oracle change, and BTC/USD on Base Sepolia is registered against no token
   * at all. A stale feed that backs a registered token takes real operations
   * offline; a stale feed that backs nothing is inert. Reporting both as the same
   * failure would train the reader to ignore the check.
   *
   * ProtocolFacet has no getter for s_priceFeeds[token], so the mapping is
   * rebuilt from the token side: each registered address -> its symbol -> its feed
   * id, through the same table register-tokens.js used. Derived on-chain rather
   * than read from deployment-tokens-*.json so this still works against a diamond
   * whose record is missing or stale — which is the case this script exists for.
   */
  const collateralAddrs = (await protocol.getAllCollateralToken()).map((a) =>
    ethers.getAddress(a),
  );
  const loanableAddrs = (await protocol.getLoanableAssets()).map((a) =>
    ethers.getAddress(a),
  );

  const NATIVE_SENTINEL = ethers.getAddress(
    "0x0000000000000000000000000000000000000001",
  );
  const nativeFeedSymbol =
    record?.nativeFeedSymbol ||
    (process.env.NATIVE_FEED_SYMBOL || "").trim() ||
    null;

  const backingFeeds = new Map(); // feed id -> [symbols of tokens using it]
  for (const addr of new Set([...collateralAddrs, ...loanableAddrs])) {
    let symbol = null;
    if (addr === NATIVE_SENTINEL) {
      symbol = nativeFeedSymbol;
      if (!symbol) {
        warn(
          "the native sentinel address(1) is registered but the feed symbol it was " +
            "registered under is unknown (no nativeFeedSymbol in the record and no " +
            "NATIVE_FEED_SYMBOL set), so its feed could not be checked for staleness.",
        );
        continue;
      }
    } else {
      try {
        const erc20 = new ethers.Contract(
          addr,
          ["function symbol() view returns (string)"],
          ethers.provider,
        );
        symbol = await erc20.symbol();
      } catch {
        warn(
          `registered token ${addr} does not answer symbol(), so its feed could not ` +
            "be identified. It is registered, so it is priced off whatever feed id " +
            "was passed to addCollateralToken — check it by hand.",
        );
        continue;
      }
    }

    try {
      const id = feedFor(symbol).id.toLowerCase();
      if (!backingFeeds.has(id)) backingFeeds.set(id, []);
      backingFeeds.get(id).push(symbol);
    } catch (err) {
      warn(
        `registered token ${symbol} @ ${addr} has no feed id in pyth-feeds.js ` +
          `(${err.message}), so its staleness could not be checked.`,
      );
    }
  }

  if (oracle && plan.length) {
    console.log("\n── Feeds (live, right now) ──");

    for (const feed of plan) {
      const label = feed.symbols.join("/");
      const id = feed.id.toLowerCase();
      const backs = backingFeeds.get(id) || [];
      const inUse = backs.length > 0;
      const installed = Number(await protocol.getFeedMaxAge(feed.id));
      const bound = installed || globalMaxAge;
      const boundSource = installed ? "per-feed" : "global";

      let priced;
      try {
        priced = await oracle.getPrice(feed.id);
      } catch (err) {
        const msg =
          `${label}: getPrice reverted (${err.shortMessage || err.message}). The ` +
          "feed id is not registered in the oracle, or its aggregator is not answering.";
        if (inUse) {
          fail(
            `${msg} ${backs.join(", ")} is registered against it, so that token ` +
              "cannot be deposited, borrowed or liquidated.",
          );
        } else {
          warn(`${msg} No registered token uses it yet.`);
        }
        console.log(`   ❌ ${label.padEnd(10)} getPrice reverted`);
        continue;
      }

      /* The reference block is sampled per feed, AFTER getPrice, not once before
       * the loop.
       *
       * The contract computes `block.timestamp - publishTime` inside a single
       * call, so it can never see a block older than the observation. A block
       * fetched once before the loop is progressively staler with each feed —
       * every iteration spends two round trips — which subtracts the run's own
       * duration from every reported age. That is the optimistic direction: a
       * feed sitting just inside its bound reads as passing here while the
       * contract reverts on it. It showed up as BTC (last in the plan) reporting
       * `age -4s`, which is not a clock problem, it is this.
       *
       * Sampling after the read makes the reference at-or-after the observation,
       * so the age is an upper bound on what the contract would compute. A
       * negative age surviving this is real skew — the aggregator's round is
       * timestamped ahead of chain time — and is reported rather than hidden,
       * because a bound checked against a future timestamp is not measuring
       * staleness at all.
       */
      const block = await ethers.provider.getBlock("latest");
      const age = Number(block.timestamp) - Number(priced.publishTime);
      const value = Number(priced.price) * 10 ** Number(priced.expo);
      const ok = age <= bound;
      const mark = ok ? "✅" : inUse ? "❌" : "➖";

      if (age < 0) {
        warn(
          `${label}: the feed's round is timestamped ${-age}s in the future ` +
            `relative to chain time (publishTime ${priced.publishTime} vs block ` +
            `${block.timestamp}). The staleness bound is being checked against a ` +
            "future timestamp, so it is not currently constraining anything for " +
            "this feed.",
        );
      }

      console.log(
        `   ${mark} ${label.padEnd(10)} $${value.toLocaleString(undefined, {
          maximumFractionDigits: 6,
        })}  age ${fmtAge(age).padEnd(16)} bound ${bound}s (${boundSource})` +
          (inUse ? `  ← ${backs.join(", ")}` : "  (no token registered)"),
      );

      if (!ok && inUse) {
        fail(
          `${label} is ${fmtAge(age)} old against a ${bound}s ${boundSource} bound, ` +
            `and ${backs.join(", ")} is registered against it — so every priced ` +
            "operation touching that token reverts right now. Either the feed " +
            "stopped publishing, or the bound is tighter than its real heartbeat.",
        );
      } else if (!ok && !inUse) {
        warn(
          `${label} is ${fmtAge(age)} old against its ${bound}s ${boundSource} bound, ` +
            "but no registered token is priced off it, so nothing is affected today. " +
            "It would break whatever market is added against it — install a bound " +
            "that matches its real heartbeat before registering a token here.",
        );
      } else if (inUse && !installed) {
        warn(
          `${label} prices ${backs.join(", ")} but has no per-feed bound, so it is ` +
            `falling back to the global ${globalMaxAge}s. Its measured age is ` +
            `${fmtAge(age)} — inside the bound now, but the global default is not ` +
            "derived from this feed's heartbeat. Run register-tokens.js to install " +
            "the measured bound.",
        );
      }
    }
  }

  /* ── 6. Registration state ────────────────────────────────────────────── */
  /* Arrays already read in section 5 to build the feed mapping. */
  console.log("\n── Registered assets ──");
  const collateral = collateralAddrs;
  const loanable = loanableAddrs;

  console.log(`   collateral ${collateral.length}: ${collateral.join(", ") || "(none)"}`);
  console.log(`   loanable   ${loanable.length}: ${loanable.join(", ") || "(none)"}`);

  const dupes = loanable.filter((a, i) => loanable.indexOf(a) !== i);
  if (dupes.length) {
    fail(
      `loanable contains duplicates: ${[...new Set(dupes)].join(", ")}. ` +
        "addLoanableToken pushes unconditionally, so it was called twice; " +
        "getLoanableAssets returns the address twice and the UI renders it twice. " +
        "Nothing removes an entry from s_loanableToken.",
    );
  }

  if (!collateral.length && !loanable.length) {
    warn(
      "no assets are registered, so every token-touching entry point reverts with " +
        "Protocol__TokenNotAllowed. Expected between deploy.js and " +
        "register-tokens.js; a blocker after it.",
    );
  }

  /* ── Summary ──────────────────────────────────────────────────────────── */
  console.log(
    `\n${"─".repeat(60)}\n` +
      `Checked ${checkedFacets}/${CUT_FACETS.length} facets, ${routedTo.size} selectors, ` +
      `${plan.length} feeds.`,
  );

  if (warnings.length) {
    console.log(`\n⚠️  ${warnings.length} warning(s):`);
    warnings.forEach((w, i) => console.log(`   ${i + 1}. ${w}`));
  }

  if (failures.length) {
    console.log(`\n❌ ${failures.length} failure(s):`);
    failures.forEach((f, i) => console.log(`   ${i + 1}. ${f}`));
    console.log("");
    process.exitCode = 1;
    return;
  }

  console.log(`\n✅ Diamond verified on ${hre.network.name}.\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
