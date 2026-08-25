// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title IAggregatorV3
 * @notice The read surface shared by Chainlink price feeds, API3 dAPI reader
 *         proxies, and the `PushablePriceFeed` we publish ourselves.
 *
 * @dev Declared here rather than imported from the chainlink/contracts npm
 *      package on purpose. That package pulls era-contracts over git+ssh, and
 *      dropping it (together with the two matterlabs/hardhat-zksync plugins) is
 *      what left this install with zero git dependencies and no SSH
 *      requirement. The interface is three functions and is not going to
 *      change; taking a git dependency to obtain it would be a poor trade.
 *
 *      Chainlink is what Sepolia and BSC Testnet read. On Robinhood Testnet no
 *      third party publishes a feed, so the implementer there is our own
 *      `PushablePriceFeed`. API3 was the near miss: its `Api3ReaderProxyV1`
 *      implements Chainlink's `AggregatorV2V3Interface` — measured, not assumed,
 *      on Robinhood's not-yet-activated ETH/USD proxy
 *      (`0xe201212b76f0C82FBf5ff17D8Ee009C9d4e9C597`), where `decimals()`
 *      returned 18 and `description()` answered while only `latestRoundData()`
 *      and API3's own `read()` reverted, for want of data not of the function.
 *      Activating it needs a purchased plan that then expires on a 24h heartbeat,
 *      so we publish our own instead; why, and what it costs, is in
 *      `PushablePriceFeed`. So one adapter reads Chainlink on Sepolia and BSC
 *      Testnet and our own feed on Robinhood, and `IPyth` covers Base Sepolia and
 *      Arc. Two code paths, five chains.
 *
 *      `decimals()` is the reason the adapter can be configured before a feed
 *      carries data, and the reason it must never be assumed: Chainlink answers
 *      8 and API3 answers 18. See AggregatorPriceOracle.
 *
 *      Deliberately omitted: `latestAnswer()`, `latestTimestamp()`,
 *      `getAnswer()` and `getTimestamp()` from the V2 half of
 *      `AggregatorV2V3Interface`. `latestAnswer()` returns a price with no
 *      timestamp beside it, which makes a staleness check impossible at the
 *      point of use — it is deprecated upstream for exactly that reason, and a
 *      protocol that liquidates on these numbers has no business reading it.
 *      `getRoundData()` is omitted because nothing here needs history.
 */
interface IAggregatorV3 {
    /// @notice Decimal places in the value returned by `latestRoundData`.
    /// @dev Chainlink feeds answer 8; API3 reader proxies answer 18.
    function decimals() external view returns (uint8);

    /// @notice Human-readable pair label, e.g. "ETH / USD".
    /// @dev Used only to make a misconfigured feed obvious in deploy logs.
    ///      API3 proxies also expose `dapiName()`, which is not in this
    ///      interface because Chainlink has no equivalent.
    function description() external view returns (string memory);

    /**
     * @notice The most recent completed round.
     * @return roundId Identifier of the round the answer belongs to.
     * @return answer The price, carrying `decimals()` decimal places.
     * @return startedAt When the round opened. Unused here.
     * @return updatedAt When the answer was written. This is the freshness
     *         timestamp — zero means the round never completed.
     * @return answeredInRound Round the answer was actually computed in. Less
     *         than `roundId` means the feed carried a stale answer forward.
     */
    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );
}
