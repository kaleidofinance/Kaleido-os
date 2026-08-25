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

    /**
     * @notice When this asset first delivered yield. Zero until it has.
     * @dev Exists so a *measured* yield rate can be quoted. totalYieldPerAsset is
     *      a cumulative amount, and an amount with no window is not a rate — a
     *      consumer holding only that number cannot annualise it, which is how the
     *      earn page ended up advertising a hardcoded floor instead. With this,
     *      the trailing rate is
     *          (totalYieldPerAsset / kafUSD supply) * (365 days / elapsed)
     *      Set once, on the first receipt, and never updated: it marks the start of
     *      the accrual window, so moving it would silently rebase the denominator
     *      of every rate computed from it.
     */
    mapping(address => uint256) public firstYieldTimestamp;

    /**
     * @notice Protocol's cut of yield, in basis points, taken as it arrives.
     * @dev 1000 = 10%, which is exactly Lido's fee on staking rewards and sits
     *      inside Aave's 10-20% reserve factor on borrower interest. This is the
     *      protocol's revenue from the stablecoin, and it replaces the 30 bps
     *      mint and redeem tolls kfUSD used to charge (now 5 bps each).
     *
     *      A fee on yield is the shape every major protocol converged on, for a
     *      reason that is not aesthetic: it can only ever charge a user who has
     *      already been paid. An entry toll is charged against principal, so it
     *      is a guaranteed loss the depositor must out-earn before breaking even;
     *      a performance fee is a share of a gain that has already happened, so
     *      the protocol cannot make money while its depositors lose it. That
     *      alignment is the point.
     *
     *      Taken off the top in `receiveYield`, before `accYieldPerShare` moves,
     *      so users' index is only ever credited with net yield. Charging it on
     *      the way out instead would mean every claim path had to remember to
     *      apply it — `claimYield`, `claimAllYield` and `claimAndCompound` are
     *      three separate withdrawal routes, and a fee that has to be repeated
     *      three times is a fee that will eventually be missed in one of them.
     *      `receiveYield` is the single chokepoint through which all yield
     *      enters, whatever the source.
     */
    uint256 public performanceFeeBps = 1000;

    /**
     * @notice Ceiling on performanceFeeBps: 20%.
     * @dev Above Lido's 10% and Aave's usual 10-20%, below Morpho Blue's 25%
     *      MAX_FEE. The cap matters because this fee is applied to yield in
     *      flight, before depositors have any claim on it, so an unbounded value
     *      would let the owner divert the entire yield stream in one transaction
     *      and leave the index flat while `totalYieldPerAsset` still climbed.
     */
    uint256 public constant MAX_PERFORMANCE_FEE_BPS = 2000;

    /**
     * @notice Where the performance fee is sent. Zero disables the fee.
     * @dev Zero means "distribute everything to depositors", not "revert" and
     *      not "send to address(0)". The direction of that default is deliberate:
     *      an unconfigured recipient must never be able to destroy yield that
     *      depositors have already earned, and it must never be able to block
     *      distribution either. Erring toward the depositors is the only choice
     *      here that cannot lose someone else's money.
     *
     *      This contrasts with the lending fee, where an unset vault reverts —
     *      there the loan is already outstanding and silently waiving the fee
     *      would be the wrong failure. Here nothing is owed yet.
     */
    address public protocolFeeRecipient;

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
    /// @dev `gross` and `fee` are both emitted so the effective rate is
    ///      auditable from logs alone, without replaying storage.
    event PerformanceFeeCharged(
        address indexed asset,
        uint256 gross,
        uint256 fee,
        address indexed recipient
    );
    event PerformanceFeeUpdated(uint256 bps);
    event ProtocolFeeRecipientUpdated(address indexed recipient);

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
     *
     * @dev The protocol's performance fee is taken here, off the gross amount,
     *      before any of it reaches `accYieldPerShare`. This is the only place
     *      yield enters the contract, which is why the fee belongs here rather
     *      than on the three separate claim paths.
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

        /*
         * Protocol fee, computed here but not paid until the end.
         *
         * Only the arithmetic happens at this point; the transfer is the last
         * thing the function does, after every storage write. Checks-effects-
         * interactions: `protocolFeeRecipient` is an address an admin chose, so
         * it can be a contract with a hook, and a transfer placed here would hand
         * control to it while `accYieldPerShare` still held its pre-receipt value
         * and the tokens were already in the contract. `nonReentrant` blocks the
         * obvious re-entry, but ordering the writes first means the window does
         * not exist to begin with rather than being closed by a modifier.
         *
         * Gross is pulled in once and the fee pushed out once, rather than two
         * safeTransferFrom calls: a source that approved exactly `_amount` would
         * have nothing left for a second pull. kfUSD happens to grant unlimited
         * approval, but any future yield source approving the exact figure is the
         * normal, careful pattern and must keep working.
         *
         * Everything below accounts `net`, never `_amount`. That keeps
         * yieldBalancePerAsset equal to the tokens actually held for depositors —
         * if it counted the gross, claimAllYield would compute a per-user
         * entitlement the contract could not pay, and the last claimant in the
         * loop would be the one whose transfer reverted.
         *
         * Integer division rounds the fee down, so the remainder goes to
         * depositors. With the fee capped at 20%, net is non-zero for every
         * _amount that got past the require above.
         */
        uint256 fee = 0;
        if (protocolFeeRecipient != address(0) && performanceFeeBps > 0) {
            fee = (_amount * performanceFeeBps) / 10000;
        }
        uint256 net = _amount - fee;

        // Update AYPS Index (SCONE Protection: Order-Independent Distribution)
        accYieldPerShare[_asset] += (net * PRECISION) / totalKafUSDSupply;

        // Update yield tracking
        //
        // Net, deliberately. `totalYieldPerAsset` is the numerator the frontend
        // annualises — useStablecoin.ts reads it together with
        // firstYieldTimestamp and computes
        //     (cumulative / kafUSD supply) * (1 year / elapsed)
        // so if it carried the gross figure the earn page would advertise a rate
        // no depositor could ever realise, overstated by exactly the protocol's
        // own fee. Net here means that number is the rate that is actually paid,
        // with no adjustment needed on the client.
        totalYieldPerAsset[_asset] += net;
        yieldBalancePerAsset[_asset] += net;

        // Opens the accrual window this asset's yield rate is measured over.
        if (firstYieldTimestamp[_asset] == 0) {
            firstYieldTimestamp[_asset] = block.timestamp;
        }

        /*
         * Source attribution stays gross. `totalContributed` answers "how much
         * did this source produce", which is a question about the source, not
         * about what depositors received — netting it would understate every
         * strategy's performance by exactly the protocol's own fee.
         */
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

        /* Net, not gross: this is what depositors can actually claim. A consumer
         * reconstructing balances from logs alone must agree with storage, and
         * PerformanceFeeCharged carries the gross and the fee separately for
         * anyone who needs to audit the split. */
        emit YieldReceived(_asset, net, msg.sender, _sourceName);

        /* The only external call after the writes. See the fee comment above. */
        if (fee > 0) {
            IERC20(_asset).safeTransfer(protocolFeeRecipient, fee);
            emit PerformanceFeeCharged(_asset, _amount, fee, protocolFeeRecipient);
        }
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
     * @dev Set the protocol's cut of incoming yield
     * @param _bps Fee in basis points; 1000 is 10% of yield
     * @dev Zero is permitted here, unlike the lending fee — it means "waive the
     *      fee", and waiving a share of a gain nobody has claimed yet harms no
     *      one. Bounded by MAX_PERFORMANCE_FEE_BPS because the fee is applied to
     *      yield in flight; without a bound the owner could route the entire
     *      yield stream to the fee recipient and leave depositors' index flat.
     *
     *      Only affects yield received after this call. Past receipts have
     *      already moved accYieldPerShare and are not recomputed, so a fee
     *      change can never retroactively claw back or top up a claim.
     */
    function setPerformanceFee(uint256 _bps) external onlyRole(ADMIN_ROLE) {
        require(
            _bps <= MAX_PERFORMANCE_FEE_BPS,
            "YieldTreasury: Fee exceeds maximum"
        );
        performanceFeeBps = _bps;
        emit PerformanceFeeUpdated(_bps);
    }

    /**
     * @dev Set where the performance fee is sent
     * @param _recipient Fee recipient; the zero address disables the fee
     * @dev Zero is deliberately accepted as the off switch rather than rejected.
     *      `receiveYield` skips the fee entirely when this is unset, so an
     *      unconfigured treasury distributes 100% to depositors instead of
     *      burning their yield to address(0) or blocking distribution outright.
     *      Should be the same multisig as the lending fee vault
     *      (KALEIDO_FEE_VAULT) so protocol revenue lands in one place.
     */
    function setProtocolFeeRecipient(
        address _recipient
    ) external onlyRole(ADMIN_ROLE) {
        protocolFeeRecipient = _recipient;
        emit ProtocolFeeRecipientUpdated(_recipient);
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

