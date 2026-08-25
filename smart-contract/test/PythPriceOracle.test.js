const { expect } = require("chai");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { ethers } = require("hardhat");

/**
 * PythPriceOracle — ownership, backend identification, and price relaying.
 *
 * Pricing *reads* are still not covered here and cannot be: `getPrice` forwards to
 * Pyth, and a Pyth receiver's updates are Wormhole-signed, so no unit test can mint
 * a valid blob. `contracts/test/MockPyth.sol` stands in for the three entry points
 * `updatePrice` actually calls, which is enough to cover the fee arithmetic, the
 * refund and who is allowed to call it; the real reads are exercised on-chain by
 * scripts/deploy-oracle.js's post-deploy probe and scripts/probe-pyth.js.
 *
 * All three functions existed nowhere, or behaved differently, before the five-chain
 * deploy work, and each is launch-blocking rather than cosmetic:
 *
 *   transferOwnership  `setEthPriceId` and `setUsdcPriceId` are onlyOwner and
 *                      `owner` was written once in the constructor with no setter,
 *                      so the deploying EOA kept those rights permanently. The
 *                      deploy plan hands the diamond to a multisig; without this the
 *                      oracle it prices everything through stays behind one hot key.
 *   oracleKind         the two backends are indistinguishable from outside —
 *                      ProtocolFacet stores both behind `IPythPriceOracle` and
 *                      calls only `getPrice` — but the tooling around them
 *                      differs, so the scripts need to ask.
 *   updatePrice        was `onlyOwner`, gating a relay of an already-signed price,
 *                      which made the whole protocol's liveness depend on one key
 *                      being online while stopping nothing an attacker wants. It
 *                      also ignored `msg.value` and kept any surplus forever. Arc
 *                      Testnet is the chain that forced the issue: its native
 *                      currency is USDC and USDC/USD measured 16.3h stale there.
 */
