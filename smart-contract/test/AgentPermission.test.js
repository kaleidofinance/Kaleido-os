const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * Agent delegation — the guardrails, exercised directly.
 *
 * STAGE 0 of the agent-execution rollout: prove the on-chain bounds bite before
 * a single line of executing code (a facet that calls `resolveActor`) or a
 * single key that could act on them exists. Nothing here deploys the protocol or
 * moves a token; it drives `LibAgentPermission` through a harness that inherits
 * `AgentPermissionFacet`, so the grant a test writes and the budget the resolver
 * spends share the one storage slot the diamond gives them in production.
 *
 * The claim being checked is narrow and load-bearing: a user grants a *ceiling*,
 * and the enforcement refuses everything above it no matter who is asking — and
 * the one thing it deliberately does NOT do (assert the health factor; that is
 * the caller's post-action job) is pinned too, so a future facet author cannot
 * mistake this for the whole check.
 */

const e18 = (n) => ethers.parseUnits(String(n), 18);
const PER_ACTION = e18(1000);
const PER_EPOCH = e18(5000);
const EPOCH = 24 * 60 * 60; // 1 day

// LibAgentPermission.ACTION_* bitmask.
const BORROW = 1;
const LEND = 2;
const REPAY = 4;

const TOKEN = ethers.getAddress("0x00000000000000000000000000000000c0ffee00");
const OTHER_TOKEN = ethers.getAddress(
  "0x00000000000000000000000000000000badbad00",
);

const increaseTime = async (sec) => {
  await ethers.provider.send("evm_increaseTime", [sec]);
  await ethers.provider.send("evm_mine", []);
};
const now = async () =>
  (await ethers.provider.getBlock("latest")).timestamp;

describe("Agent delegation guardrails (Stage 0)", function () {
  let h, user, agent, other, subAgent;

  const grant = (actions, opts = {}) =>
    h
      .connect(opts.by ?? user)
      .grantAgentPermission(
        opts.agent ?? agent.address,
        opts.perAction ?? PER_ACTION,
        opts.perEpoch ?? PER_EPOCH,
        opts.epoch ?? EPOCH,
        opts.expiry,
        opts.maxInterestBps ?? 500, // 5%
        opts.minHealthFactorBps ?? 12000, // 1.2
        actions,
        opts.tokens ?? [TOKEN],
      );

  beforeEach(async function () {
    [user, agent, other, subAgent] = await ethers.getSigners();
    const Harness = await ethers.getContractFactory("AgentPermissionHarness");
    h = await Harness.deploy();
    await grant(BORROW | REPAY, { expiry: (await now()) + 30 * EPOCH });
  });

  /* --------------------------------------------------- happy path -- */

  it("stores the bounds the user granted", async function () {
    const p = await h.getAgentPermission(user.address, agent.address);
    expect(p.maxNotionalPerAction).to.equal(PER_ACTION);
    expect(p.maxNotionalPerEpoch).to.equal(PER_EPOCH);
    expect(p.minHealthFactorBps).to.equal(12000);
    expect(p.revoked).to.equal(false);
    expect(await h.isAgentTokenAllowed(user.address, agent.address, TOKEN)).to
      .equal(true);
  });

  it("lets the agent act within the caps, and debits the budget", async function () {
    await h.connect(agent).resolve(user.address, BORROW, TOKEN, e18(400));
    expect(
      await h.agentRemainingBudget(user.address, agent.address),
    ).to.equal(PER_EPOCH - e18(400));
  });

  it("an action exactly at the per-action ceiling is allowed", async function () {
    await h.connect(agent).resolve(user.address, BORROW, TOKEN, PER_ACTION);
    expect(
      await h.agentRemainingBudget(user.address, agent.address),
    ).to.equal(PER_EPOCH - PER_ACTION);
  });

  /* --------------------------------------------- the self / no-op path -- */

  it("acting for yourself needs no grant", async function () {
    // `other` has no permission at all but is acting for itself.
    expect(
      await h
        .connect(other)
        .resolve.staticCall(other.address, BORROW, TOKEN, e18(1_000_000)),
    ).to.equal(other.address);
  });

  it("the self-path is a pure no-op — it spends no delegated budget", async function () {
    // The agent holds a grant to act for `user`, but here it acts for ITSELF.
    // That must resolve to the agent and leave the user→agent budget untouched,
    // or a delegate could quietly drain a mandate by naming itself.
    await h.connect(agent).resolve(agent.address, BORROW, TOKEN, e18(999999));
    expect(
      await h.agentRemainingBudget(user.address, agent.address),
    ).to.equal(PER_EPOCH);
  });

  it("onBehalfOf = address(0) also means 'self' and touches nothing", async function () {
    const ZERO = ethers.ZeroAddress;
    expect(
      await h
        .connect(agent)
        .resolve.staticCall(ZERO, BORROW, TOKEN, e18(999999)),
    ).to.equal(agent.address);
    await h.connect(agent).resolve(ZERO, BORROW, TOKEN, e18(999999));
    expect(
      await h.agentRemainingBudget(user.address, agent.address),
    ).to.equal(PER_EPOCH);
  });

  /* ----------------------------------------------------- the bounds -- */

  it("reverts above the per-action ceiling", async function () {
    await expect(
      h.connect(agent).resolve(user.address, BORROW, TOKEN, PER_ACTION + 1n),
    ).to.be.revertedWithCustomError(h, "Protocol__ExceedsActionLimit");
  });

  it("reverts on an action the grant does not permit", async function () {
    const Harness = await ethers.getContractFactory("AgentPermissionHarness");
    h = await Harness.deploy();
    await grant(REPAY, { expiry: (await now()) + 30 * EPOCH }); // borrow not granted
    await expect(
      h.connect(agent).resolve(user.address, BORROW, TOKEN, e18(1)),
    ).to.be.revertedWithCustomError(h, "Protocol__ActionNotPermitted");
  });

  it("reverts on a token outside the allowlist", async function () {
    await expect(
      h.connect(agent).resolve(user.address, BORROW, OTHER_TOKEN, e18(1)),
    ).to.be.revertedWithCustomError(h, "Protocol__TokenNotPermitted");
  });

  it("reverts for a stranger with no grant", async function () {
    await expect(
      h.connect(other).resolve(user.address, BORROW, TOKEN, e18(1)),
    ).to.be.revertedWithCustomError(h, "Protocol__NoAgentPermission");
  });

  it("reverts after expiry", async function () {
    await increaseTime(31 * EPOCH);
    await expect(
      h.connect(agent).resolve(user.address, BORROW, TOKEN, e18(1)),
    ).to.be.revertedWithCustomError(h, "Protocol__PermissionExpired");
  });

  /* ---------------------------------------------------------- budget -- */

  it("the epoch budget accumulates, then blocks the next action", async function () {
    for (let i = 0; i < 5; i++) {
      await h.connect(agent).resolve(user.address, BORROW, TOKEN, e18(1000));
    }
    expect(
      await h.agentRemainingBudget(user.address, agent.address),
    ).to.equal(0);
    await expect(
      h.connect(agent).resolve(user.address, BORROW, TOKEN, e18(1)),
    ).to.be.revertedWithCustomError(h, "Protocol__ExceedsEpochLimit");
  });

  it("the budget resets in the next epoch", async function () {
    await h.connect(agent).resolve(user.address, BORROW, TOKEN, e18(1000));
    await increaseTime(EPOCH + 1);
    expect(
      await h.agentRemainingBudget(user.address, agent.address),
    ).to.equal(PER_EPOCH);
    await h.connect(agent).resolve(user.address, BORROW, TOKEN, e18(1000));
    expect(
      await h.agentRemainingBudget(user.address, agent.address),
    ).to.equal(PER_EPOCH - e18(1000));
  });

  it("repaying does NOT refund the budget (monotonic within an epoch)", async function () {
    // Or a compromised agent could cycle borrow/repay for an unlimited allowance.
    await h.connect(agent).resolve(user.address, BORROW, TOKEN, e18(1000));
    await h.connect(agent).resolve(user.address, REPAY, TOKEN, e18(1000));
    expect(
      await h.agentRemainingBudget(user.address, agent.address),
    ).to.equal(PER_EPOCH - e18(2000));
  });

  /* ----------------------------------------------------- kill switch -- */

  it("revoke is immediate and zeroes the remaining budget", async function () {
    await h.connect(user).revokeAgentPermission(agent.address);
    await expect(
      h.connect(agent).resolve(user.address, BORROW, TOKEN, e18(1)),
    ).to.be.revertedWithCustomError(h, "Protocol__PermissionRevoked");
    expect(
      await h.agentRemainingBudget(user.address, agent.address),
    ).to.equal(0);
  });

  it("remaining budget reads 0 once the grant has expired", async function () {
    await increaseTime(31 * EPOCH);
    expect(
      await h.agentRemainingBudget(user.address, agent.address),
    ).to.equal(0);
  });

  it("an agent cannot revoke on the user's behalf", async function () {
    // Revoking as the agent only touches the agent's own (empty) grant mapping.
    await h.connect(agent).revokeAgentPermission(agent.address);
    expect(
      await h
        .connect(agent)
        .resolve.staticCall(user.address, BORROW, TOKEN, e18(1)),
    ).to.equal(user.address);
  });

  it("delegation does not compose — an agent cannot grant onward", async function () {
    await grant(BORROW, {
      by: agent,
      agent: subAgent.address,
      expiry: (await now()) + EPOCH,
    });
    await expect(
      h.connect(subAgent).resolve(user.address, BORROW, TOKEN, e18(1)),
    ).to.be.revertedWithCustomError(h, "Protocol__NoAgentPermission");
  });

  /* --------------------------------------------- token list + replace -- */

  it("removing a token from the allowlist blocks it; adding one clears it", async function () {
    await h.connect(user).setAgentToken(agent.address, TOKEN, false);
    await expect(
      h.connect(agent).resolve(user.address, BORROW, TOKEN, e18(1)),
    ).to.be.revertedWithCustomError(h, "Protocol__TokenNotPermitted");

    await h.connect(user).setAgentToken(agent.address, OTHER_TOKEN, true);
    expect(
      await h
        .connect(agent)
        .resolve.staticCall(user.address, BORROW, OTHER_TOKEN, e18(1)),
    ).to.equal(user.address);
  });

  it("re-granting resets the epoch budget (a new mandate, not a top-up)", async function () {
    // Three actions of 1000 (the per-action cap) to spend 3000 of the budget.
    for (let i = 0; i < 3; i++) {
      await h.connect(agent).resolve(user.address, BORROW, TOKEN, e18(1000));
    }
    expect(
      await h.agentRemainingBudget(user.address, agent.address),
    ).to.equal(PER_EPOCH - e18(3000));

    await grant(BORROW | REPAY, { expiry: (await now()) + 30 * EPOCH });
    expect(
      await h.agentRemainingBudget(user.address, agent.address),
    ).to.equal(PER_EPOCH);
  });

  /* ----------------------------------------------------- rate + floor -- */

  it("rejects a worse interest rate than granted; the ceiling itself is fine", async function () {
    await expect(
      h.connect(agent).rate(user.address, 501),
    ).to.be.revertedWithCustomError(h, "Protocol__InterestWorseThanPermitted");
    await h.connect(agent).rate(user.address, 500); // exactly at the ceiling
  });

  it("exposes the health-factor floor, and none for a self-action", async function () {
    expect(await h.connect(agent).floor.staticCall(user.address)).to.equal(
      e18("1.2"),
    );
    expect(await h.connect(user).floor.staticCall(user.address)).to.equal(0);
  });

  it("resolveActor does NOT itself enforce the health floor — that is the caller's job", async function () {
    // The sharp edge LibAgentPermission documents: budget/caps are enforced
    // here, but the floor is only readable via floor()/healthFloor() and must be
    // asserted by the calling facet AFTER the action lands. A resolve() call
    // succeeds regardless of any health state, so a facet that forgets the
    // post-action check leaves an agent able to respect every cap while walking
    // the user to liquidation. Pinned so that omission cannot pass unnoticed.
    const floor = await h.connect(agent).floor.staticCall(user.address);
    expect(floor).to.equal(e18("1.2")); // a floor IS set...
    // ...yet resolve consumes budget and returns without ever reading health.
    expect(
      await h
        .connect(agent)
        .resolve.staticCall(user.address, BORROW, TOKEN, PER_ACTION),
    ).to.equal(user.address);
  });

  /* ------------------------------------------------------ bad grants -- */

  it("rejects the caller as its own agent", async function () {
    await expect(
      grant(BORROW, { agent: user.address, tokens: [], expiry: (await now()) + EPOCH }),
    ).to.be.revertedWithCustomError(h, "Protocol__InvalidPermission");
  });

  it("rejects a health floor below 1.0", async function () {
    await expect(
      grant(BORROW, {
        minHealthFactorBps: 9999,
        tokens: [],
        expiry: (await now()) + EPOCH,
      }),
    ).to.be.revertedWithCustomError(h, "Protocol__InvalidPermission");
  });

  it("rejects a per-action ceiling above the per-epoch ceiling", async function () {
    await expect(
      grant(BORROW, {
        perAction: PER_EPOCH + 1n,
        tokens: [],
        expiry: (await now()) + EPOCH,
      }),
    ).to.be.revertedWithCustomError(h, "Protocol__InvalidPermission");
  });

  it("rejects a zero epoch duration", async function () {
    await expect(
      grant(BORROW, { epoch: 0, tokens: [], expiry: (await now()) + EPOCH }),
    ).to.be.revertedWithCustomError(h, "Protocol__InvalidPermission");
  });

  it("rejects an empty action bitmask", async function () {
    await expect(
      grant(0, { tokens: [], expiry: (await now()) + EPOCH }),
    ).to.be.revertedWithCustomError(h, "Protocol__InvalidPermission");
  });

  it("rejects an expiry in the past", async function () {
    await expect(
      grant(BORROW, { tokens: [], expiry: (await now()) - 1 }),
    ).to.be.revertedWithCustomError(h, "Protocol__InvalidPermission");
  });

  it("rejects a zero notional cap", async function () {
    await expect(
      grant(BORROW, {
        perAction: 0,
        perEpoch: 0,
        tokens: [],
        expiry: (await now()) + EPOCH,
      }),
    ).to.be.revertedWithCustomError(h, "Protocol__InvalidPermission");
  });
});
