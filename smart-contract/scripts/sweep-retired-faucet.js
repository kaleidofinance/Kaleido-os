/**
 * Recover the balance of a faucet that a redeploy left behind.
 *
 *   FAUCET_DRY_RUN=1 npx hardhat run scripts/sweep-retired-faucet.js --network robinhoodTestnet
 *   npx hardhat run scripts/sweep-retired-faucet.js --network robinhoodTestnet
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * `FORCE_REDEPLOY` in deploy-faucet.js moves the assets the PLAN lists. Anything
 * some other script listed is invisible to it, so a redeploy silently drops
 * exactly the assets it does not know about — and the old contract keeps their
 * stock forever, because nothing ever delists and nothing sweeps.
 *
 * Measured on Robinhood 2026-08-30, six days after its 2026-08-29 redeploy:
 *
 *   old faucet 0xB22E458D…7d51   USDC 0   USDT 0   USDe 0   WETH 0   KLD 5,000,000
 *
 * Four rows at zero and one at full stock is not a partial migration, it is a
 * selective one: `deploy-kld.js` had listed and stocked KLD as its own last step
 * and recorded that only in the KLD record, so `FAUCET_PLANS` did not mention it
 * and the redeploy had no way to carry it. The new faucet listed five assets and
 * no KLD at all until `FAUCET_EXTEND` put it back from the deployer's own supply,
 * which left the old 5,000,000 stranded and this script is the other half.
 *
 * ── What it will not do ─────────────────────────────────────────────────────
 *
 * It refuses to run against the faucet the deployment record calls live. Sweeping
 * `withdraw(token, to, 0)` on the working faucet would empty every row on /faucet
 * in one transaction, and "retired" vs "live" is one character of address apart in
 * a plan a human types. The record is the authority on which is which.
 *
 * It also probes the retired contract's DEPLOYED bytecode for `withdraw` before
 * sending anything, with the freshly compiled artifact as the control. The
 * two-asset faucet had no withdraw at all (Faucet.sol:373), so a retired-enough
 * faucet can be one whose funds are genuinely unreachable, and that deserves a
 * clear error rather than a reverted transaction. Native is probed separately:
 * `withdraw`'s native branch and `receive()` arrived together, so on pre-native
 * bytecode `withdraw(address(1), …)` would fall through to
 * `IERC20(address(1)).balanceOf` — the ecrecover precompile — and revert.
 */

const fs = require("fs");
const hre = require("hardhat");
const { ethers } = hre;

const NATIVE_TOKEN = "0x0000000000000000000000000000000000000001";
const WITHDRAW_SIGNATURE = "withdraw(address,address,uint256)";
const NATIVE_ERROR_SIGNATURE = "KaleidoTokenFaucet_NativeTransferFailed()";

/**
 * One entry per chain that has a faucet worth emptying.
 *
 * `retired` is the address to drain; `record` is the live faucet's deployment
 * record, used both as the safety check above and as where the sweep is written
 * down. `kldRecord` is optional and only matters when the stranded asset is KLD:
 * `deploy-kld.js` writes a `faucet` leg naming the faucet it stocked, and after a
 * redeploy that leg points at a contract which — once this script runs — holds
 * nothing, while still reporting `fundedHuman: "5000000.0"`. A stale record reads
 * as a measurement, so the pointer is repaired rather than left to mislead.
 */
const SWEEPS = {
  46630: {
    label: "Robinhood Chain Testnet",
    retired: "0xB22E458D277a55f535873a02Ef77c569cC4F7d51",
    record: "deployment-faucet-robinhoodTestnet.json",
    kldRecord: "deployment-kld-robinhoodTestnet.json",
    why: "retired by the 2026-08-29 native-support redeploy, which carried every asset except the KLD deploy-kld.js had listed",
  },
};

const ERC20 = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
];

const FAUCET = [
  "function owner() view returns (address)",
  "function assetInfo(address user) view returns (address[] tokens,uint256[] amounts,uint256[] balances,uint256[] nextClaimAt)",
  "function withdraw(address token,address to,uint256 amount) external",
];

/** True if `selector`'s function/error is in the deployed code. Throws if the artifact lacks it. */
function hasSelector(deployedCode, artifactBytecode, signature) {
  const selector = ethers.id(signature).slice(2, 10);
  if (!artifactBytecode.includes(selector)) {
    throw new Error(
      `The compiled KaleidoTokenFaucet artifact does not contain ${signature} ` +
        `(selector ${selector}). The artifact is this probe's control: without it, ` +
        `"absent from the deployed code" would mean nothing. Check the signature ` +
        `against contracts/Faucet.sol before trusting any result here.`,
    );
  }
  return deployedCode.includes(selector);
}

