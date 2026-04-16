// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @dev Holds all the constant for our protocol
library Constants {
    uint256 constant NEW_PRECISION = 1e10;
    uint256 constant PRECISION = 1e18;
    uint256 constant LIQUIDATION_THRESHOLD = 80;
    uint256 constant MIN_HEALTH_FACTOR = 1;
    uint256 constant COLLATERALIZATION_RATIO = 80;
    uint256 constant BASIS_POINTS = 10000;
    uint256 constant GITPOINT = 100 * SCALING_FACTOR;
    uint256 constant SPECIAL_GITPOINT = 600 * SCALING_FACTOR;
    uint256 constant EXTRA_POINT = 500 * SCALING_FACTOR;
    uint256 constant REFERRAL_PERCENTAGE = 1000; 
    address constant NATIVE_TOKEN = address(1);
    uint256 constant SCALING_FACTOR = 1e18;
    address constant WETH = 0x9EDCde0257F2386Ce177C3a7FCdd97787F0D841d;
    address constant USDC = 0x572f4901f03055ffC1D936a60Ccc3CbF13911BE3;





    //PRICE FEED
    bytes32 constant ETH_USD = 0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace;
    bytes32 constant WETH_USD = 0x9d4294bbcd1174d6f2003ec365831e64cc31d9f6f15a2b85399db8d5000960f6;
    bytes32 constant USDC_USD = 0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a;


    uint256 constant MIN_LOAN_AMOUNT = 10 * 1e16; // 10 USD

}
