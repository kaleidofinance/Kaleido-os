// SPDX-License-Identifier: MIT
pragma solidity >=0.5.0;

interface IKaleidoSwapFactory {
    event PairCreated(address indexed token0, address indexed token1, address pair, uint);
    event FeeEnabled(uint32 fee);

    function feeTo() external view returns (address);

    function feeToSetter() external view returns (address);

    /// @notice Whether `createPair` will accept this swap fee tier, in the
    ///         pair's own units (denominator 10000, so 30 = 0.3%).
    function isFeeEnabled(uint32 fee) external view returns (bool);

    function getPair(address tokenA, address tokenB) external view returns (address pair);

    function allPairs(uint) external view returns (address pair);

    function allPairsLength() external view returns (uint);

    function createPair(address tokenA, address tokenB, uint32 fee) external returns (address pair);

    function enableFeeAmount(uint32 fee) external;

    function setFeeTo(address) external;

    function setFeeToSetter(address) external;
}