async function main() {
  const dryRun = process.env.FAUCET_DRY_RUN === "1";
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);
  const plan = SWEEPS[chainId];

  if (!plan) {
    throw new Error(
      `No sweep plan for chain ${chainId}. This script only covers ${Object.keys(SWEEPS).join(", ")}.`,
    );
  }

  const [signer] = await ethers.getSigners();
  const to = signer.address;
  const record = JSON.parse(fs.readFileSync(plan.record, "utf8"));
  const liveFaucet = record.contracts?.faucet;

  if (!liveFaucet) {
    throw new Error(`${plan.record} carries no contracts.faucet, so "live" cannot be established.`);
  }
  if (liveFaucet.toLowerCase() === plan.retired.toLowerCase()) {
    throw new Error(
      `${plan.retired} is the LIVE faucet according to ${plan.record}. Sweeping it would ` +
        `empty every row on /faucet in one transaction. Refusing.`,
    );
  }

  console.log(`\n${plan.label} (${chainId})${dryRun ? "  — DRY RUN, nothing is sent" : ""}`);
  console.log(`  retired  ${plan.retired}`);
  console.log(`  live     ${liveFaucet}  (left alone)`);
  console.log(`  to       ${to}`);
  console.log(`  why      ${plan.why}`);

  /* ── Can this contract give anything back at all? ───────────────────────── */

  const Faucet = await ethers.getContractFactory("KaleidoTokenFaucet");
  const code = await ethers.provider.getCode(plan.retired);
  if (code === "0x") {
    throw new Error(`${plan.retired} holds no code on chain ${chainId}.`);
  }

  const canWithdraw = hasSelector(code, Faucet.bytecode, WITHDRAW_SIGNATURE);
  const canWithdrawNative = hasSelector(code, Faucet.bytecode, NATIVE_ERROR_SIGNATURE);
  console.log(`  bytecode ${(code.length - 2) / 2} bytes — withdraw ${canWithdraw ? "yes" : "NO"}, native branch ${canWithdrawNative ? "yes" : "no"}`);

  if (!canWithdraw) {
    throw new Error(
      `${plan.retired} has no withdraw(address,address,uint256). This is the pre-withdraw ` +
        `faucet (Faucet.sol:373) and its balance is genuinely unreachable — nothing this ` +
        `script can send would recover it.`,
    );
  }

  const faucet = new ethers.Contract(plan.retired, FAUCET, signer);
  const owner = await faucet.owner();
  if (owner.toLowerCase() !== to.toLowerCase()) {
    throw new Error(`withdraw is onlyOwner; retired faucet's owner is ${owner}, signer is ${to}`);
  }

  /* ── What is left in it? ────────────────────────────────────────────────────
   *
   * Read from `assetInfo` rather than from the record: the point of this script is
   * assets the record never knew about, so a plan-driven list would miss exactly
   * the ones worth sweeping. `balances` is the faucet's own holding per listed
   * asset, which is the number that matters.
   */

  const info = await faucet.assetInfo(to);
  const nativeLeft = await ethers.provider.getBalance(plan.retired);
  const found = [];

  console.log(`\n  ${info.tokens.length} asset(s) listed:`);
  for (let i = 0; i < info.tokens.length; i++) {
    const address = info.tokens[i];
    const balance = info.balances[i];

    if (address.toLowerCase() === NATIVE_TOKEN) continue; // handled below, via getBalance

    const erc20 = new ethers.Contract(address, ERC20, ethers.provider);
    const [symbol, decimals] = await Promise.all([
      erc20.symbol().catch(() => "?"),
      erc20.decimals().then(Number).catch(() => 18),
    ]);

    if (balance === 0n) {
      console.log(`    ${symbol.padEnd(7)} empty`);
      continue;
    }
    console.log(`    ${symbol.padEnd(7)} ${ethers.formatUnits(balance, decimals)}  <- sweep`);
    found.push({ symbol, address, decimals, balance });
  }

  if (nativeLeft > 0n) {
    console.log(
      `    native  ${ethers.formatEther(nativeLeft)}` +
        (canWithdrawNative
          ? "  <- sweep"
          : "  NOT SWEPT — this bytecode has no native branch, see the header"),
    );
  } else {
    console.log(`    native  0`);
  }
  const sweepNative = nativeLeft > 0n && canWithdrawNative;

  if (found.length === 0 && !sweepNative) {
    console.log(`\n  Nothing to sweep — ${plan.retired} is already empty.\n`);
    return;
  }

  if (dryRun) {
    console.log(
      `\n  DRY RUN: would send ${found.length + (sweepNative ? 1 : 0)} withdraw ` +
        `transaction(s) to ${to}, then write ${plan.record}` +
        `${plan.kldRecord ? ` and possibly ${plan.kldRecord}` : ""}.\n`,
    );
    return;
  }

  /* ── Sweep ─────────────────────────────────────────────────────────────────
   *
   * One transaction per asset, and `amount` 0 so the contract reads its own
   * balance at execution time — a figure measured here could be stale by a claim
   * (the faucet is still live for anyone holding its address) and an over-ask
   * reverts the whole sweep.
   *
   * No retry on timeout. A ConnectTimeout is a client-side event: the withdraw may
   * well have landed, and a blind resend of a whole-balance sweep is harmless only
   * by luck. If this throws, re-read the balances before acting.
   */

  const swept = [];
  for (const asset of found) {
    console.log(`\n  withdrawing ${ethers.formatUnits(asset.balance, asset.decimals)} ${asset.symbol}…`);
    const tx = await faucet.withdraw(asset.address, to, 0);
    console.log(`  tx ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`  mined in block ${receipt.blockNumber}, gas ${receipt.gasUsed}`);
    swept.push({
      symbol: asset.symbol,
      address: asset.address,
      amount: ethers.formatUnits(asset.balance, asset.decimals),
      tx: tx.hash,
    });
  }

  if (sweepNative) {
    console.log(`\n  withdrawing ${ethers.formatEther(nativeLeft)} native…`);
    const tx = await faucet.withdraw(NATIVE_TOKEN, to, 0);
    console.log(`  tx ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`  mined in block ${receipt.blockNumber}, gas ${receipt.gasUsed}`);
    swept.push({
      symbol: "native",
      address: NATIVE_TOKEN,
      amount: ethers.formatEther(nativeLeft),
      tx: tx.hash,
    });
  }

  /* ── Read back ─────────────────────────────────────────────────────────────*/

  console.log("\n  verified on chain:");
  for (const asset of found) {
    const erc20 = new ethers.Contract(asset.address, ERC20, ethers.provider);
    const [left, mine] = await Promise.all([
      erc20.balanceOf(plan.retired),
      erc20.balanceOf(to),
    ]);
    console.log(
      `    ${asset.symbol.padEnd(7)} retired ${ethers.formatUnits(left, asset.decimals)}  ` +
        `deployer ${ethers.formatUnits(mine, asset.decimals)}`,
    );
  }
  if (sweepNative) {
    console.log(`    native  retired ${ethers.formatEther(await ethers.provider.getBalance(plan.retired))}`);
  }

  /* ── Write it down ─────────────────────────────────────────────────────────
   *
   * On the LIVE faucet's record, under a top-level key deploy-faucet.js does not
   * own — so a later FAUCET_EXTEND carries it forward through `foreignKeys`
   * instead of dropping it. This is the only place a retired faucet is recorded
   * at all: nothing else in the repo names 0xB22E458D…, which is how 5,000,000
   * KLD sat in it unnoticed for six days.
   */

  const now = new Date().toISOString();
  record.retiredFaucets = [
    ...(record.retiredFaucets ?? []).filter(
      (r) => String(r.address).toLowerCase() !== plan.retired.toLowerCase(),
    ),
    {
      address: plan.retired,
      why: plan.why,
      sweptAt: now,
      sweptTo: to,
      assets: swept,
      nativeLeft: canWithdrawNative ? "0.0" : ethers.formatEther(nativeLeft),
      ...(canWithdrawNative
        ? {}
        : { nativeNote: "no native branch in this bytecode — any native balance is unreachable" }),
    },
  ];

  fs.writeFileSync(plan.record, JSON.stringify(record, null, 2));
  console.log(`\n  Saved ${plan.record} (retiredFaucets).`);

  /* The KLD record's `faucet` leg, only when it still names the address we just
     emptied. Guarded on an exact match so this is a no-op everywhere else. */
  if (plan.kldRecord && fs.existsSync(plan.kldRecord)) {
    const kld = JSON.parse(fs.readFileSync(plan.kldRecord, "utf8"));
    if (String(kld.faucet?.address).toLowerCase() === plan.retired.toLowerCase()) {
      kld.faucet.previousAddress = kld.faucet.address;
      kld.faucet.address = liveFaucet;
      kld.faucet.note =
        `Faucet redeployed ${record.timestamp}; the 5,000,000 this script had stocked stayed ` +
        `in ${plan.retired} until it was swept back to the deployer on ${now}. The same amount ` +
        `and drip were re-listed on ${liveFaucet} by FAUCET_EXTEND, so the figures above still ` +
        `describe what the live faucet holds — only the address moved.`;
      fs.writeFileSync(plan.kldRecord, JSON.stringify(kld, null, 2));
      console.log(`  Saved ${plan.kldRecord} (faucet.address -> the live faucet).`);
    }
  }

  console.log(
    `\n  The live faucet was not touched, and no address changed, so no gen:registry.\n`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
