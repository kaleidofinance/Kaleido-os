// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title USDT - Tether USD Token
 * @notice Tether USD token contract
 * @dev This is the USDT token contract for the stablecoin system
 */
contract USDT is ERC20, ERC20Burnable, Ownable {
    uint8 private _decimals;

    constructor(address _initialOwner) ERC20("Tether USD", "USDT") Ownable(_initialOwner) {
        _decimals = 6; // USDT uses 6 decimals
        _mint(_initialOwner, 1000000000 * 10**_decimals); // 1 billion USDT
    }

    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    /**
     * @dev Mint tokens for testing purposes
     * @param _to Address to mint to
     * @param _amount Amount to mint
     */
    function mint(address _to, uint256 _amount) external onlyOwner {
        _mint(_to, _amount);
    }
}

