/**
 * Exercise kfUSD: mint and redeem once per supported collateral.
 *
 *   npx hardhat run scripts/exercise-kfusd.js --network sepolia
 *   AMOUNT=1000 npx hardhat run scripts/exercise-kfusd.js --network baseTestnet
 *   ONLY=usdc npx hardhat run scripts/exercise-kfusd.js --network sepolia
 *
 * kfUSD is one of only two products that is live on every chain and takes more
 * than one asset, and it is the *only* one that works on the three chains whose
 * lending oracles are dead — because `mint` and `redeem` consult no oracle at
 * all. So this is where "different assets on every chain" actually gets tested,
 * and the per-collateral loop is the point of the script rather than a detail.
 *
 * AMOUNT is in whole collateral units and is scaled by each collateral's own
 * decimals, so the same run covers 6dp (USDC, USDT) and 18dp (USDe) against one
 * 18dp stablecoin. That mixed-decimals path is where the arithmetic is worth
 * watching, and two things are checked rather than assumed:
 *
 *   - `mint(_to, _amount, _collateralToken, _collateralAmount)` takes the kfUSD
 *     amount and the collateral amount as *independent* arguments and checks no
 *     relationship between them. The caller is trusted to scale. This script
 *     scales the same way `src/hooks/useStablecoin.ts` does — amount * 10^(18-d)
 *     — so a mismatch here would be a mismatch the app would also produce.
 *
 *   - `redeem` pays out of `idleBalances` only, and mint splits collateral by
 *     `deploymentRatio`. With the default 5000 that is half, so a full redeem of
 *     a fresh mint should fail. The full redeem is *static-called* first so the
 *     revert reason is captured without spending gas, then the redeemable part is
 *     sent for real. A run that only ever redeems the safe amount would never
 *     discover the ceiling.
 *
 * Both fees are 5 bps and both are charged on the *kfUSD* amount, not the
 * collateral — on redeem that means the collateral returned is (amount - fee)
 * rescaled, so a round trip is lossy by design and the loss is reported.
 *
 * Requires MINTER_ROLE, which the deployer holds from the constructor. That is
 * checked up front, because "mint reverted" on a chain where the role was never
 * granted is not a finding about the collateral.
 */

const hre = require("hardhat");
const { ethers } = hre;
const { registryFor } = require("./libraries/registry.js");

