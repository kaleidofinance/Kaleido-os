const { getSelectors, FacetCutAction } = require("./libraries/diamond.js");
const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");

/**
 * Protocol configuration, read and validated before anything is deployed.
 *
 * None of this used to happen. The diamond was cut and the script stopped, which
 * left every one of these values at its zero default — and ProtocolFacet treats
 * zero as "not configured" and reverts on it. A fresh deploy therefore produced
 * a protocol where a borrower could take a loan and then never repay it:
 * `repayLoan` reverts on `kaleidoFeeVault == address(0)` and on
 * `ONE_PERCENT_BPS == 0`, `liquidateUserRequest` reverts on the same vault check
 * and on `LIQUIDITY_BPS == 0`, and `getUsdValue` reverts with no price oracle, so
 * nothing that touches a price works at all. The collateral would have been
 * locked with no path out.
 *
 * Validated up front, before the first transaction, so a missing value costs
 * nothing. Validating after the cut would abort partway and leave a live diamond
 * in exactly the half-configured state this exists to prevent.
 */
function readProtocolConfig() {
  const errors = [];
  const warnings = [];

  const address = (name, { required }) => {
    const raw = (process.env[name] || "").trim();
    if (!raw) {
      (required ? errors : warnings).push(
        `${name} is not set${required ? "" : " (optional)"}`,
      );
      return null;
    }
    if (!ethers.isAddress(raw)) {
      errors.push(`${name} is not a valid address: ${raw}`);
      return null;
    }
    if (raw === ethers.ZeroAddress) {
      errors.push(`${name} is the zero address, which the facet rejects`);
      return null;
    }
    return ethers.getAddress(raw);
  };

  const bps = (name, fallback, max) => {
    const raw = (process.env[name] || "").trim();
    if (!raw) return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0 || n > max) {
      errors.push(`${name} must be an integer in 1..${max}, got ${raw}`);
      return fallback;
    }
    return n;
  };

  const cfg = {
    // Required: nothing works without these.
    feeVault: address("KALEIDO_FEE_VAULT", { required: true }),
    pythPriceOracle: address("PYTH_PRICE_ORACLE", { required: true }),

    // Optional, but each disables a feature. Warned about, not enforced.
    swapRouter: address("SWAP_ROUTER", { required: false }),

    /* 1000 bps = 10% of the interest a loan accrues, which is where the
     * protocol's revenue comes from. The bound is Constants.MAX_PROTOCOL_FEE_BPS
     * (2500), matching Morpho Blue's MAX_FEE; 10% is Lido's rate on staking
     * rewards and sits inside Aave's 10-20% reserve-factor range. Note this is a
     * share of interest, never of principal — see the comment on the fee in
     * ProtocolFacet.repayLoan for why that distinction is the whole point. */
    protocolFeeBps: bps("PROTOCOL_FEE_BPS", 1000, 2500),

    /* 640 bps = 6.4% of the debt cleared, taken from the borrower's collateral
     * and split 75/25 between the liquidator (480 bps) and the fee vault (160).
     * Bound is Constants.MAX_LIQUIDATION_PENALTY_BPS (1500), the top of Aave
     * v3's liquidation-bonus range.
     *
     * 640 is Morpho Blue's liquidation incentive at an 80% threshold —
     * 1/(0.3*0.8 + 0.7) = 1.0638. Their formula scales the incentive to the
     * position's room; with one global threshold it computes a constant, so the
     * number is what carries over, not the formula. It is also the more robust
     * choice here because the penalty is capped by what was seized above the
     * debt: liquidation opens at 1.25x collateral-to-debt and a 640 bps penalty
     * still pays in full down to 1.064x, where 1000 bps runs thin at 1.10x.
     *
     * Paid *in* that collateral, not in the loan currency: liquidation credits
     * the seized tokens to the lender, the liquidator and the fee vault on the
     * protocol's internal ledger. So the vault accrues liquidation revenue as
     * collateral positions inside the diamond and has to call
     * withdrawCollateral to realise it — budget for that, and note it will be
     * whatever assets the defaulting borrowers happened to post. The liquidator
     * is paid the same way, which is why they take the larger share. */
    liquidationPenaltyBps: bps("LIQUIDATION_PENALTY_BPS", 640, 1500),

    /* How stale a Pyth price may be before every read reverts, in seconds.
     *
     * There is no safe default the protocol can pick for you, because the right
     * value is a property of your deployment rather than of the protocol: the
     * oracle serves prices through pyth.getPriceUnsafe (no freshness guarantee
     * at all) and is refreshed by PythPriceOracle.updatePrice, which anyone may
     * call but nobody is obliged to. So the bound has to match the cadence the
     * feed is ACTUALLY relayed at on this chain, with room for one missed round
     * — measure it with scripts/probe-pyth.js rather than assuming, because a
     * feed nobody pays to refresh sits still for hours.
     *
     * 300s assumes updates landing on roughly a 2-minute interval. If this
     * chain's are slower, raise this — but understand what you are buying: every
     * second of slack is a second in which a liquidation can be priced off a
     * number that has stopped being true. The alternative to raising it is to
     * relay the update yourself, which updatePrice being permissionless is what
     * makes possible: a borrower's own transaction can carry its own price.
     * Bound is Constants.MAX_PRICE_AGE (3600). */
    priceMaxAge: bps("PRICE_MAX_AGE_SECONDS", 300, 3600),

    /* Widest Pyth confidence interval accepted, in bps of the price. 100 = 1%.
     * `conf` is Pyth's own uncertainty on the number, so this rejects a price
     * the publishers do not agree on rather than liquidating off its midpoint.
     * Bound is Constants.MAX_PRICE_CONF_BPS (500). */
    priceMaxConfBps: bps("PRICE_MAX_CONF_BPS", 100, 500),
  };

  /*
   * SWAP_ROUTER is the only optional value, and what follows it is reassurance
   * rather than a caveat.
   *
   * This block used to print "Without SWAP_ROUTER the swap paths are unusable",
   * and that is false in a way that costs real work: it reads as an incomplete
   * deployment, and the remedy it names — setSwapRouter — is owner-gated, so
   * after ownership moves to a multisig it is a signing round trip to write a
   * slot with no effect. Nothing in contracts/ reads `AppStorage.swapRouter`
   * (declared at LibAppStorage.sol:69). ProtocolFacet only writes it and exposes
   * no getter, which is why the swap-router step in configureProtocol is the one
   * step that cannot be read back. Swaps run on the standalone V3 periphery,
   * which the app resolves per chain out of the deployment registry and never
   * reaches through the diamond.
   *
   * Printed only when the router is the missing value, so a second optional
   * setting added later does not inherit an explanation about this one.
   */
  if (warnings.length) {
    console.warn("\n⚠️  Optional configuration missing:");
    for (const w of warnings) console.warn(`   - ${w}`);
    if (!cfg.swapRouter) {
      console.warn(
        "   Safe to leave unset: AppStorage.swapRouter has no reader and no\n" +
          "   getter, so setSwapRouter changes nothing today. Swaps run on the\n" +
          "   V3 periphery, not through the diamond. Set it when a facet\n" +
          "   actually reads it.\n",
      );
    }
  }

  if (errors.length) {
    throw new Error(
      "Refusing to deploy with incomplete protocol configuration:\n" +
        errors.map((e) => `   - ${e}`).join("\n") +
        "\n\nSet these in smart-contract/.env (see .env.example). They are " +
        "checked\nhere rather than after the diamond cut so a missing value " +
        "costs no gas.",
    );
  }

  return cfg;
}

