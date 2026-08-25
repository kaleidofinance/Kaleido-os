/**
 * Deploy the mock counterparty tokens a chain needs before the real deploy can run.
 *
 *   npx hardhat run scripts/deploy-mock-tokens.js --network bscTestnet
 *   npx hardhat run scripts/deploy-mock-tokens.js --network robinhoodTestnet
 *
 * ── Why this exists, and why it runs FIRST ──────────────────────────────────
 *
 * Both chains in the wave have a canonical wrapped native but no canonical testnet
 * USDC, so on each we mint only a mock USDC and record the canonical wrapped native
 * for the .env step — we never deploy a second wrapped native and split liquidity:
 *
 *   BSC Testnet (97)           WBNB is canonical (0xae13d989…BAa7cd), so we mint
 *                              only a mock USDC and record the canonical WBNB for
 *                              the .env step — we do NOT deploy a second wrapped
 *                              native and split BNB liquidity across two tokens.
 *   Robinhood Testnet (46630)  aeWETH is canonical (0x7943e237…7852Fa, an EIP-1967
 *                              proxy that wraps/unwraps and already holds ~1930 WETH),
 *                              so we mint only a mock USDC — its canonical dollar USDG
 *                              is mainnet-only. An earlier run wrongly deployed our own
 *                              WETH9 here; see the 46630 plan note below.
 *
 * The real deploy reads these as environment variables, and three later scripts
 * refuse to start without them or getCode-check them:
 *
 *   deploy-v3.js / deploy-dex.js   need WRAPPED_NATIVE (getCode-checked)
 *   deploy-stablecoin.js           needs USDC_ADDRESS (getCode + decimals())
 *
 * So the addresses have to exist before .env can be filled in, which is why this
 * is the first on-chain step on these two chains — the mock-token counterpart to
 * deploy-pushable-feeds.js on Robinhood. Its output is a set of addresses to copy
 * into .env (WRAPPED_NATIVE / USDC_ADDRESS) and into TOKENS[chainId] in the
 * registry; it prints them ready to paste and writes mocktokens-<network>.json.
 *
 * ── What it deliberately does NOT do ────────────────────────────────────────
 *
 * It writes mocktokens-<network>.json, NOT deployment-<component>-<network>.json.
 * gen-registry.mjs only globs the deployment-* names, and it has no field map for
 * mock tokens — their addresses reach the registry through the real deploy
 * scripts' env vars (WRAPPED_NATIVE lands in the v3/dex records, USDC_ADDRESS in
 * the stablecoin record), never from here. A deployment-* name would earn a noisy
 * "unknown component" skip and nothing else. This is the convention
 * pricefeeds-*.json already follows, and for the same reason: an operational
 * artifact that must stay out of the registry glob.
 *
 * It refuses any chain not in MOCK_PLANS below — Sepolia, Base and Arc already
 * deployed, and mainnet must never run mocks — and it refuses a chain that already
 * has a mocktokens-<network>.json, because a re-run would mint a SECOND mock USDC
 * that diverges from the one the stablecoin and registry already point at. That
 * silent divergence is exactly what this whole deploy path is built to prevent.
 * Pass FORCE_REDEPLOY=1 to override, knowing you must then re-point USDC_ADDRESS,
 * re-run deploy-stablecoin.js, and update TOKENS.
 *
 * WETH9 has no mint: wrapped native is obtained by deposit()ing real native, so
 * there is nothing to pre-fund here — seed it from the deployer's native when a
 * pool needs WETH liquidity. The mock ERC20s ARE pre-minted to the deployer (mint
 * is public on MockERC20, so pre-minting is convenience, not a granted capability)
 * so pools and kfUSD have something to trade the moment they exist.
 */

const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");

const { waitForCode, waitForState } = require("./libraries/rpc.js");

/**
 * Per-chain plan. Keyed by chainId, and only the two chains that need mocks are
 * present — an absent chain is refused rather than defaulted, so this cannot be
 * pointed at an already-deployed chain or at mainnet by accident.
 *
 * `wrappedNative.deploy: "WETH9"` means deploy one; `canonical` means an address
 * already holds a wrapped native and we only record it for the .env step. A chain
 * has exactly one of the two.
 */
