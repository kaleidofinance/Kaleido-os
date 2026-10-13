// SPDX-License-Identifier: MIT
// Vendored from OpenZeppelin Contracts v5.4.0 (utils/ReentrancyGuard.sol), MIT.
pragma solidity ^0.8.20;

/**
 * OpenZeppelin 5.4.0's ReentrancyGuard, copied into the repo on purpose.
 *
 * The lending market's storage layout DEPENDS on this contract. ProtocolFacet and
 * LendingAdminFacet keep their data in facet state (`LibAppStorage.Layout
 * internal _appStorage`), not at a keccak slot, and both inherit this guard
 * first — so `_status` is slot 0 and every lending field starts at slot 1. That
 * is only true while this contract declares exactly one storage variable.
 *
 * Imported from node_modules, the guard was a dependency version away from
 * silently moving: a future OpenZeppelin release that changed its storage (a
 * second variable, or an ERC-7201 namespace) would, on the next facet upgrade,
 * shift every field of a LIVE diamond by one slot — collateral balances read as
 * price feeds. Pinning the package protects installs; a copy in the repo protects
 * the layout itself. test/LendingHardening.test.js reads slot 0 and slot 1 of a
 * deployed diamond to prove the layout, so a change here fails a test.
 *
 * DO NOT add, remove or reorder storage in this contract. Behaviour is unchanged
 * from upstream, including the error name.
 */
abstract contract LendingReentrancyGuard {
    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED = 2;

    uint256 private _status;

    /// @dev Unauthorized reentrant call.
    error ReentrancyGuardReentrantCall();

    constructor() {
        _status = NOT_ENTERED;
    }

    modifier nonReentrant() {
        _nonReentrantBefore();
        _;
        _nonReentrantAfter();
    }

    function _nonReentrantBefore() private {
        // On a diamond the slot starts at 0 (the facet constructor ran in the
        // facet's own storage), which is also "not entered".
        if (_status == ENTERED) {
            revert ReentrancyGuardReentrantCall();
        }
        _status = ENTERED;
    }

    function _nonReentrantAfter() private {
        _status = NOT_ENTERED;
    }

    function _reentrancyGuardEntered() internal view returns (bool) {
        return _status == ENTERED;
    }
}
