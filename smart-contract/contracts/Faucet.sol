// SPDX-License-Identifier: MIT
pragma solidity ^0.8.3;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";


contract KaleidoTokenFaucet is Ownable(msg.sender){
    using SafeERC20 for IERC20;

    /// @dev Set at deploy rather than hardcoded. These were Abstract-testnet
    ///      literals, which made the faucet undeployable on the other testnets
    ///      without editing the source. Left mutable so the existing
    ///      owner-only setUSDCAddress keeps working; the fix here is only that
    ///      the initial values now come from the constructor.
    address public USDC;
    address public KLD;

    // State variables
    uint256 public MIN_CLAIM_AMOUNT = 100 * 10**6; // 100 USDC
    uint256 public MIN_KLD_CLAIM_AMOUNT = 10000 * 10**18; // 10,000 KLD
    uint256 public  COOLDOWN = 60 minutes;
    address[] public allUsers;
    uint256 public totalClaimed;
    uint256 public totalKLDClaimed;


    // Mappings
    mapping(address => uint256) public lastClaimed;
    mapping(address => uint256) public lastKLDClaimed;
    mapping(address => bool) public hasClaimedBefore;
    mapping(address => bool) public hasClaimedKLDBefore;

    // Errors
    error KaleidoTokenFaucet_InsufficientContractBalance();
    error KaleidoTokenFaucet_FailToSendToken();
    error KaleidoTokenFaucet_CooldownNotOver();

    // Events
    event TokenClaim(
        uint256 indexed amount,
        address indexed claimer,
        uint256 indexed date
    );
    event KLDTokenClaim(
        uint256 indexed amount,
        address indexed claimer,
        uint256 indexed date
    );

    /// @param _usdc  USDC (or its testnet mock) on the chain being deployed to.
    /// @param _kld   The KLD token on that same chain.
    constructor(address _usdc, address _kld) {
        require(_usdc != address(0) && _kld != address(0), "Faucet: zero token");
        USDC = _usdc;
        KLD = _kld;
    }

    // Claim function
    function claimToken() external {
        if (block.timestamp - lastClaimed[msg.sender] < COOLDOWN) {
            revert KaleidoTokenFaucet_CooldownNotOver();
        }

        uint256 contractBalance = IERC20(USDC).balanceOf(address(this));
        if (contractBalance < MIN_CLAIM_AMOUNT) {
            revert KaleidoTokenFaucet_InsufficientContractBalance();
        }

        lastClaimed[msg.sender] = block.timestamp;
        totalClaimed += MIN_CLAIM_AMOUNT;

        if (!hasClaimedBefore[msg.sender]) {
            allUsers.push(msg.sender);
            hasClaimedBefore[msg.sender] = true;
        }

        IERC20(USDC).safeTransfer(msg.sender, MIN_CLAIM_AMOUNT);
 
        emit TokenClaim(MIN_CLAIM_AMOUNT, msg.sender, block.timestamp);
    }

    function claimKLD() external {
        if (block.timestamp - lastKLDClaimed[msg.sender] < COOLDOWN) {
            revert KaleidoTokenFaucet_CooldownNotOver();
        }

        uint256 contractBalance = IERC20(KLD).balanceOf(address(this));
        if (contractBalance < MIN_KLD_CLAIM_AMOUNT) {
            revert KaleidoTokenFaucet_InsufficientContractBalance();
        }

        lastKLDClaimed[msg.sender] = block.timestamp;
        totalKLDClaimed += MIN_KLD_CLAIM_AMOUNT;

        if (!hasClaimedKLDBefore[msg.sender]) {
            allUsers.push(msg.sender);
            hasClaimedKLDBefore[msg.sender] = true;
        }

        IERC20(KLD).safeTransfer(msg.sender, MIN_KLD_CLAIM_AMOUNT);


        emit KLDTokenClaim(MIN_KLD_CLAIM_AMOUNT, msg.sender, block.timestamp);
    }

    

    // Getter for total users
    function getTotalUsers() public view returns (uint256) {
        return allUsers.length;
    }

    // Getter for total claimed amount
    function getTotalClaimed() public view returns (uint256) {
        return totalClaimed;
    }

    function setUSDCAddress(address _newUSDC) external onlyOwner {
        USDC = _newUSDC;
    }

    function setCooldown(uint256 _seconds) external onlyOwner {
        COOLDOWN = _seconds;
    }

    function setMinClaimAmount(uint256 _amount) external onlyOwner {
        MIN_CLAIM_AMOUNT = _amount;
    }




}
