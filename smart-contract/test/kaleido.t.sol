// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "forge-std/Test.sol";
import "../contracts/facets/ProtocolFacet.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract ProtocolLiquidationTest is Test {
    ProtocolFacet protocol;
    address owner;
    address lender;
    address bot;
    address borrower;
    address USDT;
    address ETH;
    uint256 requestId;

    function setUp() public {
        // Deploy protocol and tokens as in your main setUp
        owner = address(0xA1);
        lender = address(0xB1);
        bot = address(0xC1);
        borrower = address(0xD1);

        // Deploy protocol facet (or use diamond if needed)
        protocol = new ProtocolFacet();

        // Deploy mock ERC20 tokens (replace with your actual token deployment)
        USDT = address(new MockERC20("USDT", "USDT", 6));
        ETH = address(1); // Use address(1) as native ETH in your protocol

        // Set up protocol as needed (e.g., set bot, set price feeds, etc.)
        protocol.setBotAddress(bot);
        // ... any other setup required

        // Mint and approve collateral for borrower
        deal(USDT, borrower, 1_000_000e6);
        vm.prank(borrower);
        IERC20(USDT).approve(address(protocol), type(uint256).max);

        // Borrower deposits collateral
        vm.prank(borrower);
        protocol.depositCollateral(USDT, 500_000e6);

        // Borrower creates a lending request
        uint128 requestAmount = 1e18; // 1 ETH
        uint16 interestRate = 500;
        uint256 returnDate = block.timestamp + 1 days;

        vm.prank(borrower);
        protocol.createLendingRequest(
            requestAmount,
            interestRate,
            returnDate,
            ETH
        );

        // Lender services the request (simulate funding)
        vm.deal(lender, 2 ether);
        vm.prank(lender);
        protocol.serviceRequest{value: 1 ether}(1, ETH);

        requestId = 1;
    }

    function testCannotLiquidateHealthyPositionBeforeReturnDate() public {
        // Try to liquidate before return date and while healthy
        vm.prank(bot);
        vm.expectRevert("Protocol__PositionHealthy()");
        protocol.liquidateUserRequest(requestId);
    }

    function testCanLiquidateAfterReturnDate() public {
        // Fast-forward time past return date
        vm.warp(block.timestamp + 2 days);

        // Bot liquidates
        vm.prank(bot);
        protocol.liquidateUserRequest(requestId);

        // Check that request is closed
        Request memory req = protocol.getUserRequest(borrower, requestId);
        assertEq(uint8(req.status), uint8(Status.CLOSED));
    }
}

// Minimal MockERC20 for testing
contract MockERC20 is IERC20 {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory n, string memory s, uint8 d) {
        name = n;
        symbol = s;
        decimals = d;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }
}
