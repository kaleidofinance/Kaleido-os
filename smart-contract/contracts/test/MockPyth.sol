// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

/**
 * @title MockPyth
 * @notice The three Pyth entry points PythPriceOracle actually touches, settable,
 *         for exercising `updatePrice`.
 *
 * @dev Deliberately not a full IPyth. The interface is large and this only has to
 *      stand in for `getUpdateFee`, `updatePriceFeeds` and `getPriceUnsafe`, which
 *      are the only three functions the oracle calls. Implementing the rest would
 *      be dead code that still has to be read.
 *
 *      It exists because `updatePrice` had no coverage at all and was changed in
 *      two ways that are invisible without a Pyth to call: the `onlyOwner` gate
 *      came off, and the caller's surplus is now refunded instead of being kept
 *      forever. Neither is provable against the real Pyth in a unit test — the
 *      updates are Wormhole-signed, so no test can mint a valid blob.
 *
 *      `feedMissing` reproduces the case that made the event read guarded rather
 *      than direct: `priceFeedId` is a separate argument from the update blob, so a
 *      caller can push a batch that does not contain it, and the real
 *      `getPriceUnsafe` reverts for a feed Pyth has never populated. Without this
 *      switch there is no way to show that a valid push survives an unreportable
 *      feed id.
 */
contract MockPyth {
    uint256 public fee;
    bool public feedMissing;

    /**
     * How many times this contract has been handed an update, and how large the
     * last batch was.
     *
     * @dev Counters rather than the blobs themselves: copying a `bytes[] calldata`
     *      into a `bytes[][]` storage array is an UnimplementedFeatureError in
     *      solc's non-IR code generator, and enabling viaIR for a mock to record
     *      data no assertion reads would be the wrong trade.
     */
    uint256 public pushCount;
    uint256 public lastBatchSize;
    /** Wei received across all `updatePriceFeeds` calls — the refund's counterpart. */
    uint256 public collected;

    int64 public price = 2400_00000000;
    uint64 public conf = 1_00000000;
    int32 public expo = -8;
    uint256 public publishTime;

    error PriceFeedNotFound();
    error InsufficientFee();

    constructor(uint256 fee_) {
        fee = fee_;
        publishTime = block.timestamp;
    }

    function getUpdateFee(bytes[] calldata updateData) external view returns (uint256) {
        /* Per-blob, like the real one, so a test can tell a fee that scales with
         * the batch from a flat one. */
        return fee * updateData.length;
    }

    function updatePriceFeeds(bytes[] calldata updateData) external payable {
        uint256 required = fee * updateData.length;
        if (msg.value < required) revert InsufficientFee();
        pushCount += 1;
        lastBatchSize = updateData.length;
        collected += msg.value;
        publishTime = block.timestamp;
    }

    function getPriceUnsafe(bytes32) external view returns (PythStructs.Price memory) {
        if (feedMissing) revert PriceFeedNotFound();
        return PythStructs.Price(price, conf, expo, publishTime);
    }

    function setFee(uint256 fee_) external {
        fee = fee_;
    }

    function setFeedMissing(bool feedMissing_) external {
        feedMissing = feedMissing_;
    }

    function setPrice(int64 price_, uint64 conf_, int32 expo_, uint256 publishTime_) external {
        price = price_;
        conf = conf_;
        expo = expo_;
        publishTime = publishTime_;
    }
}
