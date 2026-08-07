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
    /// @dev Sentinel for native value, not a real address. Chain-agnostic by
    ///      construction, so it stays a compile-time constant. The frontend
    ///      mirrors it as NATIVE_SENTINEL.lending; the DEX uses the separate
    ///      0xEeee… convention, and the two must not be interchanged.
    address constant NATIVE_TOKEN = address(1);
    uint256 constant SCALING_FACTOR = 1e18;

    /*
     * REMOVED: WETH, USDC, and the ETH_USD / WETH_USD / USDC_USD price feed
     * ids.
     *
     * The two addresses were Abstract-testnet values written as Solidity
     * `constant`s, which bakes them into the bytecode of every chain this is
     * deployed to. Kaleido now targets eleven networks, so a literal that is
     * only correct on one of them is a deployment hazard rather than a
     * convenience.
     *
     * All five were dead: nothing outside this file referenced
     * Constants.WETH, Constants.USDC, or any of the feed ids. ProtocolFacet is
     * the sole importer of this library and uses only NATIVE_TOKEN and the
     * numeric constants.
     *
     * Where the live equivalents come from instead:
     *   - wrapped native  -> constructor argument (KaleidoSwapRouter.WETH is
     *                        already `immutable`, set at deploy)
     *   - collateral/loan tokens and their price feed ids -> registered at
     *     runtime via addCollateralToken(token, priceFeed) and
     *     addLoanableToken(token, priceFeed), which is already how the
     *     protocol learns about assets
     *
     * Pyth feed ids are global rather than per-chain, so they belong with the
     * per-chain token registration that supplies them, not in a shared
     * compile-time constant that implies one fixed asset set.
     */


    uint256 constant MIN_LOAN_AMOUNT = 10 * 1e16; // 10 USD

    /// @dev Interest is quoted as an APR, so rates are comparable across terms.
    uint256 constant SECONDS_PER_YEAR = 365 days;
    /// @dev Floor on loan duration. Without one, APR pricing makes near-instant
    ///      loans round down to zero interest.
    uint256 constant MIN_LOAN_DURATION = 1 days;

}