/**
 * Applies the configuration the facet needs in order to function.
 *
 * @dev Each value is read back after writing it. The setters are owner-gated
 *      through `LibDiamond.enforceIsContractOwner`, and a cut that silently
 *      failed to register a selector would make these calls hit the diamond's
 *      fallback rather than the facet — which does not always revert. Reading
 *      the value back is what distinguishes "set" from "appeared to be set".
 */
async function configureProtocol(diamondAddress, cfg) {
  const protocol = await ethers.getContractAt("ProtocolFacet", diamondAddress);

  console.log("\n⚙️  Configuring protocol...");

  const steps = [
    {
      label: `price oracle -> ${cfg.pythPriceOracle}`,
      send: () => protocol.setPythOracle(cfg.pythPriceOracle),
      read: () => protocol.getPythPriceOracle(),
      expect: cfg.pythPriceOracle,
    },
    {
      label: `fee vault -> ${cfg.feeVault}`,
      send: () => protocol.setFeeVault(cfg.feeVault),
      // No reader for kaleidoFeeVault exists on the facet.
      read: null,
      expect: null,
    },
    {
      label: `protocol fee -> ${cfg.protocolFeeBps} bps of interest`,
      send: () => protocol.setBPS(cfg.protocolFeeBps),
      read: () => protocol.getBPS(),
      expect: BigInt(cfg.protocolFeeBps),
    },
    {
      label: `liquidation penalty -> ${cfg.liquidationPenaltyBps} bps`,
      send: () => protocol.setLiquidityBps(cfg.liquidationPenaltyBps),
      read: () => protocol.getLiquidityBPS(),
      expect: BigInt(cfg.liquidationPenaltyBps),
    },
    /* Not optional, despite looking like a tuning knob. _priceScaled18 reverts
     * while either bound is zero, so until this step lands every function that
     * prices a token is offline — deposit, borrow, health factor, liquidation.
     * That is deliberate (an unset bound must not read as "no limit"), and it
     * means this step is what brings the protocol up. */
    {
      label:
        `price bounds -> max age ${cfg.priceMaxAge}s, ` +
        `max confidence ${cfg.priceMaxConfBps} bps`,
      send: () => protocol.setPriceBounds(cfg.priceMaxAge, cfg.priceMaxConfBps),
      read: () => protocol.getPriceMaxAge(),
      expect: BigInt(cfg.priceMaxAge),
    },
  ];

  /* Opt-in and inert. Kept because the operator setting SWAP_ROUTER clearly
     means to write the slot, and writing it harms nothing; but nothing reads it
     (see the warning block in readProtocolConfig), so this step configures no
     behaviour. It is also the only step with no read-back available: there is no
     getter for swapRouter, unlike the fee vault above, whose value at least has
     a reader inside the facet. */
  if (cfg.swapRouter) {
    steps.push({
      label: `swap router -> ${cfg.swapRouter} (no reader; inert today)`,
      send: () => protocol.setSwapRouter(cfg.swapRouter),
      read: null,
      expect: null,
    });
  }

  for (const step of steps) {
    const tx = await step.send();
    const receipt = await tx.wait();
    if (!receipt.status) {
      throw new Error(`Configuration failed (${step.label}): ${tx.hash}`);
    }

    if (step.read) {
      const got = await step.read();
      const same =
        typeof step.expect === "string"
          ? ethers.getAddress(got) === step.expect
          : got === step.expect;
      if (!same) {
        throw new Error(
          `Configuration did not stick (${step.label}): read back ${got}`,
        );
      }
    }

    console.log(`   ✅ ${step.label}`);
  }

  /* setPriceBounds writes two slots and the step loop only reads one back.
   * Checked separately rather than dropped, because a confidence bound that
   * silently stayed zero would revert every price read for a reason that looks
   * nothing like its cause. */
  const confBps = await protocol.getPriceMaxConfBps();
  if (confBps !== BigInt(cfg.priceMaxConfBps)) {
    throw new Error(
      `Configuration did not stick (price confidence bound): read back ${confBps}`,
    );
  }

  console.log(
    "\n📋 Still required before the protocol is usable:\n" +
      "   - addCollateralToken(token, pythPriceFeedId) for each collateral asset\n" +
      "   - addLoanableToken(token, pythPriceFeedId) for each borrowable asset\n" +
      "   Both are per-chain, so they are deliberately not hardcoded here.\n" +
      "   - transfer diamond ownership to a multisig\n",
  );
}

