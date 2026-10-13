// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
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
    /* See the note in kfUSD.sol. The same two failure modes applied here, and
     * `lockAssets` makes one of them reachable without any role: it is external
     * and open to anyone, so against a supported asset whose `transferFrom`
     * returns false rather than reverting, the caller received kafUSD 1:1 for
     * assets that never left their wallet. `completeWithdrawal` failed the other
     * way, burning the caller's kafUSD and clearing their lock balance before a
     * transfer that could quietly not happen. Both are the same one-word fix. */
    using SafeERC20 for IERC20;

    bytes32 public constant VAULT_ROLE = keccak256("VAULT_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    // kfUSD token address
    IERC20 public kfusd;

    // Supported lock assets
    mapping(address => bool) public supportedAssets;
    address[] public assetList;

    /// @dev Every asset that has EVER been supported, never shrunk. `assetList`
    ///      drops an asset when it is un-supported, but a lock held in it is still
    ///      a claim, and the transfer hook below has to carry that claim with the
    ///      token — so it walks this list, not `assetList`.
    address[] private _everSupported;
    mapping(address => bool) private _wasSupported;

    uint256 public constant BASIS_POINTS = 10000;

    // Lock and withdraw tracking
    mapping(address => uint256) public lockBalances; // Total kfUSD locked
    mapping(address => mapping(address => uint256)) public assetLockBalances; // Asset balances locked
    mapping(address => uint256) public lockTimestamps; // When user locked assets to track yield accrual

    // Cooldown period for withdrawal (7 days)
    uint256 public cooldownPeriod = 7 days;
    mapping(address => uint256) public withdrawalRequestTime;
    mapping(address => uint256) public withdrawalAmount;
    // The asset a pending request will pay out in, chosen when the request is
    // made rather than when it completes. requestWithdrawal is asset-agnostic no
    // longer: a request is a claim on one asset's locked balance, so it names the
    // asset up front and completeWithdrawal must be handed the same one.
    mapping(address => address) public withdrawalAsset;

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
        IERC20(_asset).safeTransferFrom(msg.sender, address(this), _amount);

        /* kafUSD is an 18-decimal DOLLAR receipt: one kafUSD is one dollar of
         * whatever was locked, whatever that asset's own decimals are.
         *
         * It used to mint one kafUSD per RAW unit — 1e6 for a dollar of 6-decimal
         * USDC, 1e18 for a dollar of 18-decimal kfUSD. YieldTreasury divides each
         * yield deposit by the kafUSD total supply, so a USDC locker held a
         * trillionth of the shares of a kfUSD locker for the same dollar and earned
         * a trillionth of the yield (disclosed 2026-09-23, finding 1). Scaling to a
         * common 18-decimal dollar here puts every locker on one scale.
         *
         * Par is assumed, as it is for every asset the admin lists: this contract
         * lists dollar stablecoins and a locker redeems the SAME asset it locked
         * (see the transfer hook), so a depeg moves no principal between assets —
         * it can only skew the yield share, which is what a listing decision is for. */
        uint256 kafusdToMint = _amount * _scaleOf(_asset);

        // Update balances and lock timestamp
        if (_asset == address(kfusd)) {
            lockBalances[msg.sender] += _amount;
            totalLocked += _amount;
        }
        assetLockBalances[msg.sender][_asset] += _amount;
        totalAssetsLocked += kafusdToMint;

        // Always update lock timestamp to current time when locking assets
        // This ensures yield is calculated from the most recent lock time
        lockTimestamps[msg.sender] = block.timestamp;

        // Mint kafUSD
        _mint(msg.sender, kafusdToMint);

        emit AssetsLocked(msg.sender, _asset, _amount, kafusdToMint);
    }

    /**
     * @dev Request withdrawal of a specific locked asset.
     *
     * The asset is named here, not at completion, for two reasons that were both
     * bugs in the earlier asset-agnostic version:
     *
     *  - It lets the locked balance be checked NOW. A request that exceeds what
     *    the caller has locked in _asset used to succeed and then revert a full
     *    cooldown later at completeWithdrawal — a week's notice spent queuing a
     *    withdrawal that could never complete. Here it reverts immediately.
     *  - It makes the request an unambiguous claim on one asset, so
     *    completeWithdrawal cannot be pointed at a different, cheaper asset than
     *    the one the request was sized against.
     *
     * A pending request is NOT overwritten. The single request slot per address
     * used to be reassigned unconditionally, silently discarding however much of
     * the notice had already elapsed; now a second request reverts and the caller
     * must cancelWithdrawal first, which is explicit about restarting the clock.
     *
     * @param _asset Asset to withdraw (must be one this caller has locked)
     * @param _amount Amount of kafUSD to burn (18-decimal dollars). The asset paid
     *        out is `_amount` divided by the asset's scale — for a 6-decimal asset
     *        a whole number of its smallest units, so `_amount` must be a multiple
     *        of 1e12.
     */
    function requestWithdrawal(
        address _asset,
        uint256 _amount
    ) external nonReentrant whenNotPaused {
        require(_amount > 0, "kafUSD: Amount must be greater than zero");
        require(supportedAssets[_asset], "kafUSD: Asset not supported");
        require(
            withdrawalAmount[msg.sender] == 0,
            "kafUSD: Withdrawal already pending"
        );
        require(
            balanceOf(msg.sender) >= _amount,
            "kafUSD: Insufficient balance"
        );
        uint256 assetsToUnlock = _assetsFor(_asset, _amount);
        require(
            assetLockBalances[msg.sender][_asset] >= assetsToUnlock,
            "kafUSD: Insufficient locked balance"
        );

        withdrawalRequestTime[msg.sender] = block.timestamp;
        withdrawalAmount[msg.sender] = _amount;
        withdrawalAsset[msg.sender] = _asset;

        emit WithdrawalRequested(
            msg.sender,
            _amount,
            block.timestamp + cooldownPeriod
        );
    }

    /**
     * @dev Cancel a pending withdrawal request, freeing the slot and stopping the
     * clock. Nothing was locked or burned by requestWithdrawal, so this only
     * clears the record — it exists so a caller who requested the wrong amount or
     * asset can correct it without waiting out a cooldown for a request they will
     * not complete.
     */
    function cancelWithdrawal() external {
        require(
            withdrawalAmount[msg.sender] > 0,
            "kafUSD: No withdrawal request"
        );
        withdrawalRequestTime[msg.sender] = 0;
        withdrawalAmount[msg.sender] = 0;
        withdrawalAsset[msg.sender] = address(0);
    }

    /**
     * @dev Complete withdrawal after cooldown period.
     *
     * Pays out in the asset named at request time — the caller no longer chooses
     * it here. Letting the payout asset be picked at completion is what allowed a
     * request sized against one asset to be settled from another; the asset is
     * now fixed when the request is made and read back from storage.
     */
    function completeWithdrawal() external nonReentrant whenNotPaused {
        require(
            withdrawalAmount[msg.sender] > 0,
            "kafUSD: No withdrawal request"
        );
        require(
            block.timestamp >=
                withdrawalRequestTime[msg.sender] + cooldownPeriod,
            "kafUSD: Cooldown not complete"
        );

        address _asset = withdrawalAsset[msg.sender];
        uint256 amountToUnlock = withdrawalAmount[msg.sender];

        // Clear withdrawal request
        withdrawalRequestTime[msg.sender] = 0;
        withdrawalAmount[msg.sender] = 0;
        withdrawalAsset[msg.sender] = address(0);

        // The asset units behind this much kafUSD (whole units, checked at request)
        uint256 assetsToUnlock = _assetsFor(_asset, amountToUnlock);

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
        totalAssetsLocked -= amountToUnlock;

        // Burn kafUSD
        _burn(msg.sender, amountToUnlock);

        // Transfer assets to user
        // Note: Yield is now handled by YieldTreasury contract
        // Users should claim yield separately from YieldTreasury
        IERC20(_asset).safeTransfer(msg.sender, assetsToUnlock);

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
            /* A listing must be scalable: refuse an asset whose decimals this
               contract cannot express in an 18-decimal dollar. */
            require(
                IERC20Metadata(_asset).decimals() <= 18,
                "kafUSD: Asset decimals too high"
            );
            supportedAssets[_asset] = true;
            assetList.push(_asset);
            if (!_wasSupported[_asset]) {
                _wasSupported[_asset] = true;
                _everSupported.push(_asset);
            }
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

    /**
     * @dev Scale from an asset's own units to kafUSD's 18-decimal dollars.
     */
    function _scaleOf(address _asset) internal view returns (uint256) {
        uint8 d = IERC20Metadata(_asset).decimals();
        require(d <= 18, "kafUSD: Asset decimals too high");
        return 10 ** (18 - d);
    }

    /**
     * @dev The asset units behind `_kafusd` dollars of kafUSD, which must be a
     * whole number of them — a request that is not would burn the remainder for
     * nothing.
     */
    function _assetsFor(address _asset, uint256 _kafusd) internal view returns (uint256 units) {
        uint256 scale = _scaleOf(_asset);
        units = _kafusd / scale;
        require(units > 0, "kafUSD: Amount too small for this asset");
        require(units * scale == _kafusd, "kafUSD: Amount is not a whole number of asset units");
    }

    /**
     * @dev kafUSD is the claim on what was locked, so the claim moves with it.
     *
     * `requestWithdrawal` needs both the kafUSD balance AND the original
     * `assetLockBalances` entry, and a transfer used to move only the token. After
     * any transfer the sender had no kafUSD and the receiver had no lock, so both
     * reverted for ever and the principal sat in this contract with no way out
     * (disclosed 2026-09-23, finding 2).
     *
     * A transfer now carries the sender's locks across in proportion to the share
     * of their balance it moves: send 40% of your kafUSD and 40% of EACH asset you
     * locked goes with it. That keeps what a holder can redeem equal to what they
     * hold — and never lets a transfer turn a claim on one asset into a claim on
     * another, so there is no swap here to price.
     *
     * A move that empties the sender takes every last unit (no rounding dust left
     * behind); a partial move rounds down, which can leave the receiver one asset
     * unit short of redeeming their balance to the last wei.
     *
     * Mints and burns have no counterparty to carry a claim from or to, so they
     * are left alone. A pending withdrawal's kafUSD may not be moved away, or the
     * request it belongs to could never complete.
     */
    function _update(
        address from,
        address to,
        uint256 value
    ) internal override(ERC20, ERC20Pausable) {
        if (from != address(0) && to != address(0) && from != to && value > 0) {
            uint256 bal = balanceOf(from);
            if (value <= bal) {
                require(
                    bal - value >= withdrawalAmount[from],
                    "kafUSD: Amount is reserved by a pending withdrawal"
                );
                _moveLocks(from, to, value, bal);
            }
        }
        super._update(from, to, value);
    }

    function _moveLocks(address from, address to, uint256 value, uint256 bal) private {
        uint256 n = _everSupported.length;
        for (uint256 i = 0; i < n; i++) {
            address asset = _everSupported[i];
            uint256 locked = assetLockBalances[from][asset];
            if (locked == 0) continue;
            uint256 moved = value == bal ? locked : (locked * value) / bal;
            if (moved == 0) continue;
            assetLockBalances[from][asset] = locked - moved;
            assetLockBalances[to][asset] += moved;
            if (asset == address(kfusd)) {
                lockBalances[from] -= moved;
                lockBalances[to] += moved;
            }
        }
    }

    function pause() public onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() public onlyRole(PAUSER_ROLE) {
        _unpause();
    }
}
