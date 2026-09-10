/**
 * Redeploy the staking set and carry the live positions across.
 *
 * Run:  DRY_RUN=1 npx hardhat run scripts/migrate-staking.js --network sepolia
 * Then, only once the dry run reads correctly, with DRY_RUN unset.
 *
 * WHY A MIGRATION AT ALL. `KLDVaultV2.yieldTreasury` was constructor-only and
 * `harvestYield` is the vault's sole accrual path, so when the stablecoin set
 * was redeployed on 2026-09-06 every vault kept harvesting from an address that
 * no longer knew the current kfUSD. No vault has paid a yield since. A setter
 * fixes the cause but cannot fix the deployed instance, and `StKLD.kldVault` is
 * immutable too, so both contracts are replaced and the balances rebuilt.
 *
 * THE ORDER IS THE SAFETY, and it is not the obvious one:
 *
 *   1. PAUSE THE OLD VAULT FIRST. A snapshot is a point in time and the old
 *      vault is live; a deposit landing between the snapshot and the credit
 *      would mint old stKLD to someone who is not on the list, and they would
 *      be silently left behind. Pausing gates deposit, withdraw, request and
 *      cancel, so the state cannot move once the list is taken.
 *   2. RE-VERIFY the snapshot against the chain immediately before crediting,
 *      rather than trusting the file. The file is cheap to regenerate; a stale
 *      one is the single most expensive mistake available here.
 *   3. FUND BEFORE CREDITING. `migrateIn` closes with a require comparing what
 *      the vault holds against everything it has promised, so the transfer has
 *      to land first. This is what makes an owner-callable mint acceptable: it
 *      cannot promise what is not already there.
 *   4. FINALIZE. `migrateIn` is a migration step, not a standing privilege.
 *
 * WHAT IS DELIBERATELY LEFT BEHIND. The old vault's KLD stays in the old vault
 * forever. It has no owner-level exit - the only transfer out sits inside
 * per-user `withdraw()` - so nobody can retrieve it, us included. That is the
 * accepted cost of not making 46 testers each wait out a 7-day cooldown, and it
 * is testnet KLD from a 957M deployer balance. It is not a rounding error to be
 * glossed over: say it plainly wherever this migration is reported.
 */
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

const DRY = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";
const BATCH = 20; // holders per migrateIn call, to stay well inside a block

const f = (x) =>
  Number(ethers.formatUnits(x, 18)).toLocaleString(undefined, {
    maximumFractionDigits: 6,
  });

