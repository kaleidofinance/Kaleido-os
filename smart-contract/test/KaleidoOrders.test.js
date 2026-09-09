const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * KaleidoOrders — the settlement layer behind /trade/limit and scheduled buys.
 *
 * WHAT THESE TESTS ARE REALLY CHECKING
 *
 * A signed order is an authorisation that outlives the moment it was made and is
 * submitted by someone other than the person it belongs to. So the interesting
 * question is never "does a fill work" — it is what a filler can do that the
 * maker did not agree to. Every case below is one of those:
 *
 *   the price floor      A fill below `minOut` must be impossible, because the
 *                        floor is the entire limit-order mechanism. There is no
 *                        oracle here; if the router's output check were not
 *                        enforced against the maker's own number, a limit order
 *                        would be a market order with extra steps.
 *   the schedule         Cadence, count, start and expiry all bound how many
 *                        times one signature can move funds. A recurring order
 *                        whose interval could be skipped would let a filler
 *                        drain a year of weekly buys in one block.
 *   cancellation         Off-chain deletion cannot revoke a signature, so cancel
 *                        and cancelAll have to bind on-chain.
 *   who signed it        Run against a real EOA key AND an ERC-1271 contract
 *                        wallet, because most of this app's users hold the second
 *                        kind and an `ecrecover`-only check passes every test
 *                        that only ever signs with a Hardhat key.
 *
 * The venue is a real V3 deployment — factory, pool and periphery router as
 * deployed — with a full-range position minted into it, not a mock quoting a
 * made-up price. The floor is enforced by the router, so a mock router would be
 * testing the assertion instead of the thing that makes it. V3 and not V2
 * because that is where the liquidity is: on Sepolia the V2 factory has never
 * created a pair, while the V3 KLD/USDC pool is what the chart on /trade/limit
 * draws.
 *
 * Decimals differ across the pair on purpose (KLD 18, USDC 6). An order that
 * scales `minOut` by the wrong power of ten still fills; it just fills at a
 * price nobody chose.
 *
 * Token order is computed rather than assumed. A V3 pool sorts its pair by
 * address, so which side is `token0` is decided by deployment nonces — the
 * seeding maths below reads the sort instead of hoping for one, since getting it
 * backwards would open the pool at 1e-24 of the intended price and every
 * assertion about a floor would then be measuring the seed, not the contract.
 */

const DAY = 24 * 60 * 60;
const WEEK = 7 * DAY;

/** The pool the app quotes KLD/USDC through. Tick spacing 60. */
const FEE = 3000;
const MIN_TICK = -887220;
const MAX_TICK = 887220;

const Q96 = 2n ** 96n;

const kld = (n) => ethers.parseUnits(String(n), 18);
const usdc = (n) => ethers.parseUnits(String(n), 6);

/** Integer square root, for sqrtPriceX96 — no float can hold 2^192. */
const bigSqrt = (n) => {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
};

/** sqrtPriceX96 for a pool whose raw reserves would be `a1` of token1 per `a0` of token0. */
const sqrtPriceX96For = (a1, a0) => bigSqrt((a1 * Q96 * Q96) / a0);

/**
 * A V3 path: `token || fee || token || fee || token`, 20 + 23·hops bytes.
 *
 * The same encoding /trade/limit has to produce in TypeScript, which is the
 * reason it is spelled out here rather than imported from the periphery's test
 * helpers: if the two disagree, this file is the one that says so.
 */
const encodePath = (tokens, fees) => {
  const parts = [];
  tokens.forEach((t, i) => {
    parts.push(t);
    if (i < fees.length) parts.push(ethers.toBeHex(fees[i], 3));
  });
  return ethers.concat(parts);
};

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