const MOCK_PLANS = {
  97: {
    label: "BSC Testnet",
    nativeLabel: "BNB",
    wrappedNative: {
      canonical: "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd", // canonical WBNB on chain 97
      symbol: "WBNB",
      decimals: 18,
    },
    erc20s: [{ key: "USDC", name: "USD Coin", symbol: "USDC", decimals: 6 }],
  },
  46630: {
    label: "Robinhood Chain Testnet",
    nativeLabel: "ETH",
    wrappedNative: {
      // Canonical aeWETH — an EIP-1967 proxy (impl 0xf40600e58a560a988D7B60D61F22F7AB18106ED6)
      // published at docs.robinhood.com/chain/protocol-contracts. Probed on-chain 2026-08-23:
      // deposit()/withdraw() ARE dispatched (eth_call reverts from *inside* _mint/_burn on the
      // zero-address, not selector-miss), and it already holds ~1930 WETH of real supply. An
      // earlier run deployed our own WETH9 here on a stale "nothing canonical" assumption, which
      // fragmented liquidity away from the token the chain actually uses; do not do that again.
      canonical: "0x7943e237c7F95DA44E0301572D358911207852Fa",
      symbol: "WETH",
      decimals: 18,
    },
    erc20s: [{ key: "USDC", name: "USD Coin", symbol: "USDC", decimals: 6 }],
  },
};

