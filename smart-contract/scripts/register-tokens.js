/**
 * Register collateral and loanable assets on the diamond.
 *
 *   KALEIDO_DIAMOND=0x... \
 *   COLLATERAL_TOKENS="NATIVE,WETH=0x...,USDC=0x...,USDT=0x..." \
 *   LOANABLE_TOKENS="USDC=0x...,USDT=0x..." \
 *   npx hardhat run scripts/register-tokens.js --network baseTestnet
 *
 * No script did this, and until it runs the lending market has no assets at all:
 * every entry point on ProtocolFacet that touches a token carries
 * `_isTokenAllowed`, which is `s_priceFeeds[_token] != bytes32(0)`. With the
 * mapping empty, depositCollateral, createLendingRequest, createLoanListing and
 * every health-factor read revert with Protocol__TokenNotAllowed. deploy.js
 * prints these two calls as "still required" and then leaves them undone, which
 * is where a fresh deploy currently stops being usable.
 *
 * Writes deployment-tokens-<network>.json.
 *
 * ── Four things this script exists to get right ────────────────────────────
 *
 * 1. ORDER: collateral first, then loanable. `addCollateralToken` reverts with
 *    Protocol__TokenAlreadyExists when `s_priceFeeds[_token] != 0`, and
 *    `addLoanableToken` writes that same mapping with no such check. So
 *    registering a token as loanable first makes it permanently impossible to
 *    add as collateral — there is no setter that clears one without the other
 *    (removeCollateralTokens zeroes the feed for a list of tokens, but that is a
 *    different, owner-only repair path). Every token that is meant to be both
 *    must go through addCollateralToken first. This is the single most costly
 *    ordering mistake available here and nothing in the contracts prevents it.
 *
 * 2. DUPLICATES: `addLoanableToken` pushes onto `s_loanableToken` unconditionally.
 *    Calling it twice for the same token leaves that address in the array twice,
 *    which getLoanableAssets() then returns twice and the frontend renders twice.
 *    So membership is checked before every call, which also makes re-running this
 *    script safe.
 *
 * 3. THE NATIVE SENTINEL: native collateral is tracked under
 *    Constants.NATIVE_TOKEN = address(1), not under the wrapped-native ERC20.
 *    `depositCollateral(address(1), …)` runs the same `_isTokenAllowed` check as
 *    any other token, so address(1) needs its own feed registration or native
 *    deposits revert while WETH deposits work — a confusing failure that looks
 *    like a wallet problem. Pass `NATIVE` in COLLATERAL_TOKENS to register it.
 *
 * 4. THE RIGHT FEED FOR THE RIGHT TOKEN: a wrong-but-real feed id does not
 *    revert, it silently misprices the asset forever. Two independent checks run
 *    before anything is sent: the feed is verified against Pyth on this chain and
 *    against Hermes' symbol registry (scripts/libraries/pyth-feeds.js), and the
 *    token's own on-chain symbol() is compared to the symbol you named it with.
 *    Either mismatch refuses the whole run rather than registering part of it.
 */

const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");

const {
  feedFor,
  fetchHermesSymbols,
  verifyFeed,
  pythBoundFor,
  pythBoundPlanFor,
} = require("./libraries/pyth-feeds.js");
const {
  backendFor,
  aggregatorFor,
  feedPlanFor,
  verifyAggregatorFeed,
} = require("./libraries/aggregator-feeds.js");
const { waitForState } = require("./libraries/rpc.js");

/** The read surface both Chainlink feeds and API3 reader proxies expose. */
const AGGREGATOR_ABI = [
  "function decimals() view returns (uint8)",
  "function description() view returns (string)",
];

/** Constants.NATIVE_TOKEN — the lending protocol's native sentinel. */
const NATIVE_SENTINEL = "0x0000000000000000000000000000000000000001";

const ERC20_METADATA_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

/**
 * Parse a "SYM=0x…,SYM=0x…" list, allowing a bare `NATIVE`.
 *
 * Symbols are carried alongside the addresses rather than inferred from the
 * chain because they are what selects the price feed. An operator who mistypes
 * an address gets a symbol mismatch instead of a mispriced market.
 */
function parseTokenList(raw, envName) {
  const out = [];
  for (const chunk of (raw || "").split(",").map((s) => s.trim()).filter(Boolean)) {
    if (chunk.toUpperCase() === "NATIVE") {
      out.push({ symbol: nativeFeedSymbol(), address: NATIVE_SENTINEL, isNative: true });
      continue;
    }
    const eq = chunk.indexOf("=");
    if (eq === -1) {
      throw new Error(
        `${envName} entry "${chunk}" is not SYMBOL=address.\n` +
          'Example: COLLATERAL_TOKENS="NATIVE,WETH=0xabc...,USDC=0xdef..."',
      );
    }
    const symbol = chunk.slice(0, eq).trim();
    const address = chunk.slice(eq + 1).trim();
    if (!symbol) throw new Error(`${envName} entry "${chunk}" has an empty symbol`);
    if (!ethers.isAddress(address)) {
      throw new Error(`${envName} entry "${chunk}" has an invalid address`);
    }
    out.push({ symbol, address: ethers.getAddress(address), isNative: false });
  }
  return out;
}

