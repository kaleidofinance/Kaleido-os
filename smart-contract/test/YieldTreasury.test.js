const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * YieldTreasury — who is owed what, and can the pool actually pay it.
 *
 * WHAT THESE TESTS ARE REALLY CHECKING. The treasury pays a share of a pooled
 * index to kafUSD holders, and the only interesting question about that kind of
 * accounting is whether the sum of what it promises can exceed what it holds.
 * It could, and did:
 *
 *   `userRewardDebt` was written in exactly three places, all of them claims,
 *   and nothing initialised it when a user acquired kafUSD. So every holder was
 *   valued against the whole historical `accYieldPerShare` from a debt of zero
 *   — credited yield that accrued before they arrived. Measured on Sepolia on
 *   2026-09-10: 74,243 kafUSD in issue, 71.45 kfUSD of yield ever deposited,
 *   3,969 kfUSD of total entitlement. Over-entitled 55x.
 *
 *   `claimYield` then subtracted that from `yieldBalancePerAsset` with no guard,
 *   where `claimAllYield` had always had one. The subtraction underflowed, which
 *   reaches a user as `PANIC 17` on the Claim button. Two testers reported it.
 *
 *   `claimAndCompound` transferred and never decremented the pool at all, so the
 *   treasury's own books drifted upward on every compound: it said it owed 71.45
 *   kfUSD while holding 47.40.
 *
 * So the cases below are about the invariant, not the happy path. The single
 * most important one is `a holder who arrives after the yield is credited
 * nothing for it` — every other symptom followed from that.
 *
 * THE CONSERVATIVE RULE. Exact accounting would need kafUSD to call in on every
 * transfer, which would mean redeploying kafUSD and migrating every holder. This
 * contract instead values a window at the SMALLER of the balance now and the
 * balance at the last checkpoint, which can under-credit and can never
 * over-credit. `under-credits rather than over-credits when a balance grows`
 * pins that, because it is a deliberate trade and would otherwise read as a bug
 * to whoever finds it next.
 */
const usd = (n) => ethers.parseUnits(String(n), 18);

