// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.7.6;

import './TestERC20.sol';
import '../interfaces/external/IERC20PermitAllowed.sol';

// has a fake permit that just uses the other signature type for type(uint256).max
/// @title Minimal ERC20 for testing with permit-allowed stub
contract TestERC20PermitAllowed {
    string public name = 'Test ERC20';
    string public symbol = 'TEST';
    uint8 public decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => uint256) public nonces;

    constructor(uint256 amountToMint) {
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

    function permit(
        address holder,
        address spender,
        uint256 nonce,
        uint256 expiry,
        bool allowed,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        require(nonces[holder] == nonce, 'TestERC20PermitAllowed::permit: wrong nonce');
        nonces[holder]++;
        if (allowed) {
            allowance[holder][spender] = type(uint256).max;
        } else {
            allowance[holder][spender] = 0;
        }
    }
}
