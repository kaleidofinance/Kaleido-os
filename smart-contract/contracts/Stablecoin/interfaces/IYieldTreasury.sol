// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IYieldTreasury - Interface for YieldTreasury contract
 * @notice Interface for yield accumulation and distribution
 */
interface IYieldTreasury {
    /**
     * @dev Receive yield from a source
     * @param _asset Asset address
     * @param _amount Amount of yield
     * @param _sourceName Source name
     */
    function receiveYield(
        address _asset,
        uint256 _amount,
        string memory _sourceName
    ) external;
}

