const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * KLD and KLDVesting — the protocol token and the TGE allocation table.
 *
 * The allocation below is the tokenomics table, transcribed once and used as the
 * fixture for every case, so a change to the table breaks the tests rather than
 * quietly disagreeing with them. Two things in here are worth reading before the
 * assertions, because both are load-bearing and neither is obvious.
 *
 * ── The curve is asserted through `vestedAt`, not by time travel ────────────
 *
 * `vestedAt(id, timestamp)` is a view taking an explicit time, so the whole
 * four-year schedule is checked arithmetically in one block. Time travel is used
 * only where the thing under test is `claim` itself. This is not a shortcut: the
 * boundary cases that matter are one second either side of a cliff, and
 * `evm_setNextBlockTimestamp` cannot express "the same state, one second apart"
 * without mining, which moves everything else too.
 *
 * ── The TGE unlock computes to 20.5%, not the 18% on the sheet ──────────────
 *
 * Summing the TGE columns of the eight buckets gives 205,000,000 KLD — Public
 * Sale 50M, Seed 30M, Community 50M, Liquidity 75M — which is 20.5% of supply.
 * The tokenomics sheet's own "Total Percent" column reads 5% + 3% + 7% + 3% =
 * 18%. Two rows disagree with their own vesting text: Community Ecosystem
 * unlocks 25% of a 20% bucket, which is 5% of supply and not 7%, and Liquidity
 * unlocks 50% of a 15% bucket, which is 7.5% and not 3%.
 *
 * These tests follow the vesting text, because that is the column that describes
 * a release curve; a summary percentage cannot be implemented. The assertion is
 * spelled out as its own case so the number is stated rather than implied, and so
 * that settling the discrepancy the other way fails here first.
 */

const MONTH = 30 * 24 * 60 * 60; // KLDVesting.MONTH — 30 days. See its header.
const M = (n) => ethers.parseEther(String(n * 1_000_000));
const MAX_SUPPLY = M(1000); // 1,000,000,000 KLD

/** The tokenomics table. Amounts in KLD; times in seconds from TGE. */
const BUCKETS = [
  {
    label: "Public Sale",
    note: "100% unlocked at TGE",
    tge: M(50),
    cliffAmount: 0n,
    cliffAt: 0,
    linear: 0n,
    linearStart: 0,
    linearDuration: 0,
    total: M(50),
  },
  {
    label: "Seed Round",
    note: "20% TGE; 3-month cliff; 20% unlock at Month 3; 60% linear over 10 months",
    tge: M(30),
    cliffAmount: M(30),
    cliffAt: 3 * MONTH,
    linear: M(90),
    linearStart: 3 * MONTH,
    linearDuration: 10 * MONTH,
    total: M(150),
  },
  {
    label: "Community Ecosystem",
    note: "25% at TGE, 6 months linear",
    tge: M(50),
    cliffAmount: 0n,
    cliffAt: 0,
    linear: M(150),
    linearStart: 0,
    linearDuration: 6 * MONTH,
    total: M(200),
  },
  {
    label: "Liquidity",
    note: "50% available at TGE; remaining 50% progressively released over 24 months",
    tge: M(75),
    cliffAmount: 0n,
    cliffAt: 0,
    linear: M(75),
    linearStart: 0,
    linearDuration: 24 * MONTH,
    total: M(150),
  },
  {
    label: "Team",
    note: "12-month cliff; 36-month linear vesting",
    tge: 0n,
    cliffAmount: 0n,
    cliffAt: 0,
    linear: M(100),
    linearStart: 12 * MONTH,
    linearDuration: 36 * MONTH,
    total: M(100),
  },
  {
    label: "Grants & Contributors",
    note: "0% TGE; 3-month cliff; 12-month linear vesting",
    tge: 0n,
    cliffAmount: 0n,
    cliffAt: 0,
    linear: M(100),
    linearStart: 3 * MONTH,
    linearDuration: 12 * MONTH,
    total: M(100),
  },
  {
    label: "Treasury",
    note: "12-month cliff; 36-month linear vesting",
    tge: 0n,
    cliffAmount: 0n,
    cliffAt: 0,
    linear: M(150),
    linearStart: 12 * MONTH,
    linearDuration: 36 * MONTH,
    total: M(150),
  },
  {
    label: "Advisors and Partners",
    note: "6-month cliff; 24-month linear vesting",
    tge: 0n,
    cliffAmount: 0n,
    cliffAt: 0,
    linear: M(100),
    linearStart: 6 * MONTH,
    linearDuration: 24 * MONTH,
    total: M(100),
  },
];

