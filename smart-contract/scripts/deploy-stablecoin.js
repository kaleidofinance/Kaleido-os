const hre = require("hardhat");

/**
 * Reads everything the deploy needs from the environment, before anything is
 * deployed: the stablecoin's revenue configuration and the one collateral
 * address this script does not create itself.
 *
 * Without the revenue half the protocol deploys, works, takes deposits,
 * distributes yield — and earns nothing, because
 * YieldTreasury.protocolFeeRecipient defaults to the zero address and
 * `receiveYield` treats that as "waive the fee and give it all to depositors".
 * That default is the right one for safety (an unset recipient must never burn
 * depositors' yield), but it means a missing env var produces a protocol that is
 * silently free to run rather than one that visibly fails. A silent zero is
 * harder to notice than a revert, so it is checked here instead.
 *
 * Every value below fails the same way: quietly, in a deploy that otherwise
 * looks like it worked. That is what makes them worth checking up front.
 */
function readStablecoinConfig() {
  const errors = [];

  const raw = (process.env.KALEIDO_FEE_VAULT || "").trim();
  let feeRecipient = null;
  if (!raw) {
    errors.push("KALEIDO_FEE_VAULT is not set");
  } else if (!hre.ethers.isAddress(raw) || raw === hre.ethers.ZeroAddress) {
    errors.push(`KALEIDO_FEE_VAULT is not a usable address: ${raw}`);
  } else {
    feeRecipient = hre.ethers.getAddress(raw);
  }

  /* Deliberately the same variable the diamond deploy reads, so lending
   * revenue and stablecoin revenue accumulate in one place. Two vaults would
   * mean two withdrawal procedures and two things to forget about. */

  let performanceFeeBps = 1000; // 10% of yield — Lido's rate
  const rawBps = (process.env.KFUSD_PERFORMANCE_FEE_BPS || "").trim();
  if (rawBps) {
    const n = Number(rawBps);
    if (!Number.isInteger(n) || n < 0 || n > 2000) {
      errors.push(
        `KFUSD_PERFORMANCE_FEE_BPS must be an integer in 0..2000, got ${rawBps}`,
      );
    } else {
      performanceFeeBps = n;
    }
  }

  /*
   * The one collateral this script does not deploy.
   *
   * USDT and USDe are deployed a few lines below, so their addresses are known
   * to be right by construction. USDC is external, and it used to default to
   * `0x572f4901f03055ffC1D936a60Ccc3CbF13911BE3` — the pre-rebuild Abstract
   * testnet USDC, which `docs/MULTICHAIN_DEPLOYMENT_MAP.md` records as exactly
   * the class of address the registry was emptied to stop carrying forward.
   *
   * A default is worse here than a missing value, because that address is
   * consumed three times and every one of them is a privileged write:
   * `setYieldAsset` (:130), `kfUSD.setCollateralSupport` (:189) and
   * `kafUSD.setAssetSupport` (:209). All three succeed against any address —
   * `setCollateralSupport` checks only `_token != address(0)` (kfUSD.sol:320) —
   * so a wrong value does not fail the deploy. It produces a protocol that came
   * up cleanly, printed a summary naming "USDC", and has an unrelated address in
   * its collateral list. On a chain where nothing is deployed there, minting
   * against it reverts; on a chain where something else is, the collateral list
   * names a token nobody chose.
   *
   * No default, therefore. Deploying against the wrong chain's USDC should be a
   * thing you cannot do by omission.
   */
  const rawUsdc = (process.env.USDC_ADDRESS || "").trim();
  let usdc = null;
  if (!rawUsdc) {
    errors.push("USDC_ADDRESS is not set");
  } else if (
    !hre.ethers.isAddress(rawUsdc) ||
    rawUsdc === hre.ethers.ZeroAddress
  ) {
    errors.push(`USDC_ADDRESS is not a usable address: ${rawUsdc}`);
  } else {
    usdc = hre.ethers.getAddress(rawUsdc);
  }

  /*
   * USDT and USDe are OPTIONAL, and their presence is what makes this a
   * redeploy rather than a first deploy.
   *
   * On a first deploy both are unset and the script deploys fresh mocks, as it
   * always has. On a redeploy — replacing kfUSD/kafUSD/YieldTreasury on a chain
   * that already has collateral, a faucet dripping it and pools seeded against
   * it — a fresh mock would orphan all of that: the faucet keeps dripping the
   * old token, the registry would carry two USDTs, and gen-registry.mjs would
   * throw on the disagreement. So the existing addresses are passed in and
   * reused, exactly as USDC already is.
   *
   * Same validation as USDC: a well-formed string is not a token, so the
   * address is proved live on chain before any gas is spent (assertErc20IsLive
   * below). An address that is set but wrong is a configuration error, not a
   * silent fall-through to deploying a mock — a redeploy that quietly minted new
   * collateral is the exact failure this is here to prevent.
   */
  function optionalCollateral(name) {
    const raw = (process.env[name] || "").trim();
    if (!raw) return null;
    if (!hre.ethers.isAddress(raw) || raw === hre.ethers.ZeroAddress) {
      errors.push(`${name} is set but not a usable address: ${raw}`);
      return null;
    }
    return hre.ethers.getAddress(raw);
  }
  const usdt = optionalCollateral("USDT_ADDRESS");
  const usde = optionalCollateral("USDE_ADDRESS");

  if (errors.length) {
    throw new Error(
      "Refusing to deploy with incomplete configuration:\n" +
        errors.map((e) => `   - ${e}`).join("\n") +
        "\n\nSet these in smart-contract/.env (see .env.example).",
    );
  }

  return { feeRecipient, performanceFeeBps, usdc, usdt, usde };
}

