const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * AggregatorPriceOracle — the Chainlink / API3 backend for chains where Pyth is
 * stale or absent (Sepolia, BSC Testnet, Robinhood Testnet).
 *
 * The assertion that matters most is not that any single call works, it is that
 * an 8-decimal Chainlink feed and an 18-decimal API3 feed quoting the same asset
 * at the same price produce the *same* number out of ProtocolFacet's arithmetic.
 * If they do not, every USD figure in the protocol — health factors, borrow
 * limits, liquidation thresholds — is wrong by a power of ten on one of the two
 * backends, and nothing in a type check or a successful compile would say so.
 *
 * ETH at $2,345.64 is used throughout because it is close to what the live
 * Sepolia and BSC Chainlink feeds actually answered when this was written.
 */

/** ProtocolFacet._priceScaled18, in JS, so the test asserts the figure the
 *  protocol would use rather than the oracle's raw output. */
function priceScaled18(price, expo) {
  const scaleExpo = 18n + BigInt(expo);
  return scaleExpo >= 0n
    ? BigInt(price) * 10n ** scaleExpo
    : BigInt(price) / 10n ** -scaleExpo;
}

const ETH_USD =
  "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
const USDC_USD =
  "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a";

const INT64_MAX = 2n ** 63n - 1n;

/** $2,345.64 at 8 decimals (Chainlink) and at 18 (an API3 reader proxy). */
const ETH_AT_8 = 234_564_000_000n;
const ETH_AT_18 = 2_345_640_000_000_000_000_000n;
const ETH_USD_18DP = 2_345_640_000_000_000_000_000n; // $2,345.64 with 18 dp

