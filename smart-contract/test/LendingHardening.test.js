const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { getSelectors, FacetCutAction } = require("../scripts/libraries/diamond.js");

/**
 * The pre-mainnet hardening for the lending diamond (Arc mainnet, Phase A).
 *
 * Each case pins one fix that exists because the alternative, found after a
 * mainnet deploy, would have meant a redeploy or stranded funds:
 *   - Diamond.initialize is gone (immutable, and wrote one slot off)
 *   - ownership is two-step (a wrong single-step transfer is unrecoverable)
 *   - a pause that stops new risk but never traps anyone
 *   - one stale feed no longer freezes users who don't hold that asset
 *   - registration can't silently duplicate, zero or overwrite a feed
 *   - a feed can be changed in place without stranding depositors
 *   - the per-feed age cap fits Arc's 24h-heartbeat Chainlink feeds
 *
 * Runs behind a real diamond with the Arc-mainnet shape: an 8-decimal Chainlink
 * style aggregator per asset, a 6-decimal EURC, an 8-decimal cirBTC, native
 * USDC loanable. Mocks stand in for the tokens and aggregators; the diamond,
 * facets and AggregatorPriceOracle are the real contracts.
 */
describe("Lending hardening (Arc mainnet Phase A)", function () {
  // Pyth ids used as keys (same ones the scripts register).
  const USDC_ID = "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a";
  const EURC_ID = "0x76fa85158bf14ede77087fe3ae472f66213f6ea2f5b411cb2de472794990fa5c";
  const BTC_ID = "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";
  const NATIVE = "0x0000000000000000000000000000000000000001";
  const DAY_PLUS = 97200; // the bound the Arc table installs: 27h

  let owner, alice, bob, carol, oracle;
  let diamondAddress, protocol, admin, ownership;
  let eurc, cirbtc, eurcFeed, btcFeed, usdcFeed;

  async function deployDiamond() {
    [owner, alice, bob, carol] = await ethers.getSigners();

    const cutFacet = await (await ethers.getContractFactory("DiamondCutFacet")).deploy();
    const diamond = await (await ethers.getContractFactory("Diamond")).deploy(
      owner.address,
      await cutFacet.getAddress(),
    );
    diamondAddress = await diamond.getAddress();

    const facets = [];
    for (const name of ["ProtocolFacet", "LendingAdminFacet", "OwnershipFacet"]) {
      const f = await (await ethers.getContractFactory(name)).deploy();
      facets.push({
        facetAddress: await f.getAddress(),
        action: FacetCutAction.Add,
        functionSelectors: getSelectors(f),
      });
    }
    const cut = await ethers.getContractAt("IDiamondCut", diamondAddress);
    await (await cut.diamondCut(facets, ethers.ZeroAddress, "0x")).wait();

    protocol = await ethers.getContractAt("ProtocolFacet", diamondAddress);
    admin = await ethers.getContractAt("LendingAdminFacet", diamondAddress);
    ownership = await ethers.getContractAt("OwnershipFacet", diamondAddress);

    // Oracle: the real AggregatorPriceOracle over Chainlink-style 8-dec mocks.
    const Mock = await ethers.getContractFactory("MockAggregatorV3");
    usdcFeed = await Mock.deploy(8, "USDC / USD", 99_990_000n);
    eurcFeed = await Mock.deploy(8, "EURC / USD", 113_850_000n);
    btcFeed = await Mock.deploy(8, "BTC / USD", 8_463_533_000_000n);
    oracle = await (await ethers.getContractFactory("AggregatorPriceOracle")).deploy();
    await oracle.setFeed(USDC_ID, await usdcFeed.getAddress());
    await oracle.setFeed(EURC_ID, await eurcFeed.getAddress());
    await oracle.setFeed(BTC_ID, await btcFeed.getAddress());

    await protocol.setPythOracle(await oracle.getAddress());
    await protocol.setPriceBounds(300, 100);
    for (const id of [USDC_ID, EURC_ID, BTC_ID]) await protocol.setFeedMaxAge(id, DAY_PLUS);

    const Erc = await ethers.getContractFactory("MockERC20");
    eurc = await Erc.deploy("EURC", "EURC", 6);
    cirbtc = await Erc.deploy("Circle Wrapped Bitcoin", "cirBTC", 8);

    // The Arc launch set, in the order register-tokens.js uses (collateral first).
    await protocol.addCollateralToken(await eurc.getAddress(), EURC_ID);
    await protocol.addCollateralToken(await cirbtc.getAddress(), BTC_ID);
    await protocol.addLoanableToken(NATIVE, USDC_ID);
  }

  async function fund(user, token, amount) {
    await token.mint(user.address, amount);
    await token.connect(user).approve(diamondAddress, amount);
  }

  beforeEach(deployDiamond);

  describe("the Diamond's own (immutable) surface", function () {
    it("has no initialize, example or receive — nothing compiled in that can't be removed", async function () {
      const artifact = await ethers.getContractFactory("Diamond");
      const names = artifact.interface.fragments.map((f) => f.name || f.type);
      expect(names).to.not.include("initialize");
      expect(names).to.not.include("example");
      expect(artifact.interface.fragments.some((f) => f.type === "receive")).to.equal(false);
    });

    it("a plain native transfer is refused, not silently kept", async function () {
      await expect(alice.sendTransaction({ to: diamondAddress, value: 10n ** 18n }))
        .to.be.revertedWith("Diamond: Function does not exist");
      expect(await ethers.provider.getBalance(diamondAddress)).to.equal(0n);
    });
  });

  describe("storage layout (what every upgrade depends on)", function () {
    it("the reentrancy guard is slot 0 and the lending Layout starts at slot 1", async function () {
      // Before any guarded call the diamond's slot 0 is untouched.
      expect(BigInt(await ethers.provider.getStorage(diamondAddress, 0))).to.equal(0n);
      await fund(alice, eurc, 1_000_000n);
      await protocol.connect(alice).depositCollateral(await eurc.getAddress(), 1_000_000n);
      // nonReentrant leaves NOT_ENTERED (1) behind in slot 0 …
      expect(BigInt(await ethers.provider.getStorage(diamondAddress, 0))).to.equal(1n);
      // … and s_priceFeeds (the Layout's first field) is the mapping rooted at slot 1.
      const key = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [await eurc.getAddress(), 1]),
      );
      expect(await ethers.provider.getStorage(diamondAddress, key)).to.equal(EURC_ID);
    });
  });

  describe("two-step ownership", function () {
    it("refuses address(0)", async function () {
      await expect(ownership.transferOwnership(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(ownership, "OwnershipZeroAddress");
    });

    it("nominating changes nothing until the nominee accepts", async function () {
      await expect(ownership.transferOwnership(alice.address))
        .to.emit(ownership, "OwnershipTransferStarted")
        .withArgs(owner.address, alice.address);
      expect(await ownership.owner()).to.equal(owner.address);
      expect(await ownership.pendingOwner()).to.equal(alice.address);
      // Still the old owner's diamond: it can still administer.
      await protocol.setBPS(500);
    });

    it("only the nominee can accept, and then the old owner is out", async function () {
      await ownership.transferOwnership(alice.address);
      await expect(ownership.connect(bob).acceptOwnership())
        .to.be.revertedWithCustomError(ownership, "OwnershipNotPendingOwner");
      await ownership.connect(alice).acceptOwnership();
      expect(await ownership.owner()).to.equal(alice.address);
      expect(await ownership.pendingOwner()).to.equal(ethers.ZeroAddress);
      await expect(protocol.setBPS(500)).to.be.reverted;
      await protocol.connect(alice).setBPS(500);
    });

    it("a wrong nominee is fixed by nominating again", async function () {
      await ownership.transferOwnership(bob.address); // the typo
      await ownership.transferOwnership(alice.address); // the fix
      await expect(ownership.connect(bob).acceptOwnership()).to.be.reverted;
      await ownership.connect(alice).acceptOwnership();
      expect(await ownership.owner()).to.equal(alice.address);
    });
  });

  describe("pause", function () {
    it("only the owner can pause or unpause", async function () {
      await expect(admin.connect(alice).pause()).to.be.reverted;
      await admin.pause();
      await expect(admin.connect(alice).unpause()).to.be.reverted;
    });

    it("a pause set by LendingAdminFacet is seen by ProtocolFacet (same storage slots)", async function () {
      await admin.pause();
      expect(await admin.paused()).to.equal(true);
      const later = (await time.latest()) + 3 * 86400;
      await expect(
        protocol.connect(alice).createLendingRequest(20n * 10n ** 18n, 500, later, NATIVE),
      ).to.be.revertedWithCustomError(protocol, "Protocol__Paused");
    });

    it("blocks servicing a request and borrowing from a listing", async function () {
      await admin.pause();
      await expect(
        protocol.connect(bob).serviceRequest(1, NATIVE, { value: 10n ** 18n }),
      ).to.be.revertedWithCustomError(protocol, "Protocol__Paused");
      await expect(
        protocol.connect(alice).requestLoanFromListing(1, 10n ** 19n),
      ).to.be.revertedWithCustomError(protocol, "Protocol__Paused");
    });

    it("never blocks topping up collateral — a borrower must be able to defend a position", async function () {
      await fund(alice, eurc, 1_000_000n);
      await admin.pause();
      await protocol.connect(alice).depositCollateral(await eurc.getAddress(), 1_000_000n);
      expect(await protocol.gets_addressToCollateralDeposited(alice.address, await eurc.getAddress()))
        .to.equal(1_000_000n);
    });

    it("never traps funds: withdrawing still works while paused", async function () {
      await fund(alice, eurc, 1_000_000_000n);
      await protocol.connect(alice).depositCollateral(await eurc.getAddress(), 500_000_000n);
      await admin.pause();
      await protocol.connect(alice).withdrawCollateral(await eurc.getAddress(), 500_000_000n);
      expect(await eurc.balanceOf(alice.address)).to.equal(1_000_000_000n);
    });

    it("blocks opening a listing and a request while paused, and unpause restores them", async function () {
      await admin.pause();
      const later = (await time.latest()) + 3 * 86400;
      await expect(
        protocol.connect(bob).createLoanListing(
          10n ** 20n, 10n ** 19n, 10n ** 20n, later, 500, NATIVE, { value: 10n ** 20n },
        ),
      ).to.be.revertedWithCustomError(protocol, "Protocol__Paused");
      await expect(
        protocol.connect(alice).createLendingRequest(10n ** 19n, 500, later, NATIVE),
      ).to.be.revertedWithCustomError(protocol, "Protocol__Paused");
      await admin.unpause();
      await fund(alice, eurc, 100_000_000n); // $113.85 of collateral
      await protocol.connect(alice).depositCollateral(await eurc.getAddress(), 100_000_000n);
      await protocol.connect(alice).createLendingRequest(20n * 10n ** 18n, 500, later, NATIVE);
    });
  });

  describe("one stale feed no longer freezes everyone", function () {
    it("a user who holds only EURC is priced even while BTC/USD is stale", async function () {
      await fund(alice, eurc, 100_000_000n); // 100 EURC
      await protocol.connect(alice).depositCollateral(await eurc.getAddress(), 100_000_000n);
      await fund(bob, cirbtc, 1_000_000n); // 0.01 cirBTC
      await protocol.connect(bob).depositCollateral(await cirbtc.getAddress(), 1_000_000n);

      // BTC/USD goes stale past its bound; EURC stays fresh.
      await time.increase(DAY_PLUS + 60);
      await eurcFeed.setUpdatedAt(await time.latest());
      await usdcFeed.setUpdatedAt(await time.latest());

      const aliceValue = await protocol.getAccountCollateralValue(alice.address);
      expect(aliceValue).to.equal(113_850_000_000_000_000_000n); // 100 × $1.1385, 18dp
      // Available value is priced the same way.
      expect(await protocol.getAccountAvailableValue(alice.address)).to.equal(aliceValue);
      // The holder of the stale asset is refused, as before — fail closed.
      await expect(protocol.getAccountCollateralValue(bob.address))
        .to.be.revertedWithCustomError(protocol, "Protocol__StalePrice");
    });

    it("a 6-dec EURC and an 8-dec cirBTC both value correctly", async function () {
      await fund(alice, eurc, 1_000_000n); // 1 EURC
      await fund(alice, cirbtc, 100_000_000n); // 1 cirBTC
      await protocol.connect(alice).depositCollateral(await eurc.getAddress(), 1_000_000n);
      await protocol.connect(alice).depositCollateral(await cirbtc.getAddress(), 100_000_000n);
      expect(await protocol.getAccountCollateralValue(alice.address)).to.equal(
        1_138_500_000_000_000_000n + 84_635_330_000_000_000_000_000n,
      );
    });
  });

  describe("deposits and exits", function () {
    it("native USDC (loanable only) cannot be deposited as collateral", async function () {
      await expect(
        protocol.connect(alice).depositCollateral(NATIVE, 10n ** 18n, { value: 10n ** 18n }),
      ).to.be.revertedWithCustomError(protocol, "Protocol__TokenNotAllowed");
    });

    it("a debt-free user withdraws even while their collateral's feed is stale", async function () {
      await fund(alice, cirbtc, 1_000_000n);
      await protocol.connect(alice).depositCollateral(await cirbtc.getAddress(), 1_000_000n);
      await time.increase(DAY_PLUS + 60); // BTC/USD (and every feed) now stale
      await expect(protocol.getAccountCollateralValue(alice.address))
        .to.be.revertedWithCustomError(protocol, "Protocol__StalePrice");
      // HALF, so a balance remains that would have to be priced if the health
      // check priced collateral before looking at debt (the old order).
      await protocol.connect(alice).withdrawCollateral(await cirbtc.getAddress(), 500_000n);
      expect(await cirbtc.balanceOf(alice.address)).to.equal(500_000n);
    });
  });

  describe("liquidation seizes free collateral when the lock falls short", function () {
    /* Found in the Arc mainnet fork rehearsal: eligibility used the ACCOUNT health
     * factor but seizure took only the collateral LOCKED to the loan, so an
     * over-collateralised borrower's lender recovered ≈ 67% and the liquidator
     * nothing. Pass 2 now takes the shortfall from the borrower's free balance. */
    const LOAN = 10_500_000_000_000_000_000n; // 10.5 USDC (18dp native)
    const feeVaultAddr = () => carol.address;

    async function borrow(user, amount) {
      await protocol.connect(user).createLendingRequest(amount, 1000, (await time.latest()) + 3 * 86400, NATIVE);
      const all = await protocol.getAllRequests(0, 1000);
      const id = all[all.length - 1].requestId;
      await protocol.connect(bob).serviceRequest(id, NATIVE, { value: amount });
      return id;
    }

    beforeEach(async function () {
      await protocol.setFeeVault(feeVaultAddr());
      await protocol.setLiquidityBps(640);
      await protocol.setBPS(500);
      await fund(alice, cirbtc, 60_000n); // 0.0006 cirBTC ≈ $50.8
      await protocol.connect(alice).depositCollateral(await cirbtc.getAddress(), 60_000n);
    });

    it("makes the lender whole, pays liquidator and vault, and leaves the borrower's other loan alone", async function () {
      const id1 = await borrow(alice, LOAN);
      const id2 = await borrow(alice, LOAN);
      const token = await cirbtc.getAddress();
      const locked1 = await protocol.getRequestToColateral(id1, token);
      const locked2 = await protocol.getRequestToColateral(id2, token);
      expect(locked1 + locked2).to.be.lessThan(60_000n); // spare, unlocked collateral exists

      await btcFeed.setAnswer(8_463_533_000_000n / 2n); // BTC −50%
      expect(await protocol.getHealthFactor(alice.address)).to.be.lessThan(10n ** 18n);

      const debt = (await protocol.getRequest(id1)).totalRepayment;
      await protocol.connect(owner).liquidateUserRequest(id1);

      const lenderGot = await protocol.gets_addressToCollateralDeposited(bob.address, token);
      const lenderUsd = await protocol.getUsdValue(token, lenderGot, 8);
      const debtUsd = await protocol.getUsdValue(NATIVE, debt, 18);
      // Whole, give or take one base unit of rounding (1 sat ≈ $0.0004 here).
      expect(lenderUsd + 10n ** 15n).to.be.gte(debtUsd);
      expect(await protocol.gets_addressToCollateralDeposited(owner.address, token)).to.be.greaterThan(0n); // liquidator
      expect(await protocol.gets_addressToCollateralDeposited(feeVaultAddr(), token)).to.be.greaterThan(0n); // vault
      // More than the lock was taken — pass 2 reached the free balance …
      const seized = 60_000n - (await protocol.gets_addressToCollateralDeposited(alice.address, token));
      expect(seized).to.be.greaterThan(locked1);
      // … but loan 2's lock, which backs a different lender, was not touched.
      expect(await protocol.getRequestToColateral(id2, token)).to.equal(locked2);
      // The borrower keeps whatever was not needed.
      expect(await protocol.gets_addressToCollateralDeposited(alice.address, token)).to.be.greaterThan(locked2);
      // Ledger invariant: deposited == free + every remaining lock (loan 2's).
      expect(await protocol.gets_addressToCollateralDeposited(alice.address, token)).to.equal(
        (await protocol.gets_addressToAvailableBalance(alice.address, token)) + locked2,
      );
    });

    it("pass 2 spans tokens (and the same token in both passes), keeping the ledger consistent", async function () {
      // EURC as well: a loan locks the same fraction of EVERY collateral the
      // borrower holds, and pass 2 walks tokens in listed order (EURC, cirBTC).
      await fund(alice, eurc, 5_000_000n); // 5 EURC ≈ $5.69
      await protocol.connect(alice).depositCollateral(await eurc.getAddress(), 5_000_000n);
      const id = await borrow(alice, 40n * 10n ** 18n); // ≈ 94% of the borrowing limit
      const [e, b] = [await eurc.getAddress(), await cirbtc.getAddress()];
      const freeE = await protocol.gets_addressToAvailableBalance(alice.address, e);
      const freeB = await protocol.gets_addressToAvailableBalance(alice.address, b);
      expect(freeE).to.be.greaterThan(0n);
      expect(freeB).to.be.greaterThan(0n);

      await btcFeed.setAnswer(8_463_533_000_000n / 2n); // the lock falls well short
      await protocol.connect(owner).liquidateUserRequest(id);

      // Pass 2 took the free balance of BOTH tokens (cirBTC was also in pass 1).
      expect(await protocol.gets_addressToAvailableBalance(alice.address, e)).to.equal(0n);
      expect(await protocol.gets_addressToAvailableBalance(alice.address, b)).to.equal(0n);
      // Seized EURC reached the lender, liquidator and vault.
      expect(await protocol.gets_addressToCollateralDeposited(bob.address, e)).to.be.greaterThan(0n);
      // No open loan remains, so for each token deposited == free (no stray lock).
      for (const t of [e, b]) {
        expect(await protocol.gets_addressToCollateralDeposited(alice.address, t)).to.equal(
          await protocol.gets_addressToAvailableBalance(alice.address, t),
        );
        expect(await protocol.getRequestToColateral(id, t)).to.equal(0n);
      }
    });

    it("a borrower whose lock alone covers the debt loses no free collateral", async function () {
      const id = await borrow(alice, LOAN);
      const token = await cirbtc.getAddress();
      const locked = await protocol.getRequestToColateral(id, token);
      // −10%: the account HF is still healthy with 60k sats, so force eligibility
      // by letting the loan go overdue instead.
      await btcFeed.setAnswer((8_463_533_000_000n * 9n) / 10n);
      await time.increase(3 * 86400 + 60);
      await btcFeed.setUpdatedAt(await time.latest());
      await usdcFeed.setUpdatedAt(await time.latest());
      await protocol.connect(owner).liquidateUserRequest(id);
      const seized = 60_000n - (await protocol.gets_addressToCollateralDeposited(alice.address, token));
      expect(seized).to.be.lte(locked); // only the lock was needed
    });
  });

  describe("registration guards", function () {
    it("collateral with a zero feed is refused", async function () {
      const t = await (await ethers.getContractFactory("MockERC20")).deploy("X", "X", 18);
      await expect(protocol.addCollateralToken(await t.getAddress(), ethers.ZeroHash))
        .to.be.revertedWithCustomError(protocol, "Protocol__InvalidPriceFeed");
      await expect(protocol.addCollateralTokens([await t.getAddress()], [ethers.ZeroHash]))
        .to.be.revertedWithCustomError(protocol, "Protocol__InvalidPriceFeed");
    });

    it("a loanable token can be registered only once (it can never be removed)", async function () {
      await expect(protocol.addLoanableToken(NATIVE, USDC_ID))
        .to.be.revertedWithCustomError(protocol, "Protocol__TokenAlreadyExists");
      expect((await protocol.getLoanableAssets()).length).to.equal(1);
    });

    it("a loanable token with a zero feed is refused", async function () {
      const t = await (await ethers.getContractFactory("MockERC20")).deploy("Y", "Y", 6);
      await expect(protocol.addLoanableToken(await t.getAddress(), ethers.ZeroHash))
        .to.be.revertedWithCustomError(protocol, "Protocol__InvalidPriceFeed");
    });

    it("making collateral loanable cannot silently re-price it", async function () {
      // EURC is collateral on EURC_ID; registering it loanable on BTC_ID would
      // have repriced every EURC deposit at bitcoin's price.
      await expect(protocol.addLoanableToken(await eurc.getAddress(), BTC_ID))
        .to.be.revertedWithCustomError(protocol, "Protocol__InvalidPriceFeed");
      // With its own feed it is allowed.
      await protocol.addLoanableToken(await eurc.getAddress(), EURC_ID);
    });
  });

  describe("setTokenFeed", function () {
    it("re-points a feed in place, keeping the token listed and every balance", async function () {
      await fund(alice, eurc, 1_000_000n);
      await protocol.connect(alice).depositCollateral(await eurc.getAddress(), 1_000_000n);
      await expect(admin.setTokenFeed(await eurc.getAddress(), USDC_ID))
        .to.emit(admin, "TokenPriceFeedUpdated")
        .withArgs(await eurc.getAddress(), EURC_ID, USDC_ID);
      expect(await protocol.getAllCollateralToken()).to.include(await eurc.getAddress());
      // Now priced by the new feed ($0.9999), balance untouched.
      expect(await protocol.getAccountCollateralValue(alice.address)).to.equal(999_900_000_000_000_000n);
      await protocol.connect(alice).withdrawCollateral(await eurc.getAddress(), 1_000_000n);
    });

    it("refuses a feed the oracle cannot price, and leaves the old one in place", async function () {
      const unmapped = ethers.id("no such feed");
      await expect(admin.setTokenFeed(await eurc.getAddress(), unmapped))
        .to.be.revertedWithCustomError(oracle, "FeedNotSet");
      await fund(alice, eurc, 1_000_000n);
      await protocol.connect(alice).depositCollateral(await eurc.getAddress(), 1_000_000n);
      expect(await protocol.getAccountCollateralValue(alice.address)).to.equal(1_138_500_000_000_000_000n);
    });

    it("refuses an unregistered token, a zero id, the same id, and non-owners", async function () {
      await expect(admin.setTokenFeed(carol.address, USDC_ID))
        .to.be.revertedWithCustomError(admin, "Protocol__TokenNotAllowed");
      await expect(admin.setTokenFeed(await eurc.getAddress(), ethers.ZeroHash))
        .to.be.revertedWithCustomError(admin, "Protocol__InvalidPriceFeed");
      await expect(admin.setTokenFeed(await eurc.getAddress(), EURC_ID))
        .to.be.revertedWithCustomError(admin, "Protocol__InvalidPriceFeed");
      await expect(admin.connect(alice).setTokenFeed(await eurc.getAddress(), USDC_ID)).to.be.reverted;
    });
  });

  describe("per-feed age cap fits Arc's 24h Chainlink heartbeat", function () {
    it("accepts the 27h Arc bound and the 30h cap, refuses above it", async function () {
      await protocol.setFeedMaxAge(USDC_ID, 97200);
      await protocol.setFeedMaxAge(USDC_ID, 108000);
      await expect(protocol.setFeedMaxAge(USDC_ID, 108001))
        .to.be.revertedWithCustomError(protocol, "Protocol__InvalidPriceBounds");
    });

    it("a stablecoin answer 24h+8min old (the worst walked gap) still prices", async function () {
      await fund(alice, eurc, 1_000_000n);
      await protocol.connect(alice).depositCollateral(await eurc.getAddress(), 1_000_000n);
      await time.increase(86_487);
      expect(await protocol.getAccountCollateralValue(alice.address)).to.equal(1_138_500_000_000_000_000n);
    });
  });
});
