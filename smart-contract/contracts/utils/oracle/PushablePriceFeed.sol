// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IAggregatorV3} from "../../interfaces/IAggregatorV3.sol";

/**
 * @title PushablePriceFeed
 * @author Kaleido
 * @notice An `AggregatorV3`-shaped price feed that we publish to ourselves, for a
 *         chain where no oracle publishes one.
 *
 * @dev ── Why this exists, and what it costs ────────────────────────────────────
 *
 *      Robinhood Chain Testnet (46630) has no price feed from anyone. That was
 *      measured rather than inferred:
 *
 *        * Robinhood's own docs name Chainlink and name no one else, and they are
 *          right — for MAINNET. Chainlink's reference directory publishes 57 feeds
 *          for `robinhood-mainnet` (chain 4663) and has no `robinhood-testnet`
 *          file at all; checked 2026-08-22, the mainnet URL answers 200 and the
 *          testnet one 404s.
 *        * Pyth has no deployment there. The address Pyth uses on Arc holds 1,067
 *          bytes of something else on 46630 and `getValidTimePeriod()` reverts.
 *        * API3 has an ETH/USD reader proxy deployed at
 *          `0xe201212b76f0C82FBf5ff17D8Ee009C9d4e9C597`, which answers
 *          `decimals()` with 18 and reverts on `latestRoundData()` because no
 *          Api3Market plan has been bought for it.
 *
 *      So the choice on that chain is between buying a 7-day third-party plan that
 *      then expires, and publishing the price ourselves. This contract is the
 *      second option, and the trade it makes must be stated rather than buried:
 *      **the price becomes ours.** A Chainlink feed is a number many independent
 *      node operators agreed on; this is a number one key wrote. Nothing about the
 *      arithmetic downstream changes, but the trust assumption does, completely.
 *
 *      That is acceptable on a testnet whose lending assets are mocks we minted,
 *      and it is not acceptable on mainnet — where Chainlink does publish, and a
 *      mainnet deployment must repoint `AggregatorPriceOracle` at those proxies
 *      instead of at this contract. The proxies are recorded in
 *      `scripts/libraries/aggregator-feeds.js` so that repointing needs no search.
 *
 *      ── Who may write a price, and why not everyone ─────────────────────────
 *
 *      `PythPriceOracle.updatePrice` is permissionless, deliberately: the caller
 *      has to carry a Wormhole-signed batch, so the chain verifies the data and
 *      the only thing an untrusted caller can contribute is the gas. There is no
 *      signature here. The input is a bare integer, so an unrestricted `push`
 *      would let anyone set the price of every asset on the chain, and therefore
 *      liquidate every borrower at will. Writes are restricted to `owner` plus an
 *      explicit pusher set.
 *
 *      This inverts the operational property that made the Pyth path attractive:
 *      there, a neglected feed can be repaired by any participant. Here it can
 *      only be repaired by us, so a keeper that stops is an outage nobody else can
 *      fix. See `scripts/push-aggregator.js`.
 *
 *      ── What is deliberately NOT here ──────────────────────────────────────
 *
 *      No staleness policy. `latestRoundData` reports `updatedAt` and says nothing
 *      about whether that is recent enough, because `ProtocolFacet` holds the
 *      per-feed bound and can revert with the age it measured. Two contracts
 *      enforcing one policy is two places to get it wrong — the same division
 *      `AggregatorPriceOracle` documents.
 *
 *      No round history beyond the latest. `getRoundData` answers for the current
 *      round and reverts for any other, rather than growing storage forever for
 *      data no protocol path reads. Chainlink proxies also revert for rounds from
 *      a superseded aggregator phase, so a consumer that cannot tolerate that is
 *      already broken against real feeds.
 *
 *      No `latestAnswer()`/`latestTimestamp()`. Those are the deprecated V2 half
 *      of the interface, and they hand out a price with no timestamp beside it,
 *      which makes a staleness check impossible at the point of use.
 */
