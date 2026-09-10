/**
 * Replace YieldTreasury, carrying the yield and the holders' checkpoints across.
 *
 * Run:  DRY_RUN=1 npx hardhat run scripts/migrate-treasury.js --network sepolia
 * Then, only once the dry run reads correctly, with DRY_RUN unset.
 *
 * WHY. `userRewardDebt` was never initialised when a holder acquired kafUSD, so
 * every holder was valued against the whole historical `accYieldPerShare` from a
 * debt of zero and entitled to yield that accrued before they arrived. On
 * Sepolia that was 3,969 kfUSD of entitlement against 71.45 that existed.
 * `claimYield` subtracted it from the pool unguarded and underflowed, which
 * reaches a user as PANIC 17 on the Claim button. The replacement checkpoints
 * holders instead; see YieldTreasury.sol for the accounting.
 *
 * THE ORDER, and the one step that cannot be moved:
 *
 *   CHECKPOINT EVERY HOLDER BEFORE ANY YIELD IS DEPOSITED. A holder accrues only
 *   from their first checkpoint, so yield that lands before it is not theirs and
 *   never becomes theirs — it would sit in the new pool unclaimable by anyone.
 *   Checkpointing is therefore step 4 and the yield transfer is step 5, and they
 *   are not interchangeable.
 *
 * The performance fee is set to zero for the transfer and restored afterwards.
 * `receiveYield` skims `performanceFeeBps` on the way in, and this deposit is
 * not new yield being earned — it is the same yield being moved. At 10% the
 * migration would quietly take a tenth of it.
 *
 * WHAT THE OLD TREASURY OWES vs HOLDS. Its books say more than its balance: the
 * old `claimAndCompound` transferred without decrementing `yieldBalancePerAsset`,
 * so every compound drifted the ledger upward. Only what is actually on hand can
 * be moved, and the script reports both figures rather than the flattering one.
 */
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

const DRY = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";
const SPAN = Number(process.env.SPAN ?? 1000);
const LOOKBACK = Number(process.env.LOOKBACK ?? 150000);
const BATCH = 25;

const f = (x) =>
  Number(ethers.formatUnits(x, 18)).toLocaleString(undefined, {
    maximumFractionDigits: 6,
  });

/* Holders come from a Transfer scan for the same reason the staking snapshot
   needed one: kafUSD keeps balances, not a holder list. Completeness is checked
   the same way too — the balances must sum to totalSupply, or the list is short
   and the run stops rather than checkpointing only some of them. */
async function holdersOf(token, provider) {
  const head = await provider.getBlockNumber();
  const from = Math.max(0, head - LOOKBACK);
  const topic = ethers.id("Transfer(address,address,uint256)");
  const seen = new Set();
  for (let start = from; start <= head; start += SPAN) {
    const end = Math.min(start + SPAN - 1, head);
    const logs = await provider.getLogs({
      address: token,
      topics: [topic],
      fromBlock: start,
      toBlock: end,
    });
    for (const l of logs) {
      seen.add("0x" + l.topics[1].slice(26));
      seen.add("0x" + l.topics[2].slice(26));
    }
  }
  seen.delete(ethers.ZeroAddress.toLowerCase());
  return [...seen].map((a) => ethers.getAddress(a));
}