/**
 * Prove the external contracts the config names actually exist on this chain.
 *
 * `readProtocolConfig` is synchronous and can only check form: non-empty,
 * well-formed, non-zero. Every address copied from the wrong chain passes all
 * three, which is the failure mode worth spending two eth_getCode calls on.
 *
 * Only the addresses that must be *contracts* are checked:
 *
 *  - `PYTH_PRICE_ORACLE` must be. A wrong-chain Pyth address cuts and configures
 *    the diamond cleanly — setPythOracle stores whatever it is given, and the
 *    read-back in configureProtocol confirms only that the value stuck, not that
 *    anything lives there. The first symptom is `_priceScaled18` reverting on a
 *    call to a codeless address, which takes deposit, borrow, health factor and
 *    liquidation offline together. That is the state the docstring on
 *    readProtocolConfig calls "the collateral would have been locked with no
 *    path out".
 *  - `SWAP_ROUTER` is optional, so it is only checked when set. The check is
 *    hygiene rather than protection: a codeless address here breaks nothing,
 *    because no facet reads the slot it lands in. It stays because an operator
 *    who names a router has a specific contract in mind, and catching a
 *    wrong-chain paste for free is worth one eth_getCode.
 *
 * `KALEIDO_FEE_VAULT` is deliberately NOT checked. It should be a multisig,
 * which has code, but an EOA there is a discouraged configuration rather than a
 * broken one — it receives tokens and calls withdrawCollateral, both of which an
 * EOA can do. Rejecting it would refuse a deploy that works.
 */
