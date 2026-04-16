// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title YieldTreasury - Centralized Yield Management Contract
 * @notice Handles yield accumulation and distribution from multiple sources
 * @dev Supports multi-asset yield (kfUSD, USDC, USDT, KLD, etc.) with per-asset tracking
 * 
 * Yield Sources:
 * 1. kfUSD mint/redeem fees (kfUSD tokens)
 * 2. Collateral farming rewards (USDC, USDT, USDe, etc.)
 * 3. KLD token rewards
 * 4. Future yield sources (AMM fees, liquidations, etc.)
 */
contract YieldTreasury is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant YIELD_SOURCE_ROLE = keccak256("YIELD_SOURCE_ROLE");
    bytes32 public constant VAULT_ROLE = keccak256("VAULT_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    // kafUSD contract address (for calculating user shares)
    address public kafUSDContract;
    
    // kfUSD token address (for compound functionality)
    address public kfUSDToken;

    // Supported yield assets
    mapping(address => bool) public supportedYieldAssets;
    address[] public yieldAssetList;

    // Yield tracking per asset (SCONE-Hardened Index)
    uint256 public constant PRECISION = 1e18;
    mapping(address => uint256) public accYieldPerShare; // Global index per asset
    mapping(address => mapping(address => uint256)) public userRewardDebt; // User checkpoint
    
    // totalYieldPerAsset[asset] = total yield accumulated in this asset
    mapping(address => uint256) public totalYieldPerAsset;
    
    // Yield balance per asset (actual tokens in contract)
    mapping(address => uint256) public yieldBalancePerAsset;

    // Yield sources tracking
    struct YieldSource {
        address sourceAddress;
        string sourceName;
        bool enabled;
        uint256 totalContributed; // Total yield contributed from this source
    }
    
    mapping(address => YieldSource) public yieldSources;
    address[] public yieldSourceList;

    // Events
    event YieldReceived(
        address indexed asset,
        uint256 amount,
        address indexed source,
        string sourceName
    );
    event YieldClaimed(
        address indexed user,
        address indexed asset,
        uint256 amount
    );
    event YieldCompounded(
        address indexed user,
        address indexed asset,
        uint256 amount
    );
    event YieldAssetAdded(address indexed asset, bool supported);
    event YieldSourceAdded(
        address indexed source,
        string sourceName,
        bool enabled
    );
    event KafUSDContractUpdated(address indexed kafUSDContract);

    constructor(address _kafUSDContract) {
        require(_kafUSDContract != address(0), "YieldTreasury: Invalid kafUSD address");
        kafUSDContract = _kafUSDContract;
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(YIELD_SOURCE_ROLE, msg.sender);
    }

    /**
     * @dev Receive yield from any source
     * @param _asset Asset address (kfUSD, USDC, USDT, KLD, etc.)
     * @param _amount Amount of yield
     * @param _sourceName Human-readable source name (e.g., "kfUSD Fees", "Farming Rewards", "KLD Rewards")
     */
    function receiveYield(
        address _asset,
        uint256 _amount,
        string memory _sourceName
    ) external onlyRole(YIELD_SOURCE_ROLE) nonReentrant {
        require(_asset != address(0), "YieldTreasury: Invalid asset");
        require(_amount > 0, "YieldTreasury: Amount must be greater than zero");
        
        uint256 totalKafUSDSupply = IERC20(kafUSDContract).totalSupply();
        require(totalKafUSDSupply > 0, "YieldTreasury: No shareholders to receive yield");

        // If asset is not yet supported, automatically add it
        // This allows flexibility when adding new yield sources
        if (!supportedYieldAssets[_asset]) {
            supportedYieldAssets[_asset] = true;
            yieldAssetList.push(_asset);
            emit YieldAssetAdded(_asset, true);
        }

        // Transfer tokens from caller
        IERC20(_asset).safeTransferFrom(msg.sender, address(this), _amount);

        // Update AYPS Index (SCONE Protection: Order-Independent Distribution)
        accYieldPerShare[_asset] += (_amount * PRECISION) / totalKafUSDSupply;

        // Update yield tracking
        totalYieldPerAsset[_asset] += _amount;
        yieldBalancePerAsset[_asset] += _amount;

        // Track yield source
        if (yieldSources[msg.sender].sourceAddress == address(0)) {
            yieldSources[msg.sender] = YieldSource({
                sourceAddress: msg.sender,
                sourceName: _sourceName,
                enabled: true,
                totalContributed: _amount
            });
            yieldSourceList.push(msg.sender);
        } else {
            yieldSources[msg.sender].totalContributed += _amount;
        }

        emit YieldReceived(_asset, _amount, msg.sender, _sourceName);
    }

    /**
     * @dev Calculate user's share of yield using the AYPS index
     * @param _user User address
     * @param _asset Asset address
     * @return User's claimable yield in the specified asset
     */
    function calculateUserYield(
        address _user,
        address _asset
    ) public view returns (uint256) {
        if (kafUSDContract == address(0)) return 0;
        
        uint256 userKafUSDBalance = IERC20(kafUSDContract).balanceOf(_user);
        if (userKafUSDBalance == 0) return 0;

        // pendingReward = (userShares * accYieldPerShare) - userRewardDebt
        uint256 accumulated = (userKafUSDBalance * accYieldPerShare[_asset]) / PRECISION;
        
        if (accumulated <= userRewardDebt[_user][_asset]) return 0;
        return accumulated - userRewardDebt[_user][_asset];
    }

    /**
     * @dev Calculate total yield for a user across all assets
     * @param _user User address
     * @return assets Array of asset addresses
     * @return amounts Array of yield amounts per asset
     */
    function calculateTotalUserYield(
        address _user
    ) public view returns (address[] memory assets, uint256[] memory amounts) {
        assets = new address[](yieldAssetList.length);
        amounts = new uint256[](yieldAssetList.length);

        for (uint256 i = 0; i < yieldAssetList.length; i++) {
            assets[i] = yieldAssetList[i];
            amounts[i] = calculateUserYield(_user, yieldAssetList[i]);
        }

        return (assets, amounts);
    }

    /**
     * @dev Claim yield for a specific asset (yield comes from its native source)
     * @notice Users claim yield in the asset it was provided by the yield source
     * @notice e.g., kfUSD fees → claim kfUSD yield, USDC farming → claim USDC yield
     * @param _asset Asset to claim yield in (must be available from yield sources)
     */
    function claimYield(address _asset) external nonReentrant {
        require(_asset != address(0), "YieldTreasury: Invalid asset");
        require(supportedYieldAssets[_asset], "YieldTreasury: Asset not supported");

        uint256 userYield = calculateUserYield(msg.sender, _asset);
        require(userYield > 0, "YieldTreasury: No yield available for this asset");

        // Update User Reward Debt and Pool Balance (Accounting Shield)
        userRewardDebt[msg.sender][_asset] += userYield;
        yieldBalancePerAsset[_asset] -= userYield;

        // Transfer yield to user
        IERC20(_asset).safeTransfer(msg.sender, userYield);

        emit YieldClaimed(msg.sender, _asset, userYield);
    }

    /**
     * @dev Claim all available yield from all yield sources
     * @notice Claims yield in each asset that has available yield for the user
     * @notice Each yield source provides yield in its native asset (kfUSD, USDC, KLD, etc.)
     */
    function claimAllYield() external nonReentrant {
        uint256 totalClaimed = 0;

        for (uint256 i = 0; i < yieldAssetList.length; i++) {
            address asset = yieldAssetList[i];
            
            uint256 userYield = calculateUserYield(msg.sender, asset);
            if (userYield == 0) continue;
            if (yieldBalancePerAsset[asset] < userYield) continue;

            // Update User Reward Debt and Pool Balance
            userRewardDebt[msg.sender][asset] += userYield;
            yieldBalancePerAsset[asset] -= userYield;

            // Transfer yield to user in the native asset
            IERC20(asset).safeTransfer(msg.sender, userYield);

            emit YieldClaimed(msg.sender, asset, userYield);
            totalClaimed++;
        }

        require(totalClaimed > 0, "YieldTreasury: No yield available to claim");
    }

    /**
     * @dev Claim and compound yield by locking the asset in kafUSD contract
     * @param _asset Asset to claim and compound (yield from its native source)
     * @notice Transfers yield to user, who can then lock it in kafUSD contract to compound
     */
    function claimAndCompound(address _asset) external nonReentrant {
        require(_asset != address(0), "YieldTreasury: Invalid asset");
        require(supportedYieldAssets[_asset], "YieldTreasury: Asset not supported");

        uint256 userYield = calculateUserYield(msg.sender, _asset);
        require(userYield > 0, "YieldTreasury: No yield to claim");

        // Update User Reward Debt
        userRewardDebt[msg.sender][_asset] += userYield;

        // Transfer yield to user for compounding
        IERC20(_asset).safeTransfer(msg.sender, userYield);

        emit YieldCompounded(msg.sender, _asset, userYield);
    }

    /**
     * @dev Set kfUSD token address
     * @param _kfUSDToken kfUSD token address
     */
    function setKfUSDToken(address _kfUSDToken) external onlyRole(ADMIN_ROLE) {
        require(_kfUSDToken != address(0), "YieldTreasury: Invalid kfUSD address");
        kfUSDToken = _kfUSDToken;
    }

    /**
     * @dev Add or remove supported yield asset
     * @param _asset Asset address
     * @param _supported Whether asset is supported
     */
    function setYieldAsset(
        address _asset,
        bool _supported
    ) external onlyRole(ADMIN_ROLE) {
        require(_asset != address(0), "YieldTreasury: Invalid asset");

        bool wasSupported = supportedYieldAssets[_asset];
        supportedYieldAssets[_asset] = _supported;

        if (_supported && !wasSupported) {
            yieldAssetList.push(_asset);
        } else if (!_supported && wasSupported) {
            // Remove from array
            for (uint256 i = 0; i < yieldAssetList.length; i++) {
                if (yieldAssetList[i] == _asset) {
                    yieldAssetList[i] = yieldAssetList[yieldAssetList.length - 1];
                    yieldAssetList.pop();
                    break;
                }
            }
        }

        emit YieldAssetAdded(_asset, _supported);
    }

    /**
     * @dev Add or update yield source
     * @param _source Source contract address
     * @param _sourceName Human-readable source name
     * @param _enabled Whether source is enabled
     */
    function setYieldSource(
        address _source,
        string memory _sourceName,
        bool _enabled
    ) external onlyRole(ADMIN_ROLE) {
        require(_source != address(0), "YieldTreasury: Invalid source");

        if (yieldSources[_source].sourceAddress == address(0)) {
            yieldSources[_source] = YieldSource({
                sourceAddress: _source,
                sourceName: _sourceName,
                enabled: _enabled,
                totalContributed: 0
            });
            yieldSourceList.push(_source);
            _grantRole(YIELD_SOURCE_ROLE, _source);
        } else {
            yieldSources[_source].enabled = _enabled;
            yieldSources[_source].sourceName = _sourceName;
            if (_enabled) {
                _grantRole(YIELD_SOURCE_ROLE, _source);
            } else {
                _revokeRole(YIELD_SOURCE_ROLE, _source);
            }
        }

        emit YieldSourceAdded(_source, _sourceName, _enabled);
    }

    /**
     * @dev Update kafUSD contract address
     * @param _kafUSDContract New kafUSD contract address
     */
    function setKafUSDContract(
        address _kafUSDContract
    ) external onlyRole(ADMIN_ROLE) {
        require(_kafUSDContract != address(0), "YieldTreasury: Invalid address");
        kafUSDContract = _kafUSDContract;
        emit KafUSDContractUpdated(_kafUSDContract);
    }

    /**
     * @dev Get total yield balance for an asset
     * @param _asset Asset address
     * @return Total yield balance
     */
    function getYieldBalance(address _asset) external view returns (uint256) {
        return yieldBalancePerAsset[_asset];
    }

    /**
     * @dev Get total yield accumulated for an asset
     * @param _asset Asset address
     * @return Total yield accumulated
     */
    function getTotalYield(address _asset) external view returns (uint256) {
        return totalYieldPerAsset[_asset];
    }

    /**
     * @dev Get all supported yield assets
     * @return Array of asset addresses
     */
    function getSupportedYieldAssets() external view returns (address[] memory) {
        return yieldAssetList;
    }

    /**
     * @dev Get all yield sources
     * @return Array of source addresses
     */
    function getYieldSources() external view returns (address[] memory) {
        return yieldSourceList;
    }

    /**
     * @dev Get yield source info
     * @param _source Source address
     * @return YieldSource struct
     */
    function getYieldSourceInfo(
        address _source
    ) external view returns (YieldSource memory) {
        return yieldSources[_source];
    }

    /**
     * @dev Emergency withdraw (admin only)
     * @param _asset Asset to withdraw
     * @param _amount Amount to withdraw
     * @param _to Recipient address
     */
    function emergencyWithdraw(
        address _asset,
        uint256 _amount,
        address _to
    ) external onlyRole(ADMIN_ROLE) {
        require(_to != address(0), "YieldTreasury: Invalid recipient");
        IERC20(_asset).safeTransfer(_to, _amount);
    }

}

