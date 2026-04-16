#!/bin/bash

# ProtocolFacet Function Selectors Generator
echo "Generating all ProtocolFacet function selectors..."
echo "=================================================="

# Check if cast is available
if ! command -v cast &> /dev/null; then
    echo "ERROR: 'cast' command not found. Please install Foundry first."
    echo "Visit: https://book.getfoundry.sh/getting-started/installation"
    exit 1
fi

# Function to generate selector with error handling
generate_selector() {
    local func_sig="$1"
    echo "Generating selector for: $func_sig"
    if selector=$(cast sig "$func_sig" 2>/dev/null); then
        echo "✓ $selector"
    else
        echo "✗ Error generating selector for: $func_sig"
    fi
    echo ""
}

# Main Protocol Functions
echo "=== MAIN PROTOCOL FUNCTIONS ==="
generate_selector "depositCollateral(address,uint256)"
generate_selector "createLendingRequest(uint128,uint16,uint256,address)"
generate_selector "serviceRequest(uint96,address)"
generate_selector "withdrawCollateral(address,uint128)"
generate_selector "addCollateralTokens(address[],bytes32[])"
generate_selector "addCollateralToken(address,bytes32)"
generate_selector "removeCollateralTokens(address[])"
generate_selector "addLoanableToken(address,bytes32)"
generate_selector "updateGPScore(address,uint256)"
generate_selector "AccessControlUnauthorizedAccount(address,bytes32)"


# Referral Functions
echo "=== REFERRAL FUNCTIONS ==="
generate_selector "registerUpliner(address,address)"
generate_selector "getUpliner(address)"
generate_selector "getDownliners(address,uint256)"
generate_selector "getDownlinersCount(address)"
generate_selector "getReferralPoints(address)"

# Listing Functions
echo "=== LISTING FUNCTIONS ==="
generate_selector "closeListingAd(uint96)"
generate_selector "closeRequest(uint96)"
generate_selector "createLoanListing(uint256,uint256,uint256,uint256,uint16,address)"
generate_selector "requestLoanFromListing(uint96,uint256)"

# Loan Management
echo "=== LOAN MANAGEMENT ==="
generate_selector "repayLoan(uint96,uint256)"
generate_selector "liquidateUserRequest(uint96)"

# Admin Functions
echo "=== ADMIN FUNCTIONS ==="
generate_selector "setBotAddress(address)"
generate_selector "setSwapRouter(address)"
generate_selector "setBPS(uint256)"
generate_selector "setLiquidityBps(uint256)"
generate_selector "setFeeVault(address)"
generate_selector "setPythOracle(address)"

# View Functions
echo "=== VIEW FUNCTIONS ==="
generate_selector "getTokenAmountFromUsd(address,uint256,uint8)"
generate_selector "getUsdValue(address,uint256,uint8)"
generate_selector "getPythPriceOracle()"
generate_selector "getConvertValue(address,address,uint256)"
generate_selector "getAccountCollateralValue(address)"
generate_selector "getAccountAvailableValue(address)"
generate_selector "getAllRequests(uint256,uint256)"
generate_selector "getServicedRequests()"
generate_selector "getLoanListing(uint96)"
generate_selector "getRequest(uint96)"
generate_selector "getHealthFactor(address)"
generate_selector "getAllCollateralToken()"
generate_selector "gets_addressToCollateralDeposited(address,address)"
generate_selector "gets_addressToAvailableBalance(address,address)"
generate_selector "getRequestToColateral(uint96,address)"
generate_selector "get_gitCoinPoint(address)"
generate_selector "getLoanableAssets()"
generate_selector "getUserRequest(address,uint96)"
generate_selector "getUserLoanListing(uint96)"
generate_selector "getUserActiveRequests(address)"
generate_selector "getServicedRequestByLender(address)"
generate_selector "getLoanCollectedInUsd(address)"
generate_selector "getListingId()"
generate_selector "getUserCollateralTokens(address)"
generate_selector "getLiquidityBPS()"

echo "=================================================="
echo "Script completed. Total functions: 43"