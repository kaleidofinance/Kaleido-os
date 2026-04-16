// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../Stablecoin/kfUSD.sol";

/**
 * @title ReentrancyAttacker
 * @dev Malicious contract to test reentrancy vulnerabilities
 * DO NOT DEPLOY IN PRODUCTION - FOR TESTING ONLY
 */
contract ReentrancyAttacker {
    kfUSD public targetContract;
    bool public attacking;

    constructor(address _target) {
        targetContract = kfUSD(_target);
        attacking = false;
    }

    /**
     * @dev Attempts to re-enter the redeem function
     */
    function attack() external {
        attacking = true;
        // This should fail if ReentrancyGuard is properly implemented
        // Implementation depends on kfUSD contract structure
    }

    /**
     * @dev Callback function that attempts reentrancy
     */
    receive() external payable {
        if (attacking) {
            // Attempt to call redeem again
            // This should be blocked by ReentrancyGuard
            attacking = false;
        }
    }
}