async function assertConfiguredContractsExist(cfg) {
  const mustHaveCode = [["PYTH_PRICE_ORACLE", cfg.pythPriceOracle]];
  if (cfg.swapRouter) mustHaveCode.push(["SWAP_ROUTER", cfg.swapRouter]);

  const codeless = [];
  for (const [name, address] of mustHaveCode) {
    if ((await ethers.provider.getCode(address)) === "0x") {
      codeless.push(`${name} (${address})`);
    }
  }

  if (codeless.length) {
    const { name, chainId } = await ethers.provider.getNetwork();
    throw new Error(
      `Refusing to deploy: no contract code at\n` +
        codeless.map((c) => `   - ${c}`).join("\n") +
        `\n\nChecked on ${name} (chainId ${chainId}). An address that is ` +
        `well-formed but\nholds no code is almost always one copied from ` +
        `another chain.`,
    );
  }
}

/**
 * Write the deploy record. Shared by the fresh path and the resume path.
 *
 * Extracted rather than duplicated because a resume that wrote a
 * differently-shaped record would defeat the point of resuming: gen-registry.mjs
 * is the only consumer, it keys off exact field names, and a record missing
 * `contracts.diamond` generates a chain that `isDeployed()` reports as false.
 *
 * `facets` carries the implementation addresses, which the app never calls —
 * every call goes to the diamond. They are recorded because a diamond is opaque
 * without them: verifying the deployed source on a block explorer, or cutting a
 * replacement facet later, both need the implementation address, and
 * DiamondLoupeFacet.facetAddresses() gives you addresses with no names.
 *
 * Named deployment-diamond-<network>.json rather than the
 * deployment-<network>.json that deploy-stablecoin.js used to write, because the
 * unqualified name collides: two scripts writing the same file means the second
 * silently discards the first's addresses. Every script now carries its component
 * in the filename.
 */
async function writeDiamondRecord({
  diamondAddress,
  deployer,
  deployedFacets,
  protocolConfig,
  resumedFrom = null,
}) {
  const record = {
    network: hre.network.name,
    /* Asked of the chain, not read from hardhat.config.js. gen-registry.mjs keys
     * the entire generated registry off this number, so an undefined or wrong
     * value does not fail loudly — it files a chain's addresses under the wrong
     * id, or under `undefined`. The provider's answer comes from the node itself
     * and cannot be a config typo. */
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployer,
    timestamp: new Date().toISOString(),
    contracts: {
      diamond: diamondAddress,
      priceOracle: protocolConfig.pythPriceOracle,
    },
    facets: deployedFacets,
    config: {
      feeVault: protocolConfig.feeVault,
      swapRouter: protocolConfig.swapRouter,
      protocolFeeBps: protocolConfig.protocolFeeBps,
      liquidationPenaltyBps: protocolConfig.liquidationPenaltyBps,
      priceMaxAgeSeconds: protocolConfig.priceMaxAge,
      priceMaxConfBps: protocolConfig.priceMaxConfBps,
    },
    /* Recorded because the deploy is not finished when this script exits, and a
     * JSON file that looks complete is the wrong thing to hand the next step. */
    stillRequired: [
      "register-tokens.js — addCollateralToken / addLoanableToken, or no asset is usable",
      "transfer ownership to a multisig",
    ],
  };

  /* Stated in the record, not just the console. A resumed deploy's facet
   * addresses were read back from the chain rather than observed being deployed,
   * which is a weaker provenance, and the record is the only thing that survives
   * to be audited later. */
  if (resumedFrom) {
    record.resumedFrom = resumedFrom;
    record.facetsProvenance =
      "read back from DiamondLoupeFacet.facets() and matched to artifacts by " +
      "selector set — this run did not deploy them";
  }

  const filename = `deployment-diamond-${hre.network.name}.json`;
  fs.writeFileSync(filename, JSON.stringify(record, null, 2));
  console.log("📋 Addresses saved to:", filename);
  console.log(
    "   scripts/register-tokens.js reads the diamond address from this file,\n" +
      "   and scripts/gen-registry.mjs folds it into the frontend registry.",
  );
}

/**
 * Identify the facets already cut into a diamond, by selector set.
 *
 * The loupe returns addresses with no names, and the record needs names — so each
 * live facet is matched against the artifacts by asking which artifact's selector
 * set contains the selectors actually routed to it.
 *
 * Containment rather than equality: a facet is cut with a chosen selector list,
 * which for DiamondCutFacet is a single function out of an ABI that also declares
 * events and errors. Requiring an exact match would fail to identify a correctly
 * cut facet. An unmatched address is reported rather than guessed at.
 */
