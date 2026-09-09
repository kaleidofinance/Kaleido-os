// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @dev The V3 periphery is pinned to 0.7.6, so `ISwapRouter` cannot be imported
 *      here. Only the one entry point this contract needs is declared, and the
 *      struct is copied field for field: a reordering would not fail to compile,
 *      it would encode calldata the router decodes as a different swap.
 */
interface IKaleidoSwapV3RouterLike {
    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    function exactInput(
        ExactInputParams calldata params
    ) external payable returns (uint256 amountOut);
}

/**
 * @title KaleidoOrders
 * @notice Conditional spot orders — a limit order and a recurring buy are the
 *         same object here — settled against Kaleido's own pools by whoever
 *         submits them.
 *
 * @dev WHY A SIGNED ORDER AND NOT A DELEGATED AGENT
 *
 * The thing a limit order has to do is execute while its maker is asleep, so
 * someone other than the maker sends the transaction. There are two ways to
 * authorise that: hand an agent standing authority over the maker's funds, or
 * have the maker sign the exact terms and let anyone submit them. This is the
 * second, and the difference is not stylistic — under signed terms a filler
 * that is late, offline, or actively hostile can only fail to fill. It can
 * never fill badly, because {fill} routes the swap with the maker's own signed
 * `minOut` as the router's `amountOutMin` and sends the output directly to the
 * maker. Nothing here can move a maker's funds except into a swap they priced
 * themselves. The diamond's AgentPermissionFacet is the other mechanism, and it
 * is the right one for actions whose size cannot be known until the moment they
 * run — repaying exactly enough to hold a health factor. A trade is not one of
 * those: its terms are knowable in advance, so they get signed.
 *
 * WHY THERE IS NO PRICE FEED IN HERE
 *
 * A price trigger looks like it needs an oracle to notice the price, and it does
 * not. `minOut` *is* the trigger: below the maker's price the router reverts on
 * its own output check, and at or above it the fill succeeds. The pool is the
 * only reference, which is what makes this deployable on the pair the product
 * actually leads with — KLD is carried by no price feed on any chain we are on,
 * so an oracle-triggered design could not quote the one market it exists to
 * serve.
 *
 * WHY V3 AND NOT V2
 *
 * Both venues are deployed on all five chains, and the liquidity is all in V3 —
 * on Sepolia the V2 factory has never created a pair, while the V3 KLD/USDC 0.3%
 * pool holds the reserves the chart on /trade/limit is drawing. A limit order
 * settled against the other venue would be quoting a price no one else trades
 * at: unfillable where the pool is empty, and where it was not, filling at a
 * number the user never saw. So the venue here is the one the rest of /trade
 * quotes, and the path is V3's packed `token || fee || token` encoding.
 *
 * WHAT A FILLER CAN STILL TAKE
 *
 * The path is supplied per fill rather than signed, so a filler may route
 * through whichever pools and fee tiers it likes as long as the ends match the
 * signed pair. That is deliberate — it lets a better route be found later than
 * signing time, and the maker is protected by the floor either way. It does mean
 * a filler can choose a poor route and keep the difference between what the maker
 * signed and what the market would have paid. The floor is therefore the price
 * the maker wants, not a loose bound to get filled at all costs.
 *
 * WHY `minOut` MAY NOT BE ZERO
 *
 * A zero floor is an order that says "sell this at whatever you like", and the
 * filler chooses the pool state it executes against — it can move the price
 * first, fill, and move it back. So {_shapeValid} refuses it. The visible
 * consequence is that "buy $50 of KLD every week at market" is not expressible
 * here: a recurring order still has to name the worst price it will accept.
 * That is a real restriction and it is the honest one, because the alternative
 * needs a TWAP or an oracle to bound the fill, and neither exists for these
 * pairs. "Every week, but never above this price" is a rule a maker can check;
 * "every week at market" would be a rule only the filler could check.
 */
