const { expect } = require("chai");
const { ethers } = require("hardhat");
const { getSelectors, FacetCutAction } = require("../scripts/libraries/diamond.js");

/**
 * ProtocolFacet.setFeedMaxAge / getFeedMaxAge, behind a real diamond.
 *
 * These exist so three of the five deploy targets can price anything at all:
 * Sepolia's Chainlink USDC/USD answered 13,438s old and Robinhood's API3 dAPI has
 * a 24-hour heartbeat, against a global bound of 300s. Without a per-feed override
 * every deposit, borrow, health-factor read and liquidation on those assets
 * reverts, while registration itself looks perfectly successful.
 *
 * Behind a diamond rather than standalone, and that is not incidental: the setter
 * calls `LibDiamond.enforceIsContractOwner()`, which reads LibDiamond's own
 * storage slot. A directly-deployed ProtocolFacet has owner == address(0) there,
 * so every call would revert for a reason that has nothing to do with the logic
 * under test.
 *
 * scripts/register-tokens.js sends these calls and reads the value back rather
 * than trusting a status-1 receipt. What that read-back is worth depends on the
 * contract actually behaving as its docstring claims, which is what this asserts.
 */
describe("ProtocolFacet — per-feed staleness bounds", function () {
  /** Constants.MAX_FEED_PRICE_AGE — 25 hours, the ceiling the setter enforces. */
  const MAX_FEED_PRICE_AGE = 90000n;

  const ETH_USD =
    "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
  const USDC_USD =
    "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a";

  let protocol, owner, other;

  before(async function () {
    /* One diamond for the whole describe: cutting ProtocolFacet is the slow part
     * and none of these cases mutate anything another case reads. */
    [owner, other] = await ethers.getSigners();

    const DiamondCutFacet = await ethers.getContractFactory("DiamondCutFacet");
    const diamondCutFacet = await DiamondCutFacet.deploy();
    await diamondCutFacet.waitForDeployment();

    const Diamond = await ethers.getContractFactory("Diamond");
    const diamond = await Diamond.deploy(
      owner.address,
      await diamondCutFacet.getAddress(),
    );
    await diamond.waitForDeployment();
    const diamondAddress = await diamond.getAddress();

    const ProtocolFacet = await ethers.getContractFactory("ProtocolFacet");
    const protocolFacet = await ProtocolFacet.deploy();
    await protocolFacet.waitForDeployment();

    const diamondCut = await ethers.getContractAt("IDiamondCut", diamondAddress);
    const tx = await diamondCut.diamondCut(
      [
        {
          facetAddress: await protocolFacet.getAddress(),
          action: FacetCutAction.Add,
          functionSelectors: getSelectors(protocolFacet),
        },
      ],
      ethers.ZeroAddress,
      "0x",
    );
    const receipt = await tx.wait();
    expect(receipt.status).to.equal(1);

    protocol = await ethers.getContractAt("ProtocolFacet", diamondAddress);
  });

  it("defaults to 0, meaning no override", async function () {
    /* The default has to be 0 and 0 has to mean "inherit", because every feed the
     * protocol has ever registered was written before this function existed. If
     * the unset value meant "zero seconds allowed" instead, cutting this facet in
     * would have taken every existing market offline. */
    expect(await protocol.getFeedMaxAge(ETH_USD)).to.equal(0n);
  });

  it("stores a bound and reads it back", async function () {
    await protocol.setFeedMaxAge(ETH_USD, 5400);
    expect(await protocol.getFeedMaxAge(ETH_USD)).to.equal(5400n);
  });

  it("emits FeedMaxAgeUpdated so the choice is auditable from logs", async function () {
    /* Loosening a staleness bound is a risk decision. The event is how it stays
     * visible after the fact rather than being a silent slot write. */
    await expect(protocol.setFeedMaxAge(USDC_USD, 86400))
      .to.emit(protocol, "FeedMaxAgeUpdated")
      .withArgs(USDC_USD, 86400n);
  });

  it("keeps bounds independent per feed", async function () {
    /* The whole point. Sepolia measured ETH/USD at 1,594s and USDC/USD at 13,438s
     * in the same block — an 8x spread on one chain. A global bound loose enough
     * for the stablecoin would accept a four-hour-old ETH price to liquidate
     * against. */
    await protocol.setFeedMaxAge(ETH_USD, 5400);
    await protocol.setFeedMaxAge(USDC_USD, 86400);

    expect(await protocol.getFeedMaxAge(ETH_USD)).to.equal(5400n);
    expect(await protocol.getFeedMaxAge(USDC_USD)).to.equal(86400n);
  });

  it("accepts exactly MAX_FEED_PRICE_AGE", async function () {
    /* Robinhood's API3 dAPI is configured at 90000 in aggregator-feeds.js — the
     * boundary value. An off-by-one in the comparison would reject the one entry
     * the ceiling was raised to accommodate. */
    await protocol.setFeedMaxAge(ETH_USD, MAX_FEED_PRICE_AGE);
    expect(await protocol.getFeedMaxAge(ETH_USD)).to.equal(MAX_FEED_PRICE_AGE);
  });

  it("rejects a bound above MAX_FEED_PRICE_AGE", async function () {
    /* register-tokens.js staticCalls before sending precisely to surface this as
     * a table problem rather than an opaque diamond-fallback revert. */
    await expect(
      protocol.setFeedMaxAge(ETH_USD, MAX_FEED_PRICE_AGE + 1n),
    ).to.be.revertedWithCustomError(protocol, "Protocol__InvalidPriceBounds");
  });

  it("rejects the zero feed id", async function () {
    /* bytes32(0) is what an unregistered token's s_priceFeeds entry reads as, so
     * accepting it would let a typo write a bound for "no feed". */
    await expect(
      protocol.setFeedMaxAge(ethers.ZeroHash, 5400),
    ).to.be.revertedWithCustomError(protocol, "Protocol__InvalidPriceBounds");
  });

  it("accepts 0 as a clear, not as a rejection", async function () {
    /* Documented behaviour worth pinning: 0 returns the feed to the global bound.
     * There is no value of this setting that disables the age check — the
     * fallback still reverts if the global bound is unset. */
    await protocol.setFeedMaxAge(USDC_USD, 86400);
    expect(await protocol.getFeedMaxAge(USDC_USD)).to.equal(86400n);

    await protocol.setFeedMaxAge(USDC_USD, 0);
    expect(await protocol.getFeedMaxAge(USDC_USD)).to.equal(0n);
  });

  it("lets only the diamond owner set a bound", async function () {
    /* An unpermissioned setter here would let anyone widen the staleness window
     * on a volatile feed and then liquidate against a price that stopped being
     * true — strictly worse than the feed refusing to price. */
    await expect(protocol.connect(other).setFeedMaxAge(ETH_USD, 5400)).to.be
      .reverted;
  });

  it("leaves getFeedMaxAge readable by anyone", async function () {
    /* The frontend needs the bound that was actually applied to explain a stale
     * revert, and the global value is the wrong answer whenever an override is
     * set. A permissioned read would make the error message unavailable to the
     * user seeing the error. */
    await protocol.setFeedMaxAge(ETH_USD, 5400);
    expect(await protocol.connect(other).getFeedMaxAge(ETH_USD)).to.equal(5400n);
  });
});