async function identifyFacets(diamondAddress) {
  const KNOWN = [
    "DiamondCutFacet",
    "DiamondLoupeFacet",
    "OwnershipFacet",
    "ProtocolFacet",
    "AgentPermissionFacet",
  ];

  const known = [];
  for (const name of KNOWN) {
    const iface = (await ethers.getContractFactory(name)).interface;
    const selectors = new Set(
      iface.fragments
        .filter((f) => f.type === "function")
        .map((f) => f.selector),
    );
    known.push({ name, selectors });
  }

  const loupe = await ethers.getContractAt("DiamondLoupeFacet", diamondAddress);
  const live = await loupe.facets();

  const named = {};
  const unidentified = [];
  for (const facet of live) {
    const routed = [...facet.functionSelectors];
    const match = known.find(
      (k) =>
        routed.length > 0 && routed.every((sel) => k.selectors.has(sel)),
    );
    if (match && !named[match.name]) {
      named[match.name] = facet.facetAddress;
    } else {
      unidentified.push({
        address: facet.facetAddress,
        selectors: routed.length,
        ambiguous: Boolean(match),
      });
    }
  }

  return { named, unidentified, live };
}

/**
 * Finish a diamond that is already deployed and cut.
 *
 * deploy.js is a long sequence — six contracts, a cut, then five configuration
 * transactions — and it writes its record only at the very end. A drop anywhere
 * after the cut therefore leaves the worst possible state: a diamond that exists,
 * is partly configured, and is written down nowhere. That is not hypothetical;
 * Sepolia hit it on 2026-08-21, losing the connection (ECONNRESET) after three of
 * the five configuration steps, and `priceMaxAge`/`priceMaxConfBps` both read 0 —
 * which by design means every priced operation reverts. The protocol was down and
 * the only record of it was terminal scrollback.
 *
 * Without this path the only recovery is re-running the whole script, which
 * deploys a second diamond and five more facets and orphans everything already
 * paid for. Public testnet RPCs drop often enough that this needs to be a
 * supported path rather than an emergency.
 *
 * Safe to re-run: every configuration step is a setter that writes the same value
 * and reads it back, so a step that already landed is a no-op that costs gas and
 * proves itself. It deliberately does NOT re-cut anything — if selectors are
 * missing, that is reported and left alone, because a cut is not idempotent and
 * guessing at a partial cut is how a diamond ends up with two facets claiming one
 * selector.
 */
async function resumeDiamond(diamondAddress) {
  if (!ethers.isAddress(diamondAddress)) {
    throw new Error(
      `RESUME_DIAMOND is not a usable address: ${diamondAddress}`,
    );
  }
  const address = ethers.getAddress(diamondAddress);

  const code = await ethers.provider.getCode(address);
  if (code === "0x") {
    throw new Error(
      `RESUME_DIAMOND ${address} has no code on ${hre.network.name} (chain ` +
        `${hre.network.config.chainId}). Resuming needs a diamond that already ` +
        `exists on THIS chain — check you are not holding another chain's address.`,
    );
  }

  const protocolConfig = readProtocolConfig();
  await assertConfiguredContractsExist(protocolConfig);

  const [signer] = await ethers.getSigners();
  console.log(`\n🔁 Resuming diamond ${address} on ${hre.network.name}`);
  console.log(`   signer ${signer.address}`);

  /* Ownership before anything else: every configuration setter is onlyOwner, so a
   * signer that is not the owner produces five reverts that each look like a
   * different problem. */
  const ownership = await ethers.getContractAt("OwnershipFacet", address);
  const owner = await ownership.owner();
  if (ethers.getAddress(owner) !== ethers.getAddress(signer.address)) {
    throw new Error(
      `${address} is owned by ${owner}, but the signer is ${signer.address}. ` +
        `Every configuration setter is onlyOwner, so nothing below can land.`,
    );
  }
  console.log(`   owner  ${owner} (matches signer)`);

  const { named, unidentified, live } = await identifyFacets(address);
  const selectorCount = live.reduce(
    (n, f) => n + f.functionSelectors.length,
    0,
  );
  console.log(`\n   ${live.length} facet(s) live, ${selectorCount} selectors:`);
  for (const [name, facetAddress] of Object.entries(named)) {
    console.log(`   ✅ ${name.padEnd(22)} ${facetAddress}`);
  }
  for (const u of unidentified) {
    console.log(
      `   ❓ ${"(unidentified)".padEnd(22)} ${u.address} — ${u.selectors} selector(s)` +
        (u.ambiguous ? ", matched an artifact already claimed" : ""),
    );
  }

  /* The same completeness check the fresh path runs after its cut. Configuration
   * reaches the protocol setters through the diamond, so a ProtocolFacet with
   * dropped selectors would fail here in a way that looks like a config problem. */
  if (!named.ProtocolFacet) {
    throw new Error(
      "No facet on this diamond matches ProtocolFacet's selector set. The " +
        "configuration setters live there, so there is nothing to resume — " +
        "inspect DiamondLoupeFacet.facets() before doing anything else.",
    );
  }

  const declared = (await ethers.getContractFactory("ProtocolFacet")).interface
    .fragments.filter((f) => f.type === "function")
    .map((f) => f.selector);
  const loupe = await ethers.getContractAt("DiamondLoupeFacet", address);
  const routed = new Set(
    [...(await loupe.facetFunctionSelectors(named.ProtocolFacet))],
  );
  const unrouted = declared.filter((sel) => !routed.has(sel));
  if (unrouted.length > 0) {
    const iface = (await ethers.getContractFactory("ProtocolFacet")).interface;
    const names = unrouted.map((sel) => {
      const frag = iface.fragments.find(
        (f) => f.type === "function" && f.selector === sel,
      );
      return `${sel} ${frag ? frag.format("sighash") : "(unknown)"}`;
    });
    throw new Error(
      `${unrouted.length} of ${declared.length} ProtocolFacet selectors are not ` +
        `routed on this diamond:\n   ${names.join("\n   ")}\n` +
        "This script will not re-cut them: a cut is not idempotent, and adding a " +
        "selector that is already routed elsewhere reverts the whole cut. Fix the " +
        "cut deliberately, then resume.",
    );
  }
  console.log(
    `   ✅ ProtocolFacet: all ${declared.length} selectors routed\n`,
  );

  await configureProtocol(address, protocolConfig);

  await writeDiamondRecord({
    diamondAddress: address,
    deployer: signer.address,
    deployedFacets: named,
    protocolConfig,
    resumedFrom: "RESUME_DIAMOND",
  });

  return address;
}