async function main() {
  const net = network.name;
  const [deployer] = await ethers.getSigners();
  console.log(
    `\n${DRY ? "DRY RUN - nothing is sent" : "LIVE"}   network ${net}   deployer ${deployer.address}\n`,
  );

  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const gen = fs.readFileSync(
    path.join(__dirname, "..", "..", "src", "constants", "deployments.generated.ts"),
    "utf8",
  );
  const sec = gen.slice(gen.indexOf(`${chainId}:`));
  const pick = (k) => (sec.match(new RegExp(`${k}: "(0x[0-9a-fA-F]{40})"`)) || [])[1];
  const oldTreasuryAddr = pick("yieldTreasury");
  const kafusdAddr = pick("kafUSD");
  const kfusdAddr = pick("kfUSD");
  const vaultAddr = pick("kldVault");
  if (!oldTreasuryAddr || !kafusdAddr) throw new Error("registry is missing the stable set");

  const oldT = await ethers.getContractAt("YieldTreasury", oldTreasuryAddr);
  const kafusd = await ethers.getContractAt("kafUSD", kafusdAddr);
  const kfusd = await ethers.getContractAt("kfUSD", kfusdAddr);

  const assets = await oldT.getSupportedYieldAssets();
  const sources = await oldT.getYieldSources();
  const feeBps = await oldT.performanceFeeBps();
  const feeRecipient = await oldT.protocolFeeRecipient();

  console.log(`old treasury      : ${oldTreasuryAddr}`);
  console.log(`kafUSD            : ${kafusdAddr}`);
  console.log(`supported assets  : ${assets.length}`);
  console.log(`yield sources     : ${sources.length}`);
  console.log(`performance fee   : ${feeBps} bps -> ${feeRecipient}`);

  // ---- what can actually be moved -----------------------------------------
  console.log(`\n1. yield held vs owed, per asset`);
  const onHand = {};
  for (const a of assets) {
    const token = await ethers.getContractAt("kfUSD", a);
    const held = await token.balanceOf(oldTreasuryAddr);
    const booked = await oldT.yieldBalancePerAsset(a);
    onHand[a] = held;
    if (held > 0n || booked > 0n)
      console.log(`   ${a}  books ${f(booked)} | on hand ${f(held)}${booked > held ? "  <- ledger drifted above the balance" : ""}`);
  }

  // ---- holders --------------------------------------------------------------
  console.log(`\n2. scanning kafUSD holders`);
  /* Read from a file, not scanned here. Building the list inline meant ~150
     sequential getLogs calls through hardhat's provider before the first
     transaction could be sent — slow enough on one attempt to be
     indistinguishable from a hang, and paid again on every retry.
     snapshot-holders.mjs does it once against a raw endpoint with its own
     retries, and its output is reviewable before anything is signed. The scan
     stays available below as a fallback when no snapshot exists. */
  const snapPath = path.join(__dirname, "..", `snapshot-kafusd-${net}.json`);
  let all;
  if (fs.existsSync(snapPath)) {
    const snap = JSON.parse(fs.readFileSync(snapPath, "utf8"));
    if (!snap.totals.agree)
      throw new Error("kafUSD snapshot did not reconcile — retake it.");
    if (snap.token.toLowerCase() !== kafusdAddr.toLowerCase())
      throw new Error("Snapshot is for a different token.");
    all = snap.holders.map((h) => h.holder);
    console.log(`   from ${path.basename(snapPath)} (${all.length} addresses)`);
  } else {
    all = await holdersOf(kafusdAddr, ethers.provider);
  }
  const holders = [];
  let sum = 0n;
  for (const h of all) {
    const b = await kafusd.balanceOf(h);
    if (b > 0n) {
      holders.push(h);
      sum += b;
    }
  }
  const supply = await kafusd.totalSupply();
  console.log(`   ${holders.length} holders | sum ${f(sum)} | totalSupply ${f(supply)}`);
  if (sum !== supply)
    throw new Error(
      `Holder scan is short by ${f(supply - sum)} kafUSD - widen LOOKBACK. Checkpointing a partial list would strand the rest.`,
    );
  console.log(`   reconciles exactly`);

  if (DRY) {
    console.log(`\nWould then: deploy YieldTreasury(${kafusdAddr}), configure ${assets.length} asset(s)`);
    console.log(`and ${sources.length} source(s), CHECKPOINT ${holders.length} holders, move the yield`);
    console.log(`with the fee temporarily at 0, then repoint kafUSD and the KLD vault.\n`);
    return;
  }

  // ---- deploy + configure, or pick up an existing one -----------------------
  /* RESUMABLE ON PURPOSE. This runs a dozen-plus transactions over a public
     endpoint, and the first attempt stalled part-way through the checkpoints
     with the treasury already deployed and configured. Re-running from scratch
     would abandon a perfectly good contract and pay for another, so TREASURY=0x
     attaches to what is already there and every step below asks the chain
     whether it still needs doing. A migration that cannot be resumed is one
     that has to be perfect on the first try. */
  let t;
  let addr = process.env.TREASURY;
  if (addr) {
    t = await ethers.getContractAt("YieldTreasury", addr);
    if ((await t.kafUSDContract()).toLowerCase() !== kafusdAddr.toLowerCase())
      throw new Error("TREASURY names a contract built for a different kafUSD.");
    console.log(`
3. resuming with treasury ${addr}`);
  } else {
    const T = await ethers.getContractFactory("YieldTreasury");
    t = await T.deploy(kafusdAddr);
    await t.waitForDeployment();
    addr = await t.getAddress();
    console.log(`
3. new treasury ${addr}`);
  }

  const ADMIN = await t.ADMIN_ROLE();
  const SOURCE = await t.YIELD_SOURCE_ROLE();
  if (!(await t.hasRole(ADMIN, deployer.address)))
    await (await t.grantRole(ADMIN, deployer.address)).wait();
  if (!(await t.hasRole(SOURCE, deployer.address)))
    await (await t.grantRole(SOURCE, deployer.address)).wait();
  for (const a of assets)
    if (!(await t.supportedYieldAssets(a)))
      await (await t.setYieldAsset(a, true)).wait();
  for (const srcAddr of sources)
    if (!(await t.hasRole(SOURCE, srcAddr)))
      await (await t.grantRole(SOURCE, srcAddr)).wait();
  if ((await t.protocolFeeRecipient()).toLowerCase() !== feeRecipient.toLowerCase())
    await (await t.setProtocolFeeRecipient(feeRecipient)).wait();
  if (kfusdAddr && (await t.kfUSDToken()) === ethers.ZeroAddress)
    await (await t.setKfUSDToken(kfusdAddr)).wait();
  console.log(`   configured ${assets.length} asset(s), ${sources.length} source(s)`);

  // ---- 4. CHECKPOINT BEFORE ANY YIELD --------------------------------------
  /* Asked per holder rather than tracked by a counter: a resumed run has no
     memory of how far the last one got, and the contract's own trackedHolder is
     the only answer that survives an interruption. */
  let already = 0;
  let didNow = 0;
  for (const h of holders) {
    if (await t.trackedHolder(h, kfusdAddr)) {
      already++;
      continue;
    }
    await (await t.checkpoint(h)).wait();
    didNow++;
    console.log(`   checkpointed ${already + didNow}/${holders.length}`);
  }
  if (already) console.log(`   (${already} were already done by an earlier run)`);
  console.log(`4. every holder checkpointed BEFORE any yield`);

  // ---- 5. move the yield, fee off ------------------------------------------
  await (await t.setPerformanceFee(0)).wait();
  for (const a of assets) {
    const amount = onHand[a];
    if (amount === 0n) continue;
    await (await oldT.emergencyWithdraw(a, amount, deployer.address)).wait();
    const token = await ethers.getContractAt("kfUSD", a);
    await (await token.approve(addr, amount)).wait();
    await (await t.receiveYield(a, amount, "treasury migration")).wait();
    console.log(`5. moved ${f(amount)} of ${a}`);
  }
  await (await t.setPerformanceFee(feeBps)).wait();
  console.log(`   performance fee restored to ${feeBps} bps`);

  // ---- 6. repoint everything that reads the treasury ------------------------
  await (await kafusd.setYieldTreasury(addr)).wait();
  console.log(`6. kafUSD -> ${addr}`);
  if (vaultAddr) {
    const vault = await ethers.getContractAt("KLDVaultV2", vaultAddr);
    await (await vault.setYieldTreasury(addr)).wait();
    console.log(`   KLD vault -> ${addr}`);
  }

  // ---- 7. verify -----------------------------------------------------------
  let owed = 0n;
  for (const h of holders) owed += await t.calculateUserYield(h, kfusdAddr);
  const pool = await t.yieldBalancePerAsset(kfusdAddr);
  const held = await kfusd.balanceOf(addr);
  console.log(`\n7. entitlement ${f(owed)} | pool ${f(pool)} | on hand ${f(held)}`);
  if (owed > pool) throw new Error("Entitlement exceeds the pool - do not ship this.");
  if (pool > held) throw new Error("Pool exceeds tokens on hand - do not ship this.");
  console.log(`   solvent: nothing promised that is not there`);

  const out = path.join(__dirname, "..", `deployment-treasury-${net}.json`);
  fs.writeFileSync(
    out,
    JSON.stringify(
      {
        network: net,
        chainId,
        timestamp: new Date().toISOString(),
        contracts: { YieldTreasury: addr },
        config: { assets, sources, performanceFeeBps: feeBps.toString(), feeRecipient },
        migratedFrom: {
          treasury: oldTreasuryAddr,
          holdersCheckpointed: holders.length,
          movedOnHand: Object.fromEntries(
            Object.entries(onHand).map(([k, v]) => [k, v.toString()]),
          ),
        },
      },
      null,
      2,
    ),
  );
  console.log(`   wrote ${path.basename(out)}\n`);
}

main().catch((e) => {
  console.error("\nFAILED:", e.message);
  process.exit(1);
});
