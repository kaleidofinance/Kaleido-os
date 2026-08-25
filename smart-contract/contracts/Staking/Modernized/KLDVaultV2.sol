// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

interface IStKLD {
    function mintShares(address to, uint256 amount) external returns (uint256);
    function burnShares(address from, uint256 amount) external returns (uint256);
    function getTotalShares() external view returns (uint256);
    function sharesOf(address account) external view returns (uint256);
    function getPooledKldByShares(uint256 shareAmount) external view returns (uint256);
}

interface IYieldTreasury {
    function claimYield(address _asset) external;
}

/**
 * @title KLDVaultV2 - Autonomous Yield Harvester
 * @notice Modernized staking vault with direct AYPS Yield Treasury integration.
 * @dev Supports multi-asset yield harvesting and instant stKLD rebasing.
 */
contract KLDVaultV2 is ReentrancyGuard, Pausable, Ownable {
    using SafeERC20 for IERC20;

    address public stKLD;
    address public yieldTreasury;
    
    mapping(address => bool) public supportedTokens;
    mapping(address => uint256) public totalPooledKLD;
    mapping(address => uint256) public withdrawalRequestTimestamp;

    /// @dev Approximate count of staked addresses, for display only. Kept on the
    ///      vault because it cannot be derived from a view call — stKLD stores
    ///      balances, not a holder list.
    ///
    ///      Incremented when an address with no shares deposits, decremented when
    ///      an address burns its last share. Exact while nobody moves stKLD, and
    ///      it can never underflow, but transfers make it drift both ways:
    ///      sending your whole balance away leaves your +1 stuck (you hold no
    ///      shares, so you can never withdraw to release it) and lets a second
    ///      deposit count you twice, while a recipient who then deposits is not
    ///      counted at all. Tracking true holders would mean charging every stKLD
    ///      transfer for the bookkeeping. Do not build anything on this figure
    ///      beyond a stat, and do not label it a holder count.
    uint256 public totalStakers;

    uint256 public constant WITHDRAWAL_WAITING_PERIOD = 7 days; // Optimized from 14d

    error TokenNotSupported();
    error InvalidAmount();
    error CooldownNotPassed();
    error NoWithdrawalRequest();
    error InsufficientBalance();

    event Deposited(address indexed user, address indexed token, uint256 amount, uint256 shares);
    event Withdrawn(address indexed user, address indexed token, uint256 amount);
    event Harvested(address indexed asset, uint256 amount);
    event WithdrawalRequested(address indexed user, uint256 unlocksAt);
    event WithdrawalRequestCancelled(address indexed user);

    constructor(address _yieldTreasury) Ownable(msg.sender) {
        require(_yieldTreasury != address(0), "Invalid treasury");
        yieldTreasury = _yieldTreasury;
    }

    function setStKLD(address _stKLD) external onlyOwner {
        require(stKLD == address(0), "stKLD already set");
        stKLD = _stKLD;
    }

    function setSupport(address _token, bool _status) external onlyOwner {
        supportedTokens[_token] = _status;
    }

    // --- Core Staking Logic ---

    function deposit(address _token, uint256 _amount) external whenNotPaused nonReentrant {
        if (!supportedTokens[_token]) revert TokenNotSupported();
        if (_amount == 0) revert InvalidAmount();

        uint256 sharesToMint;
        uint256 totalShares = IStKLD(stKLD).getTotalShares();
        uint256 pooled = totalPooledKLD[_token];

        if (totalShares == 0 || pooled == 0) {
            sharesToMint = _amount;
        } else {
            sharesToMint = (_amount * totalShares) / pooled;
        }

        IERC20(_token).safeTransferFrom(msg.sender, address(this), _amount);
        totalPooledKLD[_token] += _amount;

        // Counted before minting, so a top-up by an existing staker doesn't
        // inflate the figure.
        if (IStKLD(stKLD).sharesOf(msg.sender) == 0) {
            totalStakers += 1;
        }

        IStKLD(stKLD).mintShares(msg.sender, sharesToMint);
        emit Deposited(msg.sender, _token, _amount, sharesToMint);
    }

    /**
     * @notice Starts the withdrawal cooldown for the caller.
     * @dev Account-level and amount-less by design: the timestamp gates every
     *      later withdraw() call, so there is nothing to size here.
     */
    function requestWithdrawal() external whenNotPaused {
        if (IStKLD(stKLD).sharesOf(msg.sender) == 0) revert InsufficientBalance();
        withdrawalRequestTimestamp[msg.sender] = block.timestamp;
        emit WithdrawalRequested(msg.sender, block.timestamp + WITHDRAWAL_WAITING_PERIOD);
    }

    /**
     * @notice Cancels the caller's pending withdrawal request, returning them to
     *         normal liquid staking.
     * @dev Re-requesting restarts the full waiting period from scratch.
     */
    function cancelWithdrawalRequest() external whenNotPaused {
        if (withdrawalRequestTimestamp[msg.sender] == 0) revert NoWithdrawalRequest();
        withdrawalRequestTimestamp[msg.sender] = 0;
        emit WithdrawalRequestCancelled(msg.sender);
    }

    function withdraw(address _token, uint256 _amount) external whenNotPaused nonReentrant {
        if (!supportedTokens[_token]) revert TokenNotSupported();
        // Without this, withdraw(token, 0) burns nothing, transfers nothing and
        // still clears the timestamp — costing the caller a fresh 7-day wait.
        if (_amount == 0) revert InvalidAmount();
        uint256 reqTime = withdrawalRequestTimestamp[msg.sender];
        if (reqTime == 0) revert NoWithdrawalRequest();
        if (block.timestamp < reqTime + WITHDRAWAL_WAITING_PERIOD) revert CooldownNotPassed();

        uint256 totalShares = IStKLD(stKLD).getTotalShares();
        uint256 pooled = totalPooledKLD[_token];
        // An empty pool would make the share maths divide by zero.
        if (pooled == 0) revert InsufficientBalance();

        uint256 sharesToBurn = (_amount * totalShares) / pooled;
        if (IStKLD(stKLD).sharesOf(msg.sender) < sharesToBurn) revert InsufficientBalance();

        totalPooledKLD[_token] -= _amount;
        IStKLD(stKLD).burnShares(msg.sender, sharesToBurn);

        // Checked after burning: only a full exit decrements the count.
        if (IStKLD(stKLD).sharesOf(msg.sender) == 0 && totalStakers > 0) {
            totalStakers -= 1;
        }

        IERC20(_token).safeTransfer(msg.sender, _amount);
        withdrawalRequestTimestamp[msg.sender] = 0;

        emit Withdrawn(msg.sender, _token, _amount);
    }

    // --- AYPS Yield Pump ---

    /**
     * @notice Pulls accumulated protocol fees from the Yield Treasury into the Vault.
     * @dev This automatically increases totalPooledKLD, rebasing all stKLD holders.
     */
    function harvestYield(address _asset) external nonReentrant {
        uint256 balanceBefore = IERC20(_asset).balanceOf(address(this));
        
        // Atomically claim yield from Treasury
        IYieldTreasury(yieldTreasury).claimYield(_asset);
        
        uint256 balanceAfter = IERC20(_asset).balanceOf(address(this));
        uint256 harvested = balanceAfter - balanceBefore;
        
        if (harvested > 0) {
            totalPooledKLD[_asset] += harvested;
            emit Harvested(_asset, harvested);
        }
    }

    // --- Viewers ---

    function getTotalPooledKld(address _token) external view returns (uint256) {
        return totalPooledKLD[_token];
    }

    /// @notice Number of addresses currently staked.
    function getTotalStakers() external view returns (uint256) {
        return totalStakers;
    }

    /// @notice True once `_user` has an open withdrawal request.
    /// @dev Distinct from getWithdrawalTimeLeft returning 0, which is also the
    ///      answer for a request whose cooldown has already elapsed.
    function hasWithdrawalRequest(address _user) external view returns (bool) {
        return withdrawalRequestTimestamp[_user] != 0;
    }

    /// @notice Seconds until `_user` may withdraw. Zero when there is no
    ///         request, or when the cooldown has already elapsed.
    function getWithdrawalTimeLeft(address _user) external view returns (uint256) {
        uint256 reqTime = withdrawalRequestTimestamp[_user];
        if (reqTime == 0) return 0;
        uint256 unlocksAt = reqTime + WITHDRAWAL_WAITING_PERIOD;
        if (block.timestamp >= unlocksAt) return 0;
        return unlocksAt - block.timestamp;
    }
}
