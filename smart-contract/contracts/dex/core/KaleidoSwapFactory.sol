// SPDX-License-Identifier: MIT
pragma solidity =0.6.12;

import '../interfaces/IKaleidoSwapFactory.sol';
import './KaleidoSwapPair.sol';

contract KaleidoSwapFactory is IKaleidoSwapFactory {
    address public override feeTo;
    address public override feeToSetter;

    /* Ceiling on a swap fee tier, in the pair's own units (denominator 10000),
     * so 1000 = 10%.
     *
     * Two numbers matter and they are not the same. The mathematical wall is
     * 10000: KaleidoSwapPair.swap computes
     * `balance0.mul(10000).sub(amount0In.mul(swapFee))`, and since
     * `balance0 = reserve0 + amount0In`, a swapFee above 10000 makes the
     * subtrahend exceed the minuend once the input is large relative to the
     * reserve — a bare SafeMath underflow revert, not a named error. At exactly
     * 10000 there is no underflow and the fee is simply 100%, which fails the K
     * check for any non-zero output. Either way the pair is permanently
     * unswappable, and because `swapFee` is only ever written in `initialize`
     * there is no way to repair one.
     *
     * 1000 is the policy ceiling, an order of magnitude below the wall, chosen
     * to match how this repo bounds every other fee an admin controls
     * (Constants.MAX_PROTOCOL_FEE_BPS, MAX_LIQUIDATION_PENALTY_BPS). 10% is
     * already far outside anything a real pair should charge — the enabled tiers
     * are 0.05%, 0.3% and 1% — so this is a bound on how wrong the configuration
     * may be, not a target.
     */
    uint32 public constant MAX_SWAP_FEE = 1000;

    /* Enabled fee tiers. `createPair` is permissionless, as in Uniswap V2, but
     * V2 has no fee parameter to abuse: its 0.3% is a compile-time constant.
     * This factory took a caller-supplied `fee` and kept V2's permissionless
     * creation, and those two together were the bug — `getPair` holds one slot
     * per unordered token pair, `swapFee` is written once in
     * KaleidoSwapPair.initialize and never again, and there is no admin path to
     * change it. So the first caller to create KLD/USDC chose its fee forever,
     * and could choose one that makes the pair unusable. Nobody else could
     * create a competing pair (PAIR_EXISTS) and no owner could fix it; the
     * router and library both read `pair.swapFee()` when quoting
     * (KaleidoSwapRouter:376, KaleidoSwapLibrary:41), so a griefed pair poisons
     * every quote for that token pair too.
     *
     * An allowlist keeps the V2 property worth keeping — anyone may list any
     * pair — and drops the one that was never intended, that they also get to
     * price it. This is Uniswap V3's arrangement (`enableFeeAmount`, owner-only,
     * with permissionless pool creation at any enabled tier), and this repo
     * already ships that V3 factory, so it is the local convention rather than
     * an import.
     */
    mapping(uint32 => bool) public override isFeeEnabled;

    mapping(address => mapping(address => address)) public override getPair;
    address[] public override allPairs;

    event PairCreated(address indexed token0, address indexed token1, address pair, uint);
    event FeeEnabled(uint32 fee);

    constructor(address _feeToSetter) public {
        feeToSetter = _feeToSetter;
        /* Seeded here rather than left to a post-deploy call, because
         * KaleidoSwapRouter._addLiquidity creates missing pairs itself at 5 or
         * 30 depending on its `stable` flag. An empty allowlist would make every
         * first-time addLiquidity revert, so the two tiers the router can ask
         * for have to exist from the moment the factory does. 100 (1%) is seeded
         * alongside them to match the third tier the UI offers.
         */
        isFeeEnabled[5] = true; // 0.05% — stable pairs
        isFeeEnabled[30] = true; // 0.30% — the V2 default, most pairs
        isFeeEnabled[100] = true; // 1.00% — exotic pairs
        emit FeeEnabled(5);
        emit FeeEnabled(30);
        emit FeeEnabled(100);
    }

    function allPairsLength() external view override returns (uint) {
        return allPairs.length;
    }

    /// @notice Bless a new swap fee tier. Existing pairs are unaffected — this
    ///         only widens what `createPair` will accept from here on.
    /// @dev There is deliberately no way to disable a tier: pairs already
    ///      created at it would keep working while new ones could not be made,
    ///      which is a confusing state to be able to reach and buys nothing that
    ///      simply not enabling the tier does not.
    function enableFeeAmount(uint32 fee) external override {
        require(msg.sender == feeToSetter, 'KaleidoSwap: FORBIDDEN');
        require(fee > 0, 'KaleidoSwap: ZERO_FEE');
        require(fee <= MAX_SWAP_FEE, 'KaleidoSwap: FEE_TOO_HIGH');
        isFeeEnabled[fee] = true;
        emit FeeEnabled(fee);
    }

    function createPair(address tokenA, address tokenB, uint32 fee) external override returns (address pair) {
        require(tokenA != tokenB, 'KaleidoSwap: IDENTICAL_ADDRESSES');
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(token0 != address(0), 'KaleidoSwap: ZERO_ADDRESS');
        require(getPair[token0][token1] == address(0), 'KaleidoSwap: PAIR_EXISTS'); // single check is sufficient
        require(isFeeEnabled[fee], 'KaleidoSwap: FEE_NOT_ENABLED');
        bytes32 salt = keccak256(abi.encodePacked(token0, token1));
        pair = address(new KaleidoSwapPair{salt: salt}());
        IKaleidoSwapPair(pair).initialize(token0, token1, fee);
        getPair[token0][token1] = pair;
        getPair[token1][token0] = pair; // populate mapping in the reverse direction
        allPairs.push(pair);
        emit PairCreated(token0, token1, pair, allPairs.length);
    }

    function setFeeTo(address _feeTo) external override {
        require(msg.sender == feeToSetter, 'KaleidoSwap: FORBIDDEN');
        feeTo = _feeTo;
    }

    function setFeeToSetter(address _feeToSetter) external override {
        require(msg.sender == feeToSetter, 'KaleidoSwap: FORBIDDEN');
        feeToSetter = _feeToSetter;
    }
}