/** Human units of each mock ERC20 minted to the deployer. Override per run. */
const DEFAULT_MINT_HUMAN = 1_000_000;

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = hre.network.name;
  const chainId = Number((await ethers.provider.getNetwork()).chainId);

  const plan = MOCK_PLANS[chainId];
  if (!plan) {
    throw new Error(
      `Chain ${chainId} (${net}) has no mock-token plan.\n` +
        "This script only serves chains with no canonical counterparties — " +
        "currently BSC Testnet (97) and Robinhood Testnet (46630).\n" +
        "Sepolia, Base and Arc use canonical or already-deployed tokens; " +
        "mainnet must never run mocks. If this is genuinely a new chain, add it " +
        "to MOCK_PLANS deliberately rather than defaulting it.",
    );
  }

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Deploying mock counterparty tokens for ${plan.label}`);
  console.log("  network:  ", net, `(chainId ${chainId})`);
  console.log("  deployer: ", deployer.address);
  console.log("  balance:  ", ethers.formatEther(balance));

  if (balance === 0n) {
    throw new Error(
      `Deployer ${deployer.address} holds 0 native on ${net}. Fund it before ` +
        "deploying — every step below sends a transaction.",
    );
  }

  const filename = `mocktokens-${net}.json`;
  if (fs.existsSync(filename) && process.env.FORCE_REDEPLOY !== "1") {
    throw new Error(
      `${filename} already exists. Re-running would deploy a SECOND set of mocks ` +
        "that diverges from the one .env, the stablecoin and TOKENS already point " +
        "at.\nDelete it and pass FORCE_REDEPLOY=1 only if you intend to re-point " +
        "USDC_ADDRESS, re-run deploy-stablecoin.js, and update TOKENS afterwards.",
    );
  }

  const mintHuman = process.env.MOCK_USDC_MINT
    ? Number(process.env.MOCK_USDC_MINT)
    : DEFAULT_MINT_HUMAN;
  if (!Number.isFinite(mintHuman) || mintHuman < 0) {
    throw new Error(`MOCK_USDC_MINT must be a non-negative number, got ${process.env.MOCK_USDC_MINT}.`);
  }

  const record = {
    network: net,
    chainId,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    note:
      "Mock counterparty tokens. NOT read by gen-registry (no 'deployment-' prefix). " +
      "Copy the addresses below into smart-contract/.env (WRAPPED_NATIVE / USDC_ADDRESS) " +
      "and into TOKENS[chainId] in src/constants/registry.ts.",
    wrappedNative: null,
    tokens: {},
  };

  /* ── 1. Wrapped native ─────────────────────────────────────────────────── */

  if (plan.wrappedNative.deploy === "WETH9") {
    console.log(`\n1. Deploying WETH9 (wrapped ${plan.nativeLabel})`);
    const WETH9 = await ethers.getContractFactory("WETH9");
    const weth = await WETH9.deploy();
    await weth.waitForDeployment();
    const address = await weth.getAddress();
    await waitForCode(ethers.provider, address, "WETH9");

    /* Confirm the metadata deploy-v3.js/deploy-dex.js and the position-NFT SVG
     * depend on. WETH9 hardcodes these, so a mismatch would mean the wrong
     * artifact compiled, not a bad constructor arg. */
    const [symbol, decimals] = [await weth.symbol(), Number(await weth.decimals())];
    console.log(`   deployed ${address}  (${symbol}, ${decimals} decimals)`);
    if (decimals !== plan.wrappedNative.decimals) {
      throw new Error(`WETH9 reports ${decimals} decimals, expected ${plan.wrappedNative.decimals}.`);
    }

    record.wrappedNative = {
      address,
      symbol,
      decimals,
      kind: "WETH9",
      canonical: false,
      note: `Set WRAPPED_NATIVE to this; NATIVE_LABEL=${plan.nativeLabel}. Fund WETH liquidity by deposit()ing native.`,
    };
  } else {
    /* Canonical wrapped native already exists — record it for the .env step and
     * check it holds code, but do not abort here: validating WRAPPED_NATIVE is
     * deploy-v3.js/deploy-dex.js's job, and this script's contract is deploying
     * mocks, not gating on a third-party address. */
    const { canonical, symbol, decimals } = plan.wrappedNative;
    console.log(`\n1. Wrapped native is canonical (${symbol} ${canonical}) — not deploying`);
    const code = await ethers.provider.getCode(canonical);
    if (code === "0x") {
      console.log(
        `   ⚠️  ${canonical} holds no code on ${net}. deploy-v3.js/deploy-dex.js ` +
          "will reject it — confirm the canonical address for this chain before that step.",
      );
    } else {
      console.log(`   ${canonical} holds code — good.`);
    }
    record.wrappedNative = {
      address: canonical,
      symbol,
      decimals,
      kind: "canonical",
      canonical: true,
      deployed: false,
      note: `Set WRAPPED_NATIVE to this canonical address; NATIVE_LABEL=${plan.nativeLabel}.`,
    };
  }

  /* ── 2. Mock ERC20 counterparties ──────────────────────────────────────── */

  console.log(`\n2. Deploying ${plan.erc20s.length} mock ERC20(s)`);
  const MockERC20 = await ethers.getContractFactory("MockERC20");

  for (const spec of plan.erc20s) {
    console.log(`\n   ${spec.key}: ${spec.name} (${spec.symbol}, ${spec.decimals} decimals)`);
    const token = await MockERC20.deploy(spec.name, spec.symbol, spec.decimals);
    await token.waitForDeployment();
    const address = await token.getAddress();
    await waitForCode(ethers.provider, address, `${spec.key} (MockERC20)`);

    /* decimals() is what deploy-stablecoin.js reads off USDC_ADDRESS; assert it
     * stuck rather than trust the constructor arg. */
    const onDecimals = Number(await token.decimals());
    if (onDecimals !== spec.decimals) {
      throw new Error(`${spec.key} at ${address} reports ${onDecimals} decimals, expected ${spec.decimals}.`);
    }
    console.log(`     deployed ${address}`);

    let minted = null;
    if (mintHuman > 0) {
      const amount = ethers.parseUnits(String(mintHuman), spec.decimals);
      const tx = await token.mint(deployer.address, amount);
      await tx.wait();

      /* Read the balance back through an RPC that may be lagging the mint block. */
      const bal = await waitForState({
        read: () => token.balanceOf(deployer.address),
        accept: (v) => v > 0n,
        label: `${spec.key}.balanceOf(deployer)`,
      });
      if (bal !== amount) {
        throw new Error(
          `${spec.key} minted balance is ${bal}, expected ${amount} ` +
            `(${mintHuman} × 10^${spec.decimals}).`,
        );
      }
      minted = mintHuman.toString();
      console.log(`     minted ${mintHuman.toLocaleString("en-US")} ${spec.symbol} to deployer`);
    }

    record.tokens[spec.key] = {
      address,
      symbol: spec.symbol,
      decimals: spec.decimals,
      minted,
      mintedTo: minted ? deployer.address : null,
    };
  }

  /* ── 3. Record and next steps ──────────────────────────────────────────── */

  fs.writeFileSync(filename, JSON.stringify(record, null, 2));

  const usdc = record.tokens.USDC;
  const wn = record.wrappedNative;

  console.log("\n============================================================");
  console.log("MOCK TOKEN SUMMARY");
  console.log("============================================================");
  console.log(`  wrapped native  ${wn.address}  (${wn.symbol}, ${wn.kind})`);
  for (const [key, t] of Object.entries(record.tokens)) {
    console.log(`  ${key.padEnd(14)}${t.address}  (${t.symbol}, ${t.decimals} dec${t.minted ? `, ${t.minted} minted` : ""})`);
  }
  console.log("\nAdd to smart-contract/.env for this chain:");
  console.log(`  WRAPPED_NATIVE=${wn.address}`);
  console.log(`  NATIVE_LABEL=${plan.nativeLabel}`);
  if (usdc) console.log(`  USDC_ADDRESS=${usdc.address}`);
  console.log(
    "\nThen deploy in order: deploy-oracle.js → deploy.js → deploy-v3.js →\n" +
      "verify-pool-init-hash.js → deploy-dex.js → deploy-stablecoin.js →\n" +
      "register-tokens.js, and finally `npm run gen:registry` from the repo root.\n" +
      "WRAPPED_NATIVE feeds deploy-v3.js and deploy-dex.js; USDC_ADDRESS feeds\n" +
      "deploy-stablecoin.js (getCode + decimals-checked). Also populate\n" +
      `TOKENS[${chainId}] in src/constants/registry.ts from these addresses.`,
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
