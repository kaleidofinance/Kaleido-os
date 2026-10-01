const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * The three stablecoin findings of the 2026-09-23 disclosure, each pinned with a
 * case that fails on the previous contracts:
 *
 *   1. kafUSD minted one share per RAW unit across mixed decimals, so an 18-decimal
 *      locker took ~all the yield of a 6-decimal locker holding the same dollars.
 *   2. a kafUSD transfer moved the token but not the lock behind it, so after any
 *      transfer neither side could ever withdraw.
 *   3. kfUSD mint/redeem was a par swap with no price: a depegged collateral bought
 *      a good one at par.
 *
 * Real kfUSD / kafUSD / YieldTreasury; mock tokens and Chainlink-style mock feeds.
 */
describe("Stablecoin findings (kafUSD decimals + transfers, kfUSD pricing)", function () {
  const usd = (n) => ethers.parseUnits(String(n), 18);
  const px = (n) => BigInt(Math.round(n * 1e8)); // an 8-decimal feed answer
  let deployer, alice, bob, attacker;
  let kfusd, kafusd, treasury, usdc, usde;
  let usdcFeed, usdeFeed;

  beforeEach(async function () {
    [deployer, alice, bob, attacker] = await ethers.getSigners();
    const Erc = await ethers.getContractFactory("MockERC20");
    usdc = await Erc.deploy("USD Coin", "USDC", 6);
    usde = await Erc.deploy("Ethena USDe", "USDe", 18);
    const Feed = await ethers.getContractFactory("MockAggregatorV3");
    usdcFeed = await Feed.deploy(8, "USDC / USD", px(1.0));
    usdeFeed = await Feed.deploy(8, "USDe / USD", px(1.0));

    kfusd = await (await ethers.getContractFactory("kfUSD")).deploy();
    await kfusd.setCollateralSupport(await usdc.getAddress(), true);
    await kfusd.setCollateralSupport(await usde.getAddress(), true);
    /* Tolerates the pre-fix kfUSD (no feed setter) so findings 1 and 2 can be run against
       the previous contracts to show these cases fail there. */
    if (kfusd.interface.hasFunction("setCollateralFeed")) {
      await kfusd.setCollateralFeed(await usdc.getAddress(), await usdcFeed.getAddress());
      await kfusd.setCollateralFeed(await usde.getAddress(), await usdeFeed.getAddress());
    }
    await kfusd.setDeploymentRatio(0); // keep every unit idle, so redemptions can draw on it

    kafusd = await (await ethers.getContractFactory("kafUSD")).deploy(await kfusd.getAddress());
    await kafusd.setAssetSupport(await kfusd.getAddress(), true);
    await kafusd.setAssetSupport(await usdc.getAddress(), true);
    await kafusd.setCooldownPeriod(0);

    treasury = await (await ethers.getContractFactory("YieldTreasury")).deploy(await kafusd.getAddress());
    await treasury.grantRole(await treasury.ADMIN_ROLE(), deployer.address);
    await treasury.grantRole(await treasury.YIELD_SOURCE_ROLE(), deployer.address);
    await treasury.setYieldAsset(await kfusd.getAddress(), true);
    await kafusd.setYieldTreasury(await treasury.getAddress());
  });

  /** kfUSD for `who`, minted against USDC at $1 (5 bps fee comes off the top). */
  async function giveKfusd(who, approxUsd) {
    const units = ethers.parseUnits(String(approxUsd), 6);
    await usdc.mint(who.address, units);
    await usdc.connect(who).approve(await kfusd.getAddress(), units);
    await kfusd.connect(who).mintWithCollateral(await usdc.getAddress(), units);
    return kfusd.balanceOf(who.address);
  }
  async function lock(who, token, amount) {
    await token.connect(who).approve(await kafusd.getAddress(), amount);
    await kafusd.connect(who).lockAssets(await token.getAddress(), amount);
  }

  // ───────────────────────────────────────────────────────────── finding 1
  describe("1. a dollar locked earns the same yield whatever its decimals", function () {
    it("a 6-decimal and an 18-decimal locker of equal dollars split the yield evenly", async function () {
      // Alice: 1 USDC (1e6 raw) — $1.  Bob: 1 kfUSD (1e18 raw) — $1.
      await usdc.mint(alice.address, 1_000_000n);
      await lock(alice, usdc, 1_000_000n);
      await giveKfusd(bob, 1.01);
      await lock(bob, kfusd, usd(1));
      expect(await kafusd.balanceOf(alice.address)).to.equal(usd(1)); // $1 → 1e18, not 1e6
      expect(await kafusd.balanceOf(bob.address)).to.equal(usd(1));

      await treasury.checkpoint(alice.address);
      await treasury.checkpoint(bob.address);
      const depositor = await giveKfusd(deployer, 205);
      await kfusd.approve(await treasury.getAddress(), depositor);
      await treasury.receiveYield(await kfusd.getAddress(), usd(100), "test");

      const a = await treasury.calculateUserYield(alice.address, await kfusd.getAddress());
      const b = await treasury.calculateUserYield(bob.address, await kfusd.getAddress());
      expect(a).to.equal(b); // before: 0.0000000001 vs 99.9999999999 (ratio ~1e12)
      expect(a).to.equal(usd(50));
    });

    it("the supply and the accounting total are in 18-decimal dollars", async function () {
      await usdc.mint(alice.address, 5_000_000n);
      await lock(alice, usdc, 5_000_000n);
      expect(await kafusd.totalSupply()).to.equal(usd(5));
      expect(await kafusd.totalAssetsLocked()).to.equal(usd(5));
    });

    it("a withdrawal pays whole asset units and refuses an amount that is not one", async function () {
      await usdc.mint(alice.address, 2_000_000n);
      await lock(alice, usdc, 2_000_000n);
      await expect(kafusd.connect(alice).requestWithdrawal(await usdc.getAddress(), usd(1) + 1n))
        .to.be.revertedWith("kafUSD: Amount is not a whole number of asset units");
      await kafusd.connect(alice).requestWithdrawal(await usdc.getAddress(), usd(1));
      await kafusd.connect(alice).completeWithdrawal();
      expect(await usdc.balanceOf(alice.address)).to.equal(1_000_000n);
      expect(await kafusd.balanceOf(alice.address)).to.equal(usd(1));
      expect(await kafusd.totalAssetsLocked()).to.equal(usd(1));
    });

    it("an asset this contract cannot scale cannot be listed", async function () {
      const Erc = await ethers.getContractFactory("MockERC20");
      const wide = await Erc.deploy("Wide", "WIDE", 24);
      await expect(kafusd.setAssetSupport(await wide.getAddress(), true)).to.be.revertedWith(
        "kafUSD: Asset decimals too high",
      );
    });
  });

  // ───────────────────────────────────────────────────────────── finding 2
  describe("2. kafUSD carries its claim when it is transferred", function () {
    it("after a full transfer the RECEIVER can withdraw and the sender cannot", async function () {
      await giveKfusd(alice, 100.1);
      const bal = await kfusd.balanceOf(alice.address);
      await lock(alice, kfusd, bal);
      await kafusd.connect(alice).transfer(bob.address, bal);

      expect(await kafusd.getUserAssetBalance(alice.address, await kfusd.getAddress())).to.equal(0n);
      expect(await kafusd.getUserAssetBalance(bob.address, await kfusd.getAddress())).to.equal(bal);
      expect(await kafusd.lockBalances(bob.address)).to.equal(bal);

      // before: both reverted ("Insufficient balance" / "Insufficient locked balance") for ever
      await expect(kafusd.connect(alice).requestWithdrawal(await kfusd.getAddress(), bal)).to.be.revertedWith(
        "kafUSD: Insufficient balance",
      );
      await kafusd.connect(bob).requestWithdrawal(await kfusd.getAddress(), bal);
      await kafusd.connect(bob).completeWithdrawal();
      expect(await kfusd.balanceOf(bob.address)).to.equal(bal);
    });

    it("a partial transfer carries each locked asset in proportion", async function () {
      await giveKfusd(alice, 60.1);
      const k = await kfusd.balanceOf(alice.address);
      await lock(alice, kfusd, k);
      await usdc.mint(alice.address, 40_000_000n);
      await lock(alice, usdc, 40_000_000n);
      const total = await kafusd.balanceOf(alice.address); // k + $40
      const sent = total / 4n; // a quarter

      await kafusd.connect(alice).transfer(bob.address, sent);
      const near = (x, y, tol) => (x > y ? x - y : y - x) <= tol;
      expect(near(await kafusd.getUserAssetBalance(bob.address, await kfusd.getAddress()), k / 4n, 1n)).to.equal(true);
      expect(near(await kafusd.getUserAssetBalance(bob.address, await usdc.getAddress()), 10_000_000n, 1n)).to.equal(true);
      // what is left behind is the other three quarters, nothing created, nothing lost
      expect(
        (await kafusd.getUserAssetBalance(alice.address, await usdc.getAddress())) +
          (await kafusd.getUserAssetBalance(bob.address, await usdc.getAddress())),
      ).to.equal(40_000_000n);

      // and the receiver can really take their USDC out
      await kafusd.connect(bob).requestWithdrawal(await usdc.getAddress(), usd(9));
      await kafusd.connect(bob).completeWithdrawal();
      expect(await usdc.balanceOf(bob.address)).to.equal(9_000_000n);
    });

    it("a pending withdrawal's kafUSD cannot be moved away", async function () {
      await giveKfusd(alice, 10.1);
      const bal = await kfusd.balanceOf(alice.address);
      await lock(alice, kfusd, bal);
      await kafusd.setCooldownPeriod(86400);
      await kafusd.connect(alice).requestWithdrawal(await kfusd.getAddress(), bal);
      await expect(kafusd.connect(alice).transfer(bob.address, 1n)).to.be.revertedWith(
        "kafUSD: Amount is reserved by a pending withdrawal",
      );
      await kafusd.connect(alice).cancelWithdrawal();
      await kafusd.connect(alice).transfer(bob.address, 1n); // free again
    });

    it("an un-transferred lock still redeems (the control)", async function () {
      await giveKfusd(alice, 10.1);
      const bal = await kfusd.balanceOf(alice.address);
      await lock(alice, kfusd, bal);
      await kafusd.connect(alice).requestWithdrawal(await kfusd.getAddress(), bal);
      await kafusd.connect(alice).completeWithdrawal();
      expect(await kfusd.balanceOf(alice.address)).to.equal(bal);
    });

    it("a lock in an asset that was later un-listed still moves with the token", async function () {
      await usdc.mint(alice.address, 10_000_000n);
      await lock(alice, usdc, 10_000_000n);
      await kafusd.setAssetSupport(await usdc.getAddress(), false);
      await kafusd.connect(alice).transfer(bob.address, usd(10));
      expect(await kafusd.getUserAssetBalance(bob.address, await usdc.getAddress())).to.equal(10_000_000n);
      expect(await kafusd.getUserAssetBalance(alice.address, await usdc.getAddress())).to.equal(0n);
    });
  });

  // ───────────────────────────────────────────────────────────── finding 3
  describe("3. kfUSD mints and redeems at the collateral's price", function () {
    const fees = (a) => (a * 9990n) / 10000n; // 5 bps in, 5 bps out (approx)

    it("a depegged collateral can no longer buy a good one at par", async function () {
      // idle USDC for the attacker to try to take: another user minted 1000 of it
      await giveKfusd(bob, 1000);

      await usdeFeed.setAnswer(px(0.9)); // USDe at $0.90
      await usde.mint(attacker.address, usd(100));
      await usde.connect(attacker).approve(await kfusd.getAddress(), usd(100));
      await kfusd.connect(attacker).mintWithCollateral(await usde.getAddress(), usd(100));
      const minted = await kfusd.balanceOf(attacker.address);
      // 100 USDe is worth $90, so ~$89.96 of kfUSD after the fee — not ~$99.95 as before
      expect(minted).to.be.lessThan(usd(90));
      expect(minted).to.be.greaterThan(usd(89.9));

      await kfusd.connect(attacker).redeem(minted, await usdc.getAddress());
      const out = await usdc.balanceOf(attacker.address); // 6 decimals
      // value out ≈ value in ($90 less ~10 bps of fees): no premium. Before: 99,900,025.
      expect(out).to.be.lessThan(90_000_000n);
      expect(out).to.be.greaterThan(89_800_000n);
    });

    it("redeeming a depegged asset pays MORE of it, worth the same dollars", async function () {
      await usde.mint(bob.address, usd(1000));
      await usde.connect(bob).approve(await kfusd.getAddress(), usd(1000));
      await kfusd.connect(bob).mintWithCollateral(await usde.getAddress(), usd(1000)); // at $1.00
      await usdeFeed.setAnswer(px(0.8));
      const before = await usde.balanceOf(bob.address);
      await kfusd.connect(bob).redeem(usd(100), await usde.getAddress());
      const got = (await usde.balanceOf(bob.address)) - before;
      // ~$99.95 at $0.80 is ~124.9 USDe
      expect(got).to.be.greaterThan(usd(124.8));
      expect(got).to.be.lessThan(usd(125));
    });

    it("par collateral behaves as before: USDC in, ~USDC out (the control)", async function () {
      const k = await giveKfusd(alice, 100);
      await kfusd.connect(alice).redeem(k, await usdc.getAddress());
      const out = await usdc.balanceOf(alice.address);
      expect(out).to.be.greaterThan(99_800_000n);
      expect(out).to.be.lessThan(100_000_000n);
    });

    it("fails closed: no feed, a stale feed and an absurd price all refuse", async function () {
      const Erc = await ethers.getContractFactory("MockERC20");
      const usdt = await Erc.deploy("Tether", "USDT", 6);
      await kfusd.setCollateralSupport(await usdt.getAddress(), true); // listed, no feed
      await usdt.mint(alice.address, 1_000_000n);
      await usdt.connect(alice).approve(await kfusd.getAddress(), 1_000_000n);
      await expect(kfusd.connect(alice).mintWithCollateral(await usdt.getAddress(), 1_000_000n)).to.be.revertedWith(
        "kfUSD: No price feed for collateral",
      );

      await time.increase(97200 + 60); // past the 27h bound
      await usdc.mint(alice.address, 1_000_000n);
      await usdc.connect(alice).approve(await kfusd.getAddress(), 1_000_000n);
      await expect(kfusd.connect(alice).mintWithCollateral(await usdc.getAddress(), 1_000_000n)).to.be.revertedWith(
        "kfUSD: Price feed stale or out of range",
      );

      await usdcFeed.setAnswer(px(0.3)); // refreshed, but outside the $0.50–$2.00 sanity band
      await expect(kfusd.connect(alice).mintWithCollateral(await usdc.getAddress(), 1_000_000n)).to.be.revertedWith(
        "kfUSD: Price feed stale or out of range",
      );
    });

    it("a feed must return a usable price when it is set", async function () {
      const Feed = await ethers.getContractFactory("MockAggregatorV3");
      const bad = await Feed.deploy(8, "BAD", 0);
      await expect(kfusd.setCollateralFeed(await usde.getAddress(), await bad.getAddress())).to.be.revertedWith(
        "kfUSD: Feed does not return a usable price",
      );
      await expect(kfusd.connect(alice).setCollateralFeed(await usde.getAddress(), await usdeFeed.getAddress())).to.be
        .reverted; // admin only
    });

    it("the permissioned mint cannot create kfUSD beyond the collateral's value", async function () {
      await usdc.mint(deployer.address, 10_000_000n);
      await usdc.approve(await kfusd.getAddress(), 10_000_000n);
      await expect(
        kfusd.mint(deployer.address, usd(10.5), await usdc.getAddress(), 10_000_000n), // $10 of USDC, asks for $10.50
      ).to.be.revertedWith("kfUSD: Mint exceeds collateral value");
      await kfusd.mint(deployer.address, usd(10), await usdc.getAddress(), 10_000_000n); // exactly its value is fine
    });

    it("the backing ratio counts dollars, not raw units across decimals", async function () {
      await giveKfusd(alice, 100); // 100 USDC (6 dp)
      await usde.mint(bob.address, usd(50));
      await usde.connect(bob).approve(await kfusd.getAddress(), usd(50));
      await kfusd.connect(bob).mintWithCollateral(await usde.getAddress(), usd(50)); // 50 USDe (18 dp)
      expect(await kfusd.getTotalCollateralValue()).to.equal(usd(150)); // before: 100e6 + 50e18, nonsense
      expect(await kfusd.getBackingRatio()).to.equal(usd(1)); // fully backed
      await usdeFeed.setAnswer(px(0.9)); // USDe falls: backing falls with it
      expect(await kfusd.getTotalCollateralValue()).to.equal(usd(145));
      expect(await kfusd.getBackingRatio()).to.be.lessThan(usd(1));
    });
  });
});
