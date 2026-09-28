// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import { LibDiamond } from "../libraries/LibDiamond.sol";
import { IERC173 } from "../interfaces/IERC173.sol";

/**
 * Two-step ownership, the same shape as OpenZeppelin's Ownable2Step.
 *
 * This was a single-step `transferOwnership` with no zero-address check, which
 * made ownership the one setting on a diamond whose mistake is unrecoverable:
 * the owner is the only account that can `diamondCut`, so a typo in the new
 * owner's address, or a Safe address from the wrong chain, would have locked
 * every setter and every future upgrade for good — a full redeploy of the
 * lending market. Mainnet ownership is planned to move from the deployer to a
 * multisig later, which is exactly the one-shot call this has to make safe.
 *
 * Now the current owner only NOMINATES; nothing changes until the nominee calls
 * `acceptOwnership` from the new address, proving it exists on this chain and
 * that whoever holds it can sign. A wrong nominee is fixed by nominating again.
 * The name `transferOwnership` is kept (as Ownable2Step keeps it) so the
 * selector, the ERC-173 interface id and every caller stay the same.
 */
contract OwnershipFacet is IERC173 {
    error OwnershipZeroAddress();
    error OwnershipNotPendingOwner();

    event OwnershipTransferStarted(
        address indexed previousOwner,
        address indexed newOwner
    );

    /// @notice Nominate `_newOwner`. Takes effect only when they accept.
    /// @dev Nominating address(0) is refused rather than read as "cancel" —
    ///      renouncing a diamond's ownership would freeze it forever. To cancel,
    ///      nominate the current owner.
    function transferOwnership(address _newOwner) external override {
        LibDiamond.enforceIsContractOwner();
        if (_newOwner == address(0)) revert OwnershipZeroAddress();
        LibDiamond.diamondStorage().pendingOwner = _newOwner;
        emit OwnershipTransferStarted(LibDiamond.contractOwner(), _newOwner);
    }

    /// @notice Complete a transfer. Callable only by the nominated address.
    function acceptOwnership() external {
        LibDiamond.DiamondStorage storage ds = LibDiamond.diamondStorage();
        if (msg.sender != ds.pendingOwner) revert OwnershipNotPendingOwner();
        delete ds.pendingOwner;
        LibDiamond.setContractOwner(msg.sender);
    }

    function owner() external override view returns (address owner_) {
        owner_ = LibDiamond.contractOwner();
    }

    /// @notice The nominated owner, or address(0) when no transfer is pending.
    function pendingOwner() external view returns (address) {
        return LibDiamond.diamondStorage().pendingOwner;
    }
}
