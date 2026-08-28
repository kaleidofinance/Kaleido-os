/**
 * Exercise the staking vault through the four writes the Stake page sends.
 *
 *   npx hardhat run scripts/exercise-staking.js --network sepolia
 *   AMOUNT=100000 npx hardhat run scripts/exercise-staking.js --network baseTestnet
 *
 * Order, and why this order:
 *
 *   1. approve + deposit(KLD, AMOUNT)      — mints stKLD shares
 *   2. requestWithdrawal()                 — starts the 7-day clock
 *   3. cancelWithdrawalRequest()           — clears it, proving the escape hatch
 *   4. requestWithdrawal()                 — starts a fresh clock, left running
 *
 * Step 4 is deliberately left open. `withdraw` is gated on
 * `WITHDRAWAL_WAITING_PERIOD`, a 7-day *constant* — not an owner-settable
 * parameter — so there is no way to shorten it and no way to complete a real
 * withdrawal today. Leaving a request armed means the withdraw leg is reachable
 * on day 7 with a single call and no further setup; ending the run with the
 * clock cancelled would waste the week.
 *
 * Each write is preceded by the same `staticCall` the hooks in
 * `src/hooks/useStake.ts`, `useRequestWithdrawal.ts`, `useCancelWithdrawalRequest.ts`
 * and `useWithdrawStake.ts` make before sending, so a revert surfaces as the
 * vault's own custom error rather than a consumed-gas failure.
 *
 * The vault is single-asset by construction — `setSupport` refuses anything but
 * stKLD's own `kldToken()` — so there is no per-asset loop here and no missing
 * coverage from its absence. That is checked on-chain at the top rather than
 * assumed from reading the setter: `supportedTokens` is asked about every asset
 * the registry names, and a YES on anything other than KLD would be news.
 *
 * WITHDRAW=1 skips steps 1-4 and instead attempts `withdraw(KLD, AMOUNT)`. That
 * is the day-7 leg; run it once the clock from step 4 has elapsed.
 */

const hre = require("hardhat");
const { ethers } = hre;
const { registryFor } = require("./libraries/registry.js");

const VAULT_ABI = [
  "function deposit(address,uint256)",
  "function withdraw(address,uint256)",
  "function requestWithdrawal()",
  "function cancelWithdrawalRequest()",
  "function supportedTokens(address) view returns (bool)",
  "function stKLD() view returns (address)",
  "function totalPooledKLD(address) view returns (uint256)",
  "function getTotalStakers() view returns (uint256)",
  "function hasWithdrawalRequest(address) view returns (bool)",
  "function getWithdrawalTimeLeft(address) view returns (uint256)",
  "function WITHDRAWAL_WAITING_PERIOD() view returns (uint256)",
  "function paused() view returns (bool)",
];

const STKLD_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function sharesOf(address) view returns (uint256)",
  "function getTotalShares() view returns (uint256)",
  "function getPooledKldByShares(uint256) view returns (uint256)",
  "function kldToken() view returns (address)",
];