/**
 * Prove a configured collateral is an ERC20 on the chain being deployed to.
 *
 * `isAddress` only says the string is twenty well-formed bytes; every wrong
 * address in this class is also well-formed. These two reads are what
 * distinguish "an address" from "a token that exists here":
 *
 *  - Code. Without it there is nothing to transfer, and the failure would not
 *    surface until a user's first mint.
 *  - `decimals()`. Not incidental — kfUSD.sol:270-284 scales redemptions by the
 *    collateral's decimals, so this both proves the token answers the metadata
 *    interface and puts the figure that drives that conversion in the deploy
 *    log. A "USDC" that reports 18 is a different asset from one that reports 6,
 *    and the deploy summary is the last place anyone will look before it is
 *    live.
 *
 * `label` names the env var in errors so a wrong USDT and a wrong USDe don't
 * report the same message. Called before the first deploy, so a misconfigured
 * run costs no gas.
 */
async function assertErc20IsLive(label, address) {
  const code = await hre.ethers.provider.getCode(address);
  if (code === "0x") {
    const { name, chainId } = await hre.ethers.provider.getNetwork();
    throw new Error(
      `${label} ${address} has no code on ${name} (chainId ${chainId}). ` +
        `Either it belongs to another network or the token is not deployed yet.`,
    );
  }

  let decimals;
  try {
    const token = await hre.ethers.getContractAt(
      ["function decimals() view returns (uint8)"],
      address,
    );
    decimals = await token.decimals();
  } catch (error) {
    throw new Error(
      `${label} ${address} has code but does not answer decimals(), so it ` +
        `is not an ERC20 kfUSD can redeem against (see kfUSD.sol:270-284). ` +
        `Underlying error: ${error.message}`,
    );
  }

  return Number(decimals);
}