contract PushablePriceFeed is IAggregatorV3 {
    /**
     * @dev The current round, in one slot: 80 + 48 + 128 = 256 bits exactly, so a
     *      push is a single SSTORE.
     *
     *      `answer` is `int128` rather than the interface's `int256`. At 8 decimals
     *      that ceiling is about 1.7e30 dollars, so nothing real is excluded, and
     *      an out-of-range value is rejected at push time with a named error
     *      instead of surfacing later as a wrong price. Note the consumer is
     *      tighter still: `AggregatorPriceOracle` has to fit the answer into
     *      `PythStructs.Price.price`, an `int64`, so an answer this contract
     *      accepts can still be refused there. That is the right place for it —
     *      the ceiling belongs to the consumer, not to the feed.
     *
     *      `updatedAt` is `uint48`, which overflows in the year 8,921,556.
     */
    struct Round {
        uint80 roundId;
        uint48 updatedAt;
        int128 answer;
    }

    /// @dev Ceiling the stored `int128` can hold. There is no matching floor
    ///      check: a non-positive answer is rejected first, so `type(int128).min`
    ///      is unreachable and a check for it would be dead code pretending to be
    ///      a guard.
    int256 private constant MAX_ANSWER = type(int128).max;

    /// @notice Decimal places in every answer, fixed at construction.
    /// @dev 8 on purpose, which is what Chainlink reports — including on the
    ///      Robinhood mainnet feeds this contract stands in for. That makes the
    ///      eventual swap to Chainlink a change of address and nothing else:
    ///      `AggregatorPriceOracle` caches decimals per feed and rescales to 8, so
    ///      a stand-in reporting 18 like API3's proxy would silently move the
    ///      rescale path in and out of use as the backend changed.
    uint8 public immutable override decimals;

    /// @notice Pair label, e.g. "ETH / USD".
    /// @dev Populated, unlike API3's reader proxies which return the empty string.
    ///      `verifyAggregatorFeed` cross-checks a feed's `description()` against
    ///      the asset its Pyth feed id names, and treats an empty answer as
    ///      absence of evidence — so filling this in is the difference between
    ///      that check being real and being skipped.
    string public override description;

    /// @notice May push prices, authorise pushers, and hand over ownership.
    address public owner;

    /// @notice Addresses permitted to push a price, besides the owner.
    mapping(address => bool) public isPusher;

    /**
     * @notice Largest move, in basis points, an ordinary push may make from the
     *         previous answer. Zero disables the check.
     *
     * @dev This guards against a keeper bug, not against a hostile pusher — a
     *      pusher can walk the price anywhere in steps under the limit, so it buys
     *      no security against someone who wants to move it. What it does catch is
     *      the realistic accident: a decimals mix-up or a units error that arrives
     *      as an order-of-magnitude jump, which would reprice all collateral on
     *      the chain in one transaction and liquidate every borrower.
     *
     *      It is set loose deliberately. A bound tight enough to track normal
     *      volatility would reject real moves and leave the feed stale, and a stale
     *      feed means `ProtocolFacet` fails closed — safe, but the market is down
     *      and the operator has to intervene anyway. `forceAnswer` is the owner's
     *      escape hatch for a genuine large move, and it emits a distinct event so
     *      that using it is visible rather than indistinguishable from routine
     *      operation.
     */
    uint256 public maxDeviationBps;

    Round private _latest;

    event AnswerPushed(
        uint80 indexed roundId,
        int256 answer,
        uint256 updatedAt,
        address indexed pusher
    );
    /// @dev Separate from `AnswerPushed` so that bypassing the deviation guard is
    ///      an event a log filter can find, not a flag on the normal one.
    event AnswerForced(
        uint80 indexed roundId,
        int256 answer,
        int256 previousAnswer,
        uint256 updatedAt
    );
    event PusherSet(address indexed pusher, bool allowed);
    event MaxDeviationSet(uint256 previousBps, uint256 newBps);
    event OwnershipTransferred(address indexed from, address indexed to);

    error NotAuthorized(address caller);
    error InvalidAddress();
    error EmptyDescription();
    error UnsupportedDecimals(uint8 decimals);
    error NonPositiveAnswer(int256 answer);
    error AnswerOutOfRange(int256 answer);
    error TimestampInFuture(uint256 updatedAt, uint256 blockTime);
    error TimestampNotNewer(uint256 updatedAt, uint256 latestUpdatedAt);
    error DeviationTooLarge(
        int256 previousAnswer,
        int256 answer,
        uint256 deviationBps,
        uint256 maxBps
    );
    error NoAnswerYet();
    error RoundNotAvailable(uint80 requested, uint80 latest);
    error DeviationBpsTooLarge(uint256 bps);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotAuthorized(msg.sender);
        _;
    }

    /**
     * @param _decimals Decimal places every answer carries. Use 8.
     * @param _description Pair label, e.g. "ETH / USD".
     * @param _maxDeviationBps Deviation guard; 0 disables it.
     *
     * @dev The deployer becomes owner and pusher. On the testnet wave that is the
     *      known-public deployer key, which means that key can value all collateral
     *      on the chain — a strictly worse position than the Pyth chains, where a
     *      push must carry a signed batch and the key can only pay for freshness.
     *      That is a consequence of publishing our own price and is recorded here
     *      rather than in a deploy log: hand `owner` to the same multisig that
     *      takes the diamond, and authorise a dedicated keeper address as pusher.
     */
    constructor(
        uint8 _decimals,
        string memory _description,
        uint256 _maxDeviationBps
    ) {
        /* Zero decimals would make every price an integer number of dollars, and
         * is far more likely to be an unset constructor argument than a choice.
         * 36 is the same ceiling AggregatorPriceOracle accepts at registration. */
        if (_decimals == 0 || _decimals > 36) {
            revert UnsupportedDecimals(_decimals);
        }
        if (bytes(_description).length == 0) revert EmptyDescription();
        if (_maxDeviationBps > 1_000_000) {
            revert DeviationBpsTooLarge(_maxDeviationBps);
        }

        decimals = _decimals;
        description = _description;
        maxDeviationBps = _maxDeviationBps;
        owner = msg.sender;
        isPusher[msg.sender] = true;

        emit OwnershipTransferred(address(0), msg.sender);
        emit PusherSet(msg.sender, true);
        emit MaxDeviationSet(0, _maxDeviationBps);
    }

    // -----------------------------------------------------------------------
    //  Reads — the AggregatorV3 surface
    // -----------------------------------------------------------------------

    /**
     * @notice The most recent pushed answer.
     * @return roundId Round the answer belongs to; 1 for the first push.
     * @return answer The price, carrying `decimals()` decimal places.
     * @return startedAt Equal to `updatedAt` — see the note below.
     * @return updatedAt When the price was OBSERVED, not when it was written.
     * @return answeredInRound Always equal to `roundId`.
     *
     * @dev Deliberately does not revert before the first push. It returns a round
     *      with `updatedAt == 0`, which is the interface's own way of saying "no
     *      completed round", and `AggregatorPriceOracle.getPrice` checks exactly
     *      that and reverts `RoundNotComplete`. Reverting here instead would work
     *      too, but it would also break `setFeed`'s ability to register a feed
     *      before it carries data — which is what lets the whole oracle be
     *      configured in one deployment and start answering when the keeper runs.
     *
     *      `startedAt` equals `updatedAt` because there is no round-opening step to
     *      timestamp separately. Chainlink distinguishes them because its rounds
     *      open, collect submissions, then close; a single-write feed has one
     *      moment, and reporting an invented earlier one would be a fabrication.
     *
     *      `answeredInRound == roundId` always, because an answer is only ever
     *      written together with the round it belongs to. There is no mechanism
     *      here to carry a previous answer forward into a new round, which is the
     *      condition `answeredInRound < roundId` exists to advertise.
     *
     *      `updatedAt` is the publisher's observation time, taken from the pusher,
     *      not `block.timestamp`. A price observed ten minutes ago and relayed now
     *      is ten minutes old, and reporting the write time would hide exactly the
     *      lag the protocol's staleness bound exists to catch.
     */
    function latestRoundData()
        external
        view
        override
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        Round memory r = _latest;
        return (r.roundId, r.answer, r.updatedAt, r.updatedAt, r.roundId);
    }

    /**
     * @notice Data for a specific round.
     * @dev Only the current round is retained; anything else reverts
     *      `RoundNotAvailable` rather than returning a zeroed round, which a
     *      caller could mistake for a real answer of zero at the epoch. See the
     *      contract note on why no history is kept.
     */
    function getRoundData(
        uint80 roundId
    )
        external
        view
        returns (
            uint80 id,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        Round memory r = _latest;
        if (r.roundId == 0) revert NoAnswerYet();
        if (roundId != r.roundId) revert RoundNotAvailable(roundId, r.roundId);
        return (r.roundId, r.answer, r.updatedAt, r.updatedAt, r.roundId);
    }

    /// @notice Interface version, for tooling that reads it.
    /// @dev Nothing on the protocol path does — `IAggregatorV3` omits it. Reported
    ///      as 1 rather than mimicking Chainlink's 4, because claiming a version
    ///      of an implementation this is not would be a false signal to anything
    ///      branching on it.
    function version() external pure returns (uint256) {
        return 1;
    }

    /// @notice The round id of the latest answer, or 0 before the first push.
    function latestRound() external view returns (uint80) {
        return _latest.roundId;
    }

    // -----------------------------------------------------------------------
    //  Writes
    // -----------------------------------------------------------------------

    /**
     * @notice Publish a new answer.
     * @param answer The price, at `decimals()` decimal places.
     * @param observedAt When the price was observed, in seconds. Pass the
     *        publisher's own timestamp — Hermes' `publish_time`, for the keeper —
     *        not the current block time.
     *
     * @dev Every rejection here is a case that would otherwise become a wrong
     *      number downstream rather than a failure:
     *
     *        non-positive     `getTokenAmountFromUsd` divides by the price, and a
     *                         negative one wraps when cast to unsigned.
     *        out of int128    stored truncated otherwise.
     *        future timestamp `ProtocolFacet` ages a price as
     *                         `block.timestamp - publishTime`, which underflows and
     *                         reverts for a future stamp — taking every priced
     *                         operation offline until a later block passes it.
     *        not newer        a replayed older observation would roll the feed
     *                         backwards while still looking like a fresh push.
     *        deviation        see `maxDeviationBps`.
     */
    function pushAnswer(int256 answer, uint256 observedAt) external {
        if (msg.sender != owner && !isPusher[msg.sender]) {
            revert NotAuthorized(msg.sender);
        }
        _validate(answer, observedAt);

        Round memory prev = _latest;
        if (maxDeviationBps != 0 && prev.roundId != 0) {
            uint256 dev = _deviationBps(prev.answer, answer);
            if (dev > maxDeviationBps) {
                revert DeviationTooLarge(
                    prev.answer,
                    answer,
                    dev,
                    maxDeviationBps
                );
            }
        }

        uint80 next = prev.roundId + 1;
        _latest = Round({
            roundId: next,
            updatedAt: uint48(observedAt),
            answer: int128(answer)
        });
        emit AnswerPushed(next, answer, observedAt, msg.sender);
    }

    /**
     * @notice Publish an answer, bypassing the deviation guard.
     * @dev Owner only, and separate from `pushAnswer` so that the guard can be
     *      loud without being a dead end. The intended use is a real move larger
     *      than `maxDeviationBps` — after which the ordinary keeper resumes,
     *      because the guard compares against the new answer.
     *
     *      Every other check still applies. The guard is the only thing waived;
     *      a negative price, a future timestamp or a replay is refused here too.
     */
    function forceAnswer(int256 answer, uint256 observedAt) external onlyOwner {
        _validate(answer, observedAt);

        Round memory prev = _latest;
        uint80 next = prev.roundId + 1;
        _latest = Round({
            roundId: next,
            updatedAt: uint48(observedAt),
            answer: int128(answer)
        });
        emit AnswerForced(next, answer, prev.answer, observedAt);
    }

    // -----------------------------------------------------------------------
    //  Administration
    // -----------------------------------------------------------------------

    /**
     * @notice Allow or disallow an address to push answers.
     * @dev The owner is always permitted and is not represented in the mapping,
     *      so revoking the owner's own entry does not lock it out. A keeper should
     *      be its own address rather than the owner key: pushing is a hot,
     *      frequent operation and owning the feed is not.
     */
    function setPusher(address pusher, bool allowed) external onlyOwner {
        if (pusher == address(0)) revert InvalidAddress();
        isPusher[pusher] = allowed;
        emit PusherSet(pusher, allowed);
    }

    /// @notice Change the deviation guard. Zero disables it.
    /// @dev Capped at 1,000,000 bps (100x) so that "disabled" has exactly one
    ///      representation — 0 — rather than also being expressible as a number so
    ///      large no real move reaches it.
    function setMaxDeviationBps(uint256 bps) external onlyOwner {
        if (bps > 1_000_000) revert DeviationBpsTooLarge(bps);
        uint256 previous = maxDeviationBps;
        maxDeviationBps = bps;
        emit MaxDeviationSet(previous, bps);
    }

    /**
     * @notice Hand the feed to a new owner.
     * @dev Whoever holds this sets the price of every asset registered against
     *      this feed, and therefore decides who is liquidatable. It belongs to the
     *      same multisig that takes the diamond and the oracle — and it matters
     *      more here than on a Chainlink feed, where our ownership does not exist
     *      at all because the numbers are not ours.
     */
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        address previous = owner;
        owner = newOwner;
        emit OwnershipTransferred(previous, newOwner);
    }

    // -----------------------------------------------------------------------
    //  Internal
    // -----------------------------------------------------------------------

    function _validate(int256 answer, uint256 observedAt) private view {
        if (answer <= 0) revert NonPositiveAnswer(answer);
        if (answer > MAX_ANSWER) revert AnswerOutOfRange(answer);
        if (observedAt > block.timestamp) {
            revert TimestampInFuture(observedAt, block.timestamp);
        }
        uint256 last = _latest.updatedAt;
        if (observedAt <= last) revert TimestampNotNewer(observedAt, last);
    }

    /**
     * @dev Absolute deviation of `next` from `prev`, in basis points of `prev`.
     *      Both are known positive by the caller, so the subtraction is ordered
     *      rather than signed-abs'd, and `prev` is known non-zero because a
     *      non-positive answer can never have been stored.
     */
    function _deviationBps(
        int256 prev,
        int256 next
    ) private pure returns (uint256) {
        uint256 a = uint256(prev);
        uint256 b = uint256(next);
        uint256 diff = b > a ? b - a : a - b;
        return (diff * 10_000) / a;
    }
}