contract KaleidoOrders is EIP712, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /**
     * @notice One conditional order. Signed once by the maker, then submittable
     *         by anyone until it expires, fills out, or is cancelled.
     *
     * @dev `interval` and `maxFills` are what separate the two products. A limit
     *      order is `maxFills = 1, interval = 0`. A recurring buy is
     *      `maxFills = n, interval = 1 weeks`. Nothing else about them differs,
     *      which is why there is one struct and one code path.
     *
     * @param maker Whose funds move, whose signature authorises it, and who
     *        receives the output. Not a signed third-party recipient: an order
     *        that can pay someone else is a phishing signature, and no flow
     *        here needs one.
     * @param tokenIn Sold, per fill.
     * @param tokenOut Bought, per fill.
     * @param amountIn Sold per fill, not in total. A recurring order spends
     *        this much on each of its `maxFills` fills.
     * @param minOut Worst output the maker accepts per fill. The price bound and
     *        the trigger; see the note on the contract.
     * @param startAt Earliest fill. Zero means immediately.
     * @param expiry Last second at which a fill is allowed. This is what the
     *        "expires in" control on the trade form resolves to.
     * @param interval Seconds a fill must wait after the previous one. Ignored
     *        on the first fill, so a recurring order can start the moment it is
     *        signed.
     * @param maxFills Total fills allowed over the order's life.
     * @param epoch The maker's epoch at signing time. {cancelAll} bumps it and
     *        invalidates every order signed under the old one.
     * @param salt Makes two otherwise identical orders distinct, so signing the
     *        same trade twice does not collide into one filled slot.
     */
    struct Order {
        address maker;
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minOut;
        uint64 startAt;
        uint64 expiry;
        uint32 interval;
        uint32 maxFills;
        uint64 epoch;
        uint256 salt;
    }

    /// @dev Must mirror {Order} field for field, in order. A mismatch does not
    ///      fail to compile — it produces a digest the wallet will not have
    ///      signed, so every fill reverts on the signature check.
    bytes32 private constant ORDER_TYPEHASH =
        keccak256(
            "Order(address maker,address tokenIn,address tokenOut,uint256 amountIn,uint256 minOut,uint64 startAt,uint64 expiry,uint32 interval,uint32 maxFills,uint64 epoch,uint256 salt)"
        );

    struct OrderState {
        uint32 fills;
        uint64 lastFillAt;
        bool cancelled;
    }

    uint16 public constant BPS = 10_000;

    /// @dev Hard ceiling on {fillerFeeBps}. The fee is taken out of the maker's
    ///      input, so the owner must not be able to set it somewhere that makes
    ///      an order the maker already signed materially worse than the trade
    ///      they agreed to.
    uint16 public constant MAX_FILLER_FEE_BPS = 100;

    IKaleidoSwapV3RouterLike public immutable router;

    mapping(bytes32 orderHash => OrderState) private _state;

    /// @notice Current epoch per maker. Every order carries the epoch it was
    ///         signed under, and only the current one is fillable.
    mapping(address maker => uint64 epoch) public epochOf;

    /**
     * @notice Share of a fill's input paid to whoever submitted it, in BPS.
     *
     * @dev Paid to `msg.sender`, not to the protocol, because it exists to cover
     *      the filler's gas — that is what makes submitting an order something
     *      anyone can do rather than a service only we run. Zero while we run
     *      the only filler and absorb that gas ourselves; read on every fill so
     *      raising it later needs no redeploy.
     */
    uint16 public fillerFeeBps;

    event OrderFilled(
        bytes32 indexed orderHash,
        address indexed maker,
        address indexed filler,
        uint256 amountIn,
        uint256 amountOut,
        uint32 fillNumber
    );
    event OrderCancelled(bytes32 indexed orderHash, address indexed maker);
    event MakerEpochBumped(address indexed maker, uint64 epoch);
    event FillerFeeSet(uint16 bps);

    error KaleidoOrders_BadOrder();
    error KaleidoOrders_BadSignature();
    error KaleidoOrders_BadPath();
    error KaleidoOrders_Cancelled();
    error KaleidoOrders_NotStarted();
    error KaleidoOrders_Expired();
    error KaleidoOrders_NoFillsLeft();
    error KaleidoOrders_TooSoon();
    error KaleidoOrders_StaleEpoch();
    error KaleidoOrders_NotMaker();
    error KaleidoOrders_FeeTooHigh();

    constructor(
        address _router,
        address _owner
    ) EIP712("Kaleido Orders", "1") Ownable(_owner) {
        if (_router == address(0)) revert KaleidoOrders_BadOrder();
        router = IKaleidoSwapV3RouterLike(_router);
    }

    /// @notice The EIP-712 digest a maker signs. The frontend must derive the
    ///         same value from the domain, so it is exposed rather than internal.
    function hashOrder(Order calldata o) public view returns (bytes32) {
        return _hashTypedDataV4(_structHash(o));
    }

    /// @notice Fills so far, last fill time, and whether the maker killed it.
    function stateOf(Order calldata o) external view returns (OrderState memory) {
        return _state[hashOrder(o)];
    }

    /**
     * @notice Earliest second the next fill is allowed, or 0 when there is none
     *         left to wait for.
     * @dev Cadence runs from the last fill rather than from `startAt` plus a
     *      multiple of the interval. Drift accumulates when a fill lands late,
     *      and that is the intended reading of "every week": a maker who missed
     *      Friday wants one buy next week, not two back to back the moment a
     *      filler catches up.
     */
    function nextFillAt(Order calldata o) external view returns (uint64) {
        OrderState memory st = _state[hashOrder(o)];
        if (st.cancelled || st.fills >= o.maxFills) return 0;
        if (st.fills == 0) return o.startAt;
        return st.lastFillAt + o.interval;
    }

    /**
     * @notice Every reason a fill can be refused that this contract can see —
     *         and nothing about the price.
     *
     * @dev For the keeper and the order list, so neither has to send a
     *      transaction to learn that an order is cancelled, early, expired or
     *      spent. `ok == true` means the *terms* permit a fill right now; whether
     *      the market pays the maker's floor is a separate question and this
     *      cannot answer it while staying a `view`. V3 quotes by simulating a
     *      swap and reverting — `IQuoter` says so itself — so a quote writes
     *      state inside the call frame and is unreachable from a `view` function
     *      at all.
     *
     *      Not a gap. Every caller that needs the price condition needs a live
     *      quote for its own reasons anyway (the keeper to decide, the order list
     *      to show how far away a fill is), so the comparison belongs where the
     *      quote already is. Getting it wrong there costs that caller gas on a
     *      reverted fill and costs the maker nothing, because the floor is
     *      enforced by the router against `minOut` no matter who decided to try.
     *      Quote `swapInputFor(o.amountIn)` rather than `o.amountIn`.
     */
    function checkFill(
        Order calldata o,
        bytes calldata signature,
        bytes calldata path
    ) external view returns (bool ok, string memory reason) {
        if (!_shapeValid(o)) return (false, "malformed order");
        if (o.epoch != epochOf[o.maker]) return (false, "cancelled by the maker");

        OrderState memory st = _state[hashOrder(o)];
        if (st.cancelled) return (false, "cancelled");
        if (block.timestamp < o.startAt) return (false, "not started");
        if (block.timestamp > o.expiry) return (false, "expired");
        if (st.fills >= o.maxFills) return (false, "fully filled");
        if (st.fills > 0 && block.timestamp < st.lastFillAt + o.interval) {
            return (false, "waiting for the next interval");
        }
        if (!_pathValid(o, path)) return (false, "path does not match the pair");
        if (!_validSignature(o.maker, hashOrder(o), signature)) {
            return (false, "signature does not match the maker");
        }
        return (true, "");
    }

    /**
     * @notice Executes one fill of a signed order. Callable by anyone.
     *
     * @param o The signed order.
     * @param signature The maker's EIP-712 signature over {hashOrder}. An EOA
     *        key and a contract wallet answering ERC-1271 are both accepted; see
     *        {_validSignature} for why the second is not optional.
     * @param path V3 route to swap along, packed `token || fee || token || ...`.
     *        Its ends must be the signed pair; the hops and fee tiers in between
     *        are the filler's choice.
     * @return amountOut What the maker received.
     */
    function fill(
        Order calldata o,
        bytes calldata signature,
        bytes calldata path
    ) external nonReentrant returns (uint256 amountOut) {
        bytes32 h = hashOrder(o);

        /* Checks and effects in one call, interactions in the next. Split for
           the stack — eleven signed fields, a state struct and the swap's five
           arguments do not fit in one frame — but the seam is put exactly on the
           checks-effects-interactions boundary rather than anywhere cheaper, so
           the ordering the safety of this depends on is structural instead of
           being a property of how the statements happen to be arranged. */
        uint32 fillNumber = _consume(o, h, signature, path);
        amountOut = _settle(o, path);

        emit OrderFilled(h, o.maker, msg.sender, o.amountIn, amountOut, fillNumber);
    }

    /**
     * @dev Every reason a fill can be refused, then the one state change that
     *      records it happening. Returns which fill this is.
     *
     *      The slot is spent before {_settle} runs, so a token or pair that
     *      calls back in cannot re-enter against the pre-fill state — the guard
     *      on {fill} already refuses that, and this makes the refusal true of
     *      storage as well as of the call. A revert in {_settle} rolls this back
     *      with everything else, so a fill that cannot execute does not burn a
     *      slot.
     */
    function _consume(
        Order calldata o,
        bytes32 h,
        bytes calldata signature,
        bytes calldata path
    ) private returns (uint32 fillNumber) {
        if (!_shapeValid(o)) revert KaleidoOrders_BadOrder();
        if (o.epoch != epochOf[o.maker]) revert KaleidoOrders_StaleEpoch();

        OrderState storage st = _state[h];

        if (st.cancelled) revert KaleidoOrders_Cancelled();
        if (block.timestamp < o.startAt) revert KaleidoOrders_NotStarted();
        if (block.timestamp > o.expiry) revert KaleidoOrders_Expired();

        uint32 fills = st.fills;
        if (fills >= o.maxFills) revert KaleidoOrders_NoFillsLeft();
        if (fills > 0 && block.timestamp < st.lastFillAt + o.interval) {
            revert KaleidoOrders_TooSoon();
        }
        if (!_pathValid(o, path)) revert KaleidoOrders_BadPath();
        if (!_validSignature(o.maker, h, signature)) {
            revert KaleidoOrders_BadSignature();
        }

        fillNumber = fills + 1;
        st.fills = fillNumber;
        st.lastFillAt = uint64(block.timestamp);
    }

    /// @dev The interactions half of a fill: pay the filler, swap the rest.
    function _settle(
        Order calldata o,
        bytes calldata path
    ) private returns (uint256 amountOut) {
        uint256 swapIn = swapInputFor(o.amountIn);
        uint256 fee = o.amountIn - swapIn;

        IERC20(o.tokenIn).safeTransferFrom(o.maker, address(this), o.amountIn);
        if (fee > 0) IERC20(o.tokenIn).safeTransfer(msg.sender, fee);

        /* Approved for exactly this swap, and the router pulls all of it, so no
           standing allowance is left behind for the next caller of this pair. */
        IERC20(o.tokenIn).forceApprove(address(router), swapIn);

        /* `o.minOut` against the reduced input, and the output sent straight to
           the maker. Both matter: the maker cannot receive less than the floor
           they signed even though the fee came out of the input first, and the
           proceeds never sit in this contract where a later caller could reach
           them. */
        amountOut = router.exactInput(
            IKaleidoSwapV3RouterLike.ExactInputParams({
                path: path,
                recipient: o.maker,
                deadline: block.timestamp,
                amountIn: swapIn,
                amountOutMinimum: o.minOut
            })
        );
    }

    /**
     * @notice Kills one order, on-chain.
     *
     * @dev Takes the order rather than its hash because the hash alone does not
     *      say who may cancel it. Cancellation has to land here and not in the
     *      off-chain order store: a row deleted from a database is still a valid
     *      signature, and any filler holding a copy could fill it afterwards.
     */
    function cancel(Order calldata o) external {
        if (msg.sender != o.maker) revert KaleidoOrders_NotMaker();
        bytes32 h = hashOrder(o);
        _state[h].cancelled = true;
        emit OrderCancelled(h, o.maker);
    }

    /**
     * @notice Invalidates every order the caller has ever signed.
     *
     * @dev The panic button, and deliberately as unconditional as
     *      AgentPermissionFacet.revokeAgentPermission — one write, no arguments,
     *      nothing that can make it fail. Orders are signed off-chain, so a
     *      maker cannot enumerate what is outstanding to cancel it one by one,
     *      and a leaked signature has no expiry short of the one it carries.
     */
    function cancelAll() external {
        uint64 next = epochOf[msg.sender] + 1;
        epochOf[msg.sender] = next;
        emit MakerEpochBumped(msg.sender, next);
    }

    /// @notice Sets the filler's share of a fill's input, in BPS.
    function setFillerFeeBps(uint16 _bps) external onlyOwner {
        if (_bps > MAX_FILLER_FEE_BPS) revert KaleidoOrders_FeeTooHigh();
        fillerFeeBps = _bps;
        emit FillerFeeSet(_bps);
    }

    /**
     * @dev True when `signature` authorises `digest` for `maker`, whether the
     *      maker is a key or a contract.
     *
     *      ERC-1271 is not optional here. The wallets this app puts in front of
     *      people are mostly not plain keys — the in-app email/social wallet and
     *      any smart account sign by having a contract vouch for the digest — so
     *      an `ecrecover`-only check would refuse orders from most of the user
     *      base while looking correct against a test that signs with a private
     *      key. Both routes are tried rather than dispatching on `code.length`,
     *      because an EIP-7702 account is a key that also has code, and dispatch
     *      would send it down the wrong one.
     *
     *      Written out instead of using OpenZeppelin's SignatureChecker: that
     *      pulls in ERC-7913 support, whose `Bytes` helper needs MCOPY and so
     *      needs a Cancun target. Compiling this file for Cancun would mean
     *      shipping MCOPY in the bytecode to five chains including an Orbit
     *      rollup, to gain a verifier path nothing here uses.
     */
    function _validSignature(
        address maker,
        bytes32 digest,
        bytes calldata signature
    ) private view returns (bool) {
        (address recovered, ECDSA.RecoverError err, ) = ECDSA.tryRecover(
            digest,
            signature
        );
        if (err == ECDSA.RecoverError.NoError && recovered == maker) return true;

        if (maker.code.length == 0) return false;

        /* Low-level because a maker that is a contract without `isValidSignature`
           must read as an invalid signature, not as a reverting fill. */
        (bool okCall, bytes memory ret) = maker.staticcall(
            abi.encodeCall(IERC1271.isValidSignature, (digest, signature))
        );
        return
            okCall &&
            ret.length >= 32 &&
            abi.decode(ret, (bytes32)) ==
            bytes32(IERC1271.isValidSignature.selector);
    }

    /**
     * @notice What a fill of `amountIn` actually swaps, after the filler's fee.
     *
     * @dev Exposed because an off-chain quote has to price the same number
     *      {_settle} swaps, and {fillerFeeBps} can differ between the block a
     *      quote was taken in and the block a fill lands in. A quote taken on the
     *      full `amountIn` overstates the output by the fee, which near the floor
     *      is exactly the difference between "fillable" and a reverted fill.
     */
    function swapInputFor(uint256 amountIn) public view returns (uint256) {
        return amountIn - _fee(amountIn);
    }

    function _fee(uint256 amountIn) private view returns (uint256) {
        uint16 bps = fillerFeeBps;
        if (bps == 0) return 0;
        return (amountIn * bps) / BPS;
    }

    /**
     * @dev Encoded in two halves and concatenated. Every field is a static
     *      32-byte value, so this is byte-identical to encoding all eleven at
     *      once — which does not compile, because one `abi.encode` of the whole
     *      struct plus the typehash runs the stack out.
     */
    function _structHash(Order calldata o) private pure returns (bytes32) {
        return
            keccak256(
                bytes.concat(
                    abi.encode(
                        ORDER_TYPEHASH,
                        o.maker,
                        o.tokenIn,
                        o.tokenOut,
                        o.amountIn,
                        o.minOut
                    ),
                    abi.encode(
                        o.startAt,
                        o.expiry,
                        o.interval,
                        o.maxFills,
                        o.epoch,
                        o.salt
                    )
                )
            );
    }

    /**
     * @dev Everything checkable about an order without touching storage.
     *
     *      `minOut == 0` is refused for the reason given on the contract. The
     *      `maxFills > 1` case requires an interval because without one every
     *      fill is immediately due, and a recurring order would empty its whole
     *      budget into a single block — which is not a schedule, and not what a
     *      maker choosing "weekly" agreed to.
     */
    function _shapeValid(Order calldata o) private pure returns (bool) {
        if (o.maker == address(0)) return false;
        if (o.tokenIn == address(0) || o.tokenOut == address(0)) return false;
        if (o.tokenIn == o.tokenOut) return false;
        if (o.amountIn == 0 || o.minOut == 0) return false;
        if (o.maxFills == 0) return false;
        if (o.expiry <= o.startAt) return false;
        if (o.maxFills > 1 && o.interval == 0) return false;
        return true;
    }

    /**
     * @dev A V3 path is `token (20) || fee (3) || token (20) || ...`, so a valid
     *      one is 20 + 23·hops bytes and at least 43. Only the ends are checked,
     *      for the reason on the contract: the hops and fee tiers between them are
     *      the filler's choice and the floor is what protects the maker. The ends
     *      are not optional though — without them a filler could route the maker's
     *      input into a token they never asked for, and `minOut` would be measured
     *      in whatever units that token happens to have.
     */
    function _pathValid(
        Order calldata o,
        bytes calldata path
    ) private pure returns (bool) {
        if (path.length < 43 || (path.length - 20) % 23 != 0) return false;
        if (address(bytes20(path[:20])) != o.tokenIn) return false;
        return address(bytes20(path[path.length - 20:])) == o.tokenOut;
    }
}