/**
 * Which feed prices the chain's native currency.
 *
 * Not derivable from the chain id here, and wrong by default on two of our five
 * targets: BNB Testnet's native token is BNB, and Arc's is USDC. Defaulting to
 * ETH silently would price a BNB deposit off ether — roughly a 6x overvaluation
 * of the borrower's collateral, which is a solvency hole rather than a display
 * bug. So it is read from the environment and defaults to ETH only because four
 * of the five chains use it; NATIVE_FEED_SYMBOL is checked against the token
 * list in the summary either way.
 */
function nativeFeedSymbol() {
  return (process.env.NATIVE_FEED_SYMBOL || "ETH").trim().toUpperCase();
}

/** Resolve the diamond address from env, or from what deploy.js recorded. */
function resolveDiamond() {
  const fromEnv = (process.env.KALEIDO_DIAMOND || "").trim();
  if (fromEnv) {
    if (!ethers.isAddress(fromEnv)) {
      throw new Error(`KALEIDO_DIAMOND is not a valid address: ${fromEnv}`);
    }
    return ethers.getAddress(fromEnv);
  }

  const file = `deployment-diamond-${hre.network.name}.json`;
  if (fs.existsSync(file)) {
    const record = JSON.parse(fs.readFileSync(file, "utf8"));
    const address = record?.contracts?.diamond;
    if (address && ethers.isAddress(address)) {
      console.log(`  (diamond read from ${file})`);
      return ethers.getAddress(address);
    }
  }

  throw new Error(
    "KALEIDO_DIAMOND is required.\n" +
      `Set it, or run scripts/deploy.js on ${hre.network.name} first so that\n` +
      `${file} exists for this script to read.`,
  );
}

/**
 * Confirm the token at `address` is the asset the operator says it is.
 *
 * This is the check that catches an address pasted from the wrong row. A wrong
 * address that happens to be a real ERC20 registers cleanly and then prices that
 * token off the named symbol's feed for the rest of the deployment's life.
 *
 * A token that does not implement symbol() is warned about rather than refused:
 * symbol() is not part of the ERC20 spec's required surface, and some older
 * tokens return bytes32. Decimals are reported for the same reason they matter
 * to getUsdValue, which scales by them.
 */
async function describeToken(token) {
  if (token.isNative) {
    /* _getTokenDecimal hardcodes 18 for the sentinel — there is no contract to
     * ask. On a chain whose native unit is not 18-decimal wei that assumption is
     * worth checking by hand before trusting native collateral valuations. */
    return { symbol: null, decimals: 18, note: "native sentinel; decimals assumed 18 by _getTokenDecimal" };
  }

  if ((await ethers.provider.getCode(token.address)) === "0x") {
    throw new Error(
      `${token.symbol} at ${token.address} holds no code on ${hre.network.name}.\n` +
        "Almost always an address copied from another chain.",
    );
  }

  const erc20 = new ethers.Contract(token.address, ERC20_METADATA_ABI, ethers.provider);
  let onChainSymbol = null;
  let decimals = null;
  try {
    onChainSymbol = await erc20.symbol();
  } catch {
    /* left null; reported as a warning by the caller */
  }
  try {
    decimals = Number(await erc20.decimals());
  } catch {
    /* left null */
  }
  return { symbol: onChainSymbol, decimals, note: null };
}

/**
 * Does the on-chain symbol corroborate the declared one?
 *
 * Deliberately tolerant about wrapping and case — WETH against ETH, or a mock
 * deployed as "USDC (Kaleido Test)" — because the feed is chosen by asset, not
 * by ticker string, and a strict match would refuse correct registrations. What
 * it will not tolerate is two symbols with no relationship, which is the actual
 * failure mode.
 */
function symbolsAgree(declared, onChain) {
  if (!onChain) return true;
  const norm = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const a = norm(declared);
  const b = norm(onChain);
  if (a === b) return true;
  const strip = (s) => s.replace(/^W/, "");
  if (strip(a) === strip(b)) return true;
  return b.includes(a) || a.includes(b);
}

