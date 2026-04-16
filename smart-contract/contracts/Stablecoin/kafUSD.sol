// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title kafUSD - Kaleido Finance Liquid Staking Token
 * @notice A liquid staking derivative of kfUSD that accrues yield over time
 * @dev Users can lock kfUSD (and other supported assets) to receive kafUSD
 */
contract kafUSD is
    ERC20,
    ERC20Burnable,
    ERC20Pausable,
    AccessControl,
    ReentrancyGuard
{
    bytes32 public constant VAULT_ROLE = keccak256("VAULT_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    // kfUSD token address
    IERC20 public kfusd;

    // Supported lock assets
    mapping(address => bool) public supportedAssets;
    address[] public assetList;

    uint256 public constant BASIS_POINTS = 10000;

    // Lock and withdraw tracking
    mapping(address => uint256) public lockBalances; // Total kfUSD locked
    mapping(address => mapping(address => uint256)) public assetLockBalances; // Asset balances locked
    mapping(address => uint256) public lockTimestamps; // When user locked assets to track yield accrual

    // Cooldown period for withdrawal (7 days)
    uint256 public cooldownPeriod = 7 days;
    mapping(address => uint256) public withdrawalRequestTime;
    mapping(address => uint256) public withdrawalAmount;

    // Total locked values
    uint256 public totalLocked;
    uint256 public totalAssetsLocked;

    // YieldTreasury contract address (for yield distribution)
    address public yieldTreasury;

    event AssetsLocked(
        address indexed user,
        address indexed asset,
        uint256 amount,
        uint256 kafusdMinted
    );
    event AssetsUnlocked(
        address indexed user,
        address indexed asset,
        uint256 amount
    );
    event YieldTreasuryUpdated(address indexed yieldTreasury);
    event AssetSupported(address indexed asset, bool supported);
    event WithdrawalRequested(
        address indexed user,
        uint256 amount,
        uint256 unlockTime
    );
    event WithdrawalCompleted(address indexed user, uint256 amount);

    constructor(
        address _kfusd
    ) ERC20("Kaleido Finance Liquid Staked USD", "kafUSD") {
        require(_kfusd != address(0), "kafUSD: Invalid kfUSD address");
        kfusd = IERC20(_kfusd);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE, msg.sender);
        _grantRole(VAULT_ROLE, msg.sender);
    }

    /**
     * @dev Lock assets (kfUSD or other supported assets) to receive kafUSD
     * @param _asset Address of the asset to lock
     * @param _amount Amount of asset to lock
     */
    function lockAssets(
        address _asset,
        uint256 _amount
    ) external nonReentrant whenNotPaused {
        require(_amount > 0, "kafUSD: Amount must be greater than zero");
        require(supportedAssets[_asset], "kafUSD: Asset not supported");
        require(_asset != address(this), "kafUSD: Cannot lock kafUSD");

        // Transfer asset from user
        IERC20(_asset).transferFrom(msg.sender, address(this), _amount);

        // Calculate kafUSD to mint (1:1 for kfUSD, adjusted for other assets)
        uint256 kafusdToMint = _amount;
        if (_asset != address(kfusd)) {
            // For other assets, use 1:1 ratio with kfUSD equivalent
            kafusdToMint = _amount;
        }

        // Update balances and lock timestamp
        if (_asset == address(kfusd)) {
            lockBalances[msg.sender] += _amount;
            totalLocked += _amount;
        }
        assetLockBalances[msg.sender][_asset] += _amount;
        totalAssetsLocked += _amount;

        // Always update lock timestamp to current time when locking assets
        // This ensures yield is calculated from the most recent lock time
        lockTimestamps[msg.sender] = block.timestamp;

        // Mint kafUSD
        _mint(msg.sender, kafusdToMint);

        emit AssetsLocked(msg.sender, _asset, _amount, kafusdToMint);
    }

    /**
     * @dev Request withdrawal of locked assets
     * @param _amount Amount of kafUSD to burn (which determines how much to unlock)
     */
    function requestWithdrawal(
        uint256 _amount
    ) external nonReentrant whenNotPaused {
        require(_amount > 0, "kafUSD: Amount must be greater than zero");
        require(
            balanceOf(msg.sender) >= _amount,
            "kafUSD: Insufficient balance"
        );

        withdrawalRequestTime[msg.sender] = block.timestamp;
        withdrawalAmount[msg.sender] = _amount;

        emit WithdrawalRequested(
            msg.sender,
            _amount,
            block.timestamp + cooldownPeriod
        );
    }

    /**
     * @dev Complete withdrawal after cooldown period
     * @param _asset Address of the asset to withdraw
     */
    function completeWithdrawal(
        address _asset
    ) external nonReentrant whenNotPaused {
        require(
            block.timestamp >=
                withdrawalRequestTime[msg.sender] + cooldownPeriod,
            "kafUSD: Cooldown not complete"
        );
        require(
            withdrawalAmount[msg.sender] > 0,
            "kafUSD: No withdrawal request"
        );
        require(supportedAssets[_asset], "kafUSD: Asset not supported");

        uint256 amountToUnlock = withdrawalAmount[msg.sender];

        // Clear withdrawal request
        withdrawalRequestTime[msg.sender] = 0;
        withdrawalAmount[msg.sender] = 0;

        // Calculate assets to unlock (1:1 ratio)
        uint256 assetsToUnlock = amountToUnlock;

        // Check available balance
        if (_asset == address(kfusd)) {
            require(
                lockBalances[msg.sender] >= assetsToUnlock,
                "kafUSD: Insufficient locked balance"
            );
            lockBalances[msg.sender] -= assetsToUnlock;
            totalLocked -= assetsToUnlock;
        }

        require(
            assetLockBalances[msg.sender][_asset] >= assetsToUnlock,
            "kafUSD: Insufficient asset balance"
        );
        assetLockBalances[msg.sender][_asset] -= assetsToUnlock;
        totalAssetsLocked -= assetsToUnlock;

        // Burn kafUSD
        _burn(msg.sender, amountToUnlock);

        // Transfer assets to user
        // Note: Yield is now handled by YieldTreasury contract
        // Users should claim yield separately from YieldTreasury
        IERC20(_asset).transfer(msg.sender, assetsToUnlock);

        emit AssetsUnlocked(msg.sender, _asset, assetsToUnlock);
        emit WithdrawalCompleted(msg.sender, amountToUnlock);
    }

    /**
     * @dev Set YieldTreasury contract address
     * @param _yieldTreasury Address of YieldTreasury contract
     */
    function setYieldTreasury(address _yieldTreasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_yieldTreasury != address(0), "kafUSD: Cannot set zero address");
        yieldTreasury = _yieldTreasury;
        emit YieldTreasuryUpdated(_yieldTreasury);
    }

    /**
     * @dev Get time until withdrawal can be completed
     * @param _user Address of the user
     */
    function getWithdrawalTime(address _user) public view returns (uint256) {
        if (withdrawalRequestTime[_user] == 0) return 0;

        uint256 elapsed = block.timestamp - withdrawalRequestTime[_user];
        if (elapsed >= cooldownPeriod) return 0;

        return cooldownPeriod - elapsed;
    }


    /**
     * @dev Set cooldown period
     * @param _period New cooldown period in seconds
     */
    function setCooldownPeriod(
        uint256 _period
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_period <= 30 days, "kafUSD: Cooldown too long");
        cooldownPeriod = _period;
    }

    /**
     * @dev Add or remove supported assets
     * @param _asset Address of the asset
     * @param _supported Whether the asset is supported
     */
    function setAssetSupport(
        address _asset,
        bool _supported
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_asset != address(0), "kafUSD: Cannot use zero address");

        bool isSupported = supportedAssets[_asset];

        if (_supported && !isSupported) {
            supportedAssets[_asset] = true;
            assetList.push(_asset);
        } else if (!_supported && isSupported) {
            supportedAssets[_asset] = false;
            // Remove from array
            for (uint256 i = 0; i < assetList.length; i++) {
                if (assetList[i] == _asset) {
                    assetList[i] = assetList[assetList.length - 1];
                    assetList.pop();
                    break;
                }
            }
        }

        emit AssetSupported(_asset, _supported);
    }

    /**
     * @dev Get list of all supported assets
     */
    function getSupportedAssets() public view returns (address[] memory) {
        return assetList;
    }

    /**
     * @dev Get user's locked balance for a specific asset
     * @param _user Address of the user
     * @param _asset Address of the asset
     */
    function getUserAssetBalance(
        address _user,
        address _asset
    ) public view returns (uint256) {
        return assetLockBalances[_user][_asset];
    }

    function _update(
        address from,
        address to,
        uint256 value
    ) internal override(ERC20, ERC20Pausable) {
        super._update(from, to, value);
    }

    function pause() public onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() public onlyRole(PAUSER_ROLE) {
        _unpause();
    }
}
