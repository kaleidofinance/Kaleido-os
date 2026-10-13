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
/**
 * The borrow limit counts a loan at what it will OWE.
 *
 * Interest is priced once, for the whole term, at origination, and the health
 * factor reads that full `totalRepayment`. The limit (75% of collateral) used to
 * add the loan at principal only, so a long or high-rate loan cleared it and was
 * then liquidatable the moment it was funded with no price move: 74.9% LTV over
 * 365 days at 10% APR funded at a health factor of 0.971. (Disclosure of
 * 2026-09-23, finding 5; reproduced on the facet before this change.)
 *
 * Three doors take a loan and all three now price the interest: posting a request,
 * drawing from a listing, and a lender funding a request.
 */
describe("Lending: the borrow limit includes prepaid interest", function () {
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

  const U = (n) => ethers.parseUnits(String(n), 18);
  const HF_ONE = 10n ** 18n;
  // ~$1000 of cirBTC at the fixture's $84,635/BTC.
  const SATS = 1_181_500n;

  async function withCollateral() {
    await protocol.setFeeVault(carol.address);
    await protocol.setLiquidityBps(640);
    await protocol.setBPS(500);
    await fund(alice, cirbtc, SATS);
    await protocol.connect(alice).depositCollateral(await cirbtc.getAddress(), SATS);
  }
  const post = async (amount, days, bps = 1000) =>
    protocol.connect(alice).createLendingRequest(amount, bps, (await time.latest()) + days * 86400, NATIVE);
  async function postAndFund(amount, days, bps = 1000) {
    await post(amount, days, bps);
    const all = await protocol.getAllRequests(0, 1000);
    const id = all[all.length - 1].requestId;
    await protocol.connect(bob).serviceRequest(id, NATIVE, { value: amount });
    return id;
  }

  beforeEach(withCollateral);

  it("posting: 74.9% LTV over 365 days at 10% is refused (it used to pass and be liquidatable at once)", async function () {
    await expect(post(U(749), 365)).to.be.revertedWithCustomError(protocol, "Protocol__InsufficientCollateral");
  });

  it("posting: the limit is on principal + interest — 68% LTV at 10%/365d passes, 69% does not", async function () {
    await expect(post(U(690), 365)).to.be.revertedWithCustomError(protocol, "Protocol__InsufficientCollateral");
    const id = await postAndFund(U(680), 365);
    // Funded at a health factor at or above 80/75, so nothing can liquidate it without a price move.
    expect(await protocol.getHealthFactor(alice.address)).to.be.gte((HF_ONE * 106n) / 100n);
    await expect(protocol.connect(owner).liquidateUserRequest(id)).to.be.revertedWithCustomError(protocol, "Protocol__PositionHealthy");
  });

  it("posting: a short term keeps nearly all the room — 74% at 10% for 7 days still passes", async function () {
    const id = await postAndFund(U(740), 7);
    expect(await protocol.getHealthFactor(alice.address)).to.be.gte(HF_ONE);
    await expect(protocol.connect(owner).liquidateUserRequest(id)).to.be.revertedWithCustomError(protocol, "Protocol__PositionHealthy");
  });

  it("listing: a draw whose interest pushes it past the limit is refused, and one inside it lands healthy", async function () {
    await protocol.connect(bob).createLoanListing(U(900), U(1), U(900), (await time.latest()) + 365 * 86400, 1000, NATIVE, { value: U(900) });
    const lid = await protocol.getListingId();
    await expect(protocol.connect(alice).requestLoanFromListing(lid, U(749)))
      .to.be.revertedWithCustomError(protocol, "Protocol__InsufficientCollateral");
    await protocol.connect(alice).requestLoanFromListing(lid, U(680));
    expect(await protocol.getHealthFactor(alice.address)).to.be.gte((HF_ONE * 106n) / 100n);
  });

  it("listing: an aggressive lender cannot use a high rate to set a borrower up for liquidation", async function () {
    // 50% APR for a year: 200 of principal already owes 300, i.e. 30% of the collateral.
    await protocol.connect(bob).createLoanListing(U(900), U(1), U(900), (await time.latest()) + 365 * 86400, 5000, NATIVE, { value: U(900) });
    const lid = await protocol.getListingId();
    await expect(protocol.connect(alice).requestLoanFromListing(lid, U(520)))
      .to.be.revertedWithCustomError(protocol, "Protocol__InsufficientCollateral"); // owes 780
    await protocol.connect(alice).requestLoanFromListing(lid, U(480)); // owes 720 = 72%
    expect(await protocol.getHealthFactor(alice.address)).to.be.gte((HF_ONE * 106n) / 100n);
  });

  it("funding: a request that was inside the limit when posted is refused if the collateral has since fallen too far", async function () {
    await post(U(680), 365); // owes ~748 — inside the 750 limit at $84.6k BTC
    const all = await protocol.getAllRequests(0, 1000);
    const id = all[all.length - 1].requestId;
    await btcFeed.setAnswer(8_463_533_000_000n * 9n / 10n); // BTC −10%: collateral ~$900, 80% of it = 720
    // Principal alone (680) would still read healthy at 720; what it OWES (~748) does not.
    await expect(protocol.connect(bob).serviceRequest(id, NATIVE, { value: U(680) }))
      .to.be.revertedWithCustomError(protocol, "Protocol__InsufficientCollateral");
  });
});
