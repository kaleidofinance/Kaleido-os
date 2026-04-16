const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre; 

describe("Protocol Liquidation", function () {
  let protocol, loanToken, collateralToken;
  let owner, lender, borrower, bot, feeVault;
  let requestId;

beforeEach(async function () {
  [owner] = await ethers.getSigners();
    feeVault = owner
  lender = owner;
    borrower = owner;   
    bot = owner; 
  console.log("👑 Owner:", owner.address);
  console.log("💰 feeVault:", feeVault.address);

// In a real scenario, this would be a bot account

  // Deploy mock ERC20 tokens
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  loanToken = await MockERC20.deploy("Loan Token", "LOAN");
  await loanToken.waitForDeployment();

  collateralToken = await MockERC20.deploy("Collateral Token", "COL");
  await collateralToken.waitForDeployment();

  // Deploy your protocol contract with constructor args (adjust if needed)
  const Protocol = await ethers.getContractFactory("ProtocolFacet");
  protocol = await Protocol.deploy(
    "0x0493Cd78b3c1D0c322EcE96BC775A83340F5cDdd",
    "0x1FDD717733CDf231C8E7e27def75A849673F9293"
  );
  await protocol.waitForDeployment();

  // Connect protocol contract instance to the owner signer for transactions
  protocol = protocol.connect(owner);

  // Initialize protocol settings
  await protocol.setFeeVault(owner.address);
  await protocol.setLiquidityBps(1000); // 10% liquidation fee

  // Mint tokens to lender and borrower
  await loanToken.mint(lender.address, ethers.parseEther("1000"));
  await collateralToken.mint(borrower.address, ethers.parseEther("1000"));

  // Approve protocol to spend borrower's collateral
  await collateralToken.connect(borrower).approve(protocol.address, ethers.parseEther("1000"));

  // Mock price oracle setup: 1 COL = $1, 1 LOAN = $1 (8 decimals)
  await protocol.setTokenPrice(collateralToken.address, ethers.parseUnits("1", 8));
  await protocol.setTokenPrice(loanToken.address, ethers.parseUnits("1", 8));

  // Borrower creates a loan request
  const amountToBorrow = ethers.parseEther("100");
  const collateralAmount = ethers.parseEther("150"); // 150% collateralization

  const tx = await protocol.connect(borrower).createLoanRequest(
    loanToken.address,
    amountToBorrow,
    [collateralToken.address],
    [collateralAmount],
    Math.floor(Date.now() / 1000) + 3600 // returnDate 1 hour in the future
  );
  const receipt = await tx.wait();

  // Extract requestId from event
  const event = receipt.events.find(e => e.event === "LoanRequestCreated");
  requestId = event.args.requestId;

  // Mark request as SERVICED (simulate lender approval)
  await protocol.setRequestStatus(requestId, 1); // 1 = SERVICED

  // Transfer loan amount to borrower (simulate lender funding)
  await loanToken.connect(lender).transfer(borrower.address, amountToBorrow);
});


  it("should allow liquidation if borrower misses return date", async function () {
    // Move time forward to after returnDate (simulate overdue)
    await ethers.provider.send("evm_increaseTime", [3600 + 10]); // 1 hour + 10 seconds
    await ethers.provider.send("evm_mine");

    // Bot calls liquidation
    await expect(protocol.connect(bot).liquidateUserRequest(requestId))
      .to.emit(protocol, "RequestLiquidated")
      .withArgs(requestId, lender.address, ethers.matchers.anyValue);

    // Verify request status is CLOSED
    const request = await protocol.getRequest(requestId);
    expect(request.status).to.equal(2); // Assuming 2 = CLOSED
  });

  it("should revert liquidation if borrower is healthy and before return date", async function () {
    // Try liquidation before returnDate and with healthy position
    await expect(protocol.connect(bot).liquidateUserRequest(requestId))
      .to.be.revertedWith("Protocol__PositionHealthy");
  });
});