async function deployDiamond() {
  /* Before any gas is spent. */
  const protocolConfig = readProtocolConfig();
  await assertConfiguredContractsExist(protocolConfig);

  const accounts = await ethers.getSigners();

  if (accounts.length === 0) {
    throw new Error("❌ No accounts available. Check your Hardhat config.");
  }
  const contractOwner = accounts[0];
  console.log("👑 Deploying contract with account:", contractOwner.address);

  /**
   * Transaction overrides, applied only on zkSync.
   *
   * Every hardcoded value in this script was tuned for Abstract. On an EVM
   * chain a fixed gasLimit is at best redundant and at worst wrong in both
   * directions — too high and the transaction cannot be mined, too low and it
   * runs out of gas — while a fixed 40 gwei maxFeePerGas can strand a
   * transaction the moment the network is busier than that.
   *
   * Returning {} on EVM chains lets the provider estimate gas and price from
   * current conditions, which is correct on all five of them.
   */
  const zk = Boolean(hre.network.config.zksync);
  const opts = (overrides) => (zk ? overrides : {});

  /**
   * Every address this script creates, accumulated as it goes.
   *
   * This script used to write nothing at all. The diamond address was printed to
   * the console and that was the only record of it — so the addresses that the
   * whole frontend resolves through had to be copied out of scrollback by hand,
   * for five chains, and a facet address that was never written down cannot be
   * verified on a block explorer afterwards.
   *
   * scripts/gen-registry.mjs is the only consumer: it reads the JSON every
   * deploy script emits and generates src/constants/deployments.generated.ts.
   * That is what makes the registry a product of the deploy rather than a
   * transcription of it.
   */
  const deployedFacets = {};

  // Deploy DiamondCutFacet
  console.log("Deploying DiamondCutFacet...");
  const DiamondCutFacet = await ethers.getContractFactory("DiamondCutFacet");
  const diamondCutFacet = await DiamondCutFacet.deploy(
    opts({ gasLimit: 3000000 }),
  );
  await diamondCutFacet.waitForDeployment();
  const diamondCutFacetAddress = await diamondCutFacet.getAddress();
  deployedFacets.DiamondCutFacet = diamondCutFacetAddress;
  console.log("DiamondCutFacet deployed:", diamondCutFacetAddress);

  // Deploy Diamond Contract
  console.log("Deploying Diamond Contract...");
  const Diamond = await ethers.getContractFactory("Diamond");
  const diamond = await Diamond.deploy(
    contractOwner.address,
    diamondCutFacetAddress,
    opts({ gasLimit: 3000000 }),
  );
  await diamond.waitForDeployment();
  const diamondAddress = await diamond.getAddress();
  console.log("Diamond deployed:", diamondAddress);

  // Deploy DiamondInit
  console.log("Deploying Diamond Init Contract...");
  const DiamondInit = await ethers.getContractFactory("DiamondInit");
  const diamondInit = await DiamondInit.deploy(
    opts({
      gasLimit: 3000000,
      type: 2,
      maxFeePerGas: ethers.parseUnits("40", "gwei"),
      maxPriorityFeePerGas: ethers.parseUnits("40", "gwei"),
    }),
  );
  await diamondInit.waitForDeployment();
  const diamondInitAddress = await diamondInit.getAddress();
  deployedFacets.DiamondInit = diamondInitAddress;
  console.log("DiamondInit deployed:", diamondInitAddress);

  // Deploy Facets
  console.log("Deploying Diamond Facets...");
  // AgentPermissionFacet is what bounds Luca on-chain: per-agent spend budgets
  // and token allowlists that hold even if someone bypasses the frontend. It
  // was written but never cut into the diamond, so it must be in the list for a
  // fresh deploy or the agent has no on-chain limits at all.
  const FacetNames = [
    "DiamondLoupeFacet",
    "OwnershipFacet",
    "ProtocolFacet",
    "AgentPermissionFacet",
  ];
  const cut = [];

  for (const FacetName of FacetNames) {
    console.log(`Deploying ${FacetName}...`);
    const Facet = await ethers.getContractFactory(FacetName);
    /*
     * REMOVED: three hardcoded Abstract-testnet addresses (a Pyth mainnet
     * oracle, a Pyth price oracle, a Kaleido vault) that were re-declared on
     * every iteration of this loop and read by nothing. The live values now come
     * from PYTH_PRICE_ORACLE and KALEIDO_FEE_VAULT and are applied by
     * configureProtocol() after the cut, which is per-chain and therefore
     * correct on all eleven networks rather than on one testnet.
     */
    /**
     * Gas limits are zkSync-only.
     *
     * The previous values — 400,000,000 for ProtocolFacet and 50,000,000 for
     * the rest — are both larger than an entire Ethereum block (~30,000,000).
     * On Sepolia, Base, BNB, Robinhood or Arc such a transaction can never be
     * included; the deploy fails before it starts. They were tuned for
     * Abstract, where gas accounting is completely different.
     *
     * On EVM chains we omit gasLimit entirely and let the provider estimate,
     * which is both correct and self-adjusting. If an estimate reverts, that
     * is real signal — usually a contract over the EIP-170 size limit — and
     * should be fixed rather than papered over with a bigger number. Run
     * scripts/check-contract-sizes.js first.
     */
    const deploymentOptions = hre.network.config.zksync
      ? FacetName === "ProtocolFacet"
        ? { gasLimit: 400000000 }
        : { gasLimit: 50000000 }
      : {};

    try {
      console.log(`Deploying ${FacetName} with options:`, deploymentOptions);
      let facet;
      if (FacetName === "ProtocolFacet") {
        facet = await Facet.deploy(deploymentOptions);
      } else {
        facet = await Facet.deploy(deploymentOptions);
      }
      console.log(
        `${FacetName} deployment transaction sent, waiting for confirmation...`,
      );

      // Add timeout for deployment
      const deploymentPromise = facet.waitForDeployment();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Deployment timeout after 300 seconds")),
          300000,
        ),
      );

      await Promise.race([deploymentPromise, timeoutPromise]);
      const facetAddress = await facet.getAddress();
      deployedFacets[FacetName] = facetAddress;
      console.log(`${FacetName} deployed at: ${facetAddress}`);

      if (!facet.interface || !facet.interface.fragments) {
        console.error(
          `❌ Error: ${FacetName} contract.interface.fragments is undefined!`,
        );
        continue;
      }

      const functionSelectors = getSelectors(facet);
      if (functionSelectors.length === 0) {
        console.warn(`⚠️ Warning: ${FacetName} has no functions!`);
        continue;
      }

      console.log(`✅ ${FacetName} selectors:`, functionSelectors);

      cut.push({
        facetAddress: await facet.getAddress(),
        action: FacetCutAction.Add,
        functionSelectors,
      });
    } catch (error) {
      console.error(`❌ Failed to deploy ${FacetName}:`, error.message);
      throw error;
    }
  }

  // Perform Diamond Cut
  console.log("Executing Diamond Cut...");
  const diamondCut = await ethers.getContractAt(
    "IDiamondCut",
    await diamond.getAddress(),
  );

  const functionCall = diamondInit.interface.encodeFunctionData("init");
  const tx = await diamondCut.diamondCut(
    cut,
    await diamondInit.getAddress(),
    functionCall,
    // 40,000,000 also exceeds an Ethereum block. zkSync only; estimate elsewhere.
    hre.network.config.zksync ? { gasLimit: 40000000 } : {},
  );
  console.log("Diamond cut tx: ", tx.hash);

  const receipt = await tx.wait();
  if (!receipt.status) {
    throw new Error(`Diamond upgrade failed: ${tx.hash}`);
  }

  console.log("✅ Diamond Cut Completed Successfully");

  // Verify that facets were added successfully
  const diamondLoupe = await ethers.getContractAt(
    "DiamondLoupeFacet",
    await diamond.getAddress(),
  );
  const facetAddresses = await diamondLoupe.facetAddresses();
  console.log("Facets added to Diamond:", facetAddresses);

  // Get all facets and their functions
  console.log("\nVerifying all facet functions:");
  for (const facetAddress of facetAddresses) {
    const functions = await diamondLoupe.facetFunctionSelectors(facetAddress);
    console.log(`\nFacet at ${facetAddress} functions:`);
    console.log(functions);
  }

  /**
   * Confirm every ProtocolFacet function the ABI declares is actually routed.
   *
   * This used to call facetFunctionSelectors(diamond.getAddress()) — via a
   * getContractAt("ProtocolFacet", diamondAddress) whose getAddress() returns the
   * DIAMOND, not the implementation. A diamond is never a facet of itself, so
   * that call correctly returned an empty array on every successful deploy and
   * printed "ProtocolFacet functions registered: Result(0) []" directly above
   * proof that all 68 selectors were live. It then fell into a branch that
   * re-printed the ABI's selectors, which looked like a diagnosis and was just
   * the same list again.
   *
   * ProtocolFacet is the facet worth asserting on: it carries the entire lending
   * surface, and a selector silently absent from the cut is the failure that
   * looks configured and reverts on first use. register-tokens.js depends on
   * setFeedMaxAge/getFeedMaxAge being here, and neither is exercised until then.
   *
   * Compared against the loupe data already fetched above, so this costs no
   * extra RPC calls.
   */
  const protocolFacetAddress = deployedFacets["ProtocolFacet"];
  if (!protocolFacetAddress) {
    throw new Error(
      "ProtocolFacet is not in deployedFacets, so it was never deployed and the " +
        "diamond has no lending surface. An earlier per-facet failure was caught " +
        "and logged rather than thrown — scroll up for '❌ Failed to deploy'.",
    );
  }

  const routed = new Set(
    (await diamondLoupe.facetFunctionSelectors(protocolFacetAddress)).map((s) =>
      s.toLowerCase(),
    ),
  );
  const declared = getSelectors(
    await ethers.getContractFactory("ProtocolFacet"),
  ).map((s) => s.toLowerCase());
  const unrouted = declared.filter((s) => !routed.has(s));

  if (unrouted.length) {
    const iface = (await ethers.getContractFactory("ProtocolFacet")).interface;
    const named = unrouted.map((sel) => {
      const frag = iface.fragments.find(
        (f) => f.type === "function" && f.selector.toLowerCase() === sel,
      );
      return `${sel} ${frag ? frag.format("sighash") : "(unknown)"}`;
    });
    throw new Error(
      `${unrouted.length} of ${declared.length} ProtocolFacet selectors are not ` +
        `routed to ${protocolFacetAddress}:\n   ${named.join("\n   ")}\n` +
        "The diamond cut reported success, so these were dropped rather than " +
        "rejected. Do not run register-tokens.js against this diamond — check " +
        "DiamondLoupeFacet.facets() and re-cut the missing selectors.",
    );
  }
  console.log(
    `\n✅ ProtocolFacet: all ${declared.length} selectors routed to ${protocolFacetAddress}`,
  );

  /* Only now that the selectors are live can the setters be reached. */
  await configureProtocol(await diamond.getAddress(), protocolConfig);

  await writeDiamondRecord({
    diamondAddress,
    deployer: contractOwner.address,
    deployedFacets,
    protocolConfig,
  });

  return diamondAddress;
}

// Execute Script
if (require.main === module) {
  /* RESUME_DIAMOND finishes an existing diamond instead of deploying a new one.
   *
   * Dispatched here rather than inside deployDiamond() so that the two paths stay
   * separate functions with separate preconditions — the resume path must not be
   * able to fall through into deploying a second diamond, which is precisely the
   * outcome it exists to prevent. */
  const resume = (process.env.RESUME_DIAMOND || "").trim();
  const run = resume ? () => resumeDiamond(resume) : deployDiamond;

  run()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(resume ? "Resume failed:" : "Deployment failed:", error);
      process.exit(1);
    });
}

exports.deployDiamond = deployDiamond;
exports.resumeDiamond = resumeDiamond;
