// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.7.6;

import '../../libraries/IERC20_07.sol';

/// @title Minimal ERC20 for testing with metadata
contract TestERC20Metadata {
    string public name;
    string public symbol;
    uint8 public decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(
        uint256 amountToMint,
        string memory _name,
        string memory _symbol
    ) {
        name = _name;
        symbol = _symbol;
        _mint(msg.sender, amountToMint);
    }

    function _mint(address to, uint256 amount) internal {
        totalSupply += amount;
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}
