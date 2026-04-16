// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

interface IKLDVault {
    // Returns total KLD tokens staked or pooled in the vault
    function getTotalPooledKld(address __stKLDToken) external view returns (uint256);

    // Stake KLD tokens on behalf of a user
    function stake(address user, uint256 amount) external;

    // Withdraw staked KLD tokens for a user
    function withdraw(address user, uint256 amount) external;
}
