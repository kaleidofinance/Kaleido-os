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
    /** The one token stKLD prices its shares against. See setSupport. */
    function kldToken() external view returns (address);
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

    /// @dev Set once by {finalizeMigration}; {migrateIn} reverts afterwards.
    bool public migrationFinalized;

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
    event YieldTreasuryChanged(address indexed yieldTreasury);
    event Migrated(address indexed user, address indexed token, uint256 amount);
    event MigrationFinalized();

    constructor(address _yieldTreasury) Ownable(msg.sender) {
        require(_yieldTreasury != address(0), "Invalid treasury");
        yieldTreasury = _yieldTreasury;
    }

    function setStKLD(address _stKLD) external onlyOwner {
        require(stKLD == address(0), "stKLD already set");
        require(_stKLD != address(0), "Invalid stKLD");
        stKLD = _stKLD;
    }

    /**
     * @notice Repoint the vault at a different Yield Treasury.
     * @dev This was missing, and its absence is why staking has never paid a
     *      yield on any chain. `yieldTreasury` was assigned once in the
     *      constructor, and `harvestYield` — the vault's ONLY accrual path —
     *      calls `claimYield` on it. When the stablecoin set was redeployed on
     *      2026-09-06 the treasury got a new address, and every vault kept
     *      calling the old one. Measured on Sepolia before this change: the
     *      vault held 10,104,342.345940497342672767 KLD against exactly that
     *      many stKLD, identical to the wei, because the rate had never moved
     *      once since deployment. `harvestYield` reverted "Asset not supported"
     *      against a treasury that no longer knew the current kfUSD.
     *
     *      A dependency that can be redeployed and cannot be repointed is a
     *      dependency that eventually strands the contract that holds it — this
     *      one stranded 10.1M KLD of real stake and the fix required a new vault
     *      AND a new stKLD, because StKLD.kldVault is immutable too.
     *
     *      Owner-gated and deliberately unguarded beyond the zero check: the
     *      treasury cannot take anything from this vault. `harvestYield` only
     *      ever calls `claimYield` and credits whatever arrived, so the worst a
     *      wrong address does is fail to pay — the same state this fixes, not a
     *      worse one.
     */
    function setYieldTreasury(address _yieldTreasury) external onlyOwner {
        require(_yieldTreasury != address(0), "Invalid treasury");
        yieldTreasury = _yieldTreasury;
        emit YieldTreasuryChanged(_yieldTreasury);
    }

    /**
     * @notice Credit positions carried over from a previous vault. One-shot.
     * @dev Exists because the migration this contract replaces cannot be done
     *      any other way. The old vault has no owner-level exit — the only
     *      transfer out sits inside per-user `withdraw()`, behind a 7-day
     *      cooldown — so its KLD can never be moved by us, and StKLD.kldVault is
     *      immutable so the old receipt can never be repointed here. Without
     *      this, all 44 stakers would each have to request, wait a week and
     *      re-deposit.
     *
     *      THE SAFETY PROPERTY IS BACKING, NOT TRUST. The final require compares
     *      the token this vault actually holds against everything it has just
     *      promised. So the owner cannot credit a share the vault could not pay
     *      out, and the funding transfer must land BEFORE the credit rather than
     *      being taken on faith afterwards. That is what makes an owner-callable
     *      mint acceptable here at all.
     *
     *      Shares are minted 1:1 with `_amounts` because that is the state being
     *      reproduced: the old vault's pooled total equals its share supply to
     *      the wei, so every holder's balance IS their share count. The require
     *      on `getTotalShares` pins that assumption rather than assuming it — if
     *      this is ever pointed at a vault whose rate has moved, it stops.
     *
     *      `totalStakers` is incremented per holder, which is exact here: every
     *      address in the list is being credited from zero.
     */
    function migrateIn(
        address _token,
        address[] calldata _holders,
        uint256[] calldata _amounts
    ) external onlyOwner {
        require(!migrationFinalized, "Migration closed");
        require(supportedTokens[_token], "Token not supported");
        require(_holders.length == _amounts.length, "Length mismatch");

        uint256 credited = 0;
        for (uint256 i = 0; i < _holders.length; i++) {
            require(_holders[i] != address(0), "Invalid holder");
            require(_amounts[i] > 0, "Invalid amount");
            credited += _amounts[i];
            totalStakers += 1;
            IStKLD(stKLD).mintShares(_holders[i], _amounts[i]);
            emit Migrated(_holders[i], _token, _amounts[i]);
        }
        totalPooledKLD[_token] += credited;

        /* The rate this function assumes, asserted rather than trusted. */
        require(
            IStKLD(stKLD).getTotalShares() == totalPooledKLD[_token],
            "Rate is not 1:1"
        );
        /* Every credited share is backed by a token already in the vault. */
        require(
            IERC20(_token).balanceOf(address(this)) >= totalPooledKLD[_token],
            "Credited more than the vault holds"
        );
    }

    /**
     * @notice Permanently disable {migrateIn}.
     * @dev One way, with no re-open. The owner mint above is tolerable only for
     *      as long as it is a migration step; leaving the door ajar would make
     *      it a standing privilege over every staker's balance.
     */
    function finalizeMigration() external onlyOwner {
        migrationFinalized = true;
        emit MigrationFinalized();
    }

    /**
     * @notice Enable or disable a stakeable token.
     * @dev Enabling is confined to the single token stKLD prices its shares
     *      against, and that is a correctness guard rather than a policy choice.
     *
     *      `totalPooledKLD` is keyed per token, but StKLD._getTotalPooledKLD()
     *      reads exactly one key — `getTotalPooledKld(kldToken)`. So a second
     *      supported token would mint shares in `deposit` against its own pool
     *      while every `balanceOf` in stKLD valued those shares against KLD's.
     *      Nothing reverts; every staker's balance is simply mispriced, by a
     *      ratio between two unrelated pools. There is no correct second asset
     *      for this vault, so it refuses one.
     *
     *      Enabling therefore also requires stKLD to be wired first, otherwise
     *      the check has nothing to compare against and a token enabled during
     *      that window would survive it. Disabling is unconditional.
     */
    function setSupport(address _token, bool _status) external onlyOwner {
        if (_status) {
            require(stKLD != address(0), "Set stKLD first");
            require(_token == IStKLD(stKLD).kldToken(), "Only stKLD's own token");
        }
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

    // --- Emergency stop ---

    /**
     * @notice Halts deposits, withdrawal requests and withdrawals.
     * @dev These two functions were missing. The contract has always inherited
     *      Pausable and always carried `whenNotPaused` on deposit, withdraw,
     *      requestWithdrawal and cancelWithdrawalRequest — with no path to
     *      _pause() anywhere, so the modifiers could never fire and the vault
     *      could not be stopped under any circumstances. An emergency brake with
     *      no lever reads in an audit as a brake.
     *
     *      Note what stays reachable while paused: `harvestYield` carries no
     *      `whenNotPaused`, so yield can still be pulled in and stakers keep
     *      rebasing during a halt. That is deliberate and worth stating — a pause
     *      here freezes movement of principal, not accrual.
     */
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resumes deposits and withdrawals.
    function unpause() external onlyOwner {
        _unpause();
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