const KFUSD_ABI = [
  "function mint(address,uint256,address,uint256)",
  "function redeem(uint256,address)",
  "function getSupportedCollaterals() view returns (address[])",
  "function supportedCollaterals(address) view returns (bool)",
  "function collateralBalances(address) view returns (uint256)",
  "function idleBalances(address) view returns (uint256)",
  "function deployedBalances(address) view returns (uint256)",
  "function deploymentRatio() view returns (uint256)",
  "function autoDeploymentEnabled() view returns (bool)",
  "function vaultAddress() view returns (address)",
  "function mintFee() view returns (uint256)",
  "function redeemFee() view returns (uint256)",
  "function BASIS_POINTS() view returns (uint256)",
  "function totalMinted() view returns (uint256)",
  "function totalRedeemed() view returns (uint256)",
  "function feeTreasury() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function getTotalCollateralValue() view returns (uint256)",
  "function getBackingRatio() view returns (uint256)",
  "function MINTER_ROLE() view returns (bytes32)",
  "function hasRole(bytes32,address) view returns (bool)",
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

async function main() {
  const [signer] = await ethers.getSigners();
  const me = await signer.getAddress();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const reg = registryFor(chainId);
  if (!reg.kfUSD) throw new Error(`no kfUSD on chain ${chainId}`);

  const kf = new ethers.Contract(reg.kfUSD, KFUSD_ABI, signer);
  console.log(`\n=== ${hre.network.name}: kfUSD ${reg.kfUSD} ===`);
  if (await kf.paused()) throw new Error("kfUSD is paused");

  const role = await kf.MINTER_ROLE();
  if (!(await kf.hasRole(role, me)))
    throw new Error(`${me} does not hold MINTER_ROLE — mint is permissioned and this is not a collateral problem`);

  const [mintFee, redeemFee, bp, ratio, auto, vault] = await Promise.all([
    kf.mintFee(),
    kf.redeemFee(),
    kf.BASIS_POINTS(),
    kf.deploymentRatio(),
    kf.autoDeploymentEnabled(),
    kf.vaultAddress(),
  ]);
  console.log(
    `mintFee ${mintFee} bp/1e4  redeemFee ${redeemFee} bp/1e4  deploymentRatio ${(Number(ratio) / Number(bp)) * 100}%  autoDeployment ${auto}  vault ${vault}`,
  );
  console.log(`supply ${f18(await kf.totalSupply())}  totalMinted ${f18(await kf.totalMinted())}  totalRedeemed ${f18(await kf.totalRedeemed())}`);

  let collaterals = await kf.getSupportedCollaterals();
  const only = process.env.ONLY;
  if (only) {
    const want = (reg[only] ?? only).toLowerCase();
    collaterals = collaterals.filter((c) => c.toLowerCase() === want);
    if (!collaterals.length) throw new Error(`${only} is not a supported collateral here`);
  }
  console.log(`${collaterals.length} supported collateral(s)`);

  const whole = process.env.AMOUNT ?? "1000";
  const results = [];

  for (const addr of collaterals) {
    const t = new ethers.Contract(addr, ERC20_ABI, signer);
    let symbol, dec;
    try {
      [symbol, dec] = [await t.symbol(), Number(await t.decimals())];
    } catch {
      console.log(`\n-- ${addr}: not a readable ERC20, skipped`);
      continue;
    }
    console.log(`\n-- ${symbol} (${dec}dp) ${addr}`);

    const held = await t.balanceOf(me);
    const collateralAmount = ethers.parseUnits(whole, dec);
    if (held < collateralAmount) {
      console.log(
        `   short: have ${ethers.formatUnits(held, dec)}, need ${whole} — mint with scripts/mint-mock.js, skipped`,
      );
      results.push({ symbol, status: "skipped, no balance" });
      continue;
    }

    /* The same scaling the app's hook does. kfUSD is 18dp; a 6dp collateral has
     * to be multiplied by 10^12 or the mint records a thousand-billionth of the
     * intended supply against the full collateral. */
    const kfAmount = collateralAmount * 10n ** BigInt(18 - dec);

    const before = {
      kf: await kf.balanceOf(me),
      col: await t.balanceOf(me),
      idle: await kf.idleBalances(addr),
      deployed: await kf.deployedBalances(addr),
      total: await kf.collateralBalances(addr),
    };

    if ((await t.allowance(me, reg.kfUSD)) < collateralAmount) {
      const tx = await t.approve(reg.kfUSD, collateralAmount);
      await tx.wait();
      console.log(`   approved ${symbol}`);
    }

    let tx = await kf.mint(me, kfAmount, addr, collateralAmount);
    let rc = await tx.wait();
    const afterMint = {
      kf: await kf.balanceOf(me),
      col: await t.balanceOf(me),
      idle: await kf.idleBalances(addr),
      deployed: await kf.deployedBalances(addr),
    };
    const expectedFee = (kfAmount * mintFee) / bp;
    const gotKf = afterMint.kf - before.kf;
    console.log(`   mint  tx ${tx.hash}  gas ${rc.gasUsed}`);
    console.log(
      `     paid ${ethers.formatUnits(before.col - afterMint.col, dec)} ${symbol}, got ${f18(gotKf)} kfUSD` +
        `  (asked ${f18(kfAmount)} less ${f18(expectedFee)} fee${gotKf === kfAmount - expectedFee ? ", exact" : " — MISMATCH"})`,
    );
    console.log(
      `     idle ${ethers.formatUnits(afterMint.idle, dec)}  deployed ${ethers.formatUnits(afterMint.deployed, dec)}  (redeem pays from idle only)`,
    );

    /* Ceiling, probed for free. `redeem` scales (amount - fee) down to the
     * collateral's decimals and requires idleBalances to cover it, so the most
     * that can come out of a fresh mint is idle * 10^(18-d), grossed up for the
     * fee. Asking for the whole balance first records what the wall says. */
    const wall = await kf.redeem
      .staticCall(gotKf, addr)
      .then(() => "no revert — the whole balance is redeemable")
      .catch((e) => e.shortMessage || e.message);
    console.log(`     full redeem of ${f18(gotKf)} kfUSD would: ${wall}`);

    /* Largest redeem the idle balance can actually cover. */
    const idleAs18 = afterMint.idle * 10n ** BigInt(18 - dec);
    let ask = (idleAs18 * bp) / (bp - redeemFee);
    if (ask > gotKf) ask = gotKf;
    /* Grossing up can overshoot by a wei of collateral; step down until the
     * contract agrees, rather than guessing the rounding direction. */
    let ok = false;
    for (let i = 0; i < 4 && !ok; i++) {
      try {
        await kf.redeem.staticCall(ask, addr);
        ok = true;
      } catch {
        ask = (ask * 9999n) / 10000n;
      }
    }
    if (!ok) {
      console.log(`     could not find a redeemable amount — leaving ${f18(gotKf)} kfUSD held`);
      results.push({ symbol, status: "minted, redeem blocked" });
      continue;
    }

    const beforeRedeem = { kf: await kf.balanceOf(me), col: await t.balanceOf(me) };
    tx = await kf.redeem(ask, addr);
    rc = await tx.wait();
    const afterRedeem = { kf: await kf.balanceOf(me), col: await t.balanceOf(me) };
    const backCol = afterRedeem.col - beforeRedeem.col;
    const burned = beforeRedeem.kf - afterRedeem.kf;
    console.log(`   redeem  tx ${tx.hash}  gas ${rc.gasUsed}`);
    console.log(
      `     burned ${f18(burned)} kfUSD, got ${ethers.formatUnits(backCol, dec)} ${symbol}` +
        `  (fee ${f18((ask * redeemFee) / bp)} kfUSD)`,
    );

    const netCol = afterRedeem.col - before.col;
    console.log(
      `   round trip: ${symbol} ${ethers.formatUnits(netCol, dec)}, kfUSD ${f18(afterRedeem.kf - before.kf)} left held`,
    );
    results.push({
      symbol,
      status: "ok",
      redeemable: `${ethers.formatUnits(backCol, dec)} of ${whole}`,
    });
  }

  /* getTotalCollateralValue sums collateralBalances in *raw* units across 6dp
   * and 18dp assets, then getBackingRatio divides by an 18dp totalSupply. With
   * mixed collateral both figures are meaningless. Printed alongside the honest
   * sum so the size of the error is on the record; nothing internal reads them
   * and the app sums per-asset itself, so this is a reporting defect, not a
   * solvency one. */
  console.log("\n-- the two view functions, for the record --");
  const supply = await kf.totalSupply();
  console.log(`getTotalCollateralValue() = ${await kf.getTotalCollateralValue()} (raw, mixed decimals)`);
  console.log(`getBackingRatio()         = ${await kf.getBackingRatio()}`);
  console.log(`totalSupply()             = ${f18(supply)} kfUSD`);
  let honest = 0;
  for (const addr of await kf.getSupportedCollaterals()) {
    const t = new ethers.Contract(addr, ERC20_ABI, ethers.provider);
    try {
      const d = Number(await t.decimals());
      honest += parseFloat(ethers.formatUnits(await kf.collateralBalances(addr), d));
    } catch {
      /* not an ERC20; it cannot be collateral in practice either */
    }
  }
  console.log(`honest per-asset sum at par = $${honest.toFixed(6)}`);

  console.log("\n-- summary --");
  for (const r of results) console.log(`  ${r.symbol}: ${r.status}${r.redeemable ? `  redeemed ${r.redeemable}` : ""}`);
}

main().catch((e) => {
  console.error("KFUSD EXERCISE FAILED:", e.shortMessage || e.message || e);
  process.exit(1);
});
