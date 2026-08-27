/**
 * Switch USDC from Circle's real (unmintable) token to a freshly-deployed,
 * freely-mintable MockERC20 — in place, on a chain that currently carries
 * Circle's testnet USDC.
 *
 *   npx hardhat run scripts/switch-usdc-to-mock.js --network sepolia
 *   npx hardhat run scripts/switch-usdc-to-mock.js --network baseTestnet
 *
 * Rehearse first — validates every authorization gate, prints the exact sequence
 * with amounts and the Circle slot it will pause, and moves/deploys NOTHING:
 *
 *   FAUCET_DRY_RUN=1 npx hardhat run scripts/switch-usdc-to-mock.js --network sepolia
 *
 * ── Why ──────────────────────────────────────────────────────────────────────
 *
 * Circle's testnet USDC cannot be minted — faucet.circle.com caps every wallet at
 * 20 USDC per chain per 2 hours, and there is no bulk source — so on Sepolia and
 * Base the faucet's USDC slot sat at 0 stock and USDC DEX pools could never be
 * seeded (a pool needs USDC to seed, and we had none). BSC and Robinhood already
 * run a MockERC20 USDC for exactly this reason (deploy-mock-tokens.js); this
 * brings Sepolia and Base onto the same footing.
 *
 * Arc is deliberately NOT switched: its NATIVE currency IS USDC (the 0x3600…0000
 * alias), Circle's own chain, so real USDC belongs there. This script refuses any
 * chain but the two beta chains still on Circle's ERC20.
 *
 * ── What it does, per chain ──────────────────────────────────────────────────
 *
 *   1. Deploys MockERC20("USD Coin","USDC",6). Reuses a prior run's mock if the
 *      marker switch-usdc-<net>.json exists — it never deploys a second, which
 *      would diverge from the one the record and faucet already point at.
 *   2. Wires the mock into the LIVE stablecoin suite. Additive — Circle stays a
 *      supported collateral, which is harmless (nobody holds it) and avoids any
 *      chance of bricking a redemption path:
 *        kfUSD.setCollateralSupport(mock, true)
 *        kafUSD.setAssetSupport(mock, true)
 *        YieldTreasury.setYieldAsset(mock, true)
 *   3. Repoints deployment-stablecoin-<net>.json contracts.USDC -> mock and bumps
 *      timestamps.deployed to now, so gen-registry reads it as the newest record
 *      for this component. The CALLER then runs `npm run gen:registry`.
 *   4. Faucet: lists the mock (setDrip) and mints its stock, then pauses Circle's
 *      slot (setDrip 0). The contract has no remove, so Circle's slot lingers
 *      paused — the /faucet UI drops a paused row whose symbol a live row already
 *      covers (see useFaucet.ts). Both the mock's mint and the drips are the same
 *      levers topup-faucet.js uses.
 *
 * ── What it deliberately does NOT do ─────────────────────────────────────────
 *
 * It does not seed DEX pools. The mock finally makes USDC pools seedable, but
 * which venue the app routes a USDC swap through (the V2 router in the dex record
 * vs. the V3 periphery in the v3 record) has to be settled first — seeding a pool
 * the router never reaches is wasted liquidity. That is its own, ETH-spending
 * task. USDC is a claimable faucet asset and a kfUSD collateral the moment this
 * finishes; it becomes swappable when a pool is seeded against the mock.
 *
 * It does not edit registry.ts's TOKENS table or gen-registry's output — those
 * are source edits the caller makes (remove the Circle USDC TOKENS entry; run the
 * generator). The summary prints the exact follow-ups.
 */

const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");

/** Only the two beta chains still on Circle's ERC20. Arc keeps Circle; BSC and
 * Robinhood already run a mock. An absent chain is refused, never defaulted. */
const SUPPORTED = {
  11155111: { label: "Sepolia", net: "sepolia" },
  84532: { label: "Base Sepolia", net: "baseTestnet" },
};

const MOCK = { name: "USD Coin", symbol: "USDC", decimals: 6 };

/* Match the faucet's other stablecoins: 10k/claim, 3000 claims => 30M stock. */
const FAUCET_DRIP_HUMAN = 10_000;
const FAUCET_CLAIMS = 3_000;

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
  "function mint(address to, uint256 amount)",
];

