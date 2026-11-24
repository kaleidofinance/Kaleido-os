const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("ZeroAutoBridge", function () {
  const ZERO_EID = 33002;
  const FEE_BPS = 25; // 0.25%

  async function deployFixture() {
    const [deployer, feeRecipient, alice, bob, keeper] = await ethers.getSigners();
    const MockZro = await ethers.getContractFactory("MockZroOft");
    const zro = await MockZro.deploy();

    const Bridge = await ethers.getContractFactory("ZeroAutoBridge");
    const bridge = await Bridge.deploy(
      await zro.getAddress(),
      ZERO_EID,
      feeRecipient.address,
      FEE_BPS,
    );

    await zro.mint(alice.address, ethers.parseEther("1000"));
    await zro.mint(bob.address, ethers.parseEther("500"));

    return { deployer, feeRecipient, alice, bob, keeper, zro, bridge };
  }

  it("enforces immutable constructor bounds", async function () {
    const [, feeRecipient] = await ethers.getSigners();
    const MockZro = await ethers.getContractFactory("MockZroOft");
    const zro = await MockZro.deploy();
    const Bridge = await ethers.getContractFactory("ZeroAutoBridge");

    await expect(
      Bridge.deploy(ethers.ZeroAddress, ZERO_EID, feeRecipient.address, FEE_BPS),
    ).to.be.revertedWithCustomError(Bridge, "ZeroAddress");

    await expect(
      Bridge.deploy(await zro.getAddress(), ZERO_EID, feeRecipient.address, 101),
    ).to.be.revertedWithCustomError(Bridge, "FeeTooHigh");
  });

  it("bridges directly when route is open and takes 0.25% fee", async function () {
    const { feeRecipient, alice, zro, bridge } = await deployFixture();
    const amount = ethers.parseEther("100");
    await zro.connect(alice).approve(await bridge.getAddress(), amount);

    // Fails while route is closed
    await expect(
      bridge.connect(alice).bridgeDirect(amount, { value: ethers.parseEther("0.005") }),
    ).to.be.revertedWithCustomError(zro, "RouteClosed");

    // Opens route
    await zro.setRouteOpen(true);
    await expect(
      bridge.connect(alice).bridgeDirect(amount, { value: ethers.parseEther("0.005") }),
    ).to.emit(bridge, "DirectBridged");

    const expectedFee = ethers.parseEther("0.25");
    const expectedNet = ethers.parseEther("99.75");
    expect(await zro.balanceOf(feeRecipient.address)).to.equal(expectedFee);
    expect(await zro.lastDstEid()).to.equal(ZERO_EID);
    expect(await zro.lastAmountLD()).to.equal(expectedNet);
    expect(await zro.lastTo()).to.equal(ethers.zeroPadValue(alice.address, 32));
  });

  it("enrolls while closed, keeps ZRO in user wallet, and lets user cancel with 100% deposit refund", async function () {
    const { alice, zro, bridge } = await deployFixture();
    const amount = ethers.parseEther("200");
    const deposit = ethers.parseEther("0.01");
    const expiry = (await time.latest()) + 86400;

    await zro.connect(alice).approve(await bridge.getAddress(), amount);
    await bridge.connect(alice).enroll(amount, ethers.parseEther("0.005"), 0, expiry, {
      value: deposit,
    });

    // ZRO still in Alice's wallet
    expect(await zro.balanceOf(alice.address)).to.equal(ethers.parseEther("1000"));
    expect(await bridge.isEnrolled(alice.address)).to.equal(true);
    expect(await bridge.queueLength()).to.equal(1n);

    // Cancel reclaims deposit
    const balBefore = await ethers.provider.getBalance(alice.address);
    const tx = await bridge.connect(alice).cancel();
    const receipt = await tx.wait();
    const gasSpent = receipt.gasUsed * receipt.gasPrice;
    const balAfter = await ethers.provider.getBalance(alice.address);

    expect(balAfter - balBefore + gasSpent).to.equal(deposit);
    expect(await bridge.isEnrolled(alice.address)).to.equal(false);
    expect(await bridge.queueLength()).to.equal(0n);
  });

  it("executes batch when route opens, skips unapproved users without reverting batch", async function () {
    const { feeRecipient, alice, bob, keeper, zro, bridge } = await deployFixture();
    const expiry = (await time.latest()) + 86400;

    // Alice approves and enrolls; Bob enrolls WITHOUT approving ZRO
    await zro.connect(alice).approve(await bridge.getAddress(), ethers.parseEther("400"));
    await bridge
      .connect(alice)
      .enroll(ethers.parseEther("400"), ethers.parseEther("0.005"), 0, expiry, {
        value: ethers.parseEther("0.02"),
      });

    await bridge
      .connect(bob)
      .enroll(ethers.parseEther("100"), ethers.parseEther("0.005"), 0, expiry, {
        value: ethers.parseEther("0.02"),
      });

    expect(await bridge.queueLength()).to.equal(2n);

    // Open route and run batch from keeper
    await zro.setRouteOpen(true);
    await expect(
      bridge.connect(keeper).executeBatch([bob.address, alice.address]),
    )
      .to.emit(bridge, "BatchItemSkipped")
      .and.to.emit(bridge, "Executed");

    // Alice succeeded: 400 ZRO -> 1 ZRO fee, 399 ZRO sent to Alice on Zero
    expect(await bridge.isEnrolled(alice.address)).to.equal(false);
    expect(await zro.balanceOf(alice.address)).to.equal(ethers.parseEther("600"));
    expect(await zro.balanceOf(feeRecipient.address)).to.equal(ethers.parseEther("1"));
    expect(await zro.lastTo()).to.equal(ethers.zeroPadValue(alice.address, 32));
    expect(await zro.lastAmountLD()).to.equal(ethers.parseEther("399"));

    // Bob stayed queued (not silently dropped) so he can fix approval or cancel
    expect(await bridge.isEnrolled(bob.address)).to.equal(true);
    expect(await bridge.queueLength()).to.equal(1n);
  });

  it("reverts execution if expired or nativeFee exceeds user cap", async function () {
    const { alice, keeper, zro, bridge } = await deployFixture();
    const expiry = (await time.latest()) + 3600;

    await zro.connect(alice).approve(await bridge.getAddress(), ethers.parseEther("50"));
    await bridge
      .connect(alice)
      .enroll(ethers.parseEther("50"), ethers.parseEther("0.0005"), 0, expiry, {
        value: ethers.parseEther("0.01"),
      });

    await zro.setRouteOpen(true);
    // Mock nativeFee is 0.001 > Alice's 0.0005 cap
    await expect(bridge.connect(keeper).execute(alice.address)).to.be.revertedWithCustomError(
      bridge,
      "NativeFeeTooHigh",
    );

    // Fast-forward past expiry
    await time.increase(4000);
    await expect(bridge.connect(keeper).execute(alice.address)).to.be.revertedWithCustomError(
      bridge,
      "OrderExpired",
    );
  });
});