describe("AggregatorPriceOracle", function () {
  let oracle, owner, other;

  async function deployFeed(decimals, description, answer) {
    const Mock = await ethers.getContractFactory("MockAggregatorV3");
    const feed = await Mock.deploy(decimals, description, answer);
    await feed.waitForDeployment();
    return feed;
  }

  beforeEach(async function () {
    [owner, other] = await ethers.getSigners();
    const Oracle = await ethers.getContractFactory("AggregatorPriceOracle");
    oracle = await Oracle.deploy();
    await oracle.waitForDeployment();
  });

  describe("decimal normalisation", function () {
    it("agrees between an 8-decimal Chainlink feed and an 18-decimal API3 feed", async function () {
      const chainlink = await deployFeed(8, "ETH / USD", ETH_AT_8);
      const api3 = await deployFeed(18, "ETH/USD", ETH_AT_18);

      await oracle.setFeed(ETH_USD, await chainlink.getAddress());
      const fromChainlink = await oracle.getPrice(ETH_USD);

      await oracle.setFeed(ETH_USD, await api3.getAddress());
      const fromApi3 = await oracle.getPrice(ETH_USD);

      // Same normalised price and exponent out of the oracle...
      expect(fromApi3.price).to.equal(fromChainlink.price);
      expect(fromChainlink.expo).to.equal(-8);
      expect(fromApi3.expo).to.equal(-8);

      // ...and therefore the same USD figure inside the protocol.
      expect(priceScaled18(fromChainlink.price, fromChainlink.expo)).to.equal(
        ETH_USD_18DP,
      );
      expect(priceScaled18(fromApi3.price, fromApi3.expo)).to.equal(
        ETH_USD_18DP,
      );
    });

    it("would have overflowed int64 without the rescale", async function () {
      // The reason the rescale exists, stated as a test: PythStructs.Price.price
      // is int64, and an 18-decimal ETH price does not fit in it.
      expect(ETH_AT_18).to.be.greaterThan(INT64_MAX);
      expect(ETH_AT_8).to.be.lessThan(INT64_MAX);

      const api3 = await deployFeed(18, "ETH/USD", ETH_AT_18);
      await oracle.setFeed(ETH_USD, await api3.getAddress());

      const price = await oracle.getPrice(ETH_USD);
      expect(price.price).to.be.lessThanOrEqual(INT64_MAX);
      expect(price.price).to.equal(ETH_AT_8);
    });

    it("scales up a feed with fewer decimals than the target", async function () {
      const sixDp = await deployFeed(6, "USDC / USD", 1_000_000n); // $1.00
      await oracle.setFeed(USDC_USD, await sixDp.getAddress());

      const price = await oracle.getPrice(USDC_USD);
      expect(price.price).to.equal(100_000_000n); // $1.00 at 8 dp
      expect(priceScaled18(price.price, price.expo)).to.equal(10n ** 18n);
    });

    it("reverts rather than quoting zero when a price truncates away", async function () {
      const dust = await deployFeed(18, "DUST / USD", 1n); // 1e-18
      await oracle.setFeed(ETH_USD, await dust.getAddress());

      await expect(oracle.getPrice(ETH_USD)).to.be.revertedWithCustomError(
        oracle,
        "PriceTruncatedToZero",
      );
    });

    it("reverts when even the rescaled price cannot fit int64", async function () {
      const huge = await deployFeed(8, "HUGE / USD", INT64_MAX + 1n);
      await oracle.setFeed(ETH_USD, await huge.getAddress());

      await expect(oracle.getPrice(ETH_USD)).to.be.revertedWithCustomError(
        oracle,
        "PriceOverflowsInt64",
      );
    });
  });

  describe("round integrity — what stands in for Pyth's conf", function () {
    it("reports zero confidence, so the protocol's conf bound is inert", async function () {
      const feed = await deployFeed(8, "ETH / USD", ETH_AT_8);
      await oracle.setFeed(ETH_USD, await feed.getAddress());

      // Documented, not incidental: neither provider publishes an uncertainty
      // band. A confBps computed from this is 0 and passes any bound.
      expect((await oracle.getPrice(ETH_USD)).conf).to.equal(0);
      expect(await oracle.oracleKind()).to.equal("aggregator-v3");
    });

    it("passes the aggregator's updatedAt through as publishTime", async function () {
      const feed = await deployFeed(8, "ETH / USD", ETH_AT_8);
      await oracle.setFeed(ETH_USD, await feed.getAddress());

      await feed.setUpdatedAt(1_700_000_000n);
      expect((await oracle.getPrice(ETH_USD)).publishTime).to.equal(
        1_700_000_000n,
      );
    });

    it("rejects a round that never completed", async function () {
      const feed = await deployFeed(8, "ETH / USD", ETH_AT_8);
      await oracle.setFeed(ETH_USD, await feed.getAddress());
      await feed.setUpdatedAt(0);

      await expect(oracle.getPrice(ETH_USD)).to.be.revertedWithCustomError(
        oracle,
        "RoundNotComplete",
      );
    });

    it("rejects an answer carried forward from an earlier round", async function () {
      const feed = await deployFeed(8, "ETH / USD", ETH_AT_8);
      await oracle.setFeed(ETH_USD, await feed.getAddress());
      await feed.setRound(9, 7);

      await expect(oracle.getPrice(ETH_USD)).to.be.revertedWithCustomError(
        oracle,
        "StaleRound",
      );
    });

    it("rejects a non-positive answer", async function () {
      const feed = await deployFeed(8, "ETH / USD", ETH_AT_8);
      await oracle.setFeed(ETH_USD, await feed.getAddress());

      for (const bad of [0n, -1n]) {
        await feed.setAnswer(bad);
        await expect(oracle.getPrice(ETH_USD)).to.be.revertedWithCustomError(
          oracle,
          "NonPositiveAnswer",
        );
      }
    });

    it("reverts on an unregistered feed instead of returning zero", async function () {
      await expect(oracle.getPrice(ETH_USD)).to.be.revertedWithCustomError(
        oracle,
        "FeedNotSet",
      );
    });
  });

  describe("registration", function () {
    it("accepts a feed that has no data yet, as an unactivated API3 dAPI does", async function () {
      // The Robinhood Testnet case: decimals() answers, latestRoundData()
      // reverts until the plan is bought on Api3Market. Registration has to
      // succeed so the feed can be configured as part of the deployment.
      const feed = await deployFeed(18, "ETH/USD", ETH_AT_18);
      await feed.setRevertOnRead(true);

      await expect(oracle.setFeed(ETH_USD, await feed.getAddress())).to.not.be
        .reverted;
      expect(await oracle.feedDecimals(ETH_USD)).to.equal(18);

      // ...and reads fail closed in the meantime rather than quoting anything.
      await expect(oracle.getPrice(ETH_USD)).to.be.reverted;

      // Activation needs no reconfiguration.
      await feed.setRevertOnRead(false);
      expect((await oracle.getPrice(ETH_USD)).price).to.equal(ETH_AT_8);
    });

    it("caches decimals so a feed cannot silently rescale the protocol", async function () {
      const feed = await deployFeed(8, "ETH / USD", ETH_AT_8);
      await oracle.setFeed(ETH_USD, await feed.getAddress());
      expect(await oracle.feedDecimals(ETH_USD)).to.equal(8);
      expect(await oracle.feedAggregator(ETH_USD)).to.equal(
        await feed.getAddress(),
      );
      expect(await oracle.describeFeed(ETH_USD)).to.equal("ETH / USD");
    });

    it("rejects an address with no code — a getCode check is not identity", async function () {
      await expect(
        oracle.setFeed(ETH_USD, other.address),
      ).to.be.revertedWithCustomError(oracle, "AggregatorHasNoCode");
      await expect(
        oracle.setFeed(ETH_USD, ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(oracle, "InvalidAddress");
      const feed = await deployFeed(8, "ETH / USD", ETH_AT_8);
      await expect(
        oracle.setFeed(ethers.ZeroHash, await feed.getAddress()),
      ).to.be.revertedWithCustomError(oracle, "InvalidFeedId");
    });

    it("rejects implausible decimals", async function () {
      for (const dec of [0, 37]) {
        const feed = await deployFeed(dec, "ODD / USD", 1n);
        await expect(
          oracle.setFeed(ETH_USD, await feed.getAddress()),
        ).to.be.revertedWithCustomError(oracle, "UnsupportedDecimals");
      }
    });

    it("registers a batch atomically", async function () {
      const eth = await deployFeed(8, "ETH / USD", ETH_AT_8);
      const usdc = await deployFeed(8, "USDC / USD", 100_000_000n);

      await oracle.setFeeds(
        [ETH_USD, USDC_USD],
        [await eth.getAddress(), await usdc.getAddress()],
      );
      expect((await oracle.getPrice(ETH_USD)).price).to.equal(ETH_AT_8);
      expect((await oracle.getPrice(USDC_USD)).price).to.equal(100_000_000n);

      await expect(
        oracle.setFeeds([ETH_USD], []),
      ).to.be.revertedWithCustomError(oracle, "LengthMismatch");
    });

    it("removes a feed, and refuses to remove one that was never set", async function () {
      const feed = await deployFeed(8, "ETH / USD", ETH_AT_8);
      await oracle.setFeed(ETH_USD, await feed.getAddress());
      await oracle.removeFeed(ETH_USD);

      await expect(oracle.getPrice(ETH_USD)).to.be.revertedWithCustomError(
        oracle,
        "FeedNotSet",
      );
      await expect(
        oracle.removeFeed(ETH_USD),
      ).to.be.revertedWithCustomError(oracle, "FeedNotSet");
    });
  });

  describe("ownership", function () {
    it("lets only the owner configure feeds", async function () {
      const feed = await deployFeed(8, "ETH / USD", ETH_AT_8);
      const addr = await feed.getAddress();

      expect(await oracle.owner()).to.equal(owner.address);
      await expect(
        oracle.connect(other).setFeed(ETH_USD, addr),
      ).to.be.revertedWithCustomError(oracle, "NotAuthorized");
      await expect(
        oracle.connect(other).removeFeed(ETH_USD),
      ).to.be.revertedWithCustomError(oracle, "NotAuthorized");
    });

    it("hands over to a multisig, and cannot be handed to nobody", async function () {
      // Whoever owns this can repoint any feed and reprice all collateral, so
      // it goes to the same multisig that takes the diamond.
      await expect(
        oracle.transferOwnership(ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(oracle, "InvalidAddress");

      await oracle.transferOwnership(other.address);
      expect(await oracle.owner()).to.equal(other.address);

      const feed = await deployFeed(8, "ETH / USD", ETH_AT_8);
      await expect(
        oracle.setFeed(ETH_USD, await feed.getAddress()),
      ).to.be.revertedWithCustomError(oracle, "NotAuthorized");
      await expect(
        oracle.connect(other).setFeed(ETH_USD, await feed.getAddress()),
      ).to.not.be.reverted;
    });
  });
});
