/**
 * Exercise kafUSD: lock every supported asset, then open the one withdrawal
 * clock the contract allows.
 *
 *   npx hardhat run scripts/exercise-kafusd.js --network sepolia
 *   AMOUNT=100 REQUEST=kfUSD npx hardhat run scripts/exercise-kafusd.js --network baseTestnet
 *   WITHDRAW=1 REQUEST=kfUSD npx hardhat run scripts/exercise-kafusd.js --network sepolia
 *
 * kafUSD takes the widest asset set of any product — USDC, USDT, USDe and kfUSD
 * on every chain — and, like kfUSD, consults no oracle, so it is live on all five
 * chains including the three whose lending oracles are dead. That makes the
 * per-asset loop the substance of the run.
 *
 * Two structural facts shape what this script can do, and both are worth having
 * on the record rather than discovered halfway through a manual attempt:
 *
 *   1. `lockAssets` mints kafUSD 1:1 against the *raw* amount, with no decimal
 *      normalisation — `kafusdToMint = _amount`, and the `if (_asset != kfusd)`
 *      branch assigns the same value again. kafUSD is 18dp, so locking 1000 USDC
 *      (1e9 raw) mints 1e9 wei of kafUSD, which is 0.000000001 kafUSD, while
 *      locking 1000 USDe (1e21 raw) mints 1000. The round trip is symmetric —
 *      `completeWithdrawal` unlocks the same raw number — so nothing is lost and
 *      no cross-asset drain is possible (`assetLockBalances` is per asset), but
 *      the kafUSD a 6dp depositor receives is a millionth of a millionth of what
 *      they should hold. This script reports minted-versus-expected for every
 *      asset so the size of that gap is measured per decimal class.
 *
 *   2. There is one clock and one `withdrawalAmount` per *user*, not per asset:
 *      `requestWithdrawal` overwrites both. So a second request cancels the
 *      first, and only one asset can be unlocked per cooldown. Every asset is
 *      therefore locked, but exactly one request is opened — for REQUEST, default
 *      kfUSD — and it is left running, because `cooldownPeriod` is 7 days and
 *      lowering it is deliberately out of scope.
 *
 * WITHDRAW=1 runs the day-7 leg: `completeWithdrawal(REQUEST)`.
 */

const hre = require("hardhat");
const { ethers } = hre;
const { registryFor } = require("./libraries/registry.js");

const KAFUSD_ABI = [
  "function lockAssets(address,uint256)",
  "function requestWithdrawal(uint256)",
  "function completeWithdrawal(address)",
  "function getSupportedAssets() view returns (address[])",
  "function supportedAssets(address) view returns (bool)",
  "function assetLockBalances(address,address) view returns (uint256)",
  "function lockBalances(address) view returns (uint256)",
  "function totalLocked() view returns (uint256)",
  "function totalAssetsLocked() view returns (uint256)",
  "function withdrawalRequestTime(address) view returns (uint256)",
  "function withdrawalAmount(address) view returns (uint256)",
  "function getWithdrawalTime(address) view returns (uint256)",
  "function cooldownPeriod() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function paused() view returns (bool)",
];