const ERC20_ABI = [
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

const ASSET_KEYS = ["wrappedNative", "usdc", "usdt", "usde", "kld", "stKLD", "kfUSD", "kafUSD"];

const f18 = (v) => ethers.formatUnits(v, 18);
const hrs = (s) => `${Math.floor(Number(s) / 3600)}h ${Math.floor((Number(s) % 3600) / 60)}m`;

async function main() {
  const [signer] = await ethers.getSigners();
  const me = await signer.getAddress();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const reg = registryFor(chainId);
  if (!reg.kldVault) throw new Error(`no kldVault on chain ${chainId}`);
  if (!reg.kld) throw new Error(`no kld on chain ${chainId}`);

  const vault = new ethers.Contract(reg.kldVault, VAULT_ABI, signer);
  const stkld = new ethers.Contract(await vault.stKLD(), STKLD_ABI, ethers.provider);
  const kld = new ethers.Contract(reg.kld, ERC20_ABI, signer);
  const amount = ethers.parseUnits(process.env.AMOUNT ?? "100000", 18);

  console.log(`\n=== ${hre.network.name}: staking vault ${reg.kldVault} ===`);
  console.log(`stKLD ${await stkld.getAddress()}   kldToken ${await stkld.kldToken()}`);
  if (await vault.paused()) throw new Error("vault is paused — nothing to exercise");

  /* ---------------------------------------- single-asset, proven not assumed -- */
  const supported = [];
  for (const k of ASSET_KEYS) {
    if (!reg[k]) continue;
    if (await vault.supportedTokens(reg[k])) supported.push(`${k} (${reg[k]})`);
  }
  console.log(`supportedTokens YES for: ${supported.join(", ") || "(none)"}`);
  if (supported.length !== 1 || !supported[0].startsWith("kld"))
    console.log("  ^ unexpected: the vault should accept KLD and nothing else");

  const period = await vault.WITHDRAWAL_WAITING_PERIOD();
  console.log(`waiting period ${Number(period) / 86400} days (constant, not settable)`);

  const show = async (label) => {
    const [shares, bal, pooled, stakers, has, left] = await Promise.all([
      stkld.sharesOf(me),
      stkld.balanceOf(me),
      vault.totalPooledKLD(reg.kld),
      vault.getTotalStakers(),
      vault.hasWithdrawalRequest(me),
      vault.getWithdrawalTimeLeft(me),
    ]);
    console.log(
      `   ${label}: shares ${f18(shares)}  stKLD ${f18(bal)}  pooled ${f18(pooled)}  stakers ${stakers}  request ${
        has ? `open, ${hrs(left)} left` : "none"
      }`,
    );
    return { shares, bal, pooled, has, left };
  };

  const send = async (label, fn, ...args) => {
    await vault[fn].staticCall(...args); // the hooks' own pre-flight
    const tx = await vault[fn](...args);
    const rc = await tx.wait();
    console.log(`   ${label}  tx ${tx.hash}  gas ${rc.gasUsed}`);
  };

  /* ------------------------------------------------------ the day-7 leg ----- */
  if (process.env.WITHDRAW === "1") {
    console.log("\nWITHDRAW=1 — attempting the day-7 leg");
    const before = await show("before");
    if (!before.has) throw new Error("no open withdrawal request — nothing to withdraw against");
    if (before.left > 0n) throw new Error(`cooldown has ${hrs(before.left)} to run`);
    const kldBefore = await kld.balanceOf(me);
    await send(`withdraw ${f18(amount)} KLD`, "withdraw", reg.kld, amount);
    const kldAfter = await kld.balanceOf(me);
    console.log(`   wallet KLD +${f18(kldAfter - kldBefore)}`);
    await show("after");
    return;
  }

  /* --------------------------------------------------------- 1. deposit ----- */
  const held = await kld.balanceOf(me);
  if (held < amount)
    throw new Error(`short of KLD: have ${f18(held)}, need ${f18(amount)}`);

  console.log(`\n1. deposit ${f18(amount)} KLD`);
  const start = await show("before");
  if ((await kld.allowance(me, reg.kldVault)) < amount) {
    const tx = await kld.approve(reg.kldVault, amount);
    await tx.wait();
    console.log(`   approved  tx ${tx.hash}`);
  }
  await send("deposited", "deposit", reg.kld, amount);
  const afterDeposit = await show("after");

  /* The first deposit into an empty pool mints 1:1 by the `totalShares == 0`
   * branch. A later one mints amount * totalShares / pooled, so the assertion
   * has to be against the share price, not against the amount. */
  const minted = afterDeposit.shares - start.shares;
  const worth = await stkld.getPooledKldByShares(minted);
  console.log(
    `   minted ${f18(minted)} shares, worth ${f18(worth)} KLD for ${f18(amount)} deposited` +
      (worth === amount ? "  (exact)" : `  (drift ${f18(worth - amount)})`),
  );

  /* ------------------------------------------------- 2. request withdrawal -- */
  console.log("\n2. requestWithdrawal()");
  await send("requested", "requestWithdrawal");
  const req = await show("after");
  if (!req.has) console.log("   ^ unexpected: request should be open");

  /* --------------------------------------------------------- 3. cancel ------ */
  console.log("\n3. cancelWithdrawalRequest()");
  await send("cancelled", "cancelWithdrawalRequest");
  const cancelled = await show("after");
  if (cancelled.has) console.log("   ^ unexpected: request should be gone");

  /* ------------------------------------ 4. request again, and leave it open -- */
  console.log("\n4. requestWithdrawal() again — left armed for the day-7 withdraw");
  await send("requested", "requestWithdrawal");
  const armed = await show("after");
  console.log(
    `\nwithdraw becomes callable in ${hrs(armed.left)}. Then:\n` +
      `   WITHDRAW=1 AMOUNT=${process.env.AMOUNT ?? "100000"} npx hardhat run scripts/exercise-staking.js --network ${hre.network.name}`,
  );
}

main().catch((e) => {
  console.error("STAKING EXERCISE FAILED:", e.shortMessage || e.message || e);
  process.exit(1);
});