async function main() {
  const [signer] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);

  console.log("Registering protocol assets");
  console.log("  network: ", hre.network.name, `(chainId ${chainId})`);
  console.log("  signer:  ", signer.address);

  const diamondAddress = resolveDiamond();
  console.log("  diamond: ", diamondAddress);
  if ((await ethers.provider.getCode(diamondAddress)) === "0x") {
    throw new Error(`No contract at ${diamondAddress} on ${hre.network.name}.`);
  }

  const collateral = parseTokenList(process.env.COLLATERAL_TOKENS, "COLLATERAL_TOKENS");
  const loanable = parseTokenList(process.env.LOANABLE_TOKENS, "LOANABLE_TOKENS");
  if (collateral.length === 0 && loanable.length === 0) {
    throw new Error(
      "Nothing to register: set COLLATERAL_TOKENS and/or LOANABLE_TOKENS.\n" +
        'Example: COLLATERAL_TOKENS="NATIVE,WETH=0x...,USDC=0x..." ' +
        'LOANABLE_TOKENS="USDC=0x...,USDT=0x..."\n' +
        "Pass NATIVE to register the address(1) sentinel that native deposits use.",
    );
  }

  /* Both calls are LibDiamond.enforceIsContractOwner. Checked before anything is
   * sent, because the revert reason from a diamond fallback is not always
   * legible and a half-registered market is worse than none. */
  const ownership = await ethers.getContractAt("OwnershipFacet", diamondAddress);
  const owner = await ownership.owner();
  if (ethers.getAddress(owner) !== ethers.getAddress(signer.address)) {
    throw new Error(
      `Signer is not the diamond owner.\n` +
        `   owner:  ${owner}\n` +
        `   signer: ${signer.address}\n` +
        "addCollateralToken and addLoanableToken both enforce contract ownership.\n" +
        "If ownership has already moved to a multisig, these two calls have to be\n" +
        "proposed there rather than run from a script.",
    );
  }

  const protocol = await ethers.getContractAt("ProtocolFacet", diamondAddress);

  /* Registering feeds against a diamond with no oracle records prices that
   * nothing can read: _priceScaled18 reverts on a zero oracle, so the market
   * would look configured and price nothing. */
  const oracleAddress = await protocol.getPythPriceOracle();
  if (oracleAddress === ethers.ZeroAddress) {
    throw new Error(
      "The diamond has no price oracle set. Run scripts/deploy-oracle.js and\n" +
        "deploy.js (which calls setPythOracle) before registering assets — the\n" +
        "feed ids registered here are read through that oracle.",
    );
  }
  if ((await ethers.provider.getCode(oracleAddress)) === "0x") {
    throw new Error(`The configured oracle ${oracleAddress} holds no code.`);
  }

  /**
   * Which backend is installed, asked of the contract rather than assumed.
   *
   * The diamond stores either backend behind the same `IPythPriceOracle` type and
   * calls only `getPrice(bytes32)` on it, so the address alone does not say which
   * one it is — and the two need different verification. A Pyth feed is proven by
   * calling `getPriceUnsafe(id)` on Pyth's own contract; an aggregator chain has
   * no such contract, and `oracle.pyth()` (which this script used to call
   * unconditionally) reverts there.
   *
   * Falls back to "pyth" only if `oracleKind()` is missing entirely, which means
   * an oracle deployed before that function existed — and only when the error says
   * the node answered. A dropped connection and a contract without the function
   * are the same observation to a naive try/catch, and guessing "pyth" through a
   * network blip would send this script down the Pyth path on an aggregator chain,
   * where `oracle.pyth()` reverts and the failure names the wrong cause.
   */
  const kindProbe = new ethers.Contract(
    oracleAddress,
    ["function oracleKind() view returns (string)"],
    ethers.provider,
  );
  let oracleKind;
  try {
    oracleKind = await kindProbe.oracleKind();
  } catch (err) {
    /* CALL_EXCEPTION = the contract reverted; BAD_DATA = it returned something
     * undecodable, which is what calling a nonexistent function on a contract
     * with no fallback looks like. Either way the node responded. Anything else
     * (NETWORK_ERROR, TIMEOUT, SERVER_ERROR, UNSUPPORTED_OPERATION) is a
     * transport problem and says nothing about the contract. */
    if (err.code !== "CALL_EXCEPTION" && err.code !== "BAD_DATA") {
      throw new Error(
        `Could not read oracleKind() from ${oracleAddress}: ${err.shortMessage || err.message}\n` +
          `(ethers code ${err.code || "unknown"})\n` +
          "That is a transport failure, not an answer, so which backend is installed\n" +
          "is still unknown. Retry rather than guessing — picking the wrong backend\n" +
          "verifies feeds against an oracle that cannot serve them.",
      );
    }
    oracleKind = "pyth";
    console.warn(
      `   ⚠️  oracleKind() reverted (${err.shortMessage || err.message}).\n` +
        "       Assuming the Pyth backend — this oracle predates that function.\n" +
        "       Pass ORACLE_BACKEND=aggregator-v3 if that is wrong.",
    );
  }
  if (process.env.ORACLE_BACKEND) {
    const forced = backendFor(chainId);
    if (forced !== oracleKind) {
      throw new Error(
        `ORACLE_BACKEND=${forced} but the deployed oracle at ${oracleAddress}\n` +
          `reports oracleKind() "${oracleKind}". The diamond is pointed at the\n` +
          "other backend. Fix the env var or call setPythOracle with the right\n" +
          "oracle — do not register feeds against an oracle you cannot read.",
      );
    }
  }

  const isAggregator = oracleKind === "aggregator-v3";
  let pyth = null;
  let pythAddress = null;

  if (isAggregator) {
    console.log("  oracle:  ", oracleAddress, "(aggregator-v3)");
  } else {
    const pythOracle = await ethers.getContractAt("PythPriceOracle", oracleAddress);
    pythAddress = await pythOracle.pyth();
    pyth = await ethers.getContractAt("IPyth", pythAddress);
    console.log("  oracle:  ", oracleAddress, `(pyth ${pythAddress})`);
  }

  /* Bound to AggregatorPriceOracle's surface only on the chains that have one. */
  const aggregatorOracle = isAggregator
    ? await ethers.getContractAt("AggregatorPriceOracle", oracleAddress)
    : null;

  const block = await ethers.provider.getBlock("latest");
  const maxAge = Number(process.env.PRICE_MAX_AGE_SECONDS || 300);

  const skipHermes = process.env.SKIP_HERMES === "1";
  console.log("\n1. Verifying price feeds");
  if (skipHermes) {
    console.warn(
      "   SKIP_HERMES=1 — the off-chain symbol check is OFF. Feeds will be\n" +
        "   proven to exist on this chain but NOT proven to name the asset you\n" +
        "   think. Do not use this on a chain you intend to leave running.",
    );
  }
  /* Hermes is asked on both backends, for different reasons. On a Pyth chain it
   * proves the id names the asset. On an aggregator chain the id is only a label
   * — the price comes from the aggregator — but the label still has to be the
   * canonical one for that asset, because the same bytes32 is what the registry
   * and the frontend key on across all five chains. A chain that stored the
   * USDC/USD id for ETH would price correctly here and be wrong everywhere the
   * id is compared. */
  const hermes = skipHermes ? null : await fetchHermesSymbols();

  /**
   * Verify one feed on whichever backend is installed.
   *
   * The two paths answer the same question with different evidence:
   *
   *   pyth           `getPriceUnsafe(id)` on Pyth's contract proves the chain
   *                  serves the id; Hermes proves the id names the asset.
   *   aggregator-v3  the aggregator's `decimals()` and `description()` prove what
   *                  it is (self-reported — evidence, not proof: there is no
   *                  Hermes equivalent for Chainlink or API3), and the oracle's
   *                  own `getPrice(id)` proves the mapping was installed.
   *
   * A missing aggregator entry is a hard failure rather than a skip. Registering
   * a token whose id maps to nothing in the oracle produces a market that looks
   * configured and reverts FeedNotSet on the first deposit.
   */
  async function verifyOne(token, feed) {
    if (!isAggregator) {
      const verdict = await verifyFeed({ pyth, feed, hermes, blockTime: block.timestamp });

      /* Carry this chain's bound for the feed, exactly as the aggregator path
       * does below. Without it every feed on a Pyth chain was judged against the
       * global PRICE_MAX_AGE_SECONDS and setFeedMaxAge was never called for any of
       * them — the bound-install loop only ever read the aggregator table. On Arc,
       * whose native currency is USDC and whose USDC/USD measured 58,510s old,
       * that meant a registration that reported success and a market that reverted
       * on every priced call. */
      const bound = pythBoundFor(chainId, token.symbol);
      if (!bound) return verdict;

      /* maxAge null is a recorded refusal: the observed age exceeds
       * Constants.MAX_FEED_PRICE_AGE, so setFeedMaxAge would revert at any value
       * covering it AS THE FEED CURRENTLY STANDS. Harder than the warning a
       * merely-stale feed gets further down, because registering is not
       * reversible: removeCollateralTokens exists, but nothing removes a loanable
       * token.
       *
       * Note what the refusal does and does not claim. On a pull oracle an age is
       * a relay history, so "no bound covers this" is a statement about nobody
       * pushing rather than about the asset — scripts/push-prices.js took Arc's
       * two 97-day feeds to 15s for 1 wei each, and created a third the receiver
       * had never held. Registering after a push is therefore possible; it just
       * commits us to keeping that pusher running at whatever bound gets chosen,
       * and this script is the wrong place to take on that commitment silently.
       * Clear the refusal by measuring a post-push age and writing a real bound
       * into PYTH_BOUNDS, not by removing this branch. */
      if (bound.maxAge === null) {
        return {
          ok: false,
          reasons: [
            `${feed.symbol} cannot be bounded on this chain, so registering ` +
              `${token.symbol} would create a market that reverts on every priced ` +
              `call. ${bound.basis}`,
          ],
          warnings: [],
          ageSeconds: verdict.ageSeconds,
        };
      }

      return { ...verdict, feedMaxAge: bound.maxAge, maxAgeBasis: bound.basis };
    }

    let entry;
    try {
      entry = aggregatorFor(chainId, token.symbol);
    } catch (err) {
      return { ok: false, reasons: [err.message], warnings: [], ageSeconds: null };
    }

    const installed = await aggregatorOracle.feedAggregator(feed.id);
    if (installed === ethers.ZeroAddress) {
      return {
        ok: false,
        reasons: [
          `feed id ${feed.id.slice(0, 10)}… is not registered in the oracle at ` +
            `${oracleAddress}. Re-run scripts/deploy-oracle.js, or call setFeed on ` +
            `it for ${entry.aggregator}, before registering this token.`,
        ],
        warnings: [],
        ageSeconds: null,
      };
    }
    if (ethers.getAddress(installed) !== ethers.getAddress(entry.aggregator)) {
      return {
        ok: false,
        reasons: [
          `the oracle maps this feed id to ${installed} but the table expects ` +
            `${entry.aggregator}. One of the two is wrong and the token would be ` +
            "priced off whichever asset the installed address serves.",
        ],
        warnings: [],
        ageSeconds: null,
      };
    }

    const verdict = await verifyAggregatorFeed({
      oracle: aggregatorOracle,
      aggregatorContract: new ethers.Contract(entry.aggregator, AGGREGATOR_ABI, ethers.provider),
      feedId: feed.id,
      feed: entry,
      blockTime: block.timestamp,
    });

    /* Carry the bound this feed needs, so the registration step can install it. */
    return { ...verdict, feedMaxAge: entry.maxAge, maxAgeBasis: entry.maxAgeBasis };
  }

  /* Every check for every token, before the first transaction. A partial
   * registration is expensive to unwind: removeCollateralTokens exists, but
   * nothing removes a loanable token from s_loanableToken. */
  const plan = [];
  const failures = [];

  const seenCollateral = (await protocol.getAllCollateralToken()).map((a) =>
    ethers.getAddress(a),
  );
  const seenLoanable = (await protocol.getLoanableAssets()).map((a) => ethers.getAddress(a));

  for (const [kind, list] of [
    ["collateral", collateral],
    ["loanable", loanable],
  ]) {
    for (const token of list) {
      const label = `${token.symbol}${token.isNative ? " (native sentinel)" : ""} @ ${token.address}`;

      let feed;
      try {
        feed = feedFor(token.symbol);
      } catch (err) {
        failures.push(`${label}: ${err.message}`);
        continue;
      }

      let described;
      try {
        described = await describeToken(token);
      } catch (err) {
        failures.push(`${label}: ${err.message}`);
        continue;
      }

      if (!symbolsAgree(token.symbol, described.symbol)) {
        failures.push(
          `${label}: the contract calls itself "${described.symbol}" but you ` +
            `named it "${token.symbol}", which selects the ${feed.symbol} feed. ` +
            "One of the two is wrong, and registering would price this token off " +
            "the wrong asset permanently.",
        );
        continue;
      }

      const verdict = await verifyOne(token, feed);
      if (!verdict.ok) {
        failures.push(`${label}: ${verdict.reasons.join("; ")}`);
        continue;
      }
      for (const w of verdict.warnings) {
        console.warn(`   ⚠️  ${label}: ${w}`);
      }
      /**
       * The bound this feed will actually be judged against.
       *
       * Not the global one. `_priceScaled18` reads `s_feedMaxAge[id]` and falls
       * back to `priceMaxAge` only when the override is zero, so comparing every
       * feed to the global figure would report Sepolia's USDC/USD (measured
       * 13,438s old, override 86,400s) as a blocker when it is inside its bound,
       * and would say nothing about a feed whose override is *tighter* than the
       * global. Zero means no override, so `||` selects the right one.
       */
      const effectiveMaxAge = verdict.feedMaxAge || maxAge;
      if (verdict.ageSeconds !== null && verdict.ageSeconds > effectiveMaxAge) {
        /* Not a failure: registration is correct, the feed is simply not being
         * pushed. It is a launch blocker for this chain, reported again in the
         * summary so it cannot scroll past unnoticed. */
        console.warn(
          `   ⚠️  ${label}: ${feed.symbol} is ${verdict.ageSeconds}s stale ` +
            `(bound is ${effectiveMaxAge}s) — every priced operation on it reverts ` +
            "until a price is pushed.",
        );
      }

      const already =
        kind === "collateral"
          ? seenCollateral.includes(token.address)
          : seenLoanable.includes(token.address);

      plan.push({
        kind,
        ...token,
        feed,
        onChainSymbol: described.symbol,
        decimals: described.decimals,
        ageSeconds: verdict.ageSeconds,
        /* 0 = no override, inherit the global bound. Installed after registration. */
        feedMaxAge: verdict.feedMaxAge || 0,
        maxAgeBasis: verdict.maxAgeBasis || null,
        effectiveMaxAge,
        already,
      });

      console.log(
        `   ${already ? "•" : "✅"} ${kind.padEnd(10)} ${token.symbol.padEnd(6)} ` +
          `${feed.symbol.padEnd(18)} ${feed.id.slice(0, 10)}…` +
          (already ? "  (already registered — will skip)" : ""),
      );
    }
  }

  if (failures.length) {
    throw new Error(
      "Refusing to register anything. Every problem found:\n" +
        failures.map((f) => `   - ${f}`).join("\n"),
    );
  }

  /**
   * Collateral before loanable, and not merely for tidiness.
   *
   * addCollateralToken requires s_priceFeeds[token] == 0; addLoanableToken sets
   * that mapping without checking it. Sorting collateral first is what makes
   * "register X as both" possible at all — the reverse order locks X out of the
   * collateral set for good.
   */
  const ordered = [
    ...plan.filter((p) => p.kind === "collateral"),
    ...plan.filter((p) => p.kind === "loanable"),
  ];

  console.log("\n2. Registering");
  const registered = [];
  for (const entry of ordered) {
    const label = `${entry.kind} ${entry.symbol} @ ${entry.address}`;

    if (entry.already) {
      console.log(`   • skipped (already registered): ${label}`);
      registered.push({ ...entry, txHash: null, skipped: true });
      continue;
    }

    /* For collateral, the on-chain precondition is the feed mapping rather than
     * the collateral array, and the two can disagree: a token registered as
     * loanable-only has a feed but is not in s_collateralToken, so the array
     * check above says "new" and the call reverts. staticCall asks the contract
     * itself instead of re-deriving its rule here. */
    if (entry.kind === "collateral") {
      try {
        await protocol.addCollateralToken.staticCall(entry.address, entry.feed.id);
      } catch (err) {
        throw new Error(
          `addCollateralToken would revert for ${label}: ` +
            `${err.shortMessage || err.message}\n` +
            "If this is Protocol__TokenAlreadyExists, the token already has a " +
            "price feed — most likely it was registered as loanable first, which " +
            "makes adding it as collateral impossible without an owner-only " +
            "removeCollateralTokens call to clear the feed.",
        );
      }
    }

    const tx =
      entry.kind === "collateral"
        ? await protocol.addCollateralToken(entry.address, entry.feed.id)
        : await protocol.addLoanableToken(entry.address, entry.feed.id);
    const receipt = await tx.wait();
    if (!receipt.status) throw new Error(`Registration failed (${label}): ${tx.hash}`);
    console.log(`   ✅ ${label}  (${tx.hash})`);
    registered.push({ ...entry, txHash: tx.hash, skipped: false });
  }

  /**
   * Install the per-feed staleness bounds.
   *
   * After registration, and on the diamond rather than the oracle: `setFeedMaxAge`
   * is a ProtocolFacet function writing `s_feedMaxAge`, and `_priceScaled18` is
   * what enforces it. deploy-oracle.js cannot do this — the diamond does not exist
   * when it runs.
   *
   * Without it, three of the five chains have a lending market that reverts on
   * every priced call. Sepolia's USDC/USD answers roughly every 3-4 hours and the
   * global bound is 300s, so `_priceScaled18` would reject the price on every
   * deposit, borrow, health-factor read and liquidation for that asset — while the
   * registration itself looks perfectly successful.
   *
   * Deduplicated by feed id: ETH and WETH share one id, and the bound is stored
   * per id, so writing it twice would be a redundant transaction rather than a
   * second policy.
   */
  const boundsToSet = new Map();

  /* Seeded from the chain's WHOLE feed table, not only the tokens being
   * registered here.
   *
   * deploy-oracle.js installs every feed in the table so that adding a market
   * later needs no oracle change. But the bound lives on the diamond, not the
   * oracle, and building this map from `ordered` alone installed a bound only for
   * feeds that already back a registered token — leaving every other feed
   * half-configured: present in the oracle, no bound on the diamond, and an absent
   * bound means the global PRICE_MAX_AGE_SECONDS, which is deliberately tight
   * enough to fail closed.
   *
   * Measured on Base Sepolia 2026-08-21: BTC/USD was installed in the oracle with a
   * declared 1800s bound, had no bound on the diamond, and read 510s old against
   * the 300s global — so the first token registered against it would have reverted
   * on every deposit, borrow, health-factor read and liquidation, while
   * addCollateralToken itself reported success (it does no priced read). Installing
   * the declared bound alongside the feed is what makes "adding a market later
   * needs no oracle change" actually true, instead of true of the oracle and false
   * of the protocol.
   *
   * maxAge 0 is skipped rather than written: aggregator-feeds.js gives an
   * overridden aggregator 0 deliberately, meaning "inherit the global bound", and
   * setFeedMaxAge(id, 0) is how a bound is cleared.
   */
  if (isAggregator) {
    for (const feed of feedPlanFor(chainId)) {
      if (!feed.maxAge) continue;
      boundsToSet.set(feed.id, {
        id: feed.id,
        maxAge: feed.maxAge,
        basis: feed.maxAgeBasis,
        symbols: [...feed.symbols],
      });
    }
  } else {
    /* The Pyth path needs the same seeding for the same reason, and had none.
     * `pythBoundPlanFor` returns [] for a chain with no recorded exceptions,
     * which is the correct answer for a chain whose feeds are all warm — the
     * bound table is for exceptions, not inventory. */
    for (const feed of pythBoundPlanFor(chainId)) {
      boundsToSet.set(feed.id, {
        id: feed.id,
        maxAge: feed.maxAge,
        basis: feed.maxAgeBasis,
        symbols: [...feed.symbols],
      });
    }
  }

  for (const entry of ordered) {
    if (!entry.feedMaxAge) continue;
    const prior = boundsToSet.get(entry.feed.id);
    if (prior && prior.maxAge !== entry.feedMaxAge) {
      /* Two symbols sharing a feed id but asking for different bounds. Only one
       * can be stored, so without this the loop would install whichever came
       * last in collateral-then-loanable order and report success. */
      throw new Error(
        `Feed ${entry.feed.symbol} (${entry.feed.id.slice(0, 10)}…) is claimed by ` +
          `${prior.symbols.join("/")} at ${prior.maxAge}s and by ${entry.symbol} at ` +
          `${entry.feedMaxAge}s. s_feedMaxAge is keyed by feed id, not by token, so ` +
          "these cannot both hold. Reconcile the entries in " +
          "scripts/libraries/aggregator-feeds.js.",
      );
    }
    boundsToSet.set(entry.feed.id, {
      id: entry.feed.id,
      maxAge: entry.feedMaxAge,
      basis: entry.maxAgeBasis,
      /* Set, not concat: the plan seeds this with the feed table's symbols and a
       * registered token usually carries one of those same symbols, so a plain
       * append reports "ETH/WETH/ETH". */
      symbols: [...new Set([...(prior?.symbols || []), entry.symbol])],
    });
  }

  const boundsInstalled = [];
  console.log(`\n3. Per-feed staleness bounds (${boundsToSet.size} to install)`);
  if (boundsToSet.size === 0) {
    if (isAggregator) {
      console.warn(
        "   ⚠️  None, on an aggregator chain. Every feed here inherits the global\n" +
          "       PRICE_MAX_AGE_SECONDS bound, and aggregator publishers are far\n" +
          "       slower than Pyth's ~90s. If /borrow reverts on this chain, this is\n" +
          "       the first thing to check.",
      );
    } else {
      /* Now that the Pyth path has a bounds table, an empty plan means the table
       * records no exception for this chain — which is a real answer, but not a
       * claim that the feeds are fresh. Nobody has to be paid to update a
       * Chainlink feed; on Pyth somebody does, and a chain publishes per feed
       * rather than uniformly: Base Sepolia's Pyth served ETH/USD at 20s and
       * USDC/USD at 310,163s from the same contract on 2026-08-21, which is what
       * moved that chain to the aggregator backend, and Arc served USDC/USD at
       * 58,510s while ETH/USD was 4s old. The per-feed ages printed in step 1 are
       * the evidence; read those, not this line. */
      console.log(
        `   • none — PYTH_BOUNDS in scripts/libraries/pyth-feeds.js records no\n` +
          `     exception for chain ${chainId}, so every feed here is judged against\n` +
          `     the global ${maxAge}s bound. That is only right if they are all warm:\n` +
          `     check the ages reported in step 1 against it, because a Pyth chain\n` +
          `     can publish one asset every few seconds and another not at all.`,
      );
    }
  }
  for (const b of boundsToSet.values()) {
    const current = Number(await protocol.getFeedMaxAge(b.id));
    if (current === b.maxAge) {
      console.log(`   • ${b.symbols.join("/")}: already ${b.maxAge}s`);
      boundsInstalled.push({ ...b, txHash: null, skipped: true });
      continue;
    }

    /* staticCall first: the setter caps at Constants.MAX_FEED_PRICE_AGE (90000)
     * and reverts Protocol__InvalidPriceBounds above it. A table entry over the
     * cap should say so here rather than as an opaque diamond-fallback revert. */
    try {
      await protocol.setFeedMaxAge.staticCall(b.id, b.maxAge);
    } catch (err) {
      throw new Error(
        `setFeedMaxAge would revert for ${b.symbols.join("/")} at ${b.maxAge}s: ` +
          `${err.shortMessage || err.message}\n` +
          "The ceiling is Constants.MAX_FEED_PRICE_AGE = 90000 seconds (25h). A " +
          "bound above it means the table in aggregator-feeds.js is asking for " +
          "more staleness than the protocol will express — which for a volatile " +
          "asset is the right refusal.",
      );
    }

    const tx = await protocol.setFeedMaxAge(b.id, b.maxAge);
    const receipt = await tx.wait();
    if (!receipt.status) {
      throw new Error(`setFeedMaxAge failed for ${b.symbols.join("/")}: ${tx.hash}`);
    }

    /* Read it back. This goes through the diamond's fallback, so a status-1
     * transaction is not evidence the facet ran — same reasoning as the array
     * read-back below.
     *
     * Polled rather than read once, because a public RPC can serve this from a
     * node behind the write and answer 0, which is indistinguishable from a
     * selector that was never cut in. Every bound in boundsToSet is non-zero by
     * construction (the loop above skips entries with no override), so "non-zero"
     * is a sound test for "the write is visible" — and the value is still checked
     * for equality below, so a wrong bound fails rather than being polled for. */
    const stored = Number(
      await waitForState({
        read: () => protocol.getFeedMaxAge(b.id),
        accept: (v) => Number(v) !== 0,
        label: `${b.symbols.join("/")} feed bound`,
        hint:
          `setFeedMaxAge tx: ${tx.hash}\n` +
          "If it keeps reading 0, the selector may not be cut into the diamond — " +
          "check DiamondLoupeFacet.facets().",
      }),
    );
    if (stored !== b.maxAge) {
      throw new Error(
        `setFeedMaxAge stored ${stored}s for ${b.symbols.join("/")}, sent ${b.maxAge}s. ` +
          "The selector may not be cut into the diamond — check DiamondLoupeFacet.facets().",
      );
    }
    console.log(`   ✅ ${b.symbols.join("/")}: ${b.maxAge}s  (${tx.hash})`);
    boundsInstalled.push({ ...b, txHash: tx.hash, skipped: false });
  }

  /**
   * Read the two arrays back.
   *
   * The setters are reached through the diamond's fallback. A selector that was
   * never cut in sends the call to the fallback, which does not always revert —
   * so a transaction with status 1 is not by itself evidence that the facet ran.
   * This is the same reasoning as the read-back loop in deploy.js.
   *
   * Polled, because the other way this read comes back short is an RPC serving it
   * from a node behind the registration transactions — and a short array looks
   * exactly like a facet that did not run. The poll's accept test is "every token
   * we registered is present", so a token genuinely absent still fails, with the
   * diamond diagnostic in the hint.
   */
  console.log("\n4. Confirming the registrations stuck");
  let finalCollateral = [];
  let finalLoanable = [];
  await waitForState({
    read: async () => {
      finalCollateral = (await protocol.getAllCollateralToken()).map((a) =>
        ethers.getAddress(a),
      );
      finalLoanable = (await protocol.getLoanableAssets()).map((a) => ethers.getAddress(a));
      return ordered
        .filter((entry) => {
          const set = entry.kind === "collateral" ? finalCollateral : finalLoanable;
          return !set.includes(entry.address);
        })
        .map((entry) => `${entry.kind} ${entry.symbol} @ ${entry.address}`);
    },
    accept: (missing) => missing.length === 0,
    label: "the collateral and loanable arrays",
    hint:
      "Those tokens' transactions succeeded but the facet's arrays do not contain\n" +
      "them, which points at a selector that was not cut into the diamond. Check\n" +
      "DiamondLoupeFacet.facets().",
  });

  const dupes = finalLoanable.filter((a, i) => finalLoanable.indexOf(a) !== i);
  if (dupes.length) {
    console.warn(
      `\n⚠️  s_loanableToken contains duplicates: ${[...new Set(dupes)].join(", ")}\n` +
        "    addLoanableToken has no duplicate guard, so these were added by an\n" +
        "    earlier run or by hand. getLoanableAssets() returns them twice and\n" +
        "    the frontend will list them twice. There is no removal function for\n" +
        "    loanable tokens — this needs a facet change to clean up.",
    );
  }

  console.log(`   collateral tokens on-chain: ${finalCollateral.length}`);
  console.log(`   loanable tokens on-chain:   ${finalLoanable.length}`);

  const record = {
    network: hre.network.name,
    chainId,
    deployer: signer.address,
    timestamp: new Date().toISOString(),
    diamond: diamondAddress,
    oracle: oracleAddress,
    oracleKind,
    /* Null on the aggregator chains, and that is the honest value — there is no
     * Pyth contract behind an AggregatorPriceOracle. Conditional rather than
     * unconditional because `ethers.getAddress(null)` throws, and this object is
     * built *after* every registration transaction has already landed: the one
     * place in the script where a crash costs the record of work that succeeded. */
    pyth: pythAddress ? ethers.getAddress(pythAddress) : null,
    nativeFeedSymbol: nativeFeedSymbol(),
    hermesVerified: Boolean(hermes),
    registered: registered.map((r) => ({
      kind: r.kind,
      symbol: r.symbol,
      address: r.address,
      onChainSymbol: r.onChainSymbol,
      decimals: r.decimals,
      feedSymbol: r.feed.symbol,
      feedId: r.feed.id,
      feedSource: r.feed.source,
      priceAgeSeconds: r.ageSeconds,
      /* The bound this feed is judged against, and why. Recorded so a later
       * reader finds the reasoning next to the number instead of an unexplained
       * value in storage. */
      feedMaxAge: r.feedMaxAge,
      maxAgeBasis: r.maxAgeBasis,
      effectiveMaxAge: r.effectiveMaxAge,
      txHash: r.txHash,
      skipped: r.skipped,
    })),
    feedBounds: boundsInstalled.map((b) => ({
      feedId: b.id,
      symbols: b.symbols,
      maxAge: b.maxAge,
      basis: b.basis,
      txHash: b.txHash,
      skipped: b.skipped,
    })),
    onChain: { collateral: finalCollateral, loanable: finalLoanable },
  };

  const filename = `deployment-tokens-${hre.network.name}.json`;
  fs.writeFileSync(filename, JSON.stringify(record, null, 2));

  /* Per-feed bound, not the global one — same reason as the warning inside the
   * planning loop. Using `maxAge` here would list Sepolia's USDC/USD as stale
   * when its 86,400s override covers it, and would stay silent about a feed with
   * a tighter override than the global. */
  const stale = registered.filter(
    (r) => r.ageSeconds !== null && r.ageSeconds > r.effectiveMaxAge,
  );

  console.log("\n============================================================");
  console.log("ASSET REGISTRATION SUMMARY");
  console.log("============================================================");
  console.log(`Oracle backend:   ${oracleKind}`);
  console.log(`Native priced as: ${nativeFeedSymbol()}/USD`);
  if (boundsInstalled.length) {
    console.log("\nPer-feed staleness bounds now in force:");
    for (const b of boundsInstalled) {
      console.log(`   ${b.symbols.join("/").padEnd(10)} ${String(b.maxAge).padStart(6)}s`);
      if (b.basis) console.log(`      ${b.basis}`);
    }
  }
  if (!collateral.some((t) => t.isNative)) {
    console.log(
      "\n⚠️  address(1) was NOT registered as collateral. depositCollateral with\n" +
        "    the native sentinel will revert with Protocol__TokenNotAllowed while\n" +
        "    ERC20 deposits work. Pass NATIVE in COLLATERAL_TOKENS if that is not\n" +
        "    what you want.",
    );
  }
  if (stale.length) {
    console.log(
      `\n⚠️  ${stale.length} feed(s) are staler than the bound applied to them:\n` +
        stale
          .map((s) => `      ${s.symbol} — ${s.ageSeconds}s (bound ${s.effectiveMaxAge}s)`)
          .join("\n") +
        "\n    Registration is correct; the chain is not being pushed prices.\n" +
        "    /borrow is unusable for these assets until it is.",
    );
  }
  if (!hermes) {
    console.log(
      "\n⚠️  Feed symbols were not confirmed against Hermes on this run, so the\n" +
        "    ids are trusted rather than verified. Re-run `npm run probe:pyth`\n" +
        "    from a host with outbound HTTPS before treating this as done.",
    );
  }
  console.log("\nSaved to:", filename);
  console.log(
    "Next: `node scripts/gen-registry.mjs` from the repo root to fold the\n" +
      "deployed addresses into src/constants/deployments.generated.ts.",
  );
  console.log("============================================================");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