describe("KaleidoOrders", function () {
  /* Each case deploys a real V3 venue - factory, pool, periphery router, and a
     full-range position minted into it - because the floor is enforced by the
     router and a mock would test the assertion instead of the contract. That
     setup runs per case and lands either side of the 40s global bound, so the
     suite carries its own rather than loosening the bound for every other
     test in the repo. */
  this.timeout(300000);
  let owner, maker, filler, whale, stranger;
  let kldToken, usdcToken, weth;
  let factory, router, quoter, pool, orders;
  let domain;
  let now;

  const deployToken = async (name, symbol, decimals) => {
    const Mock = await ethers.getContractFactory("MockERC20");
    const t = await Mock.deploy(name, symbol, decimals);
    await t.waitForDeployment();
    return t;
  };

  /** An order selling KLD for USDC, one-shot unless overridden. */
  const buildOrder = (over = {}) => ({
    maker: maker.address,
    tokenIn: kldToken.target,
    tokenOut: usdcToken.target,
    amountIn: kld(1000),
    minOut: usdc(900),
    startAt: 0,
    expiry: now + WEEK,
    interval: 0,
    maxFills: 1,
    epoch: 0,
    salt: 1n,
    ...over,
  });

  const sign = (order, signer = maker) =>
    signer.signTypedData(domain, ORDER_TYPES, order);

  const path = () => encodePath([kldToken.target, usdcToken.target], [FEE]);

  /** What the pool would pay for `amountIn` of KLD right now. */
  const quote = (amountIn, p = path()) =>
    quoter.quoteExactInput.staticCall(p, amountIn);

  const warp = async (seconds) => {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
  };

  beforeEach(async function () {
    [owner, maker, filler, whale, stranger] = await ethers.getSigners();

    kldToken = await deployToken("Kaleido", "KLD", 18);
    usdcToken = await deployToken("USD Coin", "USDC", 6);
    /* The router stores WETH only for its ETH entry points, which nothing here
       calls. A token stands in so the constructor has an address to keep. */
    weth = await deployToken("Wrapped Ether", "WETH", 18);

    const Factory = await ethers.getContractFactory("KaleidoSwapV3Factory");
    factory = await Factory.deploy();
    await factory.waitForDeployment();

    const Router = await ethers.getContractFactory("SwapRouter");
    router = await Router.deploy(factory.target, weth.target);
    await router.waitForDeployment();

    const Quoter = await ethers.getContractFactory("Quoter");
    quoter = await Quoter.deploy(factory.target, weth.target);
    await quoter.waitForDeployment();

    /* One million of each side, so KLD opens at about 1 USDC and a thousand-KLD
       order is a small enough share of the pool to reason about. */
    const kldIsToken0 =
      kldToken.target.toLowerCase() < usdcToken.target.toLowerCase();
    const amount0 = kldIsToken0 ? kld(1_000_000) : usdc(1_000_000);
    const amount1 = kldIsToken0 ? usdc(1_000_000) : kld(1_000_000);

    await factory.createPool(kldToken.target, usdcToken.target, FEE);
    pool = await ethers.getContractAt(
      "KaleidoSwapV3Pool",
      await factory.getPool(kldToken.target, usdcToken.target, FEE),
    );
    const sqrtPriceX96 = sqrtPriceX96For(amount1, amount0);
    await pool.initialize(sqrtPriceX96);

    /* Minted over the full range so the price can be moved a long way without
       running out of position — the "reaches the maker's price" case below needs
       to move KLD several times its opening price, and a narrow band would run
       out of liquidity instead of repricing.

       `amount1 · 2^96 / sqrtP` is the full-range liquidity that deposits about
       `amount1` of token1, and correspondingly `amount1 / price` of token0. */
    const liquidity = (amount1 * Q96) / sqrtPriceX96;
    const Callee = await ethers.getContractFactory(
      "contracts/dex-v3/core/test/TestKaleidoSwapV3Callee.sol:TestKaleidoSwapV3Callee",
    );
    const callee = await Callee.deploy();
    await callee.waitForDeployment();

    await kldToken.mint(owner.address, kld(2_000_000));
    await usdcToken.mint(owner.address, usdc(2_000_000));
    await kldToken.connect(owner).approve(callee.target, kld(2_000_000));
    await usdcToken.connect(owner).approve(callee.target, usdc(2_000_000));
    await callee
      .connect(owner)
      .mint(pool.target, owner.address, MIN_TICK, MAX_TICK, liquidity);

    const Orders = await ethers.getContractFactory("KaleidoOrders");
    orders = await Orders.deploy(router.target, owner.address);
    await orders.waitForDeployment();

    /* The maker funds and approves once. From here every fill is authorised by a
       signature alone, which is the property the rest of this file probes. */
    await kldToken.mint(maker.address, kld(100_000));
    await usdcToken.mint(maker.address, usdc(100_000));
    await kldToken.connect(maker).approve(orders.target, kld(100_000));
    await usdcToken.connect(maker).approve(orders.target, usdc(100_000));

    await kldToken.mint(whale.address, kld(2_000_000));
    await usdcToken.mint(whale.address, usdc(2_000_000));
    await kldToken.connect(whale).approve(router.target, kld(2_000_000));
    await usdcToken.connect(whale).approve(router.target, usdc(2_000_000));

    domain = {
      name: "Kaleido Orders",
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: orders.target,
    };

    now = (await ethers.provider.getBlock("latest")).timestamp;
  });

  /** Pushes KLD up by buying it with USDC, so a high floor becomes reachable. */
  const pumpKld = async (usdcIn) => {
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + DAY;
    await router.connect(whale).exactInputSingle({
      tokenIn: usdcToken.target,
      tokenOut: kldToken.target,
      fee: FEE,
      recipient: whale.address,
      deadline,
      amountIn: usdc(usdcIn),
      amountOutMinimum: 0,
      sqrtPriceLimitX96: 0,
    });
  };

  describe("the price floor", function () {
    it("fills when the pool pays at least the floor, and pays the maker", async function () {
      const order = buildOrder();
      const sig = await sign(order);

      const before = await usdcToken.balanceOf(maker.address);
      await orders.connect(filler).fill(order, sig, path());
      const gained = (await usdcToken.balanceOf(maker.address)) - before;

      expect(gained).to.be.gte(order.minOut);
      expect(await kldToken.balanceOf(maker.address)).to.equal(kld(99_000));
    });

    it("refuses a fill below the floor the maker signed", async function () {
      /* Two USDC per KLD against a pool trading at one. Nothing about this order
         is malformed — it is simply not yet true, which is what an unfilled limit
         order is. */
      const order = buildOrder({ minOut: usdc(2000) });
      const sig = await sign(order);

      await expect(
        orders.connect(filler).fill(order, sig, path()),
      ).to.be.revertedWith("Too little received");
    });

    it("fills that same order once the market reaches it", async function () {
      const order = buildOrder({ minOut: usdc(2000) });
      const sig = await sign(order);

      await pumpKld(1_500_000);

      const before = await usdcToken.balanceOf(maker.address);
      await orders.connect(filler).fill(order, sig, path());
      expect((await usdcToken.balanceOf(maker.address)) - before).to.be.gte(
        order.minOut,
      );
    });

    it("never leaves the proceeds in the contract", async function () {
      const order = buildOrder();
      await orders.connect(filler).fill(order, await sign(order), path());

      expect(await usdcToken.balanceOf(orders.target)).to.equal(0);
      expect(await kldToken.balanceOf(orders.target)).to.equal(0);
    });

    it("leaves the router no standing allowance", async function () {
      const order = buildOrder();
      await orders.connect(filler).fill(order, await sign(order), path());

      expect(await kldToken.allowance(orders.target, router.target)).to.equal(0);
    });

    it("refuses a zero floor outright", async function () {
      /* The order that would let a filler move the price, fill at whatever it
         made, and move it back. Refused at the shape check rather than left to
         the router, which has no floor to enforce when the floor is zero. */
      const order = buildOrder({ minOut: 0 });
      const sig = await sign(order);

      await expect(
        orders.connect(filler).fill(order, sig, path()),
      ).to.be.revertedWithCustomError(orders, "KaleidoOrders_BadOrder");
    });
  });

  describe("who signed it", function () {
    it("refuses a signature from anyone but the maker", async function () {
      const order = buildOrder();
      const sig = await sign(order, stranger);

      await expect(
        orders.connect(filler).fill(order, sig, path()),
      ).to.be.revertedWithCustomError(orders, "KaleidoOrders_BadSignature");
    });

    it("refuses an order edited after signing", async function () {
      const order = buildOrder();
      const sig = await sign(order);

      /* The filler's own copy, with the floor dropped to something it prefers.
         This is the attack the digest exists to stop. */
      const tampered = { ...order, minOut: usdc(1) };

      await expect(
        orders.connect(filler).fill(tampered, sig, path()),
      ).to.be.revertedWithCustomError(orders, "KaleidoOrders_BadSignature");
    });

    it("accepts a contract wallet answering ERC-1271", async function () {
      const Wallet = await ethers.getContractFactory("MockERC1271Wallet");
      const wallet = await Wallet.deploy(maker.address);
      await wallet.waitForDeployment();

      await kldToken.mint(wallet.target, kld(5000));
      await wallet
        .connect(maker)
        .execute(
          kldToken.target,
          kldToken.interface.encodeFunctionData("approve", [
            orders.target,
            kld(5000),
          ]),
        );

      const order = buildOrder({ maker: wallet.target });
      /* Signed by the wallet's owner key, which recovers to the owner and not to
         the maker — the fill can only succeed by asking the wallet. */
      const sig = await sign(order, maker);

      await orders.connect(filler).fill(order, sig, path());
      expect(await usdcToken.balanceOf(wallet.target)).to.be.gte(order.minOut);
    });

    it("reads a contract with no isValidSignature as a bad signature", async function () {
      const NotAWallet = await ethers.getContractFactory("MockNotAWallet");
      const notAWallet = await NotAWallet.deploy();
      await notAWallet.waitForDeployment();

      const order = buildOrder({ maker: notAWallet.target });
      const sig = await sign(order, maker);

      await expect(
        orders.connect(filler).fill(order, sig, path()),
      ).to.be.revertedWithCustomError(orders, "KaleidoOrders_BadSignature");
    });
  });

  describe("the schedule", function () {
    it("fills a one-shot order exactly once", async function () {
      const order = buildOrder();
      const sig = await sign(order);

      await orders.connect(filler).fill(order, sig, path());
      await expect(
        orders.connect(filler).fill(order, sig, path()),
      ).to.be.revertedWithCustomError(orders, "KaleidoOrders_NoFillsLeft");
    });

    it("holds a recurring order to its interval", async function () {
      /* Dated well past the warp below, so what refuses the second fill is the
         interval and not the expiry — at the default one-week horizon the two
         land on the same second and either could be doing the work. */
      const order = buildOrder({
        interval: WEEK,
        maxFills: 4,
        expiry: now + 8 * WEEK,
      });
      const sig = await sign(order);

      await orders.connect(filler).fill(order, sig, path());
      await expect(
        orders.connect(filler).fill(order, sig, path()),
      ).to.be.revertedWithCustomError(orders, "KaleidoOrders_TooSoon");

      await warp(WEEK);
      await orders.connect(filler).fill(order, sig, path());
      expect((await orders.stateOf(order)).fills).to.equal(2);
    });

    it("stops a recurring order at its fill count", async function () {
      const order = buildOrder({ interval: DAY, maxFills: 3 });
      const sig = await sign(order);

      /* Long-dated so the loop is bounded by the count and not by the expiry —
         otherwise a passing test would not say which limit did the work. */
      const long = { ...order, expiry: now + 365 * DAY };
      const longSig = await sign(long);

      for (let i = 0; i < 3; i++) {
        await orders.connect(filler).fill(long, longSig, path());
        await warp(DAY);
      }

      await expect(
        orders.connect(filler).fill(long, longSig, path()),
      ).to.be.revertedWithCustomError(orders, "KaleidoOrders_NoFillsLeft");
    });

    it("refuses a recurring order with no interval", async function () {
      /* Four fills all immediately due: the whole budget could go into one
         block, which is not what choosing "weekly" agreed to. */
      const order = buildOrder({ maxFills: 4, interval: 0 });
      const sig = await sign(order);

      await expect(
        orders.connect(filler).fill(order, sig, path()),
      ).to.be.revertedWithCustomError(orders, "KaleidoOrders_BadOrder");
    });

    it("will not fill before the start", async function () {
      const order = buildOrder({ startAt: now + DAY });
      const sig = await sign(order);

      await expect(
        orders.connect(filler).fill(order, sig, path()),
      ).to.be.revertedWithCustomError(orders, "KaleidoOrders_NotStarted");
    });

    it("will not fill after the expiry", async function () {
      const order = buildOrder({ expiry: now + DAY });
      const sig = await sign(order);

      await warp(DAY + 1);

      await expect(
        orders.connect(filler).fill(order, sig, path()),
      ).to.be.revertedWithCustomError(orders, "KaleidoOrders_Expired");
    });

    it("reports when the next fill is due", async function () {
      const order = buildOrder({ interval: WEEK, maxFills: 4 });
      await orders.connect(filler).fill(order, await sign(order), path());

      const state = await orders.stateOf(order);
      expect(await orders.nextFillAt(order)).to.equal(
        state.lastFillAt + BigInt(WEEK),
      );
    });
  });

  describe("cancellation", function () {
    it("lets the maker kill one order", async function () {
      const order = buildOrder();
      const sig = await sign(order);

      await orders.connect(maker).cancel(order);

      await expect(
        orders.connect(filler).fill(order, sig, path()),
      ).to.be.revertedWithCustomError(orders, "KaleidoOrders_Cancelled");
    });

    it("lets nobody else kill it", async function () {
      const order = buildOrder();

      await expect(
        orders.connect(stranger).cancel(order),
      ).to.be.revertedWithCustomError(orders, "KaleidoOrders_NotMaker");
    });

    it("kills every outstanding signature at once", async function () {
      /* Two orders, one signature each, neither of which the maker can name
         on-chain — they exist only as signed messages held by a filler. This is
         the only way to revoke them. */
      const a = buildOrder({ salt: 1n });
      const b = buildOrder({ salt: 2n });
      const sigA = await sign(a);
      const sigB = await sign(b);

      await orders.connect(maker).cancelAll();

      await expect(
        orders.connect(filler).fill(a, sigA, path()),
      ).to.be.revertedWithCustomError(orders, "KaleidoOrders_StaleEpoch");
      await expect(
        orders.connect(filler).fill(b, sigB, path()),
      ).to.be.revertedWithCustomError(orders, "KaleidoOrders_StaleEpoch");
      expect(await orders.epochOf(maker.address)).to.equal(1);
    });

    it("leaves orders signed under the new epoch fillable", async function () {
      await orders.connect(maker).cancelAll();

      const order = buildOrder({ epoch: 1 });
      await orders.connect(filler).fill(order, await sign(order), path());
      expect((await orders.stateOf(order)).fills).to.equal(1);
    });

    it("does not touch another maker's epoch", async function () {
      await orders.connect(stranger).cancelAll();

      const order = buildOrder();
      await orders.connect(filler).fill(order, await sign(order), path());
      expect((await orders.stateOf(order)).fills).to.equal(1);
    });
  });

  describe("the route", function () {
    it("refuses a path that does not end in the signed pair", async function () {
      const order = buildOrder();
      const sig = await sign(order);

      await expect(
        orders
          .connect(filler)
          .fill(order, sig, encodePath([kldToken.target, weth.target], [FEE])),
      ).to.be.revertedWithCustomError(orders, "KaleidoOrders_BadPath");
    });

    it("refuses a path shorter than a pair", async function () {
      const order = buildOrder();
      const sig = await sign(order);

      await expect(
        orders.connect(filler).fill(order, sig, encodePath([kldToken.target], [])),
      ).to.be.revertedWithCustomError(orders, "KaleidoOrders_BadPath");
    });

    it("refuses a path whose length is not 20 + 23·hops", async function () {
      /* Ends the signed pair, one stray byte long. The router decodes a path by
         position, so a length the encoding cannot produce is refused here rather
         than left to be reinterpreted as some other route. */
      const order = buildOrder();
      const sig = await sign(order);

      await expect(
        orders.connect(filler).fill(order, sig, ethers.concat([path(), "0x00"])),
      ).to.be.revertedWithCustomError(orders, "KaleidoOrders_BadPath");
    });

    it("accepts a multi-hop path whose ends match", async function () {
      /* KLD → USDC via a second KLD/USDC pool at another fee tier. Two hops,
         both real, ends correct: the shape a filler routing around thin
         liquidity would submit. */
      const alt = 500;
      await factory.createPool(kldToken.target, weth.target, alt);
      await factory.createPool(weth.target, usdcToken.target, alt);
      const kldWeth = await ethers.getContractAt(
        "KaleidoSwapV3Pool",
        await factory.getPool(kldToken.target, weth.target, alt),
      );
      const wethUsdc = await ethers.getContractAt(
        "KaleidoSwapV3Pool",
        await factory.getPool(weth.target, usdcToken.target, alt),
      );

      const Callee = await ethers.getContractFactory(
        "contracts/dex-v3/core/test/TestKaleidoSwapV3Callee.sol:TestKaleidoSwapV3Callee",
      );
      const callee = await Callee.deploy();
      await callee.waitForDeployment();

      await weth.mint(owner.address, kld(4_000_000));
      await kldToken.mint(owner.address, kld(2_000_000));
      await usdcToken.mint(owner.address, usdc(2_000_000));
      for (const t of [kldToken, usdcToken, weth]) {
        await t.connect(owner).approve(callee.target, ethers.MaxUint256);
      }

      /* Both legs at one-for-one in human terms, seeded the same way as the
         primary pool. */
      for (const [p, a, b] of [
        [kldWeth, kldToken, weth],
        [wethUsdc, weth, usdcToken],
      ]) {
        const aIsToken0 = a.target.toLowerCase() < b.target.toLowerCase();
        const dec = async (t) => Number(await t.decimals());
        const amt = async (t) => ethers.parseUnits("1000000", await dec(t));
        const amount0 = aIsToken0 ? await amt(a) : await amt(b);
        const amount1 = aIsToken0 ? await amt(b) : await amt(a);
        const sqrtP = sqrtPriceX96For(amount1, amount0);
        await p.initialize(sqrtP);
        await callee
          .connect(owner)
          .mint(
            p.target,
            owner.address,
            MIN_TICK,
            MAX_TICK,
            (amount1 * Q96) / sqrtP,
          );
      }

      const hops = encodePath(
        [kldToken.target, weth.target, usdcToken.target],
        [alt, alt],
      );
      /* Two 0.05% hops instead of one 0.3%, so the floor stays reachable. */
      const order = buildOrder({ minOut: usdc(900) });
      const before = await usdcToken.balanceOf(maker.address);
      await orders.connect(filler).fill(order, await sign(order), hops);

      expect((await usdcToken.balanceOf(maker.address)) - before).to.be.gte(
        order.minOut,
      );
    });

    it("cannot tell that a pool on the path is missing, and the fill reverts", async function () {
      /* The ends match the signed pair, so {_pathValid} passes and checkFill says
         the terms permit a fill — the contract does not know which pools exist.
         The boundary is honest because the failure is a reverted transaction the
         filler paid for, not a bad fill: nothing has moved when it is over. */
      const order = buildOrder();
      const sig = await sign(order);
      const missing = encodePath([kldToken.target, usdcToken.target], [500]);

      const [ok] = await orders.checkFill(order, sig, missing);
      expect(ok).to.equal(true);

      await expect(orders.connect(filler).fill(order, sig, missing)).to.be
        .reverted;
      expect((await orders.stateOf(order)).fills).to.equal(0);
    });
  });

  describe("the filler's fee", function () {
    it("is nothing by default, so the whole input is swapped", async function () {
      const order = buildOrder();
      await orders.connect(filler).fill(order, await sign(order), path());

      expect(await kldToken.balanceOf(filler.address)).to.equal(0);
      expect(await orders.swapInputFor(kld(1000))).to.equal(kld(1000));
    });

    it("pays the submitter, not the protocol", async function () {
      await orders.connect(owner).setFillerFeeBps(100);

      const ownerBefore = await kldToken.balanceOf(owner.address);
      const order = buildOrder();
      await orders.connect(filler).fill(order, await sign(order), path());

      /* 1% of the input, to whoever sent the transaction — it is there to cover
         their gas, which is what keeps filling open to anyone. */
      expect(await kldToken.balanceOf(filler.address)).to.equal(kld(10));
      expect(await kldToken.balanceOf(owner.address)).to.equal(ownerBefore);
    });

    it("reports the amount that will actually be swapped", async function () {
      await orders.connect(owner).setFillerFeeBps(100);

      /* The keeper quotes this number and not `amountIn`. A quote on the full
         input overstates the output by the fee, which near the floor is the
         difference between deciding to fill and paying for a revert. */
      expect(await orders.swapInputFor(kld(1000))).to.equal(kld(990));
    });

    it("still cannot pay the maker less than they signed for", async function () {
      await orders.connect(owner).setFillerFeeBps(100);

      /* A floor set at what the full input would fetch, so removing 1% of the
         input takes the output below it. The fee comes out first and the router
         then refuses the swap — the fee cannot be charged by quietly worsening a
         price the maker already agreed. */
      const order = buildOrder({ minOut: await quote(kld(1000)) });
      const sig = await sign(order);

      await expect(
        orders.connect(filler).fill(order, sig, path()),
      ).to.be.revertedWith("Too little received");
    });

    it("cannot be set above the cap", async function () {
      await expect(
        orders.connect(owner).setFillerFeeBps(101),
      ).to.be.revertedWithCustomError(orders, "KaleidoOrders_FeeTooHigh");
    });

    it("cannot be set by anyone but the owner", async function () {
      await expect(orders.connect(stranger).setFillerFeeBps(50)).to.be.reverted;
    });
  });

  describe("checkFill", function () {
    it("says the terms permit a fill", async function () {
      const order = buildOrder();
      const [ok, reason] = await orders.checkFill(
        order,
        await sign(order),
        path(),
      );

      expect(ok).to.equal(true);
      expect(reason).to.equal("");
    });

    it("says nothing about the price, and the router still holds the floor", async function () {
      /* The one thing checkFill deliberately does not answer. V3 quotes by
         simulating a swap and reverting, so a quote cannot be reached from a
         `view` function at all — the price comparison lives in the caller, next
         to the quote it already needs. What makes that safe is the second half:
         the floor is enforced by the router regardless of who decided to try. */
      const order = buildOrder({ minOut: usdc(5000) });
      const sig = await sign(order);

      const [ok, reason] = await orders.checkFill(order, sig, path());
      expect(ok).to.equal(true);
      expect(reason).to.equal("");

      await expect(
        orders.connect(filler).fill(order, sig, path()),
      ).to.be.revertedWith("Too little received");
    });

    it("names the reason instead of reverting, for every refusal it can see", async function () {
      /* This is what the keeper reads before it spends gas, and what the order
         list shows a maker. A revert here would tell both of them nothing. */
      const cases = [
        [buildOrder({ minOut: 0 }), path(), maker, "malformed order"],
        [buildOrder({ startAt: now + DAY }), path(), maker, "not started"],
        [buildOrder({ epoch: 7 }), path(), maker, "cancelled by the maker"],
        [
          buildOrder(),
          encodePath([kldToken.target, weth.target], [FEE]),
          maker,
          "path does not match the pair",
        ],
        [
          buildOrder(),
          path(),
          stranger,
          "signature does not match the maker",
        ],
      ];

      for (const [order, p, signer, expected] of cases) {
        const [ok, reason] = await orders.checkFill(
          order,
          await sign(order, signer),
          p,
        );
        expect(ok, expected).to.equal(false);
        expect(reason).to.equal(expected);
      }
    });

    it("reports a cancelled order as cancelled", async function () {
      const order = buildOrder();
      const sig = await sign(order);
      await orders.connect(maker).cancel(order);

      const [ok, reason] = await orders.checkFill(order, sig, path());
      expect(ok).to.equal(false);
      expect(reason).to.equal("cancelled");
    });

    it("reports a spent order and a recurring one still waiting", async function () {
      const one = buildOrder();
      const oneSig = await sign(one);
      await orders.connect(filler).fill(one, oneSig, path());
      expect((await orders.checkFill(one, oneSig, path()))[1]).to.equal(
        "fully filled",
      );

      const many = buildOrder({
        salt: 2n,
        interval: WEEK,
        maxFills: 4,
        expiry: now + 8 * WEEK,
      });
      const manySig = await sign(many);
      await orders.connect(filler).fill(many, manySig, path());
      expect((await orders.checkFill(many, manySig, path()))[1]).to.equal(
        "waiting for the next interval",
      );
    });

    it("reports an expired order as expired", async function () {
      const order = buildOrder({ expiry: now + DAY });
      const sig = await sign(order);
      await warp(DAY + 1);

      const [ok, reason] = await orders.checkFill(order, sig, path());
      expect(ok).to.equal(false);
      expect(reason).to.equal("expired");
    });
  });

  describe("the digest", function () {
    it("is what the wallet signed", async function () {
      /* The frontend builds this digest from the domain and the type string, and
         a mismatch there does not fail loudly — it produces orders no fill can
         verify. Recovering the signer from the contract's own hash is the check
         that the two agree. */
      const order = buildOrder();
      const sig = await sign(order);
      const digest = await orders.hashOrder(order);

      expect(ethers.recoverAddress(digest, sig)).to.equal(maker.address);
      expect(ethers.TypedDataEncoder.hash(domain, ORDER_TYPES, order)).to.equal(
        digest,
      );
    });

    it("separates two orders that differ only by salt", async function () {
      const a = buildOrder({ salt: 1n });
      const b = buildOrder({ salt: 2n });

      expect(await orders.hashOrder(a)).to.not.equal(await orders.hashOrder(b));

      await orders.connect(filler).fill(a, await sign(a), path());
      await orders.connect(filler).fill(b, await sign(b), path());

      expect((await orders.stateOf(a)).fills).to.equal(1);
      expect((await orders.stateOf(b)).fills).to.equal(1);
    });
  });
});
