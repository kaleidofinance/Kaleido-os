const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * KaleidoTokenFaucet — the testnet drip behind /faucet and Luca's claimTestTokens
 * tool.
 *
 * Three of the cases below are regressions against the two-asset version this
 * replaced, and they are the reason the contract was rewritten rather than
 * patched:
 *
 *   "counts a claimer once"     it pushed to allUsers from both claim functions
 *                               behind separate flags, so anyone who claimed both
 *                               assets was counted twice by getTotalUsers().
 *   "first claim survives a
 *    cooldown longer than the
 *    chain's own clock"         the guard was `block.timestamp - lastClaimed <
 *                               COOLDOWN` with lastClaimed 0 for a new user, so on
 *                               a chain younger than the cooldown every first
 *                               claim reverted.
 *   "cooldown is per asset"     one shared lastClaimed mapping meant claiming USDC
 *                               locked out KLD.
 *
 * Amounts are asserted in base units against tokens with DIFFERENT decimals (6
 * and 18) throughout, because a faucet that scales its payout by the wrong power
 * of ten still emits a successful transaction.
 */

const HOUR = 60 * 60;

/** 100 USDC at 6dp, and 10,000 of an 18dp token — the drips actually deployed. */
const USDC_DRIP = 100n * 10n ** 6n;
const DAI_DRIP = 10_000n * 10n ** 18n;

describe("KaleidoTokenFaucet", function () {
  let owner, alice, bob;
  let usdc, dai;

  async function deployToken(name, symbol, decimals) {
    const Mock = await ethers.getContractFactory("MockERC20");
    const token = await Mock.deploy(name, symbol, decimals);
    await token.waitForDeployment();
    return token;
  }

  /** A faucet listing both tokens, funded with `refills` drips of each. */
  async function deployFaucet({ cooldown = HOUR, refills = 10n } = {}) {
    const Faucet = await ethers.getContractFactory("KaleidoTokenFaucet");
    const faucet = await Faucet.deploy(
      [await usdc.getAddress(), await dai.getAddress()],
      [USDC_DRIP, DAI_DRIP],
      cooldown
    );
    await faucet.waitForDeployment();
    const address = await faucet.getAddress();
    if (refills > 0n) {
      await (await usdc.mint(address, USDC_DRIP * refills)).wait();
      await (await dai.mint(address, DAI_DRIP * refills)).wait();
    }
    return faucet;
  }

  beforeEach(async function () {
    [owner, alice, bob] = await ethers.getSigners();
    usdc = await deployToken("USD Coin", "USDC", 6);
    dai = await deployToken("Dai Stablecoin", "DAI", 18);
  });

  /* --------------------------------------------------------------- claiming -- */

  it("pays the configured drip in the token's own base units", async function () {
    const faucet = await deployFaucet();

    await (await faucet.connect(alice).claim(await usdc.getAddress())).wait();
    await (await faucet.connect(alice).claim(await dai.getAddress())).wait();

    expect(await usdc.balanceOf(alice.address)).to.equal(USDC_DRIP);
    expect(await dai.balanceOf(alice.address)).to.equal(DAI_DRIP);
  });

  it("counts a claimer once no matter how many assets they claim", async function () {
    const faucet = await deployFaucet();

    await (await faucet.connect(alice).claim(await usdc.getAddress())).wait();
    expect(await faucet.getTotalUsers()).to.equal(1n);

    // The regression: a second asset by the same claimer is not a second user.
    await (await faucet.connect(alice).claim(await dai.getAddress())).wait();
    expect(await faucet.getTotalUsers()).to.equal(1n);

    await (await faucet.connect(bob).claim(await usdc.getAddress())).wait();
    expect(await faucet.getTotalUsers()).to.equal(2n);
  });

  it("first claim survives a cooldown longer than the chain's own clock", async function () {
    /*
     * A cooldown well past the current block timestamp. Under the old
     * `block.timestamp - lastClaimed < COOLDOWN` guard this reverts for a
     * never-claimed user, because their lastClaimed is 0 and the whole of unix
     * time is shorter than the cooldown.
     */
    const latest = await ethers.provider.getBlock("latest");
    const faucet = await deployFaucet({ cooldown: latest.timestamp * 2 });

    await expect(faucet.connect(alice).claim(await usdc.getAddress())).to.not.be
      .reverted;
    expect(await usdc.balanceOf(alice.address)).to.equal(USDC_DRIP);
  });

  it("enforces the cooldown per asset, not globally", async function () {
    const faucet = await deployFaucet();
    const usdcAddr = await usdc.getAddress();
    const daiAddr = await dai.getAddress();

    await (await faucet.connect(alice).claim(usdcAddr)).wait();

    await expect(
      faucet.connect(alice).claim(usdcAddr)
    ).to.be.revertedWithCustomError(
      faucet,
      "KaleidoTokenFaucet_CooldownNotOver"
    );

    // The other asset is untouched by that claim.
    await expect(faucet.connect(alice).claim(daiAddr)).to.not.be.reverted;
  });

  it("lets a claimer back in once the cooldown elapses", async function () {
    const faucet = await deployFaucet();
    const usdcAddr = await usdc.getAddress();

    await (await faucet.connect(alice).claim(usdcAddr)).wait();
    await ethers.provider.send("evm_increaseTime", [HOUR]);
    await ethers.provider.send("evm_mine", []);

    await (await faucet.connect(alice).claim(usdcAddr)).wait();
    expect(await usdc.balanceOf(alice.address)).to.equal(USDC_DRIP * 2n);
  });

  it("refuses an asset it was never configured with", async function () {
    const faucet = await deployFaucet();
    const stranger = await deployToken("Stranger", "STR", 18);

    await expect(
      faucet.connect(alice).claim(await stranger.getAddress())
    ).to.be.revertedWithCustomError(
      faucet,
      "KaleidoTokenFaucet_AssetNotListed"
    );
  });

  it("refuses a paused asset without delisting it", async function () {
    const faucet = await deployFaucet();
    const usdcAddr = await usdc.getAddress();

    await (await faucet.setDrip(usdcAddr, 0)).wait();

    await expect(
      faucet.connect(alice).claim(usdcAddr)
    ).to.be.revertedWithCustomError(
      faucet,
      "KaleidoTokenFaucet_AssetNotListed"
    );

    // Still listed: the array is append-only, so assets(0) does not shift.
    expect(await faucet.assetCount()).to.equal(2n);
    expect(await faucet.assets(0)).to.equal(usdcAddr);
  });

  it("reverts with the balance error when it cannot cover a drip", async function () {
    const faucet = await deployFaucet({ refills: 0n });

    await expect(
      faucet.connect(alice).claim(await usdc.getAddress())
    ).to.be.revertedWithCustomError(
      faucet,
      "KaleidoTokenFaucet_InsufficientContractBalance"
    );
  });

  it("accumulates totalClaimed per token", async function () {
    const faucet = await deployFaucet();
    const usdcAddr = await usdc.getAddress();

    await (await faucet.connect(alice).claim(usdcAddr)).wait();
    await (await faucet.connect(bob).claim(usdcAddr)).wait();

    expect(await faucet.totalClaimed(usdcAddr)).to.equal(USDC_DRIP * 2n);
    expect(await faucet.totalClaimed(await dai.getAddress())).to.equal(0n);
  });

  it("emits Claimed with the token and claimer indexed", async function () {
    const faucet = await deployFaucet();
    const usdcAddr = await usdc.getAddress();

    await expect(faucet.connect(alice).claim(usdcAddr))
      .to.emit(faucet, "Claimed")
      .withArgs(usdcAddr, alice.address, USDC_DRIP, (v) => v > 0n);
  });

  /* ------------------------------------------------------------------ reads -- */

  it("assetInfo answers amount, balance and deadline for every asset at once", async function () {
    const faucet = await deployFaucet({ refills: 3n });
    const usdcAddr = await usdc.getAddress();
    const daiAddr = await dai.getAddress();

    let info = await faucet.assetInfo(alice.address);
    expect(info.tokens).to.deep.equal([usdcAddr, daiAddr]);
    expect(info.amounts).to.deep.equal([USDC_DRIP, DAI_DRIP]);
    expect(info.balances).to.deep.equal([USDC_DRIP * 3n, DAI_DRIP * 3n]);
    // Never claimed: both claimable now.
    expect(info.nextClaimAt).to.deep.equal([0n, 0n]);

    const receipt = await (await faucet.connect(alice).claim(usdcAddr)).wait();
    const claimedAt = (await ethers.provider.getBlock(receipt.blockNumber))
      .timestamp;

    info = await faucet.assetInfo(alice.address);
    expect(info.balances).to.deep.equal([USDC_DRIP * 2n, DAI_DRIP * 3n]);
    expect(info.nextClaimAt[0]).to.equal(BigInt(claimedAt + HOUR));
    expect(info.nextClaimAt[1]).to.equal(0n);

    // Another address is unaffected — the deadline is per claimer.
    const other = await faucet.assetInfo(bob.address);
    expect(other.nextClaimAt).to.deep.equal([0n, 0n]);
  });

  it("claimableAt returns 0 once the deadline has passed", async function () {
    const faucet = await deployFaucet();
    const usdcAddr = await usdc.getAddress();

    await (await faucet.connect(alice).claim(usdcAddr)).wait();
    expect(await faucet.claimableAt(usdcAddr, alice.address)).to.be.greaterThan(
      0n
    );

    await ethers.provider.send("evm_increaseTime", [HOUR]);
    await ethers.provider.send("evm_mine", []);
    expect(await faucet.claimableAt(usdcAddr, alice.address)).to.equal(0n);
  });

  it("a zero cooldown makes every asset immediately re-claimable", async function () {
    const faucet = await deployFaucet({ cooldown: 0 });
    const usdcAddr = await usdc.getAddress();

    await (await faucet.connect(alice).claim(usdcAddr)).wait();
    await (await faucet.connect(alice).claim(usdcAddr)).wait();

    expect(await usdc.balanceOf(alice.address)).to.equal(USDC_DRIP * 2n);
    expect(await faucet.claimableAt(usdcAddr, alice.address)).to.equal(0n);
  });

  /* ------------------------------------------------------------------ owner -- */

  it("setDrip lists a new asset and re-prices an existing one", async function () {
    const faucet = await deployFaucet();
    const extra = await deployToken("Ethena USD", "USDe", 18);
    const extraAddr = await extra.getAddress();

    await expect(faucet.setDrip(extraAddr, DAI_DRIP))
      .to.emit(faucet, "DripSet")
      .withArgs(extraAddr, DAI_DRIP);
    expect(await faucet.assetCount()).to.equal(3n);

    await (
      await faucet.setDrip(await usdc.getAddress(), USDC_DRIP * 2n)
    ).wait();
    expect(await faucet.assetCount()).to.equal(3n); // re-priced, not re-listed
    const drip = await faucet.drips(await usdc.getAddress());
    expect(drip.amount).to.equal(USDC_DRIP * 2n);
    expect(drip.listed).to.equal(true);
  });

  it("withdraw with amount 0 sweeps the whole balance", async function () {
    const faucet = await deployFaucet({ refills: 5n });
    const usdcAddr = await usdc.getAddress();

    await (await faucet.withdraw(usdcAddr, owner.address, 0)).wait();

    expect(await usdc.balanceOf(await faucet.getAddress())).to.equal(0n);
    expect(await usdc.balanceOf(owner.address)).to.equal(USDC_DRIP * 5n);
  });

  it("only the owner may set drips, cooldown or withdraw", async function () {
    const faucet = await deployFaucet();
    const usdcAddr = await usdc.getAddress();

    for (const call of [
      faucet.connect(alice).setDrip(usdcAddr, 1n),
      faucet.connect(alice).setCooldown(1),
      faucet.connect(alice).withdraw(usdcAddr, alice.address, 0),
    ]) {
      await expect(call).to.be.revertedWithCustomError(
        faucet,
        "OwnableUnauthorizedAccount"
      );
    }
  });

  /* ------------------------------------------------------------- claimMany -- */

  it("claimMany pays every claimable asset in one transaction", async function () {
    const faucet = await deployFaucet();
    const list = [await usdc.getAddress(), await dai.getAddress()];

    expect(await faucet.connect(alice).claimMany.staticCall(list)).to.equal(2n);
    await (await faucet.connect(alice).claimMany(list)).wait();

    expect(await usdc.balanceOf(alice.address)).to.equal(USDC_DRIP);
    expect(await dai.balanceOf(alice.address)).to.equal(DAI_DRIP);
  });

  it("claimMany skips a member on cooldown and pays the rest", async function () {
    /*
     * The whole reason the batch skips rather than reverting. A wallet that
     * claimed one asset a minute ago must still be able to collect the others; a
     * batch that reverted here would be unusable on its second press.
     */
    const faucet = await deployFaucet();
    await (await faucet.connect(alice).claim(await usdc.getAddress())).wait();

    const list = [await usdc.getAddress(), await dai.getAddress()];
    expect(await faucet.connect(alice).claimMany.staticCall(list)).to.equal(1n);
    await (await faucet.connect(alice).claimMany(list)).wait();

    // USDC paid once, not twice, and DAI paid despite USDC being locked.
    expect(await usdc.balanceOf(alice.address)).to.equal(USDC_DRIP);
    expect(await dai.balanceOf(alice.address)).to.equal(DAI_DRIP);
  });

  it("claimMany skips a paused asset and pays the rest", async function () {
    const faucet = await deployFaucet();
    await (await faucet.setDrip(await usdc.getAddress(), 0n)).wait();

    const list = [await usdc.getAddress(), await dai.getAddress()];
    expect(await faucet.connect(alice).claimMany.staticCall(list)).to.equal(1n);
    await (await faucet.connect(alice).claimMany(list)).wait();

    expect(await usdc.balanceOf(alice.address)).to.equal(0n);
    expect(await dai.balanceOf(alice.address)).to.equal(DAI_DRIP);
  });

  it("claimMany skips an asset it cannot cover and pays the rest", async function () {
    const faucet = await deployFaucet({ refills: 0n });
    await (await dai.mint(await faucet.getAddress(), DAI_DRIP)).wait();

    const list = [await usdc.getAddress(), await dai.getAddress()];
    expect(await faucet.connect(alice).claimMany.staticCall(list)).to.equal(1n);
    await (await faucet.connect(alice).claimMany(list)).wait();

    expect(await usdc.balanceOf(alice.address)).to.equal(0n);
    expect(await dai.balanceOf(alice.address)).to.equal(DAI_DRIP);
  });

  it("claimMany reverts when nothing in the list is claimable", async function () {
    /*
     * A batch that moved no tokens must not succeed: on-chain it would be
     * indistinguishable from one that worked, and the caller pays gas either way.
     */
    const faucet = await deployFaucet();
    const list = [await usdc.getAddress(), await dai.getAddress()];
    await (await faucet.connect(alice).claimMany(list)).wait();

    await expect(
      faucet.connect(alice).claimMany(list)
    ).to.be.revertedWithCustomError(
      faucet,
      "KaleidoTokenFaucet_NothingClaimable"
    );
  });

  it("claimMany reverts on an empty list", async function () {
    const faucet = await deployFaucet();
    await expect(
      faucet.connect(alice).claimMany([])
    ).to.be.revertedWithCustomError(
      faucet,
      "KaleidoTokenFaucet_NothingClaimable"
    );
  });

  it("claimMany counts the claimer once and accumulates per token", async function () {
    const faucet = await deployFaucet();
    await (
      await faucet
        .connect(alice)
        .claimMany([await usdc.getAddress(), await dai.getAddress()])
    ).wait();

    // The allUsers regression, reached through the batch path this time.
    expect(await faucet.getTotalUsers()).to.equal(1n);
    expect(await faucet.totalClaimed(await usdc.getAddress())).to.equal(
      USDC_DRIP
    );
    expect(await faucet.totalClaimed(await dai.getAddress())).to.equal(
      DAI_DRIP
    );
  });

  it("claimMany pays a duplicated asset once", async function () {
    const faucet = await deployFaucet();
    const addr = await usdc.getAddress();

    expect(
      await faucet.connect(alice).claimMany.staticCall([addr, addr])
    ).to.equal(1n);
    await (await faucet.connect(alice).claimMany([addr, addr])).wait();

    expect(await usdc.balanceOf(alice.address)).to.equal(USDC_DRIP);
  });

  it("claimMany leaves each asset's own cooldown running", async function () {
    const faucet = await deployFaucet();
    await (
      await faucet
        .connect(alice)
        .claimMany([await usdc.getAddress(), await dai.getAddress()])
    ).wait();

    for (const token of [usdc, dai]) {
      expect(
        await faucet.claimableAt(await token.getAddress(), alice.address)
      ).to.be.greaterThan(0n);
    }
    // And a single claim of either is now refused for the usual reason.
    await expect(
      faucet.connect(alice).claim(await usdc.getAddress())
    ).to.be.revertedWithCustomError(
      faucet,
      "KaleidoTokenFaucet_CooldownNotOver"
    );
  });

  /* -------------------------------------------------------------- setDrips -- */

  it("setDrips lists several new assets in one call", async function () {
    const faucet = await deployFaucet();
    const usdt = await deployToken("Tether USD", "USDT", 6);
    const weth = await deployToken("Wrapped Ether", "WETH", 18);

    await (
      await faucet.setDrips(
        [await usdt.getAddress(), await weth.getAddress()],
        [USDC_DRIP, 10n ** 18n]
      )
    ).wait();

    expect(await faucet.assetCount()).to.equal(4n);
    expect((await faucet.drips(await weth.getAddress())).amount).to.equal(
      10n ** 18n
    );
  });

  it("setDrips re-prices and pauses existing assets", async function () {
    const faucet = await deployFaucet();
    await (
      await faucet.setDrips(
        [await usdc.getAddress(), await dai.getAddress()],
        [USDC_DRIP * 2n, 0n]
      )
    ).wait();

    // Re-pricing and pausing must not append duplicate slots.
    expect(await faucet.assetCount()).to.equal(2n);
    expect((await faucet.drips(await usdc.getAddress())).amount).to.equal(
      USDC_DRIP * 2n
    );
    expect((await faucet.drips(await dai.getAddress())).listed).to.equal(true);
    await expect(
      faucet.connect(alice).claim(await dai.getAddress())
    ).to.be.revertedWithCustomError(
      faucet,
      "KaleidoTokenFaucet_AssetNotListed"
    );
  });

  it("setDrips refuses mismatched lists rather than truncating", async function () {
    const faucet = await deployFaucet();
    await expect(
      faucet.setDrips([await usdc.getAddress(), await dai.getAddress()], [0n])
    ).to.be.revertedWithCustomError(faucet, "KaleidoTokenFaucet_BadConfig");
  });

  it("only the owner may setDrips", async function () {
    const faucet = await deployFaucet();
    await expect(
      faucet.connect(alice).setDrips([await usdc.getAddress()], [USDC_DRIP])
    ).to.be.revertedWithCustomError(faucet, "OwnableUnauthorizedAccount");
  });

  /* ------------------------------------------------------------ constructor -- */

  it("refuses mismatched token and amount lists", async function () {
    const Faucet = await ethers.getContractFactory("KaleidoTokenFaucet");
    await expect(
      Faucet.deploy(
        [await usdc.getAddress(), await dai.getAddress()],
        [USDC_DRIP],
        HOUR
      )
    ).to.be.revertedWithCustomError(Faucet, "KaleidoTokenFaucet_BadConfig");
  });

  it("refuses the zero address as an asset", async function () {
    const Faucet = await ethers.getContractFactory("KaleidoTokenFaucet");
    await expect(
      Faucet.deploy([ethers.ZeroAddress], [USDC_DRIP], HOUR)
    ).to.be.revertedWithCustomError(Faucet, "KaleidoTokenFaucet_BadConfig");
  });

  it("deploys empty and can be filled in afterwards", async function () {
    /*
     * The KLD case, and why an empty list is legal. No contract in this repo mints
     * KLD, so a chain can stand a faucet up for the assets it has and add KLD the
     * day that token exists — the old constructor required a non-zero KLD address
     * and so could not be deployed at all.
     */
    const Faucet = await ethers.getContractFactory("KaleidoTokenFaucet");
    const faucet = await Faucet.deploy([], [], HOUR);
    await faucet.waitForDeployment();

    expect(await faucet.assetCount()).to.equal(0n);
    const info = await faucet.assetInfo(alice.address);
    expect(info.tokens).to.deep.equal([]);

    await (await faucet.setDrip(await usdc.getAddress(), USDC_DRIP)).wait();
    expect(await faucet.assetCount()).to.equal(1n);
  });

  /* ------------------------------------------------- native gas token -- */

  describe("the native gas token (sentinel address(1))", function () {
    /*
     * The faucet hands out the chain's native gas token under the sentinel
     * address(1), through the same claim/cooldown/stock machinery as an ERC20 —
     * because a wallet with no gas cannot pay for the transaction that would
     * claim the ERC20s.
     *
     * The hazard every one of these guards against: address(1) is the ecrecover
     * precompile, so a `balanceOf` staticcall against it returns decodable
     * garbage instead of reverting. Every balance and payout path has to branch
     * on the sentinel BEFORE it reaches IERC20, and one that forgot to would
     * MISREPORT its native stock, not fail loudly. So stock is asserted against
     * the contract's real ether balance throughout, and payouts against the
     * faucet's own balance delta (it is never the tx sender, so that delta is
     * exact and free of gas) — a path that read the precompile would not match
     * either.
     */
    const NATIVE = "0x0000000000000000000000000000000000000001";
    const ETH_DRIP = ethers.parseEther("0.05");

    /**
     * A faucet listing USDC and the native sentinel (native second), funded with
     * `refills` drips of each. Native is funded by a plain send, which is the
     * path receive() exists to accept.
     */
    async function deployNativeFaucet({ cooldown = HOUR, refills = 10n } = {}) {
      const Faucet = await ethers.getContractFactory("KaleidoTokenFaucet");
      const faucet = await Faucet.deploy(
        [await usdc.getAddress(), NATIVE],
        [USDC_DRIP, ETH_DRIP],
        cooldown
      );
      await faucet.waitForDeployment();
      const addr = await faucet.getAddress();
      if (refills > 0n) {
        await (await usdc.mint(addr, USDC_DRIP * refills)).wait();
        await (
          await owner.sendTransaction({ to: addr, value: ETH_DRIP * refills })
        ).wait();
      }
      return faucet;
    }

    it("is listed and priced like any other asset", async function () {
      const faucet = await deployNativeFaucet({ refills: 0n });

      expect(await faucet.assetCount()).to.equal(2n);
      expect(await faucet.assets(1)).to.equal(NATIVE);
      const drip = await faucet.drips(NATIVE);
      expect(drip.amount).to.equal(ETH_DRIP);
      expect(drip.listed).to.equal(true);
    });

    it("receive() takes native funding and assetInfo reports it as stock", async function () {
      const faucet = await deployNativeFaucet({ refills: 3n });
      const addr = await faucet.getAddress();

      expect(await ethers.provider.getBalance(addr)).to.equal(ETH_DRIP * 3n);

      const info = await faucet.assetInfo(alice.address);
      // native is listed second; its stock is address(this).balance, not a
      // balanceOf against the precompile.
      expect(info.tokens[1]).to.equal(NATIVE);
      expect(info.amounts[1]).to.equal(ETH_DRIP);
      expect(info.balances[1]).to.equal(ETH_DRIP * 3n);
    });

    it("pays the native drip out of the faucet's own balance", async function () {
      const faucet = await deployNativeFaucet();
      const addr = await faucet.getAddress();

      const before = await ethers.provider.getBalance(addr);
      await (await faucet.connect(alice).claim(NATIVE)).wait();
      const after = await ethers.provider.getBalance(addr);

      expect(before - after).to.equal(ETH_DRIP);
      expect(await faucet.totalClaimed(NATIVE)).to.equal(ETH_DRIP);
    });

    it("delivers spendable gas to the claimer, net of the claim's own gas", async function () {
      const faucet = await deployNativeFaucet();

      const balBefore = await ethers.provider.getBalance(alice.address);
      const receipt = await (await faucet.connect(alice).claim(NATIVE)).wait();
      const gas = receipt.gasUsed * receipt.gasPrice;
      const balAfter = await ethers.provider.getBalance(alice.address);

      // The claimer is the tx sender, so their credit is the drip less the gas
      // they burned claiming it. Holds whether or not the network charges a fee.
      expect(balAfter - balBefore + gas).to.equal(ETH_DRIP);
    });

    it("decrements native stock after a claim", async function () {
      const faucet = await deployNativeFaucet({ refills: 3n });

      await (await faucet.connect(alice).claim(NATIVE)).wait();

      const info = await faucet.assetInfo(alice.address);
      expect(info.balances[1]).to.equal(ETH_DRIP * 2n);
    });

    it("claimMany pays native alongside an ERC20 in one transaction", async function () {
      const faucet = await deployNativeFaucet();
      const addr = await faucet.getAddress();
      const list = [await usdc.getAddress(), NATIVE];

      expect(await faucet.connect(alice).claimMany.staticCall(list)).to.equal(
        2n
      );

      const before = await ethers.provider.getBalance(addr);
      await (await faucet.connect(alice).claimMany(list)).wait();
      const after = await ethers.provider.getBalance(addr);

      expect(await usdc.balanceOf(alice.address)).to.equal(USDC_DRIP);
      expect(before - after).to.equal(ETH_DRIP);
    });

    it("enforces the native cooldown without locking the ERC20", async function () {
      const faucet = await deployNativeFaucet();

      await (await faucet.connect(alice).claim(NATIVE)).wait();
      await expect(
        faucet.connect(alice).claim(NATIVE)
      ).to.be.revertedWithCustomError(
        faucet,
        "KaleidoTokenFaucet_CooldownNotOver"
      );

      // The ERC20's own cooldown is untouched by the native claim.
      await expect(faucet.connect(alice).claim(await usdc.getAddress())).to.not
        .be.reverted;
    });

    it("reverts InsufficientContractBalance when native stock is short", async function () {
      // USDC funded, native deliberately not — assertInfo would read the
      // precompile here if the branch were missing.
      const Faucet = await ethers.getContractFactory("KaleidoTokenFaucet");
      const faucet = await Faucet.deploy(
        [await usdc.getAddress(), NATIVE],
        [USDC_DRIP, ETH_DRIP],
        HOUR
      );
      await faucet.waitForDeployment();
      await (await usdc.mint(await faucet.getAddress(), USDC_DRIP)).wait();

      await expect(
        faucet.connect(alice).claim(NATIVE)
      ).to.be.revertedWithCustomError(
        faucet,
        "KaleidoTokenFaucet_InsufficientContractBalance"
      );

      // Control: the batch skips the empty native and still pays the funded USDC.
      const list = [await usdc.getAddress(), NATIVE];
      expect(await faucet.connect(alice).claimMany.staticCall(list)).to.equal(
        1n
      );
    });

    it("withdraw sweeps the whole native balance with amount 0", async function () {
      const faucet = await deployNativeFaucet({ refills: 5n });
      const addr = await faucet.getAddress();

      // bob is the recipient, not the sender, so his credit is exact and gas-free.
      const before = await ethers.provider.getBalance(bob.address);
      await (await faucet.withdraw(NATIVE, bob.address, 0)).wait();
      const after = await ethers.provider.getBalance(bob.address);

      expect(after - before).to.equal(ETH_DRIP * 5n);
      expect(await ethers.provider.getBalance(addr)).to.equal(0n);
    });

    it("withdraw sends a partial native amount", async function () {
      const faucet = await deployNativeFaucet({ refills: 5n });
      const addr = await faucet.getAddress();

      await (await faucet.withdraw(NATIVE, bob.address, ETH_DRIP)).wait();
      expect(await ethers.provider.getBalance(addr)).to.equal(ETH_DRIP * 4n);
    });

    it("reverts NativeTransferFailed when the recipient rejects value", async function () {
      const faucet = await deployNativeFaucet({ refills: 5n });
      // MockERC20 has no receive or payable fallback, so it rejects a plain
      // send — the same low-level call and revert the native claim path uses.
      const rejecter = await usdc.getAddress();

      await expect(
        faucet.withdraw(NATIVE, rejecter, ETH_DRIP)
      ).to.be.revertedWithCustomError(
        faucet,
        "KaleidoTokenFaucet_NativeTransferFailed"
      );
    });

    it("the reentrancy guard stops a native claim from re-entering", async function () {
      /*
       * cooldown 0 is essential: at any positive cooldown the second entry is
       * refused by lastClaimed alone (set before the payout, CEI), so the guard
       * would look load-bearing when it was not. At 0 only nonReentrant stops the
       * re-entry — a guardless faucet would pay this contract twice.
       */
      const Faucet = await ethers.getContractFactory("KaleidoTokenFaucet");
      const faucet = await Faucet.deploy([NATIVE], [ETH_DRIP], 0);
      await faucet.waitForDeployment();
      const addr = await faucet.getAddress();
      await (
        await owner.sendTransaction({ to: addr, value: ETH_DRIP * 5n })
      ).wait();

      const Attacker = await ethers.getContractFactory("FaucetReentrant");
      const attacker = await Attacker.deploy(addr);
      await attacker.waitForDeployment();

      await (await attacker.attack()).wait();

      expect(await attacker.received()).to.equal(1n); // paid once, not drained
      expect(await attacker.reentryReverted()).to.equal(true);
      expect(await faucet.totalClaimed(NATIVE)).to.equal(ETH_DRIP);
      expect(await ethers.provider.getBalance(addr)).to.equal(ETH_DRIP * 4n);
      expect(
        await ethers.provider.getBalance(await attacker.getAddress())
      ).to.equal(ETH_DRIP);
    });
  });
});
