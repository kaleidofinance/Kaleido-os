// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract KaleidoVault is Ownable(msg.sender), ReentrancyGuard {
    using SafeERC20 for IERC20;

    event Deposit(address indexed user, address indexed token, uint256 amount);
    event Withdraw(address indexed to, address indexed token, uint256 amount);
    event TokensAdded(address[] tokens);
    event Paused(address indexed admin);
    event Unpaused(address indexed admin);

    error InvalidFeeAmount();
    error InvalidTokenAddress();
    error EthTransferFailed();
    error EthAmountMismatch();
    error InvalidRecipient();
    error VaultPaused();
    error VaultNotPaused();

    mapping(address => bool) public isAcceptedToken;
    address[] private acceptedTokens;

    address public constant NATIVE_TOKEN = address(1);

    bool private paused;




    modifier validToken(address token) {
        if (!isAcceptedToken[token]) revert InvalidTokenAddress();
        _;
    }

    modifier amountNotZero(uint256 amount) {
        if (amount == 0) revert InvalidFeeAmount();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert VaultPaused();
        _;
    }

    modifier whenPaused() {
        if (!paused) revert VaultNotPaused();
        _;
    }

    function addTokens(address[] calldata tokens) external onlyOwner whenNotPaused {
        for (uint256 i = 0; i < tokens.length; i++) {
            if (tokens[i] == address(0)) revert InvalidTokenAddress();
            if (!isAcceptedToken[tokens[i]]) {
                isAcceptedToken[tokens[i]] = true;
                acceptedTokens.push(tokens[i]);
            }
        }
        emit TokensAdded(tokens);
    }

    function depositFees(address token, uint256 amount)
        external
        payable
        nonReentrant
        validToken(token)
        amountNotZero(amount)
        whenNotPaused
    {
        if (token == NATIVE_TOKEN) {
            if (msg.value != amount) revert EthAmountMismatch();
        } else {
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        }
        emit Deposit(msg.sender, token, amount);
    }

    function withdrawFees(address token, uint256 amount, address payable to)
        external
        onlyOwner
        nonReentrant
        validToken(token)
        amountNotZero(amount)
        whenNotPaused
    {
        if (to == address(0)) revert InvalidRecipient();

        if (token == NATIVE_TOKEN) {
            if (address(this).balance < amount) revert InvalidFeeAmount();
            (bool success, ) = to.call{value: amount}("");
            if (!success) revert EthTransferFailed();
        } else {
            uint256 balance = IERC20(token).balanceOf(address(this));
            if (balance < amount) revert InvalidFeeAmount();
            IERC20(token).safeTransfer(to, amount);
        }
        emit Withdraw(to, token, amount);
    }

    function getAcceptedTokens() external view returns (address[] memory) {
        return acceptedTokens;
    }

    /// @notice Pause vault operations (onlyOwner)
    function pause() external onlyOwner whenNotPaused {
        paused = true;
        emit Paused(msg.sender);
    }

    /// @notice Unpause vault operations (onlyOwner)
    function unpause() external onlyOwner whenPaused {
        paused = false;
        emit Unpaused(msg.sender);
    }

    receive() external payable whenNotPaused {
   
        emit Deposit(msg.sender, NATIVE_TOKEN, msg.value);
    }
}
