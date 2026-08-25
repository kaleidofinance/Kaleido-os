// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import {IAggregatorV3} from "../../interfaces/IAggregatorV3.sol";

/**
 * @title AggregatorPriceOracle
 * @author Kaleido
 * @notice Reads Chainlink feeds and API3 dAPI reader proxies, and answers in the
 *         shape `ProtocolFacet` already expects from `PythPriceOracle`.
 *
 * @dev Why this exists. Pyth is live and sub-two-minutes on Base Sepolia and Arc
 *      Testnet, and on the other three chains in the wave it is stale or absent
 *      — measured 2026-08-21 by reading each chain, not from Pyth's coverage
 *      page, which omits chains:
 *
 *        Sepolia 11155111        Pyth ETH/USD 17,866s old   Chainlink is live
 *        BSC Testnet 97          Pyth ETH/USD 136,497s old  Chainlink is live
 *        Robinhood Testnet 46630 no Pyth deployment         API3 is deployed
 *
 *      The address Pyth uses on Arc, `0x2880aB155794e7179c9eE2e38200202908C17B43`,
 *      also holds code on Robinhood Testnet — 1,067 bytes of something else.
 *      `getValidTimePeriod()` reverts there. A `getCode` check proves a contract
 *      exists, never which contract, so `setFeed` below calls `decimals()` and
 *      the deploy script calls a provider-specific method.
 *
 *      The seam this plugs into is one function wide. `ProtocolFacet` reads every
 *      USD figure in the protocol through `_priceScaled18`, and the only thing
 *      that function asks of the oracle is
 *      `getPrice(bytes32) -> PythStructs.Price`. So this contract is a drop-in:
 *      deploy it, call `setPythOracle(address)`, and health factors, borrow
 *      limits, conversions and liquidation all price off Chainlink or API3 with
 *      no change to the facet's arithmetic. `_priceScaled18` already handles an
 *      arbitrary `expo` correctly, which is what makes that possible.
 *
 *      What this contract is NOT: a pusher. It reads a feed; it never writes one,
 *      so there is no equivalent of `PythPriceOracle.updatePrice` and none is
 *      provided. Where the feed is Chainlink or API3 (Sepolia, BSC Testnet) the
 *      provider maintains it and freshness is outside our reach — the mirror of
 *      the Pyth path, where `updatePrice` is permissionless, so that feed can be
 *      repaired by any participant and neglected by all of them while this one can
 *      be neither. The exception is Robinhood Testnet, where the feed is a
 *      `PushablePriceFeed` WE publish: this contract still only reads, but the
 *      freshness of what it reads is now our own responsibility, kept by
 *      `scripts/push-aggregator.js`, and a stopped keeper is an outage only we can
 *      fix — the worst of both, and the price of pricing a chain no one else
 *      publishes to. See `PushablePriceFeed`.
 *
 * ---------------------------------------------------------------------------
 *  Two things a reader must know before trusting this contract
 * ---------------------------------------------------------------------------
 *
 *  1. `conf` is always zero, so `priceMaxConfBps` is inert on this backend.
 *
 *     Pyth publishes `conf`, an uncertainty band that `_priceScaled18` rejects
 *     when it is too wide. Chainlink and API3 publish a single number and no
 *     uncertainty at all. Reporting a fabricated `conf` would be worse than
 *     reporting none, so this returns 0 — and 0 passes any `maxConfBps`, which
 *     means that half of the protocol's price policy does nothing while this
 *     oracle is installed.
 *
 *     That is inherent to the data source, not a shortcut, but it must not be
 *     invisible: the facet's own comment argues that a check which is disabled
 *     with no way to tell from the outside is the failure mode to avoid. So
 *     `oracleKind()` names the backend, and an operator or frontend can read it
 *     to know whether the confidence bound means anything. In place of `conf`
 *     this enforces what an aggregator does expose — a completed round, a
 *     non-carried-forward answer, and a positive price — see `getPrice`.
 *
 *  2. Prices are renormalised to 8 decimals, because `int64` cannot hold 18.
 *
 *     `PythStructs.Price.price` is `int64`, whose maximum is about 9.22e18. An
 *     API3 proxy answers with 18 decimals, so ETH at $2,345 arrives as 2.345e21
 *     — roughly 254x too large to fit. Passing it through would overflow the
 *     cast in `_priceScaled18` and price the asset at a garbage number, so
 *     every feed is rescaled to `TARGET_DECIMALS` and reports `expo = -8`,
 *     which is also what a Pyth USD feed reports. Chainlink's 8 needs no
 *     rescale; API3's 18 is divided by 1e10.
 *
 *     The cost is precision below 1e-8 of a unit, which is discarded. For an
 *     asset priced anywhere near a dollar that is far finer than the protocol's
 *     own rounding; for an asset so cheap that 1e-8 is its whole price, the
 *     division would truncate to zero and `getPrice` reverts rather than
 *     quoting a free asset.
 */