async function main() {
  /* Before any gas is spent. */
  const revenueConfig = readStablecoinConfig();
  const USDC_ADDRESS = revenueConfig.usdc;

  const [deployer] = await hre.ethers.getSigners();

  console.log("Deploying contracts with the account:", deployer.address);
  console.log(
    "Account balance:",
    (await hre.ethers.provider.getBalance(deployer.address)).toString(),
  );

  /* Still before any gas is spent: the env said this is USDC, now check the
   * chain agrees. */
  const usdcDecimals = await assertErc20IsLive("USDC_ADDRESS", USDC_ADDRESS);
  console.log(
    `\nUsing USDC at ${USDC_ADDRESS} (${usdcDecimals} decimals, code verified)`,
  );

  /*
   * USDT and USDe: reuse if an address was supplied, otherwise deploy a fresh
   * mock. See readStablecoinConfig — a supplied address makes this a redeploy
   * that keeps the faucet, pools and registry pointing at the collateral that
   * already exists. The reuse path is verified on chain exactly like USDC; the
   * deploy path is the original first-deploy behaviour, unchanged.
   */
  console.log("\n=== Collateral: USDT and USDe ===");

  let usdt;
  if (revenueConfig.usdt) {
    const d = await assertErc20IsLive("USDT_ADDRESS", revenueConfig.usdt);
    usdt = await hre.ethers.getContractAt("USDT", revenueConfig.usdt);
    console.log(
      `Reusing USDT at ${revenueConfig.usdt} (${d} decimals, code verified)`,
    );
  } else {
    const USDT = await hre.ethers.getContractFactory("USDT");
    usdt = await USDT.deploy(deployer.address);
    await usdt.waitForDeployment();
    console.log("USDT deployed to:", await usdt.getAddress());
  }

  let usde;
  if (revenueConfig.usde) {
    const d = await assertErc20IsLive("USDE_ADDRESS", revenueConfig.usde);
    usde = await hre.ethers.getContractAt("USDe", revenueConfig.usde);
    console.log(
      `Reusing USDe at ${revenueConfig.usde} (${d} decimals, code verified)`,
    );
  } else {
    const USDe = await hre.ethers.getContractFactory("USDe");
    usde = await USDe.deploy(deployer.address);
    await usde.waitForDeployment();
    console.log("USDe deployed to:", await usde.getAddress());
  }

  // Deploy kfUSD Stablecoin
  console.log("\n=== Deploying kfUSD Stablecoin ===");
  const KfUSD = await hre.ethers.getContractFactory("kfUSD");
  const kfusd = await KfUSD.deploy();
  await kfusd.waitForDeployment();
  const kfusdAddress = await kfusd.getAddress();
  console.log("kfUSD deployed to:", kfusdAddress);

  // Deploy kafUSD Liquid Staking Token
  console.log("\n=== Deploying kafUSD Liquid Staking Token ===");
  const KafUSD = await hre.ethers.getContractFactory("kafUSD");
  const kafusd = await KafUSD.deploy(kfusdAddress);
  await kafusd.waitForDeployment();
  const kafusdAddress = await kafusd.getAddress();
  console.log("kafUSD deployed to:", kafusdAddress);

  // Deploy YieldTreasury Contract
  console.log("\n=== Deploying YieldTreasury Contract ===");
  const YieldTreasury = await hre.ethers.getContractFactory("YieldTreasury");
  const yieldTreasury = await YieldTreasury.deploy(kafusdAddress);
  await yieldTreasury.waitForDeployment();
  const yieldTreasuryAddress = await yieldTreasury.getAddress();
  console.log("YieldTreasury deployed to:", yieldTreasuryAddress);

  // Configure YieldTreasury
  console.log("\n=== Configuring YieldTreasury ===");

  /* Every state-changing call below is `await (await fn()).wait()`, not `await
   * fn()`. The difference is not stylistic: `await contract.fn()` resolves as soon
   * as the transaction is BROADCAST and returns a TransactionResponse, so without
   * the inner .wait() this section fires six transactions back to back and asks
   * the provider for a fresh nonce each time. A provider that answers
   * eth_getTransactionCount from mined state rather than from the pending pool
   * then hands out the same nonce repeatedly, and the run dies partway through
   * with "replacement transaction underpriced" — which it did on Base Sepolia on
   * 2026-08-21, at the third setYieldAsset, after all five contracts had already
   * been deployed. Waiting for the receipt makes each nonce correct by
   * construction, on any endpoint, and these are configuration calls where a
   * transaction that silently never mined is worse than a slow script.
   */

  // Grant YIELD_SOURCE_ROLE to kfUSD contract
  const YIELD_SOURCE_ROLE = await yieldTreasury.YIELD_SOURCE_ROLE();
  await (await yieldTreasury.grantRole(YIELD_SOURCE_ROLE, kfusdAddress)).wait();
  console.log("Granted YIELD_SOURCE_ROLE to kfUSD contract");

  // Register kfUSD as yield source
  await (await yieldTreasury.setYieldSource(kfusdAddress, "kfUSD Fees", true)).wait();
  console.log("Registered kfUSD as yield source: 'kfUSD Fees'");

  // Add supported yield assets (kfUSD, USDC, USDT, USDe)
  const usdtAddress = await usdt.getAddress();
  const usdeAddress = await usde.getAddress();

  await (await yieldTreasury.setYieldAsset(kfusdAddress, true)).wait();
  console.log("Added kfUSD as supported yield asset");

  await (await yieldTreasury.setYieldAsset(USDC_ADDRESS, true)).wait();
  console.log("Added USDC as supported yield asset");

  await (await yieldTreasury.setYieldAsset(usdtAddress, true)).wait();
  console.log("Added USDT as supported yield asset");

  await (await yieldTreasury.setYieldAsset(usdeAddress, true)).wait();
  console.log("Added USDe as supported yield asset");

  // Route the protocol's cut of yield. Without both of these the fee is inert
  // and 100% of yield goes to depositors — see readStablecoinConfig.
  console.log("\n=== Configuring YieldTreasury revenue ===");
  await (
    await yieldTreasury.setProtocolFeeRecipient(revenueConfig.feeRecipient)
  ).wait();
  await (
    await yieldTreasury.setPerformanceFee(revenueConfig.performanceFeeBps)
  ).wait();

  /* Read both back. These are the two values that decide whether the protocol
   * earns anything at all, and a fee that failed to stick fails silently — the
   * contract keeps distributing yield perfectly well, just none of it here. */
  const [readRecipient, readBps] = await Promise.all([
    yieldTreasury.protocolFeeRecipient(),
    yieldTreasury.performanceFeeBps(),
  ]);
  if (
    hre.ethers.getAddress(readRecipient) !== revenueConfig.feeRecipient ||
    readBps !== BigInt(revenueConfig.performanceFeeBps)
  ) {
    throw new Error(
      `Revenue configuration did not stick: recipient=${readRecipient} bps=${readBps}`,
    );
  }
  console.log(
    `Performance fee: ${revenueConfig.performanceFeeBps} bps of yield -> ${revenueConfig.feeRecipient}`,
  );

  // Configure kfUSD with YieldTreasury
  console.log("\n=== Configuring kfUSD with YieldTreasury ===");
  await (await kfusd.setYieldTreasury(yieldTreasuryAddress)).wait();
  console.log("Set YieldTreasury address in kfUSD contract");

  // Auto-transfer is enabled by default, but explicitly enable it here for clarity
  // Fees from mint & redeem will automatically be sent to YieldTreasury
  await (await kfusd.setAutoTransferFees(true)).wait();
  console.log(
    "Automatic fee transfer to YieldTreasury enabled (fees auto-sent on mint/redeem)",
  );

  // Configure kafUSD with YieldTreasury
  console.log("\n=== Configuring kafUSD with YieldTreasury ===");
  await (await kafusd.setYieldTreasury(yieldTreasuryAddress)).wait();
  console.log("Set YieldTreasury address in kafUSD contract");

  // Configure kfUSD with supported collaterals
  console.log("\n=== Configuring kfUSD Collaterals ===");

  // Add USDC as collateral
  await (await kfusd.setCollateralSupport(USDC_ADDRESS, true)).wait();
  console.log("Added USDC as collateral");

  // Add USDT as collateral
  await (await kfusd.setCollateralSupport(usdtAddress, true)).wait();
  console.log("Added USDT as collateral");

  // Add USDe as collateral
  await (await kfusd.setCollateralSupport(usdeAddress, true)).wait();
  console.log("Added USDe as collateral");

  // Grant MINTER_ROLE to kfUSD for minting
  const MINTER_ROLE = await kfusd.MINTER_ROLE();
  // You can add your own address or a multisig here
  console.log("\nMinter role can be granted later:", MINTER_ROLE);

  // Configure kafUSD with supported assets
  console.log("\n=== Configuring kafUSD Assets ===");

  // Add USDC as supported asset
  await (await kafusd.setAssetSupport(USDC_ADDRESS, true)).wait();
  console.log("Added USDC as supported asset");

  // Add kfUSD as supported asset
  await (await kafusd.setAssetSupport(kfusdAddress, true)).wait();
  console.log("Added kfUSD as supported asset");

  // Add collaterals as supported assets
  await (await kafusd.setAssetSupport(usdtAddress, true)).wait();
  console.log("Added USDT as supported asset");

  await (await kafusd.setAssetSupport(usdeAddress, true)).wait();
  console.log("Added USDe as supported asset");

  // Summary
  console.log("\n=== Deployment Summary ===");
  console.log("USDT:", await usdt.getAddress());
  console.log("USDe:", await usde.getAddress());
  console.log("kfUSD:", kfusdAddress);
  console.log("kafUSD:", kafusdAddress);
  console.log("YieldTreasury:", yieldTreasuryAddress);
  console.log("USDC:", USDC_ADDRESS);
  console.log("\nSupported Collaterals for kfUSD:");
  console.log("- USDC:", USDC_ADDRESS);
  console.log("- USDT:", await usdt.getAddress());
  console.log("- USDe:", await usde.getAddress());
  console.log("\nSupported Assets for kafUSD:");
  console.log("- USDC:", USDC_ADDRESS);
  console.log("- kfUSD:", kfusdAddress);
  console.log("- USDT:", await usdt.getAddress());
  console.log("- USDe:", await usde.getAddress());
  console.log("\nYieldTreasury Configuration:");
  console.log("- kfUSD registered as yield source: 'kfUSD Fees'");
  console.log("- Auto-transfer enabled in kfUSD");
  console.log("- Supported yield assets: kfUSD, USDC, USDT, USDe");
  console.log(
    `- Performance fee: ${revenueConfig.performanceFeeBps} bps of yield`,
  );
  console.log(`- Fee recipient: ${revenueConfig.feeRecipient}`);
  const [liveMintFee, liveRedeemFee] = await Promise.all([
    kfusd.mintFee(),
    kfusd.redeemFee(),
  ]);
  console.log(
    `- kfUSD mint/redeem: ${liveMintFee}/${liveRedeemFee} bps ` +
      `(round trip ${(Number(liveMintFee) + Number(liveRedeemFee)) / 100}%)`,
  );

  // Save deployment info
  const network = await hre.ethers.provider.getNetwork();
  const deploymentInfo = {
    network: hre.network.name,
    chainId: network.chainId.toString(), // Convert BigInt to string
    deployer: deployer.address,
    contracts: {
      USDT: await usdt.getAddress(),
      USDe: await usde.getAddress(),
      kfUSD: kfusdAddress,
      kafUSD: kafusdAddress,
      YieldTreasury: yieldTreasuryAddress,
      USDC: USDC_ADDRESS,
    },
    timestamps: {
      deployed: new Date().toISOString(),
    },
  };

  const fs = require("fs");
  const filename = `deployment-stablecoin-${hre.network.name}-${Date.now()}.json`;
  fs.writeFileSync(filename, JSON.stringify(deploymentInfo, null, 2));
  console.log("\nDeployment info saved to:", filename);

  /**
   * Also written to a stable filename, which is what gen-registry.mjs reads.
   *
   * This was `deployment-<network>.json` — no component in the name. deploy.js
   * now writes a record too, and an unqualified name means whichever script runs
   * second overwrites the first and its addresses are simply gone. Every deploy
   * script now uses deployment-<component>-<network>.json.
   */
  const fixedFilename = `deployment-stablecoin-${hre.network.name}.json`;
  fs.writeFileSync(fixedFilename, JSON.stringify(deploymentInfo, null, 2));
  console.log("Deployment info also saved to:", fixedFilename);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
