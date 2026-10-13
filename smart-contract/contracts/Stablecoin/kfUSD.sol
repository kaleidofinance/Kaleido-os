// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IAggregatorV3} from "../interfaces/IAggregatorV3.sol";

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
    /* Every collateral movement below goes through SafeERC20, which YieldTreasury
     * in this same directory already used while this contract did not.
     *
     * The calls here were plain high-level ones with their return values
     * discarded, and that breaks in two directions against the exact three
     * tokens deploy-stablecoin.js registers as collateral:
     *
     *  - Tokens that return nothing. Ethereum's USDT declares `transfer` and
     *    `transferFrom` with no return value at all. solc must decode a bool from
     *    a zero-length returndata and reverts, so mint and redeem against real
     *    USDT did not merely skip a check — they could not execute.
     *  - Tokens that return false instead of reverting. The older convention, and
     *    one an admin can add via setCollateralSupport, which validates nothing
     *    beyond a non-zero address. `mint` would credit collateralBalances and
     *    mint kfUSD for collateral that never arrived; `redeem` would burn the
     *    user's kfUSD and pay out nothing. Both leave the peg claiming backing
     *    the contract does not hold.
     *
     * SafeERC20 handles both: it requires the call to succeed and accepts either
     * empty returndata or an explicit true, treating false as a revert.
     */
    using SafeERC20 for IERC20;

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    // Supported collateral assets
    mapping(address => bool) public supportedCollaterals;
    address[] public collateralList;

    // Mint and redemption fee (in basis points, 100 = 1%)
    //
    // 5 bps each, a 0.1% round trip. These were 30 bps each — 0.6% to enter and
    // leave, which is where the design went wrong: it charged for *access* to a
    // dollar-pegged token rather than for the yield the protocol actually
    // produces. No major stablecoin prices entry that way. Circle mints and
    // redeems USDC at par; DAI has no mint fee at all; Ethena's USDe mints at
    // par and takes its cut from the basis trade; Liquity charges a one-off
    // borrowing fee but pays 75% of interest back to depositors. A 0.6% round
    // trip is roughly a year of yield on a low-rate stablecoin, so a user who
    // minted and redeemed inside twelve months lost money by holding it — which
    // makes the toll a deterrent to the deposits the yield engine needs.
    //
    // Not zero: at zero, mint and redeem is a free round trip, and anything free
    // and unbounded is a griefing vector — an attacker can churn supply to move
    // accYieldPerShare's denominator, or simply burn the protocol's gas
    // subsidies. 5 bps is small enough to be noise against real usage and large
    // enough that a loop costs the looper something.
    //
    // Revenue now comes from YieldTreasury's performance fee on yield, which
    // only charges when the protocol has actually earned something. See
    // YieldTreasury.performanceFeeBps.
    uint256 public mintFee = 5; // 0.05%
    uint256 public redeemFee = 5; // 0.05%
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
    /*
     * ---- Pricing -----------------------------------------------------------
     *
     * Mint and redeem used to be a PAR swap: each collateral was scaled for its
     * decimals and nothing else — no price, no check — and the redeemer chose which
     * reserve to take. So with USDe at $0.90 and USDC at $1.00, 100 USDe minted
     * ~99.95 kfUSD, which redeemed for ~99.90 USDC: the depegged asset bought the
     * good one at par, repeatable while idle reserves lasted (disclosed 2026-09-23,
     * finding 3).
     *
     * Both legs are now valued at the collateral's USD price from a Chainlink-style
     * aggregator the admin names per collateral:
     *   - mint credits `collateral × price` of kfUSD, so a depegged asset buys only
     *     what it is worth;
     *   - redeem pays `kfUSD ÷ price` of the output asset, so what leaves is worth
     *     what was burned, whichever reserve is chosen.
     * kfUSD itself is taken as $1.
     *
     * Fail-closed: a collateral with no feed cannot be minted or redeemed; a stale,
     * non-positive or implausible (outside $0.50–$2.00) answer reverts. Feeds are
     * read directly, not through the lending oracle, so this contract stays
     * standalone.
     */
    uint256 public constant PRICE_FLOOR = 0.5e18;
    uint256 public constant PRICE_CEILING = 2e18;
    mapping(address => address) public collateralFeed;
    /// @dev 27h: fits a stablecoin feed that updates on a 24h heartbeat (Arc's
    ///      Chainlink stable feeds do), with slack — the bound the lending oracle uses.
    uint256 public maxFeedAge = 97200;

    event CollateralFeedSet(address indexed token, address indexed feed);
    event MaxFeedAgeSet(uint256 maxAge);

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
        _mintWithCollateral(_to, _amount, _collateralToken, _collateralAmount);
    }

    /**
     * @dev Permissionless mint: deposit collateral, receive kfUSD at par.
     *
     * The reason this exists beside the role-gated `mint` above, and the reason
     * `mint` cannot simply be opened up: `mint` takes the kfUSD amount and the
     * collateral amount as INDEPENDENT arguments and checks no relationship
     * between them. A caller who could set both would mint any amount of kfUSD
     * against one wei of collateral — so the `onlyRole(MINTER_ROLE)` on it is
     * load-bearing, not incidental, and it stays exactly as it was for the
     * scripts and integrations that pass an explicit pair.
     *
     * This entry point removes the free parameter instead of the guard. The
     * caller names only the collateral and how much of it; the kfUSD amount is
     * DERIVED here at par — one unit of collateral backs one kfUSD, scaled from
     * the collateral's own decimals to kfUSD's 18. That is the same 1:1 the mint
     * form has always quoted (useStablecoin.ts) and the same relationship the
     * backing ratio is measured against, so the peg it implies is one the
     * contract can actually honour on redeem. There is no amount a caller can
     * pass that mints kfUSD the collateral does not back, which is what makes it
     * safe to leave open.
     *
     * Decimals are read from the collateral token rather than passed in, so the
     * scaling cannot be spoofed by a caller and a collateral whose decimals
     * exceed 18 (none of the three registered ones do) reverts on the subtraction
     * rather than minting a distorted amount.
     */
    function mintWithCollateral(
        address _collateralToken,
        uint256 _collateralAmount
    ) external nonReentrant whenNotPaused {
        require(
            supportedCollaterals[_collateralToken],
            "kfUSD: Collateral not supported"
        );
        require(
            _collateralAmount > 0,
            "kfUSD: Collateral amount must be greater than zero"
        );

        // Worth what the collateral is worth at its oracle price, not at par.
        uint256 kfUsdAmount = _collateralValue(_collateralToken, _collateralAmount);

        _mintWithCollateral(
            msg.sender,
            kfUsdAmount,
            _collateralToken,
            _collateralAmount
        );
    }

    /**
     * @dev The shared mint body. Both entry points funnel here so the collateral
     * accounting, the fee split and the yield-treasury notification live in one
     * place and cannot drift between the permissioned and permissionless paths.
     * Collateral is always pulled from msg.sender, so the caller pays whether or
     * not `_to` is themselves.
     */
    function _mintWithCollateral(
        address _to,
        uint256 _amount,
        address _collateralToken,
        uint256 _collateralAmount
    ) internal {
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
        /* The permissioned `mint` names its own kfUSD amount. It may not exceed what
           the collateral is worth, so a minter's mistake (or a compromised minter
           key) cannot create unbacked kfUSD through this door either. */
        require(
            _amount <= _collateralValue(_collateralToken, _collateralAmount),
            "kfUSD: Mint exceeds collateral value"
        );

        // Transfer collateral from caller
        IERC20(_collateralToken).safeTransferFrom(
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
            /* Pushed, not pulled. The approve that used to sit here granted the
             * vault an allowance for the same amount transferred on the next
             * line, so nothing ever consumed it and every mint left a standing
             * allowance behind. It was also the third way this function could
             * revert on a token like USDT, whose `approve` returns no value
             * either. */
            IERC20(_collateralToken).safeTransfer(vaultAddress, toDeploy);
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

        // Collateral worth what was burned: kfUSD is $1, the output asset is
        // valued at its oracle price. Rounds down, in the protocol's favour.
        uint256 collateralToReturn = _collateralFor(_outputToken, redeemAmount);

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
        IERC20(_outputToken).safeTransfer(msg.sender, collateralToReturn);

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
        /* USD, 18 decimals. This used to add RAW balances — 6-decimal USDC with
           18-decimal USDe — which is neither dollars nor comparable to the
           18-decimal supply the backing ratio divides it by. A collateral with no
           usable price counts as ZERO: the figure understates backing rather than
           overstating it. */
        uint256 total = 0;
        for (uint256 i = 0; i < collateralList.length; i++) {
            address token = collateralList[i];
            uint256 bal = collateralBalances[token];
            if (bal == 0) continue;
            (bool ok, uint256 price) = _tryPrice(collateralFeed[token]);
            if (!ok) continue;
            uint8 d = IERC20Metadata(token).decimals();
            if (d > 18) continue;
            total += (bal * (10 ** (18 - d)) * price) / 1e18;
        }
        return total;
    }

    /**
     * @dev The USD value (18 decimals) of `_amount` of `_token` at its oracle price.
     */
    function _collateralValue(address _token, uint256 _amount) internal view returns (uint256) {
        uint8 d = IERC20Metadata(_token).decimals();
        require(d <= 18, "kfUSD: Collateral decimals too high");
        return (_amount * (10 ** (18 - d)) * _priceOf(_token)) / 1e18;
    }

    /**
     * @dev How much `_token` is worth `_kfusd` kfUSD (taken as $1), rounded down.
     */
    function _collateralFor(address _token, uint256 _kfusd) internal view returns (uint256 units) {
        uint8 d = IERC20Metadata(_token).decimals();
        require(d <= 18, "kfUSD: Collateral decimals too high");
        units = (_kfusd * 1e18) / _priceOf(_token) / (10 ** (18 - d));
    }

    function _priceOf(address _token) internal view returns (uint256) {
        address feed = collateralFeed[_token];
        require(feed != address(0), "kfUSD: No price feed for collateral");
        (bool ok, uint256 price) = _tryPrice(feed);
        require(ok, "kfUSD: Price feed stale or out of range");
        return price;
    }

    /**
     * @dev Read a feed without reverting. `ok` is false for no feed, a failing
     * feed, a non-positive or stale answer, or one outside [PRICE_FLOOR, PRICE_CEILING].
     */
    function _tryPrice(address feed) internal view returns (bool ok, uint256 price) {
        if (feed == address(0)) return (false, 0);
        try IAggregatorV3(feed).latestRoundData() returns (
            uint80,
            int256 answer,
            uint256,
            uint256 updatedAt,
            uint80
        ) {
            if (answer <= 0 || updatedAt == 0 || block.timestamp > updatedAt + maxFeedAge) return (false, 0);
            try IAggregatorV3(feed).decimals() returns (uint8 fd) {
                if (fd > 18) return (false, 0);
                uint256 p = uint256(answer) * (10 ** (18 - fd));
                if (p < PRICE_FLOOR || p > PRICE_CEILING) return (false, 0);
                return (true, p);
            } catch {
                return (false, 0);
            }
        } catch {
            return (false, 0);
        }
    }

    /**
     * @dev Name the USD price feed for a collateral (address(0) clears it, which
     * disables mint and redeem for that collateral). The feed is checked to answer
     * with a usable price now, so a wrong address fails here, not at a user's mint.
     */
    function setCollateralFeed(address _token, address _feed) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_token != address(0), "kfUSD: Cannot use zero address");
        if (_feed != address(0)) {
            (bool ok, ) = _tryPrice(_feed);
            require(ok, "kfUSD: Feed does not return a usable price");
        }
        collateralFeed[_token] = _feed;
        emit CollateralFeedSet(_token, _feed);
    }

    function setMaxFeedAge(uint256 _maxAge) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_maxAge >= 1 hours && _maxAge <= 3 days, "kfUSD: Feed age out of range");
        maxFeedAge = _maxAge;
        emit MaxFeedAgeSet(_maxAge);
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
        IERC20(_token).safeTransfer(msg.sender, _amount);
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
        IERC20(_token).safeTransferFrom(msg.sender, address(this), _amount);

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
        IERC20(_token).safeTransfer(_vault, _amount);
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
