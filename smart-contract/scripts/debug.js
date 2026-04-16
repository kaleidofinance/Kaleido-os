const { ethers } = require("hardhat");

async function debugRequestStatus() {
  const DIAMOND_ADDRESS = "0x2aC60481a9EA2e67D80CdfBF587c63c88A5874ac";
  const contract = await ethers.getContractAt("ProtocolFacet", DIAMOND_ADDRESS);

  console.log("🔍 Debugging request statuses...\n");

  try {
    // Get all requests
    console.log("1. Getting all requests:");
    const allRequests = await contract.getAllRequest();
    console.log(`   Total requests found: ${allRequests.length}`);

    if (allRequests.length === 0) {
      console.log("   No requests found. Create some requests first.");
      return;
    }

    // Check each request status
    console.log("\n2. Request details:");
    for (let i = 0; i < Math.min(allRequests.length, 10); i++) {
      // Limit to first 10
      const request = allRequests[i];
      const statusNames = ["OPEN", "SERVICED", "CLOSED"];
      const statusName =
        statusNames[request.status] || `UNKNOWN(${request.status})`;

      console.log(`   Request ID ${request.requestId}:`);
      console.log(`     - Author: ${request.author}`);
      console.log(`     - Lender: ${request.lender}`);
      console.log(`     - Amount: ${ethers.formatEther(request.amount)}`);
      console.log(`     - Status: ${statusName} (${request.status})`);
      console.log(`     - Loan Currency: ${request.loanRequestAddr}`);
      console.log(
        `     - Return Date: ${new Date(Number(request.returnDate) * 1000).toLocaleString()}`,
      );
      console.log(
        `     - Total Repayment: ${ethers.formatEther(request.totalRepayment)}`,
      );
      console.log("");
    }

    // Get specifically serviced requests
    console.log("3. Getting SERVICED requests:");
    try {
      const servicedRequests = await contract.getServicedRequests();
      console.log(`   Found ${servicedRequests.length} serviced requests`);

      if (servicedRequests.length > 0) {
        console.log("   Serviced request IDs that can be liquidated:");
        servicedRequests.forEach((req) => {
          const isOverdue =
            Number(req.returnDate) < Math.floor(Date.now() / 1000);
          const overdueStatus = isOverdue ? "⚠️ OVERDUE" : "✅ Active";
          console.log(`     - ID ${req.requestId}: ${overdueStatus}`);
        });
      } else {
        console.log("   ❌ No serviced requests found!");
        console.log("   You need to:");
        console.log("   1. Create a lending request (createLendingRequest)");
        console.log("   2. Service the request (serviceRequest)");
        console.log("   3. Then you can liquidate if conditions are met");
      }
    } catch (error) {
      console.log(`   ❌ Error getting serviced requests: ${error.message}`);
    }

    // Check specific request ID 1
    console.log("\n4. Checking specific request ID 1:");
    try {
      const request1 = await contract.getRequest(1);
      const statusNames = ["OPEN", "SERVICED", "CLOSED"];
      const statusName =
        statusNames[request1.status] || `UNKNOWN(${request1.status})`;
      console.log(`   Request 1 status: ${statusName} (${request1.status})`);

      if (request1.status === 1) {
        // SERVICED
        console.log(
          "   ✅ Request 1 is serviced and can potentially be liquidated",
        );

        // Check if it meets liquidation conditions
        const isOverdue =
          Number(request1.returnDate) < Math.floor(Date.now() / 1000);
        console.log(
          `   Return date: ${new Date(Number(request1.returnDate) * 1000).toLocaleString()}`,
        );
        console.log(`   Is overdue: ${isOverdue}`);

        if (request1.author !== ethers.ZeroAddress) {
          try {
            const healthFactor = await contract.getHealthFactor(
              request1.author,
            );
            console.log(
              `   Health factor: ${ethers.formatEther(healthFactor)}`,
            );

            const canLiquidate =
              healthFactor < ethers.parseEther("1.0") || isOverdue;
            console.log(`   Can liquidate: ${canLiquidate}`);

            if (!canLiquidate) {
              console.log(
                "   ❌ Cannot liquidate: Health factor >= 1.0 and not overdue",
              );
            }
          } catch (error) {
            console.log(`   ❌ Error checking health factor: ${error.message}`);
          }
        }
      } else {
        console.log(
          `   ❌ Request 1 cannot be liquidated (status: ${statusName})`,
        );
      }
    } catch (error) {
      console.log(`   ❌ Error getting request 1: ${error.message}`);
    }
  } catch (error) {
    console.log(`❌ Debug failed: ${error.message}`);
  }
}

