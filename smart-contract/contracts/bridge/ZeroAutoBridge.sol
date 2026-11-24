// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Minimal LayerZero V2 OFT interface for $ZRO bridging.
interface ILayerZeroOFT {
    struct SendParam {
        uint32 dstEid;
        bytes32 to;
        uint256 amountLD;
        uint256 minAmountLD;
        bytes extraOptions;
        bytes composeMsg;
        bytes oftCmd;
    }

    struct MessagingFee {
        uint256 nativeFee;
        uint256 lzTokenFee;
    }

    struct MessagingReceipt {
        bytes32 guid;
        uint64 nonce;
        MessagingFee fee;
    }

    struct OFTReceipt {
        uint256 amountSentLD;
        uint256 amountReceivedLD;
    }

    function quoteSend(
        SendParam calldata _sendParam,
        bool _payInLzToken
    ) external view returns (MessagingFee memory msgFee);

    function send(
        SendParam calldata _sendParam,
        MessagingFee calldata _fee,
        address _refundAddress
    ) external payable returns (MessagingReceipt memory msgReceipt, OFTReceipt memory oftReceipt);
}

/**
 * @title ZeroAutoBridge
 * @notice Ownerless, immutable, non-custodial auto-bridge queue for bridging $ZRO
 *         to LayerZero's Zero chain (dstEid = 33002).
 *
 * Security invariants:
 * - NO owner, NO admin keys, NO pause, NO upgradeability.
 * - User $ZRO NEVER sits in this contract: it remains in the user's own wallet
 *   until the instant a LayerZero route window opens and `execute` / `executeBatch` runs.
 * - Bridged $ZRO can ONLY be sent to `bytes32(uint256(uint160(user)))` on `dstEid`.
 *   Neither the keeper nor the fee recipient can redirect a user's principal.
 * - Users can call `cancel()` at any time to leave the queue and reclaim 100% of
 *   their native gas deposit immediately.
 * - Protocol fee (`feeBps`, immutable, <= 100 bps) is only taken upon successful bridge.
 */
