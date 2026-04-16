// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title USDe - Ethena USD Token
 * @notice Ethena USD token contract
 * @dev This is the USDe token contract for the stablecoin system
 */
contract USDe is ERC20, ERC20Burnable, Ownable {
    uint8 private _decimals;

    constructor(address _initialOwner) ERC20("Ethena USD", "USDe") Ownable(_initialOwner) {
        _decimals = 18; // USDe uses 18 decimals
        _mint(_initialOwner, 1000000000 * 10**_decimals); // 1 billion USDe
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

