// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * A stand-in aggregator router for KaleidoOrdersV2.fillViaAggregator tests.
 *
 * Every behaviour a real route could exhibit toward the orders contract is one
 * parameter away, so each test can make it honest, stingy, greedy, misdirected
 * or re-entrant and check that the maker is protected regardless. Pre-fund it
 * with `tokenOut` to pay from.
 */
contract MockAggregator {
    /// @notice Pull `pull` of tokenIn from the caller, then send `pay` of
    ///         tokenOut to `payTo`. A real route's two halves, independently set.
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 pull,
        uint256 pay,
        address payTo
    ) external {
        if (pull > 0) {
            require(
                IERC20(tokenIn).transferFrom(msg.sender, address(this), pull),
                "pull failed"
            );
        }
        if (pay > 0) {
            require(IERC20(tokenOut).transfer(payTo, pay), "pay failed");
        }
    }

    /// @notice Pull the input, then pay in NATIVE currency instead of the token.
    function swapToNative(address tokenIn, uint256 pull, uint256 pay, address payTo) external {
        require(IERC20(tokenIn).transferFrom(msg.sender, address(this), pull), "pull failed");
        (bool ok, ) = payTo.call{value: pay}("");
        require(ok, "native pay failed");
    }

    /// @notice Call back into `target` with `data` mid-swap (a re-entrancy probe).
    function reenter(address target, bytes calldata data) external {
        (bool ok, bytes memory ret) = target.call(data);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
    }

    receive() external payable {}
}