async function createTestScenario() {
  const [signer] = await ethers.getSigners();
  const DIAMOND_ADDRESS = "0x2aC60481a9EA2e67D80CdfBF587c63c88A5874ac";
  const contract = await ethers.getContractAt("ProtocolFacet", DIAMOND_ADDRESS);

  console.log("\n🧪 Creating test scenario for liquidation...");
  console.log("This will help you create a proper liquidatable position\n");

  try {
    // Get available tokens
    const collateralTokens = await contract.getAllCollateralToken();
    const loanableTokens = await contract.getLoanableAssets();

    console.log("Available collateral tokens:", collateralTokens);
    console.log("Available loanable tokens:", loanableTokens);

    if (collateralTokens.length === 0 || loanableTokens.length === 0) {
      console.log("❌ No tokens available. Set up tokens first.");
      return;
    }

    // Check if user has collateral
    const collateralValue = await contract.getAccountCollateralValue(
      signer.address,
    );
    console.log(
      `Your collateral value: $${ethers.formatEther(collateralValue)}`,
    );

    if (collateralValue === 0n) {
      console.log("\n📋 To create a liquidatable scenario:");
      console.log(
        "1. Deposit collateral: await contract.depositCollateral(tokenAddress, amount)",
      );
      console.log(
        "2. Create lending request: await contract.createLendingRequest(amount, interest, returnDate, currency)",
      );
      console.log(
        "3. Service the request: await contract.serviceRequest(requestId, tokenAddress)",
      );
      console.log("4. Wait for conditions (health factor < 1.0 or overdue)");
      console.log(
        "5. Then liquidate: await contract.liquidateUserRequest(requestId)",
      );
    }
  } catch (error) {
    console.log(`❌ Test scenario creation failed: ${error.message}`);
  }
}

async function testLiquidationConditions(requestId) {
  const DIAMOND_ADDRESS = "0x2aC60481a9EA2e67D80CdfBF587c63c88A5874ac";
  const contract = await ethers.getContractAt("ProtocolFacet", DIAMOND_ADDRESS);

  console.log(`\n🔬 Testing liquidation conditions for request ${requestId}:`);

  try {
    const request = await contract.getRequest(requestId);

    // Check status
    if (request.status !== 1) {
      console.log(
        `❌ Request status is ${request.status}, needs to be 1 (SERVICED)`,
      );
      return;
    }
    console.log("✅ Request is SERVICED");

    // Check if overdue
    const now = Math.floor(Date.now() / 1000);
    const isOverdue = Number(request.returnDate) < now;
    console.log(
      `Return date: ${new Date(Number(request.returnDate) * 1000).toLocaleString()}`,
    );
    console.log(`Current time: ${new Date(now * 1000).toLocaleString()}`);
    console.log(`Is overdue: ${isOverdue}`);

    // Check health factor
    const healthFactor = await contract.getHealthFactor(request.author);
    const healthFactorFormatted = ethers.formatEther(healthFactor);
    console.log(`Health factor: ${healthFactorFormatted}`);

    const healthFactorLow = healthFactor < ethers.parseEther("1.0");
    console.log(`Health factor < 1.0: ${healthFactorLow}`);

    // Final liquidation check
    const canLiquidate = healthFactorLow || isOverdue;
    console.log(`\n🎯 Can liquidate: ${canLiquidate}`);

    if (!canLiquidate) {
      console.log("\n💡 To make this request liquidatable:");
      console.log("- Wait until return date passes, OR");
      console.log("- Manipulate price feeds to lower health factor, OR");
      console.log(
        "- Borrow more against the collateral to lower health factor",
      );
    }
  } catch (error) {
    console.log(`❌ Liquidation condition test failed: ${error.message}`);
  }
}

if (require.main === module) {
  debugRequestStatus()
    .then(() => createTestScenario())
    .then(() => {
      // Test specific request ID - change this to your request ID
      return testLiquidationConditions(1);
    })
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("❌ Debug failed:", error);
      process.exit(1);
    });
}

module.exports = {
  debugRequestStatus,
  createTestScenario,
  testLiquidationConditions,
};