contract ZeroAutoBridge is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant MAX_FEE_BPS = 100; // Hard cap: 1.00%
    uint256 public constant KEEPER_GAS_OVERHEAD = 65_000;

    IERC20 public immutable zro;
    uint32 public immutable dstEid;
    address public immutable feeRecipient;
    uint16 public immutable feeBps;

    struct Order {
        uint256 amount;        // Total $ZRO to pull from user (fee deducted from this)
        uint128 deposit;       // Native gas deposited by user for LZ fee + keeper gas
        uint128 maxNativeFee;  // Max LayerZero messaging nativeFee user accepts
        uint64 maxGasPrice;    // Max tx.gasprice user accepts for keeper execution
        uint40 validUntil;     // Order expiry timestamp (unix seconds)
        uint32 queuePos;       // 1-based position in `queue` array (0 = not enrolled)
    }

    mapping(address => Order) public orders;
    mapping(address => uint256) public refunds;
    address[] private queue;

    event Enrolled(
        address indexed user,
        uint256 amount,
        uint128 deposit,
        uint128 maxNativeFee,
        uint64 maxGasPrice,
        uint40 validUntil
    );
    event Cancelled(address indexed user, uint256 depositRefunded);
    event Executed(
        address indexed user,
        address indexed keeper,
        uint256 grossAmount,
        uint256 netAmount,
        uint256 feeAmount,
        uint256 lzNativeFee,
        uint256 keeperReimbursement,
        uint256 userRefund,
        bytes32 guid
    );
    event DirectBridged(
        address indexed user,
        uint256 grossAmount,
        uint256 netAmount,
        uint256 feeAmount,
        uint256 lzNativeFee,
        bytes32 guid
    );
    event RefundClaimed(address indexed user, uint256 amount);
    event BatchItemSkipped(address indexed user, bytes reason);

    error ZeroAddress();
    error FeeTooHigh();
    error InvalidAmount();
    error InvalidExpiry();
    error NotEnrolled();
    error OrderExpired();
    error GasPriceTooHigh();
    error NativeFeeTooHigh();
    error InsufficientDeposit();
    error NothingToClaim();
    error NativeTransferFailed();

    constructor(
        address _zro,
        uint32 _dstEid,
        address _feeRecipient,
        uint16 _feeBps
    ) {
        if (_zro == address(0) || _feeRecipient == address(0)) revert ZeroAddress();
        if (_feeBps > MAX_FEE_BPS) revert FeeTooHigh();
        zro = IERC20(_zro);
        dstEid = _dstEid;
        feeRecipient = _feeRecipient;
        feeBps = _feeBps;
    }

    /// @notice Returns the number of currently queued users.
    function queueLength() external view returns (uint256) {
        return queue.length;
    }

    /// @notice Returns whether a user currently has an active queued order.
    function isEnrolled(address user) external view returns (bool) {
        return orders[user].queuePos != 0;
    }

    /// @notice Paginated read of queued user addresses for off-chain keepers.
    function getQueue(uint256 offset, uint256 limit) external view returns (address[] memory out) {
        uint256 len = queue.length;
        if (offset >= len) return new address[](0);
        uint256 end = offset + limit;
        if (end > len) end = len;
        uint256 count = end - offset;
        out = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            out[i] = queue[offset + i];
        }
    }

    /// @notice Helper to build the strict self-addressed LayerZero OFT SendParam.
    function buildSendParam(
        address user,
        uint256 netAmount
    ) public view returns (ILayerZeroOFT.SendParam memory) {
        return ILayerZeroOFT.SendParam({
            dstEid: dstEid,
            to: bytes32(uint256(uint160(user))),
            amountLD: netAmount,
            minAmountLD: (netAmount * 995) / 1000,
            extraOptions: "",
            composeMsg: "",
            oftCmd: ""
        });
    }

    /// @notice Quotes the LayerZero native fee for bridging `grossAmount` for `user`.
    ///         Reverts if LayerZero's route to `dstEid` is currently closed.
    function quoteBridge(
        address user,
        uint256 grossAmount
    ) external view returns (uint256 nativeFee, uint256 netAmount, uint256 feeAmount) {
        feeAmount = (grossAmount * feeBps) / 10_000;
        netAmount = grossAmount - feeAmount;
        ILayerZeroOFT.SendParam memory sp = buildSendParam(user, netAmount);
        ILayerZeroOFT.MessagingFee memory mf = ILayerZeroOFT(address(zro)).quoteSend(sp, false);
        nativeFee = mf.nativeFee;
    }

    /**
     * @notice Direct one-shot bridge when the LayerZero route is OPEN.
     *         Pulls `amount` $ZRO from msg.sender, takes `feeBps`, and bridges
     *         the rest strictly to `msg.sender` on Zero (`dstEid`).
     */
    function bridgeDirect(uint256 amount) external payable nonReentrant {
        if (amount == 0) revert InvalidAmount();

        uint256 feeAmount = (amount * feeBps) / 10_000;
        uint256 netAmount = amount - feeAmount;
        if (netAmount == 0) revert InvalidAmount();

        ILayerZeroOFT.SendParam memory sp = buildSendParam(msg.sender, netAmount);
        ILayerZeroOFT.MessagingFee memory mf = ILayerZeroOFT(address(zro)).quoteSend(sp, false);
        if (msg.value < mf.nativeFee) revert InsufficientDeposit();

        zro.safeTransferFrom(msg.sender, address(this), amount);
        if (feeAmount > 0) {
            zro.safeTransfer(feeRecipient, feeAmount);
        }

        (ILayerZeroOFT.MessagingReceipt memory receipt, ) = ILayerZeroOFT(address(zro)).send{
            value: mf.nativeFee
        }(sp, mf, payable(msg.sender));

        uint256 excess = msg.value - mf.nativeFee;
        if (excess > 0) {
            _safeRefundNative(msg.sender, excess);
        }

        emit DirectBridged(msg.sender, amount, netAmount, feeAmount, mf.nativeFee, receipt.guid);
    }

    /**
     * @notice Enroll or update an auto-bridge order while the route is closed.
     *         Attach native ETH/BNB/POL/AVAX as `msg.value` to cover LayerZero's
     *         messaging fee + keeper gas reimbursement (unused deposit is refunded).
     */
    function enroll(
        uint256 amount,
        uint128 maxNativeFee,
        uint64 maxGasPrice,
        uint40 validUntil
    ) external payable nonReentrant {
        if (amount == 0) revert InvalidAmount();
        if (validUntil <= block.timestamp) revert InvalidExpiry();

        Order storage o = orders[msg.sender];
        uint256 newDeposit = uint256(o.deposit) + msg.value;
        if (newDeposit == 0 || newDeposit > type(uint128).max) revert InsufficientDeposit();

        if (o.queuePos == 0) {
            queue.push(msg.sender);
            o.queuePos = uint32(queue.length);
        }

        o.amount = amount;
        o.deposit = uint128(newDeposit);
        o.maxNativeFee = maxNativeFee;
        o.maxGasPrice = maxGasPrice;
        o.validUntil = validUntil;

        emit Enrolled(msg.sender, amount, uint128(newDeposit), maxNativeFee, maxGasPrice, validUntil);
    }

    /**
     * @notice Cancel your queued order at any time and reclaim 100% of your native deposit.
     */
    function cancel() external nonReentrant {
        Order storage o = orders[msg.sender];
        if (o.queuePos == 0) revert NotEnrolled();

        uint256 dep = o.deposit;
        _removeFromQueue(msg.sender, o.queuePos);
        delete orders[msg.sender];

        if (dep > 0) {
            _safeRefundNative(msg.sender, dep);
        }
        emit Cancelled(msg.sender, dep);
    }

    /**
     * @notice Pull fallback if a native refund transfer ever failed (e.g., smart contract wallet).
     */
    function withdrawRefund() external nonReentrant {
        uint256 amt = refunds[msg.sender];
        if (amt == 0) revert NothingToClaim();
        refunds[msg.sender] = 0;
        (bool ok, ) = payable(msg.sender).call{ value: amt }("");
        if (!ok) revert NativeTransferFailed();
        emit RefundClaimed(msg.sender, amt);
    }

    /**
     * @notice Permissionless single-user execution when the LayerZero route opens.
     */
    function execute(address user) external nonReentrant {
        _executeInternal(user, msg.sender);
    }

    /**
     * @notice Permissionless batch execution for keepers. Skips any individual user
     *         whose order expired, lacks allowance/balance, or exceeds caps, so one
     *         bad order never blocks the rest of the batch.
     */
    function executeBatch(address[] calldata users) external nonReentrant {
        uint256 len = users.length;
        for (uint256 i = 0; i < len; i++) {
            try this._executeSingleForBatch(users[i], msg.sender) {
                // succeeded
            } catch (bytes memory reason) {
                emit BatchItemSkipped(users[i], reason);
            }
        }
    }

    /// @dev Self-call entrypoint used strictly by `executeBatch` for per-item isolation.
    function _executeSingleForBatch(address user, address keeper) external {
        require(msg.sender == address(this), "only self");
        _executeInternal(user, keeper);
    }

    function _executeInternal(address user, address keeper) internal {
        uint256 gasStart = gasleft();

        Order memory o = orders[user];
        if (o.queuePos == 0) revert NotEnrolled();
        if (block.timestamp > o.validUntil) revert OrderExpired();
        if (o.maxGasPrice > 0 && tx.gasprice > o.maxGasPrice) revert GasPriceTooHigh();

        uint256 feeAmount = (o.amount * feeBps) / 10_000;
        uint256 netAmount = o.amount - feeAmount;
        if (netAmount == 0) revert InvalidAmount();

        ILayerZeroOFT.SendParam memory sp = buildSendParam(user, netAmount);
        ILayerZeroOFT.MessagingFee memory mf = ILayerZeroOFT(address(zro)).quoteSend(sp, false);

        if (o.maxNativeFee > 0 && mf.nativeFee > o.maxNativeFee) revert NativeFeeTooHigh();
        if (o.deposit < mf.nativeFee) revert InsufficientDeposit();

        // Effects: remove order before external calls
        _removeFromQueue(user, o.queuePos);
        delete orders[user];

        // Interactions: pull $ZRO from user and bridge strictly to `user` on Zero
        zro.safeTransferFrom(user, address(this), o.amount);
        if (feeAmount > 0) {
            zro.safeTransfer(feeRecipient, feeAmount);
        }

        (ILayerZeroOFT.MessagingReceipt memory receipt, ) = ILayerZeroOFT(address(zro)).send{
            value: mf.nativeFee
        }(sp, mf, payable(user));

        // Reimburse keeper for actual gas used (capped at remaining deposit)
        uint256 remaining = uint256(o.deposit) - mf.nativeFee;
        uint256 gasUsed = (gasStart - gasleft()) + KEEPER_GAS_OVERHEAD;
        uint256 keeperPay = gasUsed * tx.gasprice;
        if (keeperPay > remaining) {
            keeperPay = remaining;
        }
        uint256 userRefund = remaining - keeperPay;

        if (keeperPay > 0) {
            _safeRefundNative(keeper, keeperPay);
        }
        if (userRefund > 0) {
            _safeRefundNative(user, userRefund);
        }

        emit Executed(
            user,
            keeper,
            o.amount,
            netAmount,
            feeAmount,
            mf.nativeFee,
            keeperPay,
            userRefund,
            receipt.guid
        );
    }

    function _removeFromQueue(address user, uint32 pos1Based) internal {
        uint256 idx = uint256(pos1Based) - 1;
        uint256 lastIdx = queue.length - 1;
        if (idx != lastIdx) {
            address lastUser = queue[lastIdx];
            queue[idx] = lastUser;
            orders[lastUser].queuePos = pos1Based;
        }
        queue.pop();
        // Silence unused param warning if optimizer folds
        user;
    }

    function _safeRefundNative(address to, uint256 amount) internal {
        (bool ok, ) = payable(to).call{ value: amount }("");
        if (!ok) {
            refunds[to] += amount;
        }
    }
}