contract AggregatorPriceOracle {
    /**
     * @dev A registered feed. `aggregator` and `decimals` share one slot, so a
     *      price read costs one SLOAD and one external call.
     *
     *      `decimals` is cached at registration instead of read on every price.
     *      Both providers treat it as immutable — a Chainlink proxy that changes
     *      decimals is a new proxy — and caching means a feed whose `decimals()`
     *      started answering differently cannot silently rescale every USD
     *      figure in the protocol by a power of ten. Re-run `setFeed` to change
     *      it, which emits an event.
     */
    struct Feed {
        address aggregator;
        uint8 decimals;
    }

    /// @dev Exponent every price is reported at, matching a Pyth USD feed.
    int32 private constant TARGET_EXPO = -8;

    /// @dev Decimal places implied by TARGET_EXPO. Kept as its own constant
    ///      because the rescale arithmetic needs it unsigned.
    uint256 private constant TARGET_DECIMALS = 8;

    /// @dev Largest `decimals()` accepted at registration. No price feed
    ///      reports anywhere near this; the bound exists so that
    ///      `10 ** (decimals - TARGET_DECIMALS)` cannot be pushed toward
    ///      overflowing a uint256 by a misconfigured or hostile aggregator.
    uint8 private constant MAX_DECIMALS = 36;

    /// @dev `type(int64).max` as a uint256, the ceiling a rescaled price must
    ///      fit under before it is cast down.
    uint256 private constant INT64_MAX = uint256(int256(type(int64).max));

    /// @notice Feed id (a Pyth feed id, reused here as a chain-independent
    ///         asset key) to the aggregator that prices it on this chain.
    /// @dev Keeping Pyth's ids as the key is what lets `register-tokens.js` stay
    ///      chain-agnostic: `ProtocolFacet.addCollateralToken(token, feedId)` is
    ///      given the same `bytes32` on all five chains, and only the oracle
    ///      deployment differs. Nothing here interprets the id.
    mapping(bytes32 => Feed) private _feeds;

    /// @notice May register feeds and hand over ownership.
    /// @dev Public, unlike `PythPriceOracle.owner`, which is `internal` and so
    ///      cannot be checked from outside the contract it governs.
    address public owner;

    event FeedSet(
        bytes32 indexed feedId,
        address indexed aggregator,
        uint8 decimals
    );
    event FeedRemoved(bytes32 indexed feedId);
    event OwnershipTransferred(address indexed from, address indexed to);

    error NotAuthorized();
    error InvalidFeedId();
    error InvalidAddress();
    error AggregatorHasNoCode(address aggregator);
    error UnsupportedDecimals(address aggregator, uint8 decimals);
    error LengthMismatch(uint256 feedIds, uint256 aggregators);
    error FeedNotSet(bytes32 feedId);
    error RoundNotComplete(bytes32 feedId);
    error StaleRound(bytes32 feedId, uint80 roundId, uint80 answeredInRound);
    error NonPositiveAnswer(bytes32 feedId, int256 answer);
    error PriceTruncatedToZero(bytes32 feedId, int256 answer, uint8 decimals);
    error PriceOverflowsInt64(bytes32 feedId, uint256 scaled);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotAuthorized();
        _;
    }

    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    // -----------------------------------------------------------------------
    //  Reads
    // -----------------------------------------------------------------------

    /**
     * @notice The latest price for `feedId`, in the shape `ProtocolFacet`
     *         expects from `PythPriceOracle`.
     * @param feedId The asset key the token was registered against.
     * @return A Pyth-shaped price: rescaled to `expo = -8`, `conf = 0`, and
     *         `publishTime` set to the aggregator's `updatedAt`.
     *
     * @dev Reverts rather than returning a questionable number, because the
     *      caller is `_priceScaled18` and every USD figure in the protocol
     *      passes through it — a bad price here is a wrong health factor and a
     *      wrong liquidation, not a cosmetic problem.
     *
     *      The three round checks are what stands in for Pyth's `conf` (see the
     *      contract-level note):
     *
     *        `updatedAt == 0`            the round never completed, so there is
     *                                    no timestamp to age-check against and
     *                                    the facet's staleness bound would be
     *                                    comparing against the epoch.
     *        `answeredInRound < roundId` the feed opened a round and carried the
     *                                    previous answer into it. The number is
     *                                    older than `updatedAt` implies, which
     *                                    is precisely the case the facet's
     *                                    staleness bound cannot see.
     *        `answer <= 0`               a negative price would wrap when cast
     *                                    to unsigned; zero would divide by zero
     *                                    in `getTokenAmountFromUsd`.
     *
     *      Freshness itself is deliberately NOT enforced here. It belongs in
     *      `ProtocolFacet`, which holds the per-feed bound and can revert with
     *      the age it measured; duplicating the policy in two contracts would
     *      mean two places to get it wrong. This contract's job is translation.
     */
    function getPrice(
        bytes32 feedId
    ) public view returns (PythStructs.Price memory) {
        Feed memory f = _feeds[feedId];
        if (f.aggregator == address(0)) revert FeedNotSet(feedId);

        (
            uint80 roundId,
            int256 answer,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = IAggregatorV3(f.aggregator).latestRoundData();

        if (updatedAt == 0) revert RoundNotComplete(feedId);
        if (answeredInRound < roundId) {
            revert StaleRound(feedId, roundId, answeredInRound);
        }
        if (answer <= 0) revert NonPositiveAnswer(feedId, answer);

        uint256 scaled = _rescale(feedId, answer, f.decimals);

        return
            PythStructs.Price({
                price: int64(uint64(scaled)),
                conf: 0,
                expo: TARGET_EXPO,
                publishTime: updatedAt
            });
    }

    /// @notice The aggregator pricing `feedId`, or the zero address.
    function feedAggregator(bytes32 feedId) external view returns (address) {
        return _feeds[feedId].aggregator;
    }

    /// @notice The aggregator's own decimals, as cached at registration.
    /// @dev Not the decimals of the returned price, which is always 8. This is
    ///      here so an operator can see which provider a feed came from — 8 is
    ///      Chainlink, 18 is an API3 proxy — and confirm the cache matches the
    ///      live feed.
    function feedDecimals(bytes32 feedId) external view returns (uint8) {
        return _feeds[feedId].decimals;
    }

    /**
     * @notice Which backend this oracle reads, so callers can tell whether the
     *         protocol's confidence bound is meaningful.
     * @dev `PythPriceOracle` is distinguishable by its `pyth()` getter; this is
     *      the explicit counterpart, so tooling can branch without relying on a
     *      call reverting. Any oracle installed here should answer it.
     */
    function oracleKind() external pure returns (string memory) {
        return "aggregator-v3";
    }

    /// @notice The aggregator's own pair label, e.g. "ETH / USD".
    /// @dev For deploy-time confirmation that a feed id was mapped to the right
    ///      pair. Not used on any protocol path — it allocates a string.
    function describeFeed(
        bytes32 feedId
    ) external view returns (string memory) {
        Feed memory f = _feeds[feedId];
        if (f.aggregator == address(0)) revert FeedNotSet(feedId);
        return IAggregatorV3(f.aggregator).description();
    }

    // -----------------------------------------------------------------------
    //  Administration
    // -----------------------------------------------------------------------

    /**
     * @notice Point `feedId` at the aggregator that prices it on this chain.
     * @dev Validates that the target is a contract and that it answers
     *      `decimals()` with a plausible value. That is a genuine identity
     *      check rather than a code check: the Robinhood address that holds
     *      1,067 bytes of non-Pyth code would fail it.
     *
     *      It deliberately does NOT require `latestRoundData()` to succeed.
     *      API3's proxies are deployed before the dAPI is purchased on
     *      Api3Market, and in that state `decimals()` and `description()` answer
     *      while `latestRoundData()` reverts — measured on Robinhood Testnet. So
     *      a feed can be registered as part of the deployment and begin
     *      answering when the plan is activated, instead of forcing the
     *      activation to happen before anything can be configured. `getPrice`
     *      reverts in the meantime, which is the correct behaviour: no price is
     *      better than a wrong one, and the facet already fails closed.
     *
     *      Re-registering an existing id is allowed and is how a feed gets
     *      repointed or its cached decimals refreshed. The event is the record.
     */
    function setFeed(bytes32 feedId, address aggregator) public onlyOwner {
        if (feedId == bytes32(0)) revert InvalidFeedId();
        if (aggregator == address(0)) revert InvalidAddress();
        if (aggregator.code.length == 0) revert AggregatorHasNoCode(aggregator);

        uint8 dec = IAggregatorV3(aggregator).decimals();
        /* Zero is rejected as well as oversized: a price feed reporting no
         * decimal places is far more likely to be a contract that is not an
         * aggregator answering a selector collision than a real integer feed. */
        if (dec == 0 || dec > MAX_DECIMALS) {
            revert UnsupportedDecimals(aggregator, dec);
        }

        _feeds[feedId] = Feed({aggregator: aggregator, decimals: dec});
        emit FeedSet(feedId, aggregator, dec);
    }

    /**
     * @notice Register several feeds in one transaction.
     * @dev Deployment registers every asset at once, and a partially configured
     *      oracle is a market where some collateral prices and some reverts.
     *      One transaction makes that atomic.
     */
    function setFeeds(
        bytes32[] calldata feedIds,
        address[] calldata aggregators
    ) external onlyOwner {
        if (feedIds.length != aggregators.length) {
            revert LengthMismatch(feedIds.length, aggregators.length);
        }
        for (uint256 i = 0; i < feedIds.length; i++) {
            setFeed(feedIds[i], aggregators[i]);
        }
    }

    /**
     * @notice Stop pricing `feedId`.
     * @dev Reverts when the id was not registered, so a typo in an incident
     *      response does not report success while leaving the real feed live.
     *      Tokens registered against a removed id price nothing until it is set
     *      again — `getPrice` reverts with `FeedNotSet`.
     */
    function removeFeed(bytes32 feedId) external onlyOwner {
        if (_feeds[feedId].aggregator == address(0)) revert FeedNotSet(feedId);
        delete _feeds[feedId];
        emit FeedRemoved(feedId);
    }

    /**
     * @notice Hand the feed registry to a new owner.
     * @dev Whoever holds this can repoint any feed and therefore reprice all
     *      collateral in the protocol, so it belongs to the same multisig that
     *      takes the diamond. `PythPriceOracle` has no equivalent and cannot be
     *      handed over at all, which is one more reason not to leave it
     *      installed on a chain where this adapter works.
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

    /**
     * @dev Moves `answer` from `dec` decimal places to `TARGET_DECIMALS` and
     *      checks it fits `int64`. Split out of `getPrice` so the overflow and
     *      truncation reasoning sits in one place.
     *
     *      `answer` is known positive by the caller. The upward branch cannot
     *      silently wrap — Solidity 0.8 arithmetic reverts on overflow — and the
     *      explicit `INT64_MAX` check catches a value that is representable in
     *      uint256 but not in the int64 the struct field holds. Without it, an
     *      18-decimal API3 price would wrap on the cast and quote a nonsense
     *      number instead of reverting.
     */
    function _rescale(
        bytes32 feedId,
        int256 answer,
        uint8 dec
    ) private pure returns (uint256) {
        uint256 raw = uint256(answer);
        uint256 scaled;

        if (uint256(dec) > TARGET_DECIMALS) {
            scaled = raw / (10 ** (uint256(dec) - TARGET_DECIMALS));
            /* Only the downward branch can lose the whole number: an asset
             * priced below 1e-8 of a unit rounds to zero, and a zero price
             * divides by zero in getTokenAmountFromUsd. */
            if (scaled == 0) revert PriceTruncatedToZero(feedId, answer, dec);
        } else if (uint256(dec) < TARGET_DECIMALS) {
            scaled = raw * (10 ** (TARGET_DECIMALS - uint256(dec)));
        } else {
            scaled = raw;
        }

        if (scaled > INT64_MAX) revert PriceOverflowsInt64(feedId, scaled);
        return scaled;
    }
}
