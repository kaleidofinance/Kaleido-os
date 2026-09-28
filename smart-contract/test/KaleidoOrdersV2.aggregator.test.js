const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * KaleidoOrdersV2.fillViaAggregator — the path that lets a limit order fill
 * through an aggregator router (KyberSwap on Arc) instead of only Kaleido's own
 * V3 pools.
 *
 * The swap runs inside a contract we do not control, on calldata the FILLER
 * supplies. So every case here is the same question from a different angle: can
 * a filler, a stale route or a hostile router make the maker end up worse than
 * the `minOut` they signed? The answer must always be "no — the fill reverts".
 *
 * The router is MockAggregator, a knob per behaviour. The V3 fill path and all
 * order/signature/schedule rules are covered by KaleidoOrders.test.js, which runs
 * against V2 too.
 */

const DAY = 24 * 60 * 60;
const WEEK = 7 * DAY;
const usdc = (n) => ethers.parseUnits(String(n), 6);
const eurc = (n) => ethers.parseUnits(String(n), 6);

const ORDER_TYPES = {
  Order: [
    { name: "maker", type: "address" },
    { name: "tokenIn", type: "address" },
    { name: "tokenOut", type: "address" },
    { name: "amountIn", type: "uint256" },
    { name: "minOut", type: "uint256" },
    { name: "startAt", type: "uint64" },
    { name: "expiry", type: "uint64" },
    { name: "interval", type: "uint32" },
    { name: "maxFills", type: "uint32" },
    { name: "epoch", type: "uint64" },
    { name: "salt", type: "uint256" },
  ],
};

