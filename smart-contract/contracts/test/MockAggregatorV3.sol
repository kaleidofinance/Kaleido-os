// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IAggregatorV3} from "../interfaces/IAggregatorV3.sol";

/**
 * @title MockAggregatorV3
 * @notice A settable Chainlink/API3-shaped feed, for exercising
 *         AggregatorPriceOracle's rescaling and round checks.
 *
 * @dev Decimals are a constructor argument rather than a constant because the
 *      cases worth testing are exactly the two the real providers use: 8
 *      (Chainlink) and 18 (an API3 reader proxy). The 18-decimal case is the one
 *      that overflows `int64` if it is passed through unscaled, so a mock that
 *      could only be 8 would not exercise the interesting path.
 *
 *      `answeredInRound` is settable independently of `roundId` so the
 *      carried-forward-answer case can be reproduced; a real feed reaches that
 *      state on its own and cannot be asked to.
 */
contract MockAggregatorV3 is IAggregatorV3 {
    uint8 private _decimals;
    string private _description;

    int256 public answer;
    uint256 public updatedAt;
    uint80 public roundId;
    uint80 public answeredInRound;

    /// @dev Reproduces an API3 dAPI whose plan has not been bought on
    ///      Api3Market: `decimals()` and `description()` answer, and only the
    ///      data read reverts. Measured on Robinhood Testnet, and the reason
    ///      `setFeed` validates `decimals()` instead of `latestRoundData()`.
    bool public revertOnRead;

    error NoDataYet();

    constructor(uint8 decimals_, string memory description_, int256 answer_) {
        _decimals = decimals_;
        _description = description_;
        answer = answer_;
        updatedAt = block.timestamp;
        roundId = 1;
        answeredInRound = 1;
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    function description() external view returns (string memory) {
        return _description;
    }

    function latestRoundData()
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        if (revertOnRead) revert NoDataYet();
        return (roundId, answer, updatedAt, updatedAt, answeredInRound);
    }

    function setRevertOnRead(bool revertOnRead_) external {
        revertOnRead = revertOnRead_;
    }

    function setAnswer(int256 answer_) external {
        answer = answer_;
    }

    function setUpdatedAt(uint256 updatedAt_) external {
        updatedAt = updatedAt_;
    }

    function setRound(uint80 roundId_, uint80 answeredInRound_) external {
        roundId = roundId_;
        answeredInRound = answeredInRound_;
    }
}
