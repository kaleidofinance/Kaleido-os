// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// Interface for YieldTreasury contract to receive yield
interface IYieldTreasury {
    function receiveYield(
        address _asset,
        uint256 _amount,
        string memory _sourceName
    ) external;
}

/**
 * @title kfUSD - Kaleido Finance USD Stablecoin
 * @notice A stablecoin backed by multiple stablecoin assets (USDC, USDT, USDe)
 * @dev Supports minting with collateral assets and redemption to backed assets
 */
contract kfUSD is
    ERC20,
    ERC20Burnable,
    ERC20Pausable,
    AccessControl,
    ReentrancyGuard
{
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    // Supported collateral assets
    mapping(address => bool) public supportedCollaterals;
    address[] public collateralList;

    // Mint and redemption fee (in basis points, 100 = 1%)
    uint256 public mintFee = 30; // 0.3%
    uint256 public redeemFee = 30; // 0.3%
    uint256 public constant BASIS_POINTS = 10000;

    // Total minted and redeemed amounts
    uint256 public totalMinted;
    uint256 public totalRedeemed;

    // Collateral balances
    mapping(address => uint256) public collateralBalances;

    // Fee treasury - collected fees that fund kafUSD yield (for tracking)
    uint256 public feeTreasury;
    
    // YieldTreasury contract address for yield distribution
    address public yieldTreasury;
    bool public autoTransferFees = true; // Enabled by default - fees automatically sent to YieldTreasury
    bool private _yieldTreasuryApproved = false; // Track if we've approved YieldTreasury

    // Deployment strategy for collateral
    // Percentage of collateral to deploy to yield sources (basis points)
    uint256 public deploymentRatio = 5000; // 50% deployed, 50% idle for redemptions
    mapping(address => uint256) public idleBalances; // Collateral kept idle
    mapping(address => uint256) public deployedBalances; // Collateral deployed to yield

    // Automated vault for yield deployment
    address public vaultAddress;
    bool public autoDeploymentEnabled = false;

    // Chain-specific deployment strategy
    enum DeploymentStrategy {
        FEES_ONLY, // Only use fees (works everywhere)
        LP_FARMING, // Native LP farming
        LENDING_PROTOCOLS, // Aave, Compound, etc.
        CROSS_CHAIN // Bridge to other chains
    }

    mapping(address => DeploymentStrategy) public tokenStrategy;

    event CollateralAdded(address indexed asset, uint256 amount);
    event CollateralRemoved(address indexed asset, uint256 amount);
    event Minted(
        address indexed to,
        uint256 amount,
        address indexed collateral,
        uint256 collateralAmount
    );
    event Redeemed(
        address indexed from,
        uint256 amount,
        address indexed outputAsset,
        uint256 outputAmount
    );
    event FeesUpdated(uint256 newMintFee, uint256 newRedeemFee);
    event CollateralSupported(address indexed asset, bool supported);
    event YieldTreasuryUpdated(address indexed yieldTreasury);
    event AutoTransferFeesUpdated(bool enabled);

    constructor() ERC20("Kaleido Finance USD", "kfUSD") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE, msg.sender);
    }

    /**
     * @dev Mint kfUSD tokens by depositing collateral
     * @param _to Address to receive kfUSD
     * @param _amount Amount of kfUSD to mint
     * @param _collateralToken Address of the collateral token (USDC, USDT, USDe)
     * @param _collateralAmount Amount of collateral to deposit
     */
    function mint(
        address _to,
        uint256 _amount,
        address _collateralToken,
        uint256 _collateralAmount
    ) external onlyRole(MINTER_ROLE) nonReentrant whenNotPaused {
        require(_to != address(0), "kfUSD: Cannot mint to zero address");
        require(_amount > 0, "kfUSD: Amount must be greater than zero");
        require(
            supportedCollaterals[_collateralToken],
            "kfUSD: Collateral not supported"
        );
        require(
            _collateralAmount > 0,
            "kfUSD: Collateral amount must be greater than zero"
        );

        // Transfer collateral from caller
        IERC20(_collateralToken).transferFrom(
            msg.sender,
            address(this),
            _collateralAmount
        );

        // Calculate fee
        uint256 fee = (_amount * mintFee) / BASIS_POINTS;
        uint256 mintAmount = _amount - fee;

        // Update collateral balances
        collateralBalances[_collateralToken] += _collateralAmount;
        totalMinted += _amount;

        // Split collateral: X% idle for redemptions, Y% deployed for yield
        uint256 toDeploy = (_collateralAmount * deploymentRatio) / BASIS_POINTS;
        uint256 toIdle = _collateralAmount - toDeploy;

        idleBalances[_collateralToken] += toIdle;
        deployedBalances[_collateralToken] += toDeploy;

        // Auto-deploy to vault if enabled
        if (
            autoDeploymentEnabled && vaultAddress != address(0) && toDeploy > 0
        ) {
            IERC20(_collateralToken).approve(vaultAddress, toDeploy);
            // Transfer to vault for automatic deployment
            IERC20(_collateralToken).transfer(vaultAddress, toDeploy);
        }

        // Track fees for yield distribution
        feeTreasury += fee;

        // Mint kfUSD to user (after fee deduction)
        _mint(_to, mintAmount);
        
        // Mint fee tokens to this contract (stored for later distribution)
        // These tokens will be transferred to YieldTreasury for distribution
        _mint(address(this), fee);
        
        // Automatically transfer fees to YieldTreasury if enabled
        if (autoTransferFees && yieldTreasury != address(0) && fee > 0) {
            // Approve YieldTreasury to spend the fee tokens (only once)
            // receiveYield() will do the actual transfer via safeTransferFrom
            if (!_yieldTreasuryApproved) {
                _approve(address(this), yieldTreasury, type(uint256).max);
                _yieldTreasuryApproved = true;
            }
            // Notify YieldTreasury of fee receipt (it will transfer tokens itself)
            try IYieldTreasury(yieldTreasury).receiveYield(address(this), fee, "kfUSD Mint Fees") {
                // Successfully sent to YieldTreasury
            } catch {
                // If YieldTreasury doesn't accept, fees remain in kfUSD contract
                // Admin can manually transfer later
            }
        }

        emit Minted(_to, mintAmount, _collateralToken, _collateralAmount);
        emit CollateralAdded(_collateralToken, _collateralAmount);
    }

    /**
     * @dev Redeem kfUSD tokens for a specific collateral asset
     * @param _amount Amount of kfUSD to redeem
     * @param _outputToken Address of the output collateral token
     */
    function redeem(
        uint256 _amount,
        address _outputToken
    ) external nonReentrant whenNotPaused {
        require(_amount > 0, "kfUSD: Amount must be greater than zero");
        // Minimum redemption to prevent rounding errors (0.001 kfUSD = 1e15)
        // This ensures at least 0.001 USDC can be returned (accounting for 6 decimal precision)
        require(
            _amount >= 1e15,
            "kfUSD: Amount below minimum redemption (0.001 kfUSD)"
        );
        require(
            supportedCollaterals[_outputToken],
            "kfUSD: Output token not supported"
        );
        require(
            balanceOf(msg.sender) >= _amount,
            "kfUSD: Insufficient balance"
        );
        require(
            collateralBalances[_outputToken] > 0,
            "kfUSD: No collateral available"
        );

        // Calculate fee
        uint256 fee = (_amount * redeemFee) / BASIS_POINTS;
        uint256 redeemAmount = _amount - fee;

        // Track fees for yield distribution
        feeTreasury += fee;
        
        // Mint fee tokens to this contract (stored for later distribution)
        // These tokens will be transferred to YieldTreasury for distribution
        _mint(address(this), fee);
        
        // Automatically transfer fees to YieldTreasury if enabled
        if (autoTransferFees && yieldTreasury != address(0) && fee > 0) {
            // Approve YieldTreasury to spend the fee tokens (only once)
            // receiveYield() will do the actual transfer via safeTransferFrom
            if (!_yieldTreasuryApproved) {
                _approve(address(this), yieldTreasury, type(uint256).max);
                _yieldTreasuryApproved = true;
            }
            // Notify YieldTreasury of fee receipt (it will transfer tokens itself)
            try IYieldTreasury(yieldTreasury).receiveYield(address(this), fee, "kfUSD Redeem Fees") {
                // Successfully sent to YieldTreasury
            } catch {
                // If YieldTreasury doesn't accept, fees remain in kfUSD contract
                // Admin can manually transfer later
            }
        }

        // Calculate collateral to return (1:1 ratio)
        // Improved decimal handling to prevent rounding errors
        uint256 kfUSDDecimals = decimals(); // 18
        uint256 collateralDecimals = IERC20Metadata(_outputToken).decimals();

        uint256 collateralToReturn;
        if (kfUSDDecimals >= collateralDecimals) {
            // kfUSD has more decimals (18) than collateral (6 for USDC/USDT)
            uint256 scale = 10 ** (kfUSDDecimals - collateralDecimals);
            collateralToReturn = redeemAmount / scale;
            // Ensure no rounding down causes loss
            require(
                collateralToReturn * scale <= redeemAmount,
                "kfUSD: Rounding error"
            );
        } else {
            // Collateral has more decimals (unlikely but handle it)
            uint256 scale = 10 ** (collateralDecimals - kfUSDDecimals);
            collateralToReturn = redeemAmount * scale;
        }

        require(collateralToReturn > 0, "kfUSD: Collateral amount too small");

        require(
            idleBalances[_outputToken] >= collateralToReturn,
            "kfUSD: Insufficient idle collateral available"
        );

        // Burn kfUSD
        _burn(msg.sender, _amount);

        // Update balances - use idle collateral first
        collateralBalances[_outputToken] -= collateralToReturn;
        idleBalances[_outputToken] -= collateralToReturn;
        totalRedeemed += _amount;

        // Transfer collateral to user
        IERC20(_outputToken).transfer(msg.sender, collateralToReturn);

        emit Redeemed(msg.sender, _amount, _outputToken, collateralToReturn);
        emit CollateralRemoved(_outputToken, collateralToReturn);
    }

    /**
     * @dev Add or remove collateral assets
     * @param _token Address of the token
     * @param _supported Whether the token is supported
     */
    function setCollateralSupport(
        address _token,
        bool _supported
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_token != address(0), "kfUSD: Cannot use zero address");

        bool isSupported = supportedCollaterals[_token];

        if (_supported && !isSupported) {
            supportedCollaterals[_token] = true;
            collateralList.push(_token);
        } else if (!_supported && isSupported) {
            supportedCollaterals[_token] = false;
            // Remove from array
            for (uint256 i = 0; i < collateralList.length; i++) {
                if (collateralList[i] == _token) {
                    collateralList[i] = collateralList[
                        collateralList.length - 1
                    ];
                    collateralList.pop();
                    break;
                }
            }
        }

        emit CollateralSupported(_token, _supported);
    }

    /**
     * @dev Set YieldTreasury contract address for yield distribution
     * @param _yieldTreasury Address of YieldTreasury contract
     */
    function setYieldTreasury(address _yieldTreasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_yieldTreasury != address(0), "kfUSD: Cannot set zero address");
        yieldTreasury = _yieldTreasury;
        _yieldTreasuryApproved = false; // Reset approval flag when treasury changes
        emit YieldTreasuryUpdated(_yieldTreasury);
    }

    /**
     * @dev Enable or disable automatic fee transfer to YieldTreasury
     * @param _enabled Whether to enable automatic fee transfer
     */
    function setAutoTransferFees(bool _enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        autoTransferFees = _enabled;
        emit AutoTransferFeesUpdated(_enabled);
    }

    /**
     * @dev Update mint and redeem fees
     * @param _mintFee New mint fee in basis points
     * @param _redeemFee New redeem fee in basis points
     */
    function setFees(
        uint256 _mintFee,
        uint256 _redeemFee
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_mintFee <= 300, "kfUSD: Mint fee cannot exceed 3%"); // Max 3% (300 basis points)
        require(_redeemFee <= 300, "kfUSD: Redeem fee cannot exceed 3%"); // Max 3% (300 basis points)

        mintFee = _mintFee;
        redeemFee = _redeemFee;

        emit FeesUpdated(_mintFee, _redeemFee);
    }

    /**
     * @dev Get total collateral value across all supported assets
     */
    function getTotalCollateralValue() public view returns (uint256) {
        uint256 total = 0;
        for (uint256 i = 0; i < collateralList.length; i++) {
            total += collateralBalances[collateralList[i]];
        }
        return total;
    }

    /**
     * @dev Get backing ratio (collateral / total supply)
     */
    function getBackingRatio() public view returns (uint256) {
        if (totalSupply() == 0) return 0;
        return (getTotalCollateralValue() * 1e18) / totalSupply();
    }

    /**
     * @dev Get list of all supported collaterals
     */
    function getSupportedCollaterals() public view returns (address[] memory) {
        return collateralList;
    }

    /**
     * @dev Transfer fee treasury to YieldTreasury for yield distribution
     * @param _amount Amount to transfer
     */
    function transferFeesToYieldTreasury(
        uint256 _amount
    ) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        require(yieldTreasury != address(0), "kfUSD: YieldTreasury not set");
        require(_amount > 0, "kfUSD: Amount must be greater than zero");
        require(feeTreasury >= _amount, "kfUSD: Insufficient fee treasury");
        
        // Check that contract has enough kfUSD tokens (minted during fee collection)
        uint256 contractBalance = balanceOf(address(this));
        require(contractBalance >= _amount, "kfUSD: Insufficient fee tokens in contract");

        feeTreasury -= _amount;

        // Transfer the kfUSD tokens to YieldTreasury
        _transfer(address(this), yieldTreasury, _amount);
        
        // Notify YieldTreasury
        try IYieldTreasury(yieldTreasury).receiveYield(address(this), _amount, "kfUSD Fees") {
            // Successfully sent to YieldTreasury
        } catch {
            // Revert if YieldTreasury doesn't accept
            revert("kfUSD: Failed to send to YieldTreasury");
        }
    }

    /**
     * @dev Get accumulated fee treasury
     */
    function getFeeTreasury() public view returns (uint256) {
        return feeTreasury;
    }

    /**
     * @dev Deploy collateral to yield sources (called by vault/strategy contract)
     * @param _token Collateral token address
     * @param _amount Amount to deploy
     */
    function deployCollateral(
        address _token,
        uint256 _amount
    ) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        require(supportedCollaterals[_token], "kfUSD: Token not supported");
        require(_amount > 0, "kfUSD: Amount must be greater than zero");
        require(
            deployedBalances[_token] >= _amount,
            "kfUSD: Insufficient deployed balance"
        );

        deployedBalances[_token] -= _amount;
        // Transfer to external yield source (implemented by strategy contract)
        IERC20(_token).transfer(msg.sender, _amount);
    }

    /**
     * @dev Withdraw collateral from yield sources
     * @param _token Collateral token address
     * @param _amount Amount to withdraw
     */
    function withdrawCollateral(
        address _token,
        uint256 _amount
    ) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        require(supportedCollaterals[_token], "kfUSD: Token not supported");
        require(_amount > 0, "kfUSD: Amount must be greater than zero");

        // Transfer from external yield source
        IERC20(_token).transferFrom(msg.sender, address(this), _amount);

        // Can go to either idle or deployed depending on strategy
        idleBalances[_token] += _amount;
    }

    /**
     * @dev Set deployment ratio (how much collateral to deploy)
     * @param _ratio New ratio in basis points (e.g., 5000 = 50%)
     */
    function setDeploymentRatio(
        uint256 _ratio
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_ratio <= BASIS_POINTS, "kfUSD: Ratio cannot exceed 100%");
        // Ensure minimum 10% idle collateral for redemptions
        require(
            _ratio <= BASIS_POINTS - 1000,
            "kfUSD: Must keep at least 10% idle for redemptions"
        );
        deploymentRatio = _ratio;
    }

    /**
     * @dev Get idle and deployed balances for a token
     */
    function getBalances(
        address _token
    ) public view returns (uint256 idle, uint256 deployed) {
        return (idleBalances[_token], deployedBalances[_token]);
    }

    /**
     * @dev Set vault address for automated deployment (legacy, auto-deployment disabled by default)
     */
    function setVaultAddress(
        address _vault
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_vault != address(0), "kfUSD: Invalid vault address");
        vaultAddress = _vault;
    }

    /**
     * @dev Enable/disable auto-deployment (disabled by default - manual management preferred)
     */
    function setAutoDeploymentEnabled(
        bool _enabled
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        autoDeploymentEnabled = _enabled;
    }

    /**
     * @dev Manually transfer collateral to vault (for manual deployment)
     * @param _vault Vault contract address
     * @param _token Collateral token address
     * @param _amount Amount to transfer
     */
    function transferCollateralToVault(
        address _vault,
        address _token,
        uint256 _amount
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_vault != address(0), "kfUSD: Invalid vault address");
        require(_token != address(0), "kfUSD: Invalid token address");
        require(_amount > 0, "kfUSD: Amount must be greater than zero");
        require(
            idleBalances[_token] >= _amount,
            "kfUSD: Insufficient idle balance"
        );

        // Remove from idle balances
        idleBalances[_token] -= _amount;
        // Add to deployed balances (tracking)
        deployedBalances[_token] += _amount;

        // Transfer to vault
        IERC20(_token).transfer(_vault, _amount);
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