const ERC20_ABI = [
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

const f18 = (v) => ethers.formatUnits(v, 18);
const days = (s) => (Number(s) / 86400).toFixed(2);

async function main() {
  const [signer] = await ethers.getSigners();
  const me = await signer.getAddress();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const reg = registryFor(chainId);
  if (!reg.kafUSD) throw new Error(`no kafUSD on chain ${chainId}`);

  const kaf = new ethers.Contract(reg.kafUSD, KAFUSD_ABI, signer);
  console.log(`\n=== ${hre.network.name}: kafUSD ${reg.kafUSD} ===`);
  if (await kaf.paused()) throw new Error("kafUSD is paused");

  const cooldown = await kaf.cooldownPeriod();
  console.log(
    `cooldownPeriod ${days(cooldown)} days  supply ${f18(await kaf.totalSupply())}  totalAssetsLocked ${await kaf.totalAssetsLocked()} (raw, mixed decimals)`,
  );

  const requestKey = process.env.REQUEST ?? "kfUSD";
  const requestAddr = (reg[requestKey] ?? requestKey).toLowerCase();

  /* ------------------------------------------------------- the day-7 leg ---- */
  if (process.env.WITHDRAW === "1") {
    const [left, amt] = await Promise.all([kaf.getWithdrawalTime(me), kaf.withdrawalAmount(me)]);
    console.log(`open request for ${amt} raw kafUSD, ${Number(left) / 3600}h left`);
    if (amt === 0n) throw new Error("no open withdrawal request");
    if (left > 0n) throw new Error(`cooldown has ${Number(left) / 3600}h to run`);
    const t = new ethers.Contract(requestAddr, ERC20_ABI, signer);
    const before = await t.balanceOf(me);
    await kaf.completeWithdrawal.staticCall(requestAddr);
    const tx = await kaf.completeWithdrawal(requestAddr);
    const rc = await tx.wait();
    const d = Number(await t.decimals());
    console.log(
      `completeWithdrawal  tx ${tx.hash}  gas ${rc.gasUsed}  +${ethers.formatUnits((await t.balanceOf(me)) - before, d)} ${await t.symbol()}`,
    );
    return;
  }

  const assets = await kaf.getSupportedAssets();
  console.log(`${assets.length} supported asset(s)`);
  const whole = process.env.AMOUNT ?? "100";
  const rows = [];

  for (const addr of assets) {
    const t = new ethers.Contract(addr, ERC20_ABI, signer);
    let symbol, dec;
    try {
      [symbol, dec] = [await t.symbol(), Number(await t.decimals())];
    } catch {
      console.log(`\n-- ${addr}: not a readable ERC20, skipped`);
      continue;
    }
    const amount = ethers.parseUnits(whole, dec);
    const held = await t.balanceOf(me);
    console.log(`\n-- ${symbol} (${dec}dp) ${addr}`);
    if (held < amount) {
      console.log(`   short: have ${ethers.formatUnits(held, dec)}, need ${whole} — skipped`);
      rows.push({ symbol, dec, status: "skipped, no balance" });
      continue;
    }

    if ((await t.allowance(me, reg.kafUSD)) < amount) {
      const tx = await t.approve(reg.kafUSD, amount);
      await tx.wait();
      console.log(`   approved ${symbol}`);
    }

    const kafBefore = await kaf.balanceOf(me);
    const tx = await kaf.lockAssets(addr, amount);
    const rc = await tx.wait();
    const minted = (await kaf.balanceOf(me)) - kafBefore;
    const locked = await kaf.assetLockBalances(me, addr);

    /* What an 18dp-normalising implementation would have minted, for comparison.
     * Equal for 18dp assets by definition, which is why the defect is invisible
     * until a 6dp asset is locked. */
    const shouldMint = amount * 10n ** BigInt(18 - dec);
    console.log(`   lockAssets ${whole} ${symbol}  tx ${tx.hash}  gas ${rc.gasUsed}`);
    console.log(
      `     minted ${f18(minted)} kafUSD   would-be-correct ${f18(shouldMint)}` +
        (minted === shouldMint ? "  (equal — 18dp asset)" : `  SHORT BY 10^${18 - dec}`),
    );
    console.log(`     assetLockBalances[${symbol}] = ${locked} raw`);
    rows.push({ symbol, dec, addr, status: "locked", minted, shouldMint, locked });
  }

  /* -------------------------------------- one request, for one asset only --- */
  const target = rows.find((r) => r.addr && r.addr.toLowerCase() === requestAddr) ?? rows.find((r) => r.addr);
  if (!target) {
    console.log("\nnothing was locked, so there is nothing to request against");
    return;
  }
  /* Request exactly the chosen asset's locked raw balance: completeWithdrawal
   * checks assetLockBalances[user][asset] >= withdrawalAmount, so a request sized
   * from the whole kafUSD balance would be unfillable by any single asset. */
  const ask = target.locked;
  console.log(
    `\nrequestWithdrawal(${ask}) — sized to ${target.symbol}'s locked balance, not the kafUSD balance`,
  );
  console.log(`  kafUSD held ${f18(await kaf.balanceOf(me))} (across every asset locked above)`);
  await kaf.requestWithdrawal.staticCall(ask);
  const tx = await kaf.requestWithdrawal(ask);
  const rc = await tx.wait();
  console.log(`  requested  tx ${tx.hash}  gas ${rc.gasUsed}`);
  const left = await kaf.getWithdrawalTime(me);
  console.log(`  completeWithdrawal becomes callable in ${(Number(left) / 3600).toFixed(1)}h. Then:`);
  console.log(
    `    WITHDRAW=1 REQUEST=${requestKey} npx hardhat run scripts/exercise-kafusd.js --network ${hre.network.name}`,
  );

  /* Which assets could satisfy the request that is now open. `completeWithdrawal`
   * takes the asset as a *parameter* and checks only
   * `assetLockBalances[user][asset] >= withdrawalAmount` — the request itself
   * records no asset. So any asset whose locked raw balance covers the number can
   * be the one that pays, and assets of equal decimals are freely substitutable
   * regardless of what they are worth. Measurable now, from state: the cooldown is
   * the first require, so a static call would only ever report the cooldown. */
  const ask18 = await kaf.withdrawalAmount(me);
  const fillable = [];
  for (const r of rows)
    if (r.addr && (await kaf.assetLockBalances(me, r.addr)) >= ask18) fillable.push(r.symbol);
  console.log(
    `\nthe open request for ${ask18} raw could be filled from ${fillable.length} of ${rows.filter((r) => r.addr).length} locked asset(s): ${fillable.join(", ") || "none"}`,
  );
  if (fillable.length > 1)
    console.log(
      `  substitutable — the request names no asset, so any of these can pay it out`,
    );

  console.log("\n-- summary: kafUSD minted per asset --");
  for (const r of rows)
    console.log(
      `  ${r.symbol} (${r.dec}dp): ${r.status}` +
        (r.minted !== undefined
          ? `  minted ${f18(r.minted)} vs ${f18(r.shouldMint)} expected`
          : ""),
    );
  console.log(
    `  totalAssetsLocked ${await kaf.totalAssetsLocked()} raw — a sum across 6dp and 18dp assets, so not a dollar figure`,
  );
}

main().catch((e) => {
  console.error("KAFUSD EXERCISE FAILED:", e.shortMessage || e.message || e);
  process.exit(1);
});
