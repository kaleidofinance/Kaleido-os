// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";

/**
 * @notice A contract wallet that vouches for its owner's signatures, ERC-1271
 *         style. Test double for the wallets most of this app's users have.
 *
 * @dev The in-app email/social wallet and any smart account do not sign with a
 *      key the verifying contract can recover from — they answer
 *      `isValidSignature` instead. KaleidoOrders has to accept those, and a test
 *      that only ever signs with a Hardhat private key would pass whether it
 *      does or not.
 */
contract MockERC1271Wallet is IERC1271 {
    address public immutable owner;

    error NotOwner();

    constructor(address _owner) {
        owner = _owner;
    }

    /**
     * @notice Lets the wallet act — approving a spender, in practice.
     * @dev A signed order moves the maker's funds by `transferFrom`, so a
     *      contract maker still has to grant the allowance itself. Without this
     *      the ERC-1271 path could be tested only as far as the signature check.
     */
    function execute(
        address target,
        bytes calldata data
    ) external returns (bytes memory) {
        if (msg.sender != owner) revert NotOwner();
        (bool ok, bytes memory ret) = target.call(data);
        require(ok, "MockERC1271Wallet: call failed");
        return ret;
    }

    function isValidSignature(
        bytes32 hash,
        bytes calldata signature
    ) external view override returns (bytes4) {
        (address recovered, ECDSA.RecoverError err, ) = ECDSA.tryRecover(
            hash,
            signature
        );
        if (err == ECDSA.RecoverError.NoError && recovered == owner) {
            return IERC1271.isValidSignature.selector;
        }
        return 0xffffffff;
    }
}

/**
 * @notice A contract with no `isValidSignature` at all.
 *
 * @dev Exists to prove the difference between "this wallet says no" and "this
 *      address cannot be asked". The second must read as an invalid signature;
 *      if the staticcall's failure propagated instead, an order naming a plain
 *      contract as its maker would make every fill attempt revert in a way no
 *      caller could tell apart from a bug.
 */
contract MockNotAWallet {
    uint256 public unrelated;

    function poke() external {
        unrelated += 1;
    }
}