describe("PythPriceOracle", function () {
  /** Any address deploys: the constructor makes no call on it. */
  const PYTH_STUB = "0xA2aa501b19aff244D90cc15a4Cf739D2725B5729"; // Pyth on Base Sepolia
  const ETH_USD =
    "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
  const USDC_USD =
    "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a";

  let oracle, owner, other, third;

  beforeEach(async function () {
    [owner, other, third] = await ethers.getSigners();
    const Oracle = await ethers.getContractFactory("PythPriceOracle");
    oracle = await Oracle.deploy(PYTH_STUB);
    await oracle.waitForDeployment();
  });

  describe("deployment", function () {
    it("records the deployer as owner, readably", async function () {
      /* `owner` was `internal` with no getter. A deployment could not prove who
       * held the privileged role and neither could an explorer, which is the
       * whole reason this assertion can be written at all. */
      expect(await oracle.owner()).to.equal(owner.address);
    });

    it("stores the Pyth address as an immutable", async function () {
      expect(await oracle.pyth()).to.equal(PYTH_STUB);
    });

    it("ships the canonical ETH/USD and USDC/USD feed ids", async function () {
      expect(await oracle.ethPriceId()).to.equal(ETH_USD);
      expect(await oracle.usdcPriceId()).to.equal(USDC_USD);
    });
  });

  describe("oracleKind", function () {
    it('answers "pyth"', async function () {
      expect(await oracle.oracleKind()).to.equal("pyth");
    });

    it("differs from AggregatorPriceOracle's answer", async function () {
      /* The assertion the deploy scripts depend on. Both contracts answer the
       * same selector, and register-tokens.js branches on the string: a Pyth feed
       * is proven by calling getPriceUnsafe on Pyth's own contract, which an
       * aggregator chain has none of. If these two ever returned the same value
       * the script would verify feeds against a backend that isn't there. */
      const Agg = await ethers.getContractFactory("AggregatorPriceOracle");
      const agg = await Agg.deploy();
      await agg.waitForDeployment();

      expect(await agg.oracleKind()).to.equal("aggregator-v3");
      expect(await oracle.oracleKind()).to.not.equal(await agg.oracleKind());
    });

    it("is callable by anyone", async function () {
      /* Not owner-gated: the deploy and registration scripts read it before they
       * hold any role on the contract, and a read that needed permission would
       * make backend detection depend on who is asking. */
      expect(await oracle.connect(other).oracleKind()).to.equal("pyth");
    });
  });

  describe("transferOwnership", function () {
    it("moves the role and emits the change", async function () {
      await expect(oracle.transferOwnership(other.address))
        .to.emit(oracle, "OwnershipTransferred")
        .withArgs(owner.address, other.address);

      expect(await oracle.owner()).to.equal(other.address);
    });

    it("hands over the onlyOwner functions with it", async function () {
      /* The point of the function. Ownership that moved but left the previous
       * holder able to call setEthPriceId would not be a handover. */
      await oracle.transferOwnership(other.address);

      await expect(oracle.setEthPriceId(USDC_USD)).to.be.revertedWithCustomError(
        oracle,
        "NotAuthorized",
      );
      await expect(oracle.connect(other).setEthPriceId(USDC_USD)).to.not.be.reverted;
      expect(await oracle.ethPriceId()).to.equal(USDC_USD);
    });

    it("rejects the zero address", async function () {
      /* Zero would strand the contract: no account could ever change a feed id
       * again, and the only remedy would be redeploying the oracle and calling
       * setPythOracle on the diamond a second time. */
      await expect(
        oracle.transferOwnership(ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(oracle, "InvalidAddress");

      expect(await oracle.owner()).to.equal(owner.address);
    });

    it("rejects a caller that is not the owner", async function () {
      await expect(
        oracle.connect(other).transferOwnership(other.address),
      ).to.be.revertedWithCustomError(oracle, "NotAuthorized");

      expect(await oracle.owner()).to.equal(owner.address);
    });

    it("cannot be replayed by the previous owner", async function () {
      await oracle.transferOwnership(other.address);

      await expect(
        oracle.transferOwnership(third.address),
      ).to.be.revertedWithCustomError(oracle, "NotAuthorized");

      expect(await oracle.owner()).to.equal(other.address);
    });

    it("can be chained by the new owner", async function () {
      /* Single-step by design: the mitigation for handing ownership to an address
       * that cannot act is that nothing about pricing depends on the owner —
       * getPrice is unrestricted — so the cost is losing the ability to change
       * feed ids, not the ability to read prices. This confirms a live new owner
       * retains full control. */
      await oracle.transferOwnership(other.address);
      await expect(oracle.connect(other).transferOwnership(third.address))
        .to.emit(oracle, "OwnershipTransferred")
        .withArgs(other.address, third.address);

      expect(await oracle.owner()).to.equal(third.address);
    });

    it("allows a transfer to the current owner without changing anything", async function () {
      /* Not guarded against, and not worth guarding: it is a no-op that costs
       * gas. Asserted so the behaviour is recorded rather than discovered. */
      await expect(oracle.transferOwnership(owner.address))
        .to.emit(oracle, "OwnershipTransferred")
        .withArgs(owner.address, owner.address);

      expect(await oracle.owner()).to.equal(owner.address);
    });
  });

  describe("updatePrice", function () {
    const FEE = 1_000_000_000n; // 1 gwei per blob, the shape Pyth charges
    const BLOB = ["0xdeadbeef"];

    let pyth, priced;

    beforeEach(async function () {
      const Pyth = await ethers.getContractFactory("MockPyth");
      pyth = await Pyth.deploy(FEE);
      await pyth.waitForDeployment();

      /* A second oracle, bound to the mock. The suite's shared `oracle` points at
       * a stub address with no code, which is right for every other test here and
       * useless for this one. */
      const Oracle = await ethers.getContractFactory("PythPriceOracle");
      priced = await Oracle.deploy(await pyth.getAddress());
      await priced.waitForDeployment();
    });

    it("lets any account relay a price, not just the owner", async function () {
      /* The change this suite exists to pin. `updatePriceFeeds` verifies the
       * update's Wormhole signatures on-chain, so gating the relay stopped nothing
       * an attacker wants and made liveness depend on one key: with the gate on,
       * Arc's 16.3h-stale USDC/USD could only be refreshed by the deployer. */
      await expect(
        priced.connect(other).updatePrice(BLOB, ETH_USD, { value: FEE }),
      ).to.not.be.reverted;

      expect(await pyth.pushCount()).to.equal(1);
    });

    it("forwards exactly the fee Pyth asked for", async function () {
      /* Not `msg.value`. Overpaying must not become a larger payment to Pyth — the
       * surplus is the caller's and comes back below. */
      await priced.updatePrice(BLOB, ETH_USD, { value: FEE * 5n });
      expect(await pyth.collected()).to.equal(FEE);
    });

    it("refunds the surplus to the caller", async function () {
      /* The second half of the fix. This previously stayed in the oracle forever:
       * the fee was drawn from `address(this)` and `msg.value` was never read, and
       * there is no withdraw function on the contract. */
      const before = await ethers.provider.getBalance(other.address);

      const tx = await priced
        .connect(other)
        .updatePrice(BLOB, ETH_USD, { value: FEE * 10n });
      const receipt = await tx.wait();
      const gas = receipt.gasUsed * receipt.gasPrice;

      const after = await ethers.provider.getBalance(other.address);
      /* Net cost is the fee plus gas — the other 9 gwei came back. Asserted as an
       * exact balance rather than "greater than", because the bug being guarded
       * against loses a precise amount. */
      expect(before - after).to.equal(FEE + gas);
      expect(await ethers.provider.getBalance(await priced.getAddress())).to.equal(0n);
    });

    it("keeps nothing when the fee is paid exactly", async function () {
      await priced.updatePrice(BLOB, ETH_USD, { value: FEE });
      expect(await ethers.provider.getBalance(await priced.getAddress())).to.equal(0n);
    });

    it("names the fee when too little is sent", async function () {
      /* Checked before the call rather than left to fail inside Pyth: the fee can
       * change between a caller's off-chain estimate and this block. */
      await expect(priced.updatePrice(BLOB, ETH_USD, { value: FEE - 1n }))
        .to.be.revertedWithCustomError(priced, "InsufficientFee")
        .withArgs(FEE, FEE - 1n);
    });

    it("does not spend a balance it happens to be holding", async function () {
      /* The reason the fee check is explicit. Without it, `{value: fee}` against a
       * short `msg.value` draws on the contract's own balance — so a stray balance
       * would silently subsidise callers until it ran out.
       *
       * Forced rather than transferred in: the contract has no `receive` and no
       * `fallback`, so a plain send cannot fund it and the only routes in reality
       * are SELFDESTRUCT and being named a block's fee recipient. Exotic, which is
       * why the check is cheap insurance rather than a live bug. */
      await ethers.provider.send("hardhat_setBalance", [
        await priced.getAddress(),
        "0x" + (FEE * 100n).toString(16),
      ]);

      await expect(
        priced.updatePrice(BLOB, ETH_USD, { value: 0 }),
      ).to.be.revertedWithCustomError(priced, "InsufficientFee");
      /* Untouched, which is the assertion that matters — a revert alone would also
       * follow from Pyth rejecting the call. */
      expect(await ethers.provider.getBalance(await priced.getAddress())).to.equal(
        FEE * 100n,
      );
    });

    it("scales the fee with the size of the batch", async function () {
      const batch = ["0x01", "0x02", "0x03"];
      await expect(
        priced.updatePrice(batch, ETH_USD, { value: FEE * 2n }),
      ).to.be.revertedWithCustomError(priced, "InsufficientFee");

      await priced.updatePrice(batch, ETH_USD, { value: FEE * 3n });
      expect(await pyth.collected()).to.equal(FEE * 3n);
    });

    it("reports what the named feed now reads", async function () {
      await pyth.setPrice(2500_00000000n, 2_00000000n, -8, 1787000000);

      await expect(priced.updatePrice(BLOB, USDC_USD, { value: FEE }))
        .to.emit(priced, "PriceUpdated")
        /* publishTime is the mock's block.timestamp, set on push, so it is not the
         * value written above — the other four are. */
        .withArgs(USDC_USD, 2500_00000000n, 2_00000000n, -8, anyValue);

      /* And it matches its own interface. IPythPriceFeed.sol declared
       * (feedId, price, conf, expo, publishTime) while the implementation emitted
       * the raw update blob, so the two disagreed and the blob cost ~1KB of event
       * data per call to say less. */
      const iface = await ethers.getContractAt(
        "IPythPriceOracle",
        await priced.getAddress(),
      );
      expect(iface.interface.getEvent("PriceUpdated").format()).to.equal(
        priced.interface.getEvent("PriceUpdated").format(),
      );
    });

    it("still lands the update when the named feed is not served", async function () {
      /* `priceFeedId` is a separate argument from the blob, so a caller can push a
       * batch that does not contain it and the real `getPriceUnsafe` reverts for a
       * feed Pyth has never populated. Rolling back a valid price push for the sake
       * of an event would be the wrong trade. */
      await pyth.setFeedMissing(true);

      await expect(priced.updatePrice(BLOB, ETH_USD, { value: FEE })).to.not.be
        .reverted;
      expect(await pyth.pushCount()).to.equal(1);
      await expect(
        priced.updatePrice(BLOB, ETH_USD, { value: FEE }),
      ).to.not.emit(priced, "PriceUpdated");
    });

    it("reverts rather than keeping the change a caller cannot take back", async function () {
      /* Reachable only from a contract caller: an EOA always accepts a refund, so
       * an implementation that ignored the `call`'s return value would pass every
       * test above while quietly keeping the surplus. */
      const Rejector = await ethers.getContractFactory("RefundRejector");
      const rejector = await Rejector.deploy();
      await rejector.waitForDeployment();

      await expect(
        rejector.push(await priced.getAddress(), BLOB, ETH_USD, { value: FEE * 2n }),
      ).to.be.revertedWithCustomError(priced, "RefundFailed");

      /* Exact payment needs no refund, so the same caller succeeds — the revert is
       * about the change, not about being a contract. */
      await expect(
        rejector.push(await priced.getAddress(), BLOB, ETH_USD, { value: FEE }),
      ).to.not.be.reverted;
    });
  });
});