describe("YieldTreasury", function () {
  let deployer, early, late, other;
  let kfusd, kafusd, treasury;

  beforeEach(async function () {
    [deployer, early, late, other] = await ethers.getSigners();

    /* Mocks for the two tokens, deliberately. The treasury only ever reads
       balanceOf and totalSupply off kafUSD and transfers the yield asset, so the
       real kfUSD/kafUSD pair would add a collateral flow and a lock flow to
       every case while testing none of this contract's arithmetic. The real
       tokens' own behaviour is not in question here; the accounting is. */
    const Mock = await ethers.getContractFactory("MockERC20");
    kfusd = await Mock.deploy("Kaleido USD", "kfUSD", 18);
    kafusd = await Mock.deploy("Kaleido Liquid USD", "kafUSD", 18);
    treasury = await (
      await ethers.getContractFactory("YieldTreasury")
    ).deploy(await kafusd.getAddress());

    const ADMIN = await treasury.ADMIN_ROLE();
    const SOURCE = await treasury.YIELD_SOURCE_ROLE();
    await treasury.grantRole(ADMIN, deployer.address);
    await treasury.grantRole(SOURCE, deployer.address);
    await treasury.setYieldAsset(await kfusd.getAddress(), true);

    await kafusd.mint(early.address, usd(1000));

    /* Checkpointed before any yield arrives, which is the operational
       requirement this design carries and not a test convenience: a holder
       accrues only from their first checkpoint, so whoever deploys this has to
       checkpoint the existing holders once before the first receiveYield, and a
       keeper has to pick up new holders after that. The case below named
       `strands yield deposited before a holder was ever checkpointed` is what
       happens when that is skipped, pinned so the cost is visible rather than
       discovered. */
    await treasury.checkpoint(early.address);

    // Yield is paid in kfUSD, so the treasury needs a float to pay out of.
    await kfusd.mint(deployer.address, usd(10_000));
    await kfusd.approve(await treasury.getAddress(), usd(10_000));
  });

  const deposit = (n) =>
    treasury.receiveYield(kfusd.getAddress(), usd(n), "test");

  it("credits the whole pot to the only holder there when it arrived", async function () {
    await deposit(100);
    expect(await treasury.calculateUserYield(early.address, kfusd.getAddress())).to.equal(
      usd(100),
    );
  });

  /* THE BUG. A holder who arrives after the index has moved must not be entitled
     to what moved it. This is the case that produced every other symptom. */
  it("credits a holder who arrives after the yield nothing for it", async function () {
    await deposit(100);
    await kafusd.mint(late.address, usd(1000));
    await treasury.checkpoint(late.address);

    expect(await treasury.calculateUserYield(late.address, kfusd.getAddress())).to.equal(0n);
  });

  /* The cost of the checkpoint requirement, stated plainly. Yield that arrives
     while a holder has never been checkpointed is not theirs and never becomes
     theirs — it stays in the pool. That is the safe direction and it is why the
     deploy has to checkpoint existing holders before the first receiveYield. */
  it("strands yield deposited before a holder was ever checkpointed", async function () {
    await kafusd.mint(other.address, usd(1000));
    await deposit(100);
    await treasury.checkpoint(other.address);

    expect(await treasury.calculateUserYield(other.address, kfusd.getAddress())).to.equal(0n);
  });

  it("and the two of them split only what arrives afterwards", async function () {
    await deposit(100);
    await kafusd.mint(late.address, usd(1000));
    await treasury.checkpoint(late.address);
    await deposit(100);

    // 2000 kafUSD in issue, so 50 each out of the second 100.
    expect(await treasury.calculateUserYield(late.address, kfusd.getAddress())).to.equal(
      usd(50),
    );
    expect(await treasury.calculateUserYield(early.address, kfusd.getAddress())).to.equal(
      usd(150),
    );
  });

  /* The sum of every entitlement must never exceed what the pool holds. That is
     the property the underflow was a symptom of, so it is asserted directly and
     not only through the revert. */
  it("never promises more in total than the pool actually holds", async function () {
    await deposit(100);
    await kafusd.mint(late.address, usd(9000));
    await deposit(100);
    await treasury.checkpoint(late.address);

    const a = await treasury.calculateUserYield(early.address, kfusd.getAddress());
    const b = await treasury.calculateUserYield(late.address, kfusd.getAddress());
    const pool = await treasury.yieldBalancePerAsset(kfusd.getAddress());
    expect(a + b).to.be.lte(pool);
  });

  it("pays a claim and takes it out of the pool", async function () {
    await deposit(100);
    const before = await kfusd.balanceOf(early.address);

    await treasury.connect(early).claimYield(kfusd.getAddress());

    expect(await kfusd.balanceOf(early.address)).to.equal(before + usd(100));
    expect(await treasury.yieldBalancePerAsset(kfusd.getAddress())).to.equal(0n);
    expect(await treasury.calculateUserYield(early.address, kfusd.getAddress())).to.equal(0n);
  });

  it("refuses a claim with nothing owed instead of paying zero", async function () {
    await deposit(100);
    await kafusd.mint(late.address, usd(1000));

    await expect(
      treasury.connect(late).claimYield(kfusd.getAddress()),
    ).to.be.revertedWith("YieldTreasury: No yield available for this asset");
  });

  /* PANIC 17, in the shape a user met it. Not reachable any more via the
     entitlement, so the guard is asserted directly: whatever the pool is short
     of, the answer must be a sentence rather than an arithmetic panic. */
  it("says so in words when the pool is short, rather than panicking", async function () {
    await deposit(100);
    // Drain the tokens without touching the books, reproducing a pool that
    // cannot cover what it has recorded.
    await treasury.emergencyWithdraw(kfusd.getAddress(), usd(100), other.address);

    await expect(
      treasury.connect(early).claimYield(kfusd.getAddress()),
    ).to.be.revertedWith("YieldTreasury: Pool is short of this asset on hand");
  });

  /* claimAndCompound paid out and left the pool figure untouched, so the books
     drifted up by the whole amount on every compound. */
  it("decrements the pool when compounding, not only when claiming", async function () {
    await deposit(100);
    expect(await treasury.yieldBalancePerAsset(kfusd.getAddress())).to.equal(usd(100));

    await treasury.connect(early).claimAndCompound(kfusd.getAddress());

    expect(await treasury.yieldBalancePerAsset(kfusd.getAddress())).to.equal(0n);
    expect(await kfusd.balanceOf(await treasury.getAddress())).to.equal(0n);
  });

  it("cannot be claimed twice", async function () {
    await deposit(100);
    await treasury.connect(early).claimYield(kfusd.getAddress());

    await expect(
      treasury.connect(early).claimYield(kfusd.getAddress()),
    ).to.be.revertedWith("YieldTreasury: No yield available for this asset");
  });

  /* The deliberate trade, pinned so it is not mistaken for a defect. A balance
     that grew mid-window earns at the OLD size; the difference stays in the pool
     rather than being promised out of it. */
  it("under-credits rather than over-credits when a balance grows mid-window", async function () {
    await treasury.checkpoint(early.address); // 1000 kafUSD on record
    await kafusd.mint(early.address, usd(1000)); // now 2000, no checkpoint
    await deposit(100);

    // The index moved against a 2000 supply, but early is valued at the 1000
    // that was on record, so 50 rather than 100.
    expect(await treasury.calculateUserYield(early.address, kfusd.getAddress())).to.equal(
      usd(50),
    );
  });

  it("lets anyone close a window for anyone, and repeats harmlessly", async function () {
    await deposit(100);
    await treasury.connect(other).checkpoint(early.address);
    const once = await treasury.calculateUserYield(early.address, kfusd.getAddress());

    await treasury.connect(other).checkpoint(early.address);
    await treasury.connect(other).checkpoint(early.address);

    expect(await treasury.calculateUserYield(early.address, kfusd.getAddress())).to.equal(
      once,
    );
  });
});