function readJson(name) {
  if (!fs.existsSync(name)) throw new Error(`${name} not found.`);
  return JSON.parse(fs.readFileSync(name, "utf8"));
}

/** Probe a state-changing owner/admin call read-only: it reverts iff the sender
 * is not authorized (the args below are idempotent no-ops on state). */
async function canCall(contract, fn, args) {
  try {
    await contract[fn].staticCall(...args);
    return true;
  } catch (e) {
    return e.message;
  }
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = hre.network.name;
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const dryRun = process.env.FAUCET_DRY_RUN === "1";

  const plan = SUPPORTED[chainId];
  if (!plan) {
    throw new Error(
      `Chain ${chainId} (${net}) is not a USDC-switch target. Only Sepolia ` +
        "(11155111) and Base Sepolia (84532) still run Circle's ERC20 USDC. " +
        "Arc keeps Circle's USDC (its native currency is USDC); BSC and " +
        "Robinhood already run a MockERC20 USDC."
    );
  }

  const stableName = `deployment-stablecoin-${net}.json`;
  const faucetName = `deployment-faucet-${net}.json`;
  const markerName = `switch-usdc-${net}.json`;

  const stable = readJson(stableName);
  const faucetRec = readJson(faucetName);

  const circleUSDC = ethers.getAddress(stable.contracts.USDC);
  const kfusdAddr = ethers.getAddress(stable.contracts.kfUSD);
  const kafusdAddr = ethers.getAddress(stable.contracts.kafUSD);
  const ytAddr = ethers.getAddress(stable.contracts.YieldTreasury);
  const faucetAddr = ethers.getAddress(faucetRec.contracts.faucet);

  console.log(`Switching USDC to a mintable mock on ${plan.label}`);
  console.log("  network:  ", net, `(chainId ${chainId})`);
  console.log("  deployer: ", deployer.address);
  console.log(
    "  balance:  ",
    ethers.formatEther(await ethers.provider.getBalance(deployer.address)),
    "\n"
  );
  console.log("  Circle USDC (to pause): ", circleUSDC);
  console.log("  kfUSD:        ", kfusdAddr);
  console.log("  kafUSD:       ", kafusdAddr);
  console.log("  YieldTreasury:", ytAddr);
  console.log("  faucet:       ", faucetAddr, "\n");

  /* The faucet's current USDC entry — the slot we pause. Matched by address, not
   * by symbol/key, because the record's key is "USDC" and the mock will reuse it. */
  const assets = faucetRec.config?.assets ?? [];
  const circleEntry = assets.find(
    (a) => ethers.getAddress(a.address) === circleUSDC
  );
  if (!circleEntry) {
    throw new Error(
      `${faucetName} has no asset at ${circleUSDC} — the faucet's USDC slot does ` +
        "not match the stablecoin record. Refusing to guess which slot to pause."
    );
  }

  const kfusd = await ethers.getContractAt("kfUSD", kfusdAddr, deployer);
  const kafusd = await ethers.getContractAt("kafUSD", kafusdAddr, deployer);
  const yt = await ethers.getContractAt("YieldTreasury", ytAddr, deployer);
  const faucet = await ethers.getContractAt(
    "KaleidoTokenFaucet",
    faucetAddr,
    deployer
  );

  /* ── Authorization gates (read-only; run in dry mode too) ─────────────────
   * Probe each write with an idempotent arg so a revert can only mean "not
   * authorized", surfacing a role problem here instead of three txns in. */
  const gates = {
    "kfUSD.setCollateralSupport": await canCall(kfusd, "setCollateralSupport", [
      circleUSDC,
      true,
    ]),
    "kafUSD.setAssetSupport": await canCall(kafusd, "setAssetSupport", [
      circleUSDC,
      true,
    ]),
    "YieldTreasury.setYieldAsset": await canCall(yt, "setYieldAsset", [
      circleUSDC,
      true,
    ]),
  };
  const faucetOwner = await faucet.owner();
  gates["faucet.owner == deployer"] =
    faucetOwner.toLowerCase() === deployer.address.toLowerCase()
      ? true
      : `owner is ${faucetOwner}`;

  console.log("Authorization:");
  let blocked = false;
  for (const [k, v] of Object.entries(gates)) {
    console.log(`  ${v === true ? "ok  " : "FAIL"} ${k}${v === true ? "" : ` — ${v}`}`);
    if (v !== true) blocked = true;
  }
  if (blocked) {
    throw new Error(
      "The deployer cannot make one of the required calls — see FAIL above. " +
        "Nothing was changed."
    );
  }

  const dripBase = ethers.parseUnits(String(FAUCET_DRIP_HUMAN), MOCK.decimals);
  const stockBase = dripBase * BigInt(FAUCET_CLAIMS);

  /* Reuse a prior run's mock rather than deploy a second. */
  let mockAddr = null;
  let reused = false;
  if (fs.existsSync(markerName) && process.env.FORCE_REDEPLOY !== "1") {
    const marker = readJson(markerName);
    mockAddr = ethers.getAddress(marker.mock);
    reused = true;
  }

  console.log("\nPlan:");
  console.log(
    `  1. ${reused ? `reuse mock USDC ${mockAddr}` : `deploy MockERC20("${MOCK.name}","${MOCK.symbol}",${MOCK.decimals})`}`
  );
  console.log("  2. kfUSD.setCollateralSupport(mock,true), kafUSD.setAssetSupport(mock,true), YieldTreasury.setYieldAsset(mock,true)");
  console.log(
    `  3. faucet.setDrip(mock, ${FAUCET_DRIP_HUMAN} USDC) + mint ${(FAUCET_DRIP_HUMAN * FAUCET_CLAIMS).toLocaleString("en-US")} USDC stock (${FAUCET_CLAIMS} claims)`
  );
  console.log(`  4. faucet.setDrip(${circleUSDC}, 0)  — pause Circle`);
  console.log(`  5. repoint ${stableName} USDC -> mock, bump timestamp`);

  if (dryRun) {
    console.log(
      "\nDRY RUN — nothing deployed or moved. Re-run without FAUCET_DRY_RUN to apply."
    );
    return;
  }

  /* ── 1. Deploy (or reuse) the mock ────────────────────────────────────── */
  if (!reused) {
    console.log("\nDeploying MockERC20 USDC…");
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const mock = await MockERC20.deploy(MOCK.name, MOCK.symbol, MOCK.decimals);
    await mock.waitForDeployment();
    mockAddr = ethers.getAddress(await mock.getAddress());
    const [sym, dec] = [await mock.symbol(), Number(await mock.decimals())];
    if (sym !== MOCK.symbol || dec !== MOCK.decimals) {
      throw new Error(`Deployed mock reports ${sym}/${dec}, expected USDC/6.`);
    }
    console.log(`  mock USDC deployed ${mockAddr} (${sym}, ${dec} decimals)`);
  } else {
    console.log(`\nReusing mock USDC ${mockAddr} (marker ${markerName}).`);
  }
  const mock = new ethers.Contract(mockAddr, ERC20_ABI, deployer);

  /* ── 2. Wire into the live stablecoin suite ───────────────────────────── */
  console.log("\nWiring the mock into kfUSD / kafUSD / YieldTreasury…");
  await (await kfusd.setCollateralSupport(mockAddr, true)).wait();
  await (await kafusd.setAssetSupport(mockAddr, true)).wait();
  await (await yt.setYieldAsset(mockAddr, true)).wait();
  const [cOk, aOk, yOk] = await Promise.all([
    kfusd.supportedCollaterals(mockAddr),
    kafusd.supportedAssets(mockAddr),
    yt.supportedYieldAssets(mockAddr),
  ]);
  if (!cOk || !aOk || !yOk) {
    throw new Error(
      `Wiring did not stick: kfUSD=${cOk} kafUSD=${aOk} YT=${yOk}. USDC is ` +
        "deployed and may be half-wired — re-run (idempotent) before repointing."
    );
  }
  console.log("  supported: kfUSD ✓  kafUSD ✓  YieldTreasury ✓");

  /* ── 3. Faucet: stock + list the mock ─────────────────────────────────── */
  console.log("\nFaucet: minting stock and listing the mock…");
  const haveStock = await mock.balanceOf(faucetAddr);
  if (haveStock < stockBase) {
    await (await mock.mint(faucetAddr, stockBase - haveStock)).wait();
  }
  await (await faucet.setDrip(mockAddr, dripBase)).wait();

  /* ── 4. Pause Circle's slot ───────────────────────────────────────────── */
  await (await faucet.setDrip(circleUSDC, 0n)).wait();
  console.log("  mock listed + stocked; Circle slot paused.");

  /* Read the faucet back through assetInfo — authoritative for drip + stock. */
  const [tks, drs, stk] = await faucet.assetInfo(deployer.address);
  const liveFaucet = new Map();
  for (let i = 0; i < tks.length; i++) {
    liveFaucet.set(tks[i].toLowerCase(), { drip: drs[i], stock: stk[i] });
  }
  const mLive = liveFaucet.get(mockAddr.toLowerCase()) ?? { drip: 0n, stock: 0n };
  const cLive = liveFaucet.get(circleUSDC.toLowerCase()) ?? { drip: 0n, stock: 0n };

  /* ── 5. Rewrite the records ───────────────────────────────────────────── */
  // Stablecoin record: repoint USDC and make it the newest for gen-registry.
  stable.contracts.USDC = mockAddr;
  stable.timestamps = stable.timestamps ?? {};
  stable.timestamps.deployed = new Date().toISOString();
  stable.usdcNote =
    "USDC switched from Circle's real token to a mintable MockERC20 " +
    `(${mockAddr}) — see scripts/switch-usdc-to-mock.js. Circle was ${circleUSDC}.`;
  fs.writeFileSync(stableName, JSON.stringify(stable, null, 2));

  // Faucet record: relabel the paused Circle entry, add the mock as "USDC".
  circleEntry.key = "USDC_CIRCLE_LEGACY";
  circleEntry.drip = "0";
  circleEntry.dripHuman = "0";
  circleEntry.paused = true;
  circleEntry.note =
    "Circle's real USDC — paused when USDC switched to a mintable mock. The " +
    "faucet has no remove, so the slot lingers; the /faucet UI hides it.";
  assets.push({
    key: "USDC",
    address: mockAddr,
    symbol: "USDC",
    decimals: MOCK.decimals,
    dripHuman: ethers.formatUnits(mLive.drip, MOCK.decimals),
    drip: mLive.drip.toString(),
    source: "stablecoin",
    funding: {
      method: "switch-mock",
      stocked: ethers.formatUnits(mLive.stock, MOCK.decimals),
      claimsLeft: mLive.drip > 0n ? Number(mLive.stock / mLive.drip) : 0,
    },
  });
  faucetRec.lastUsdcSwitch = new Date().toISOString();
  fs.writeFileSync(faucetName, JSON.stringify(faucetRec, null, 2));

  // Marker: the mock is now canonical; a re-run reuses it.
  fs.writeFileSync(
    markerName,
    JSON.stringify(
      {
        network: net,
        chainId,
        mock: mockAddr,
        replaced: circleUSDC,
        symbol: MOCK.symbol,
        decimals: MOCK.decimals,
        switchedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );

  console.log("\n============================================================");
  console.log(`USDC SWITCHED TO MOCK — ${plan.label}`);
  console.log("============================================================");
  console.log(`  mock USDC   ${mockAddr}`);
  console.log(
    `  faucet USDC drip ${ethers.formatUnits(mLive.drip, MOCK.decimals)}  ` +
      `stock ${ethers.formatUnits(mLive.stock, MOCK.decimals)}  ` +
      `(${mLive.drip > 0n ? mLive.stock / mLive.drip : 0n} claims)`
  );
  console.log(
    `  Circle slot ${circleUSDC} drip ${ethers.formatUnits(cLive.drip, MOCK.decimals)} (paused)`
  );
  console.log("\nFollow-ups (source edits, not on-chain):");
  console.log("  1. npm run gen:registry   — repoints getContracts().usdc to the mock");
  console.log(
    `  2. Remove the Circle USDC entry (${circleUSDC}) from TOKENS[${chainId}] in ` +
      "src/constants/registry.ts — USDC is ours now, like BSC/Robinhood, so it"
  );
  console.log("     belongs in getContracts().usdc only, not TOKENS.");
  console.log("  3. (once) useFaucet.ts drops the paused duplicate USDC row.");
  console.log("  Deferred: seed a USDC pool (needs V2-vs-V3 routing settled).");
  console.log("============================================================");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