async function main() {
  const net = network.name;
  const [deployer] = await ethers.getSigners();
  console.log(
    `\n${DRY ? "DRY RUN - nothing is sent" : "LIVE"}   network ${net}   deployer ${deployer.address}\n`,
  );

  const record = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", `deployment-kld-${net}.json`), "utf8"),
  );
  const { KLD: kldAddr, KLDVault: oldVaultAddr, stKLD: oldStkldAddr } = record.contracts;

  const snapPath = path.join(__dirname, "..", `snapshot-stakers-${net}.json`);
  if (!fs.existsSync(snapPath))
    throw new Error(`No snapshot. Run snapshot-stakers.mjs ${net} first.`);
  const snap = JSON.parse(fs.readFileSync(snapPath, "utf8"));
  if (!snap.totals.agree)
    throw new Error("Snapshot did not reconcile - refusing to migrate from it.");
  if (snap.oldVault.toLowerCase() !== oldVaultAddr.toLowerCase())
    throw new Error("Snapshot is for a different vault.");

  /* The live treasury, read from the generated registry rather than the stale
     value in the KLD deployment record - that record's `yieldTreasury` is the
     dead address this whole migration exists to escape. */
  const gen = fs.readFileSync(
    path.join(__dirname, "..", "..", "src", "constants", "deployments.generated.ts"),
    "utf8",
  );
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const section = gen.slice(gen.indexOf(`${chainId}:`));
  const treasury = (section.match(/yieldTreasury: "(0x[0-9a-fA-F]{40})"/) || [])[1];
  if (!treasury) throw new Error(`No yieldTreasury in the registry for chain ${chainId}`);
  console.log(`live treasury (registry) : ${treasury}`);

  const kld = await ethers.getContractAt("KLD", kldAddr);
  const oldVault = await ethers.getContractAt("KLDVaultV2", oldVaultAddr);
  const oldStkld = await ethers.getContractAt("StKLD", oldStkldAddr);

  console.log(`old vault stale pointer  : ${await oldVault.yieldTreasury()}`);

  // ---- 1. freeze the old set ----------------------------------------------
  const alreadyPaused = await oldVault.paused();
  console.log(
    `\n1. freeze old vault      : ${alreadyPaused ? "already paused" : DRY ? "would pause()" : "pausing..."}`,
  );
  if (!alreadyPaused && !DRY) await (await oldVault.pause()).wait();

  // ---- 2. re-verify the snapshot against the chain -------------------------
  console.log(`2. re-verify ${snap.holders.length} holders against the chain`);
  let sum = 0n;
  let drifted = 0;
  for (const h of snap.holders) {
    const live = await oldStkld.balanceOf(h.holder);
    if (live.toString() !== h.amount) {
      drifted++;
      console.log(`     DRIFT ${h.holder}  file ${f(h.amount)}  chain ${f(live)}`);
    }
    sum += BigInt(h.amount);
  }
  const supply = await oldStkld.totalSupply();
  const vaultKld = await kld.balanceOf(oldVaultAddr);
  console.log(`   sum ${f(sum)} | supply ${f(supply)} | old vault KLD ${f(vaultKld)}`);
  if (drifted > 0)
    throw new Error(`${drifted} balance(s) moved since the snapshot - retake it.`);
  if (sum !== supply || supply !== vaultKld)
    throw new Error("Totals disagree - retake the snapshot.");
  console.log(`   reconciles exactly`);

  const bal = await kld.balanceOf(deployer.address);
  console.log(`3. deployer holds ${f(bal)} KLD, needs ${f(sum)}`);
  if (bal < sum) throw new Error("Deployer cannot fund the new vault.");

  if (DRY) {
    console.log(
      `\nWould then: deploy vault(${treasury}) + stKLD, wire, transfer ${f(sum)} KLD,`,
    );
    console.log(
      `credit ${snap.holders.length} holders in ${Math.ceil(snap.holders.length / BATCH)} batch(es), finalize.`,
    );
    console.log(
      `\nThe old vault's ${f(vaultKld)} KLD stays there permanently - it has no owner exit.\n`,
    );
    return;
  }

  // ---- 4. deploy + wire ----------------------------------------------------
  const vault = await (await ethers.getContractFactory("KLDVaultV2")).deploy(treasury);
  await vault.waitForDeployment();
  const vaultAddr = await vault.getAddress();
  const stkld = await (await ethers.getContractFactory("StKLD")).deploy(vaultAddr, kldAddr);
  await stkld.waitForDeployment();
  const stkldAddr = await stkld.getAddress();
  console.log(`\n4. new vault ${vaultAddr}\n   new stKLD ${stkldAddr}`);

  await (await vault.setStKLD(stkldAddr)).wait();
  await (await vault.setSupport(kldAddr, true)).wait();

  // ---- 5. fund, then credit ------------------------------------------------
  await (await kld.transfer(vaultAddr, sum)).wait();
  console.log(`5. funded with ${f(sum)} KLD`);

  for (let i = 0; i < snap.holders.length; i += BATCH) {
    const slice = snap.holders.slice(i, i + BATCH);
    await (
      await vault.migrateIn(
        kldAddr,
        slice.map((h) => h.holder),
        slice.map((h) => h.amount),
      )
    ).wait();
    console.log(`   credited ${Math.min(i + BATCH, snap.holders.length)}/${snap.holders.length}`);
  }
  await (await vault.finalizeMigration()).wait();
  console.log(`6. migration finalized`);

  // ---- 7. verify every position landed -------------------------------------
  let bad = 0;
  for (const h of snap.holders) {
    const got = await stkld.balanceOf(h.holder);
    if (got.toString() !== h.amount) {
      bad++;
      console.log(`   WRONG ${h.holder} expected ${f(h.amount)} got ${f(got)}`);
    }
  }
  const newSupply = await stkld.totalSupply();
  const newBacking = await kld.balanceOf(vaultAddr);
  console.log(`\n7. ${snap.holders.length - bad}/${snap.holders.length} positions exact`);
  console.log(`   new stKLD supply ${f(newSupply)} | new vault KLD ${f(newBacking)}`);
  if (bad > 0 || newSupply !== sum || newBacking < newSupply)
    throw new Error("Post-migration verification FAILED.");

  const out = path.join(__dirname, "..", `deployment-staking-${net}.json`);
  fs.writeFileSync(
    out,
    JSON.stringify(
      {
        network: net,
        chainId,
        timestamp: new Date().toISOString(),
        deployer: deployer.address,
        contracts: { KLD: kldAddr, KLDVault: vaultAddr, stKLD: stkldAddr },
        config: { yieldTreasury: treasury },
        migratedFrom: {
          vault: oldVaultAddr,
          stKLD: oldStkldAddr,
          holders: snap.holders.length,
          amount: sum.toString(),
          strandedInOldVault: vaultKld.toString(),
        },
      },
      null,
      2,
    ),
  );
  console.log(`   wrote ${path.basename(out)}\n`);
  console.log(
    `REMEMBER: the old vault still holds ${f(vaultKld)} KLD and nobody can retrieve it.\n`,
  );
}

main().catch((e) => {
  console.error("\nFAILED:", e.message);
  process.exit(1);
});
