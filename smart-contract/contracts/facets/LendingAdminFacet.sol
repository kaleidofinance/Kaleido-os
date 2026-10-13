// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import {LibAppStorage} from "../libraries/LibAppStorage.sol";
import {LibDiamond} from "../libraries/LibDiamond.sol";
import "../utils/validators/Error.sol";
import {LendingReentrancyGuard} from "../utils/LendingReentrancyGuard.sol";

/// @dev ProtocolFacet's pricing entry point, reached through the diamond itself.
interface ILendingPricing {
    function getUsdValue(address token, uint256 amount, uint8 tokenDecimals)
        external
        view
        returns (uint256);
}

/**
 * Owner-only operational controls for the lending market, in their own facet.
 *
 * Separate from ProtocolFacet for one reason: ProtocolFacet sits ~700 bytes under
 * the EIP-170 limit, and these are pure admin paths that no user call needs.
 *
 * STORAGE LAYOUT — the part that must not be got wrong. The lending data is not
 * at LibAppStorage.layout()'s keccak slot; it lives in facet state, and
 * ProtocolFacet inherits LendingReentrancyGuard (a vendored copy of
 * OpenZeppelin 5.4.0's, see that file) FIRST, so `_status` takes slot 0 and
 * the Layout starts at slot 1. This facet declares the identical prefix —
 * ReentrancyGuard first, then the Layout — so both facets address the same
 * slots when delegatecalled by the diamond. Reordering the inheritance, or
 * adding a state variable before `_appStorage`, would make every write here
 * land one slot off. test/LendingHardening.test.js pauses through this facet and
 * asserts ProtocolFacet sees it, which is what proves the alignment.
 */
contract LendingAdminFacet is LendingReentrancyGuard {
    LibAppStorage.Layout internal _appStorage;

    event LendingPaused(address indexed by);
    event LendingUnpaused(address indexed by);
    event TokenPriceFeedUpdated(
        address indexed token,
        bytes32 previousFeed,
        bytes32 newFeed
    );

    /// @notice Stop everything that opens new risk. Repay, withdraw, close and
    ///         liquidate keep working — see LibAppStorage.Layout.paused.
    /// @dev The diamond had no pause at all; the only emergency lever was
    ///      removing selectors with diamondCut, which also blocks the exits.
    function pause() external {
        LibDiamond.enforceIsContractOwner();
        _appStorage.paused = true;
        emit LendingPaused(msg.sender);
    }

    function unpause() external {
        LibDiamond.enforceIsContractOwner();
        _appStorage.paused = false;
        emit LendingUnpaused(msg.sender);
    }

    function paused() external view returns (bool) {
        return _appStorage.paused;
    }

    /**
     * @notice Re-point an already-registered token at a different price feed id.
     *
     * @dev There was no way to change a feed. The only route was
     *      removeCollateralTokens + addCollateralToken, and removal zeroes the
     *      feed and drops the token from the collateral list — so every depositor
     *      is stranded (withdrawCollateral checks the token is allowed) for as
     *      long as the two calls are apart, and a loanable token cannot be
     *      re-added at all. This changes the id in place and nothing else: the
     *      token keeps its collateral/loanable status and every balance.
     *
     *      Only for a token that is registered (has a feed), only to a non-zero
     *      id, and never to the id it already has. The new id must be served by
     *      the oracle — check `getUsdValue` before and after, the way
     *      register-tokens.js does for a fresh registration.
     */
    function setTokenFeed(address _token, bytes32 _newFeed) external {
        LibDiamond.enforceIsContractOwner();
        bytes32 _previous = _appStorage.s_priceFeeds[_token];
        if (_previous == bytes32(0)) revert Protocol__TokenNotAllowed();
        if (_newFeed == bytes32(0) || _newFeed == _previous)
            revert Protocol__InvalidPriceFeed();
        _appStorage.s_priceFeeds[_token] = _newFeed;
        /* Prove it prices before the change can land. Called on the diamond
         * (this facet runs in its context), so it goes through ProtocolFacet's
         * real read: oracle mapping, per-feed or global age bound, confidence.
         * A new id the oracle does not map, or one with no per-feed bound on a
         * 24h feed (so the 300s global applies), reverts here and the whole
         * change unwinds — instead of every priced call on the token reverting
         * afterwards. Install the id's bound (setFeedMaxAge) first. */
        ILendingPricing(address(this)).getUsdValue(_token, 1, 18);
        emit TokenPriceFeedUpdated(_token, _previous, _newFeed);
    }
}
