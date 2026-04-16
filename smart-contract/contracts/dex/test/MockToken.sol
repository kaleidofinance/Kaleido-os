// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0;

import "../interfaces/IERC20.sol";

contract MockToken is IERC20 {
    string public constant override name = "Mock Token";
    string public constant override symbol = "MCK";
    uint8 public constant override decimals = 18;
    uint  public override totalSupply;
    mapping(address => uint) public override balanceOf;
    mapping(address => mapping(address => uint)) public override allowance;

    event Transfer(address indexed from, address indexed to, uint value);
    event Approval(address indexed owner, address indexed spender, uint value);

    constructor(uint _totalSupply) public {
        _mint(msg.sender, _totalSupply);
    }

    function _mint(address to, uint value) internal {
        totalSupply = totalSupply + value;
        balanceOf[to] = balanceOf[to] + value;
        emit Transfer(address(0), to, value);
    }

    function approve(address spender, uint value) external override returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint value) external override returns (bool) {
        require(balanceOf[msg.sender] >= value, "MockToken: INSUFFICIENT_BALANCE");
        balanceOf[msg.sender] = balanceOf[msg.sender] - value;
        balanceOf[to] = balanceOf[to] + value;
        emit Transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint value) external override returns (bool) {
        require(balanceOf[from] >= value, "MockToken: INSUFFICIENT_BALANCE");
        require(allowance[from][msg.sender] >= value, "MockToken: INSUFFICIENT_ALLOWANCE");
        allowance[from][msg.sender] = allowance[from][msg.sender] - value;
        balanceOf[from] = balanceOf[from] - value;
        balanceOf[to] = balanceOf[to] + value;
        emit Transfer(from, to, value);
        return true;
    }
}