describe("KaleidoOrdersV2 — aggregator fills", function () {
  let owner, maker, filler, stranger, newOwner;
  let tIn, tOut, agg, orders, v3router, domain, now;

  const deployToken = async (name, symbol, decimals) => {
    const t = await (await ethers.getContractFactory("MockERC20")).deploy(name, symbol, decimals);
    await t.waitForDeployment();
    return t;
  };

  /** Sell 100 USDC for at least 87 EURC — the Arc trade the card got wrong. */
  const buildOrder = (over = {}) => ({
    maker: maker.address,
    tokenIn: tIn.target,
    tokenOut: tOut.target,
    amountIn: usdc(100),
    minOut: eurc(87),
    startAt: 0,
    expiry: now + WEEK,
    interval: 0,
    maxFills: 1,
    epoch: 0,
    salt: 1n,
    ...over,
  });
  const sign = (o, signer = maker) => signer.signTypedData(domain, ORDER_TYPES, o);
  const swapData = (pull, pay, payTo = orders.target) =>
    agg.interface.encodeFunctionData("swap", [tIn.target, tOut.target, pull, pay, payTo]);

  beforeEach(async function () {
    [owner, maker, filler, stranger, newOwner] = await ethers.getSigners();
    tIn = await deployToken("USD Coin", "USDC", 6);
    tOut = await deployToken("Euro Coin", "EURC", 6);
    /* The V3 router's address is all V2's constructor needs here; the aggregator
       path never calls it. Any contract stands in. */
    v3router = await deployToken("stand-in router", "RTR", 18);

    orders = await (await ethers.getContractFactory("KaleidoOrdersV2")).deploy(v3router.target, owner.address);
    await orders.waitForDeployment();
    agg = await (await ethers.getContractFactory("MockAggregator")).deploy();
    await agg.waitForDeployment();
    await orders.connect(owner).setAggregator(agg.target, true);

    await tIn.mint(maker.address, usdc(10_000));
    await tIn.connect(maker).approve(orders.target, usdc(10_000));
    await tOut.mint(agg.target, eurc(1_000_000)); // what the router pays out from

    domain = {
      name: "Kaleido Orders",
      version: "2",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: orders.target,
    };
    now = (await ethers.provider.getBlock("latest")).timestamp;
  });

  describe("an honest route", function () {
    it("pays the maker, spends exactly the input, and counts the fill", async function () {
      const o = buildOrder();
      const before = await tOut.balanceOf(maker.address);
      await expect(
        orders.connect(filler).fillViaAggregator(o, await sign(o), agg.target, swapData(usdc(100), eurc(88))),
      ).to.emit(orders, "OrderFilled");
      expect((await tOut.balanceOf(maker.address)) - before).to.equal(eurc(88));
      expect(await tIn.balanceOf(maker.address)).to.equal(usdc(9_900));
      expect((await orders.stateOf(o)).fills).to.equal(1);
    });

    it("leaves nothing in the contract and no allowance to the router", async function () {
      const o = buildOrder();
      await orders.connect(filler).fillViaAggregator(o, await sign(o), agg.target, swapData(usdc(100), eurc(88)));
      expect(await tIn.balanceOf(orders.target)).to.equal(0n);
      expect(await tOut.balanceOf(orders.target)).to.equal(0n);
      expect(await tIn.allowance(orders.target, agg.target)).to.equal(0n);
    });

    it("fills at exactly the floor", async function () {
      const o = buildOrder();
      await orders.connect(filler).fillViaAggregator(o, await sign(o), agg.target, swapData(usdc(100), eurc(87)));
      expect(await tOut.balanceOf(maker.address)).to.equal(eurc(87));
    });
  });

  describe("the floor holds whatever the route does", function () {
    it("refuses a route that pays less than the floor, and moves nothing", async function () {
      const o = buildOrder();
      await expect(
        orders.connect(filler).fillViaAggregator(o, await sign(o), agg.target, swapData(usdc(100), eurc(86))),
      )
        .to.be.revertedWithCustomError(orders, "KaleidoOrders_BelowFloor")
        .withArgs(eurc(86), eurc(87));
      expect(await tIn.balanceOf(maker.address)).to.equal(usdc(10_000));
      // The slot was not burned: the same order still fills once a route pays.
      await orders.connect(filler).fillViaAggregator(o, await sign(o), agg.target, swapData(usdc(100), eurc(90)));
      expect(await tOut.balanceOf(maker.address)).to.equal(eurc(90));
    });

    it("refuses a route that pays someone else", async function () {
      const o = buildOrder();
      await expect(
        orders
          .connect(filler)
          .fillViaAggregator(o, await sign(o), agg.target, swapData(usdc(100), eurc(88), filler.address)),
      ).to.be.revertedWithCustomError(orders, "KaleidoOrders_BelowFloor");
    });

    it("does not count tokens someone else left in the contract as the maker's output", async function () {
      await tOut.mint(orders.target, eurc(500)); // a donation (or a trap)
      const o = buildOrder();
      await expect(
        orders.connect(filler).fillViaAggregator(o, await sign(o), agg.target, swapData(usdc(100), eurc(10))),
      ).to.be.revertedWithCustomError(orders, "KaleidoOrders_BelowFloor");
    });

    it("refuses a route that tries to pull more than the approved input", async function () {
      const o = buildOrder();
      await expect(
        orders.connect(filler).fillViaAggregator(o, await sign(o), agg.target, swapData(usdc(100) + 1n, eurc(88))),
      ).to.be.reverted;
      expect(await tIn.balanceOf(maker.address)).to.equal(usdc(10_000));
    });

    it("refunds input the route did not spend", async function () {
      const o = buildOrder();
      await orders.connect(filler).fillViaAggregator(o, await sign(o), agg.target, swapData(usdc(60), eurc(88)));
      expect(await tIn.balanceOf(maker.address)).to.equal(usdc(9_940));
      expect(await tIn.balanceOf(orders.target)).to.equal(0n);
    });

    it("refuses a route that pays native currency instead of the signed token", async function () {
      const o = buildOrder();
      await owner.sendTransaction({ to: agg.target, value: ethers.parseEther("1") });
      const data = agg.interface.encodeFunctionData("swapToNative", [tIn.target, usdc(100), 1n, orders.target]);
      await expect(orders.connect(filler).fillViaAggregator(o, await sign(o), agg.target, data)).to.be.reverted;
    });

    it("bubbles up the router's own revert, unchanged", async function () {
      const o = buildOrder();
      // The router tries to pull tokenOut, which the orders contract never approved:
      // the token's own custom error must surface, not a generic failure.
      const data = agg.interface.encodeFunctionData("swap", [tOut.target, tOut.target, 1n, 0n, orders.target]);
      await expect(orders.connect(filler).fillViaAggregator(o, await sign(o), agg.target, data))
        .to.be.revertedWithCustomError(tOut, "ERC20InsufficientAllowance");
    });
  });

  describe("who may be called", function () {
    it("refuses a router that is not allowlisted", async function () {
      const other = await (await ethers.getContractFactory("MockAggregator")).deploy();
      const o = buildOrder();
      await expect(
        orders.connect(filler).fillViaAggregator(o, await sign(o), other.target, swapData(usdc(100), eurc(88))),
      ).to.be.revertedWithCustomError(orders, "KaleidoOrders_NotAggregator");
    });

    it("refuses the order's own token as a target even if it were allowlisted", async function () {
      await orders.connect(owner).setAggregator(tIn.target, true);
      const o = buildOrder();
      const data = tIn.interface.encodeFunctionData("transferFrom", [maker.address, filler.address, usdc(100)]);
      await expect(
        orders.connect(filler).fillViaAggregator(o, await sign(o), tIn.target, data),
      ).to.be.revertedWithCustomError(orders, "KaleidoOrders_NotAggregator");
    });

    it("refuses the V3 router as an aggregator target", async function () {
      await orders.connect(owner).setAggregator(v3router.target, true);
      const o = buildOrder();
      await expect(
        orders.connect(filler).fillViaAggregator(o, await sign(o), v3router.target, "0x"),
      ).to.be.revertedWithCustomError(orders, "KaleidoOrders_NotAggregator");
    });

    it("lets only the owner change the allowlist, and refuses an address with no code", async function () {
      await expect(orders.connect(stranger).setAggregator(agg.target, false))
        .to.be.revertedWithCustomError(orders, "OwnableUnauthorizedAccount");
      await expect(orders.connect(owner).setAggregator(stranger.address, true))
        .to.be.revertedWithCustomError(orders, "KaleidoOrders_NotAggregator");
      await expect(orders.connect(owner).setAggregator(agg.target, false))
        .to.emit(orders, "AggregatorSet").withArgs(agg.target, false);
      expect(await orders.isAggregator(agg.target)).to.equal(false);
    });

    it("cannot be re-entered from inside the route", async function () {
      const o = buildOrder();
      const sig = await sign(o);
      const inner = orders.interface.encodeFunctionData("fillViaAggregator", [o, sig, agg.target, swapData(usdc(100), eurc(88))]);
      const data = agg.interface.encodeFunctionData("reenter", [orders.target, inner]);
      await expect(orders.connect(filler).fillViaAggregator(o, sig, agg.target, data))
        .to.be.revertedWithCustomError(orders, "ReentrancyGuardReentrantCall");
    });
  });

  describe("the order's own rules still apply", function () {
    it("fills a one-shot order once", async function () {
      const o = buildOrder();
      const sig = await sign(o);
      await orders.connect(filler).fillViaAggregator(o, sig, agg.target, swapData(usdc(100), eurc(88)));
      await expect(orders.connect(filler).fillViaAggregator(o, sig, agg.target, swapData(usdc(100), eurc(88))))
        .to.be.revertedWithCustomError(orders, "KaleidoOrders_NoFillsLeft");
    });

    it("refuses a signature from anyone but the maker", async function () {
      const o = buildOrder();
      await expect(
        orders.connect(filler).fillViaAggregator(o, await sign(o, stranger), agg.target, swapData(usdc(100), eurc(88))),
      ).to.be.revertedWithCustomError(orders, "KaleidoOrders_BadSignature");
    });

    it("refuses a cancelled order", async function () {
      const o = buildOrder();
      await orders.connect(maker).cancel(o);
      await expect(
        orders.connect(filler).fillViaAggregator(o, await sign(o), agg.target, swapData(usdc(100), eurc(88))),
      ).to.be.revertedWithCustomError(orders, "KaleidoOrders_Cancelled");
    });

    it("pays the filler's fee out of the input and swaps only the rest", async function () {
      await orders.connect(owner).setFillerFeeBps(50); // 0.5%
      const o = buildOrder();
      const swapIn = await orders.swapInputFor(o.amountIn);
      expect(swapIn).to.equal(usdc(99.5));
      await orders.connect(filler).fillViaAggregator(o, await sign(o), agg.target, swapData(swapIn, eurc(88)));
      expect(await tIn.balanceOf(filler.address)).to.equal(usdc(0.5));
      expect(await tOut.balanceOf(maker.address)).to.equal(eurc(88));
    });

    it("checkFillTerms reports the same refusals without a path", async function () {
      const o = buildOrder();
      const sig = await sign(o);
      expect(await orders.checkFillTerms(o, sig)).to.deep.equal([true, ""]);
      await orders.connect(maker).cancel(o);
      expect((await orders.checkFillTerms(o, sig))[1]).to.equal("cancelled");
    });
  });

  describe("ownership is two-step", function () {
    it("does not move until the nominee accepts", async function () {
      await orders.connect(owner).transferOwnership(newOwner.address);
      expect(await orders.owner()).to.equal(owner.address);
      expect(await orders.pendingOwner()).to.equal(newOwner.address);
      await expect(orders.connect(stranger).acceptOwnership())
        .to.be.revertedWithCustomError(orders, "OwnableUnauthorizedAccount");
      await orders.connect(newOwner).acceptOwnership();
      expect(await orders.owner()).to.equal(newOwner.address);
    });
  });
});