describe("KLD", function () {
  let kld, admin, minter, bridge, alice;

  beforeEach(async function () {
    [admin, minter, bridge, alice] = await ethers.getSigners();
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const KLD = await ethers.getContractFactory("KLD");
    kld = await KLD.deploy(MAX_SUPPLY, chainId, admin.address);
    await kld.waitForDeployment();
  });

  it("matches the token OWN_TOKENS has always described", async function () {
    // src/constants/registry.ts:790 — symbol KLD, name "Kaleido", 18 decimals.
    // The frontend keys off these; a mismatch shows a token with no name.
    expect(await kld.name()).to.equal("Kaleido");
    expect(await kld.symbol()).to.equal("KLD");
    expect(await kld.decimals()).to.equal(18n);
  });

  it("mints nothing at construction", async function () {
    // Allocation is the deploy script's job, so the token itself has no opinion
    // about who gets the first tokens. A fresh KLD is inert.
    expect(await kld.totalSupply()).to.equal(0n);
    expect(await kld.totalIssued()).to.equal(0n);
    expect(await kld.remainingIssuance()).to.equal(MAX_SUPPLY);
  });

  it("caps issuance at maxSupply", async function () {
    await kld.mint(alice.address, MAX_SUPPLY - M(1));
    await expect(kld.mint(alice.address, M(2)))
      .to.be.revertedWithCustomError(kld, "CapExceeded")
      .withArgs(M(2), M(1));
    await kld.mint(alice.address, M(1)); // exactly to the cap is fine
    expect(await kld.totalSupply()).to.equal(MAX_SUPPLY);
  });

  it("does not hand back issuance headroom when tokens are burnt", async function () {
    /* THE INVARIANT THAT MAKES THIS TOKEN SAFE TO BRIDGE.
     *
     * Under burn-and-mint bridging, leaving this chain burns supply here. If the
     * cap were checked against totalSupply(), bridging everything away would
     * restore the full headroom and a minter could issue maxSupply a second
     * time — 2x supply, from a contract that looks capped. Capping the monotonic
     * totalIssued is what closes it, and this is that case: mint to the cap,
     * burn the lot, and the next wei of issuance must still fail. */
    await kld.mint(alice.address, MAX_SUPPLY);
    await kld.connect(alice).burn(MAX_SUPPLY);

    expect(await kld.totalSupply()).to.equal(0n);
    expect(await kld.totalIssued()).to.equal(MAX_SUPPLY);
    expect(await kld.remainingIssuance()).to.equal(0n);
    await expect(kld.mint(alice.address, 1n)).to.be.revertedWithCustomError(
      kld,
      "CapExceeded",
    );
  });

  it("refuses MINTER_ROLE on any chain but the home chain", async function () {
    /* The other half of the global-supply guarantee: a satellite deployment
     * cannot issue, only receive over a bridge. Deployed here with a home chain
     * id that is deliberately not this one. */
    const thisChain = (await ethers.provider.getNetwork()).chainId;
    const foreignHome = thisChain + 1n;

    const KLD = await ethers.getContractFactory("KLD");
    const satellite = await KLD.deploy(MAX_SUPPLY, foreignHome, admin.address);
    await satellite.waitForDeployment();

    expect(await satellite.isHomeChain()).to.equal(false);
    // The constructor skipped the grant rather than reverting the deploy.
    expect(await satellite.hasRole(await satellite.MINTER_ROLE(), admin.address))
      .to.equal(false);

    await expect(
      satellite.grantRole(await satellite.MINTER_ROLE(), minter.address),
    )
      .to.be.revertedWithCustomError(satellite, "IssuanceIsHomeChainOnly")
      .withArgs(foreignHome, thisChain);
  });

  it("lets a bridge mint without consuming issuance headroom", async function () {
    /* A cross-chain transfer is not issuance: the tokens were counted against
     * the cap at home and burnt there. A bridge holding MINTER_ROLE instead
     * would eat real headroom on every inbound transfer. */
    await kld.grantRole(await kld.BRIDGE_ROLE(), bridge.address);
    await kld.connect(bridge).mint(alice.address, M(100));

    expect(await kld.balanceOf(alice.address)).to.equal(M(100));
    expect(await kld.totalIssued()).to.equal(0n);
    expect(await kld.remainingIssuance()).to.equal(MAX_SUPPLY);
  });

  it("still bounds a bridge by the global cap", async function () {
    // Not the cap — a backstop, so a broken bridge is bounded rather than
    // unbounded. One chain must never hold more than global supply.
    await kld.grantRole(await kld.BRIDGE_ROLE(), bridge.address);
    await kld.connect(bridge).mint(alice.address, MAX_SUPPLY);
    await expect(kld.connect(bridge).mint(alice.address, 1n))
      .to.be.revertedWithCustomError(kld, "BridgeMintExceedsGlobalCap")
      .withArgs(1n, 0n);
  });

  it("refuses a caller holding neither role", async function () {
    await expect(kld.connect(alice).mint(alice.address, 1n))
      .to.be.revertedWithCustomError(kld, "NotAuthorisedToMint")
      .withArgs(alice.address);
  });

  it("rejects a zero cap and a zero admin", async function () {
    const KLD = await ethers.getContractFactory("KLD");
    const chainId = (await ethers.provider.getNetwork()).chainId;
    await expect(
      KLD.deploy(0, chainId, admin.address),
    ).to.be.revertedWithCustomError(KLD, "ZeroMaxSupply");
    await expect(
      KLD.deploy(MAX_SUPPLY, chainId, ethers.ZeroAddress),
    ).to.be.revertedWithCustomError(KLD, "ZeroAddress");
  });

  it("carries a working EIP-2612 permit domain", async function () {
    // The staking UI approves before every deposit; permit is what lets that be
    // a signature rather than a second transaction.
    await kld.mint(alice.address, M(1));
    const { chainId } = await ethers.provider.getNetwork();
    const deadline = ethers.MaxUint256;
    const value = M(1);

    const sig = await alice.signTypedData(
      {
        name: "Kaleido",
        version: "1",
        chainId,
        verifyingContract: await kld.getAddress(),
      },
      {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      {
        owner: alice.address,
        spender: bridge.address,
        value,
        nonce: await kld.nonces(alice.address),
        deadline,
      },
    );
    const { v, r, s } = ethers.Signature.from(sig);
    await kld.permit(alice.address, bridge.address, value, deadline, v, r, s);
    expect(await kld.allowance(alice.address, bridge.address)).to.equal(value);
  });
});

describe("KLDVesting", function () {
  let kld, vesting, admin, alice, bob;
  let tge;

  /** Deploy KLD + vesting, fund with the full supply, register all 8 buckets. */
  async function deployWithTable(startOffsetSeconds = 0) {
    [admin, alice, bob] = await ethers.getSigners();
    const chainId = (await ethers.provider.getNetwork()).chainId;

    const KLD = await ethers.getContractFactory("KLD");
    kld = await KLD.deploy(MAX_SUPPLY, chainId, admin.address);
    await kld.waitForDeployment();

    const now = BigInt((await ethers.provider.getBlock("latest")).timestamp);
    tge = now + BigInt(startOffsetSeconds);

    const V = await ethers.getContractFactory("KLDVesting");
    vesting = await V.deploy(await kld.getAddress(), tge, admin.address);
    await vesting.waitForDeployment();

    // Fund first, then allocate — addSchedule refuses otherwise.
    await kld.mint(await vesting.getAddress(), MAX_SUPPLY);
    for (const b of BUCKETS) {
      await vesting.addSchedule(
        admin.address,
        b.label,
        b.tge,
        b.cliffAmount,
        b.cliffAt,
        b.linear,
        b.linearStart,
        b.linearDuration,
      );
    }
  }

  beforeEach(async function () {
    await deployWithTable();
  });

  it("holds the whole allocation table and nothing spare", async function () {
    expect(await vesting.scheduleCount()).to.equal(BigInt(BUCKETS.length));
    expect(await vesting.totalAllocated()).to.equal(MAX_SUPPLY);
    expect(await vesting.unallocated()).to.equal(0n);

    // The eight buckets sum to supply — the sheet's own total, checked here so a
    // mistyped bucket cannot pass as a complete table.
    const sum = BUCKETS.reduce((a, b) => a + b.total, 0n);
    expect(sum).to.equal(MAX_SUPPLY);

    for (let i = 0; i < BUCKETS.length; i++) {
      const s = await vesting.schedules(i);
      expect(s.label, `label ${i}`).to.equal(BUCKETS[i].label);
      expect(s.total, `total ${i}`).to.equal(BUCKETS[i].total);
    }
  });

  it("unlocks 205,000,000 KLD at TGE — 20.5%, not the sheet's 18%", async function () {
    /* See the file header. Public Sale 50M + Seed 30M + Community 50M +
     * Liquidity 75M. Asserted as an explicit number so that settling the
     * discrepancy the other way has to change this line. */
    let atTge = 0n;
    for (let i = 0; i < BUCKETS.length; i++) {
      atTge += await vesting.vestedAt(i, tge);
    }
    expect(atTge).to.equal(M(205));
    expect((atTge * 1000n) / MAX_SUPPLY).to.equal(205n); // 20.5%
  });

  it("releases nothing before TGE", async function () {
    await deployWithTable(30 * MONTH); // TGE 30 months out
    for (let i = 0; i < BUCKETS.length; i++) {
      expect(await vesting.vestedAt(i, tge - 1n), `bucket ${i}`).to.equal(0n);
    }
  });

  it("steps the Seed Round at month 3 rather than ramping into it", async function () {
    /* The case `cliffAmount` exists for. "20% unlock at Month 3" is a step; a
     * plain cliff-plus-linear contract would spread that 20% across the ten
     * months after it and land on the same total by a different path. */
    const seed = 1;
    const at = (months) => vesting.vestedAt(seed, tge + BigInt(months * MONTH));

    expect(await at(0)).to.equal(M(30)); // 20% TGE
    expect(await vesting.vestedAt(seed, tge + BigInt(3 * MONTH) - 1n)).to.equal(
      M(30), // one second before the step: still only the TGE tranche
    );
    expect(await at(3)).to.equal(M(60)); // step lands: 20% + 20%
    expect(await at(8)).to.equal(M(60) + M(90) / 2n); // half the tail
    expect(await at(13)).to.equal(M(150)); // 3 + 10 months: fully vested
    expect(await at(60)).to.equal(M(150)); // and never more
  });

  it("vests every bucket to exactly its total, and no earlier", async function () {
    /* End-to-end on the table: one second before each bucket's final second it
     * must be short, and at it, exact. Catches an off-by-one in the tail and any
     * bucket whose components do not reach its total. */
    const ends = [
      0, // Public Sale — all at TGE
      3 + 10, // Seed
      6, // Community
      24, // Liquidity
      12 + 36, // Team
      3 + 12, // Grants
      12 + 36, // Treasury
      6 + 24, // Advisors
    ];
    for (let i = 0; i < BUCKETS.length; i++) {
      const endAt = tge + BigInt(ends[i] * MONTH);
      expect(await vesting.vestedAt(i, endAt), `${BUCKETS[i].label} end`).to.equal(
        BUCKETS[i].total,
      );
      if (ends[i] > 0) {
        expect(
          await vesting.vestedAt(i, endAt - 1n),
          `${BUCKETS[i].label} one second early`,
        ).to.be.lt(BUCKETS[i].total);
      }
    }
  });

  it("holds the four zero-TGE buckets behind their cliffs", async function () {
    // Team, Grants, Treasury, Advisors — nothing at all until the tail starts.
    for (const [id, cliffMonths] of [
      [4, 12],
      [5, 3],
      [6, 12],
      [7, 6],
    ]) {
      const atCliff = tge + BigInt(cliffMonths * MONTH);
      expect(await vesting.vestedAt(id, atCliff - 1n), `bucket ${id}`).to.equal(0n);
      expect(await vesting.vestedAt(id, atCliff), `bucket ${id} at cliff`).to.equal(
        0n, // the ramp starts here; it has accrued nothing yet
      );
      expect(
        await vesting.vestedAt(id, atCliff + BigInt(MONTH)),
        `bucket ${id} one month in`,
      ).to.be.gt(0n);
    }
  });

  it("never releases more than supply across the whole schedule", async function () {
    for (const months of [0, 1, 3, 6, 12, 13, 24, 30, 36, 48, 120]) {
      let released = 0n;
      for (let i = 0; i < BUCKETS.length; i++) {
        released += await vesting.vestedAt(i, tge + BigInt(months * MONTH));
      }
      expect(released, `month ${months}`).to.be.lte(MAX_SUPPLY);
    }
    // And reaches supply exactly once the last bucket completes (month 48).
    let final = 0n;
    for (let i = 0; i < BUCKETS.length; i++) {
      final += await vesting.vestedAt(i, tge + BigInt(48 * MONTH));
    }
    expect(final).to.equal(MAX_SUPPLY);
  });

  it("refuses to allocate more than it holds", async function () {
    // The failure this guard exists for: eight schedules summing past the
    // balance look correct for months, then the last beneficiary finds nothing.
    await expect(
      vesting.addSchedule(alice.address, "Overflow", M(1), 0, 0, 0, 0, 0),
    ).to.be.revertedWithCustomError(vesting, "InsufficientUnallocatedBalance");
  });

  it("rejects malformed schedules", async function () {
    /* A fresh, deliberately under-funded pair rather than the fixture above: that
     * one holds the entire 1B, so both mint paths are exhausted — MINTER_ROLE by
     * the cap and BRIDGE_ROLE by the global-supply backstop — and there is no
     * headroom to attempt an allocation with. */
    const KLD = await ethers.getContractFactory("KLD");
    const V = await ethers.getContractFactory("KLDVesting");
    const chainId = (await ethers.provider.getNetwork()).chainId;

    const k = await KLD.deploy(MAX_SUPPLY, chainId, admin.address);
    const now = BigInt((await ethers.provider.getBlock("latest")).timestamp);
    const v = await V.deploy(await k.getAddress(), now, admin.address);
    await k.mint(await v.getAddress(), M(10));

    await expect(
      v.addSchedule(alice.address, "no duration", 0, 0, 0, M(1), 0, 0),
    ).to.be.revertedWithCustomError(v, "LinearDurationMismatch");
    await expect(
      v.addSchedule(alice.address, "cliff at nothing", M(1), 0, MONTH, 0, 0, 0),
    ).to.be.revertedWithCustomError(v, "CliffBeforeNothing");
    await expect(
      v.addSchedule(alice.address, "empty", 0, 0, 0, 0, 0, 0),
    ).to.be.revertedWithCustomError(v, "ZeroAmount");
    await expect(
      v.addSchedule(ethers.ZeroAddress, "nobody", M(1), 0, 0, 0, 0, 0),
    ).to.be.revertedWithCustomError(v, "ZeroAddress");
  });

  it("pays a claim to the beneficiary no matter who calls it", async function () {
    /* Permissionless claim, fixed payee. A third party can pay the gas; nobody
     * can redirect the tokens. */
    const V = await ethers.getContractFactory("KLDVesting");
    const KLD = await ethers.getContractFactory("KLD");
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const k = await KLD.deploy(MAX_SUPPLY, chainId, admin.address);
    const now = BigInt((await ethers.provider.getBlock("latest")).timestamp);
    const v = await V.deploy(await k.getAddress(), now, admin.address);
    await k.mint(await v.getAddress(), M(50));
    await v.addSchedule(alice.address, "Public Sale", M(50), 0, 0, 0, 0, 0);

    await expect(v.connect(bob).claim(0)).to.changeTokenBalances(
      k,
      [alice, bob],
      [M(50), 0n],
    );
    await expect(v.connect(bob).claim(0)).to.be.revertedWithCustomError(
      v,
      "NothingToClaim",
    );
  });

  it("keeps circulating supply readable as supply minus what it holds", async function () {
    /* The invariant that makes circulating supply computable without an indexer:
     * every KLD this contract holds is unreleased.
     *
     * Asserted against the contract's own curve at the claim block's timestamp
     * rather than against a flat 205M. Community and Liquidity both ramp from
     * month 0, so by the time claimAll is mined a few seconds of tail have
     * genuinely accrued — expecting the bare TGE figure would be asserting that
     * the linear buckets do not start until later than they do. */
    const rc = await (await vesting.claimAll()).wait();
    const ts = BigInt((await ethers.provider.getBlock(rc.blockNumber)).timestamp);

    let expected = 0n;
    for (let i = 0; i < BUCKETS.length; i++) {
      expected += await vesting.vestedAt(i, ts);
    }

    const held = await kld.balanceOf(await vesting.getAddress());
    expect((await kld.totalSupply()) - held).to.equal(expected);
    expect(await vesting.totalClaimed()).to.equal(expected);

    // And that figure is the TGE tranche plus only seconds of ramp, not a month.
    expect(expected).to.be.gte(M(205));
    expect(expected - M(205)).to.be.lt(M(1));
  });

  it("skips buckets with nothing due instead of reverting the batch", async function () {
    // Four of the eight are behind cliffs of 3 to 12 months and must not block
    // the four with TGE tranches.
    const paid = await vesting.claimAll.staticCall();
    expect(paid).to.be.gte(M(205));
    expect(paid - M(205)).to.be.lt(M(1));

    await vesting.claimAll();
    for (const id of [4, 5, 6, 7]) {
      expect((await vesting.schedules(id)).claimed, `bucket ${id}`).to.equal(0n);
    }
    // The four that paid did so in full for their TGE tranche.
    for (const id of [0, 1]) {
      expect((await vesting.schedules(id)).claimed, `bucket ${id}`).to.equal(
        BUCKETS[id].tge,
      );
    }
  });

  it("reverts claimAll only when no row has anything due", async function () {
    /* Asserted on a pre-TGE fixture, not by calling claimAll twice. Community and
     * Liquidity ramp from month 0, so a second call one block later legitimately
     * has a few seconds of accrual to pay — "nothing due anywhere" is a state
     * this table only reaches before TGE. */
    await deployWithTable(6 * MONTH);
    await expect(vesting.claimAll()).to.be.revertedWithCustomError(
      vesting,
      "NothingToClaim",
    );
    await expect(vesting.claim(0)).to.be.revertedWithCustomError(
      vesting,
      "NothingToClaim",
    );
  });

  it("will not let the owner sweep an allocated tranche", async function () {
    // sweep() is capped at unallocated(), which is zero once the table is
    // registered — so a beneficiary's unclaimed KLD is out of the owner's reach.
    expect(await vesting.unallocated()).to.equal(0n);
    await expect(
      vesting.sweep(await kld.getAddress(), admin.address, M(1)),
    ).to.be.revertedWithCustomError(vesting, "InsufficientUnallocatedBalance");
  });
});
