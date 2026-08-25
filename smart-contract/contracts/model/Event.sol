// SPDX-License-Identifier: MIT 
pragma solidity ^0.8.9;

interface IKaleidoEvents {
    event RequestCreated(
        address indexed _borrower,
        uint96 indexed requestId,
        uint _amount,
        uint16 _interest,
        address indexed tokenAddress
    );
    event OrderCreated(
        address indexed _lender,
        address indexed_tokenAddress,
        uint256 _amount,
        uint96 indexed _requestId
    );
    event RespondToLendingOffer(
        address indexed sender,
        uint indexed _offerId,
        uint8 _status,
        uint8 _offerStatus
    );
    event RequestServiced(
        uint96 indexed _requestId,
        address indexed _lender,
        address indexed _borrower,
        uint256 _amount,
        address  tokenAddress
    );
    event CollateralWithdrawn(
        address indexed sender,
        address indexed _tokenCollateralAddress,
        uint256 _amount
    );
    event UpdatedCollateralTokens(address indexed sender, uint8 newTokensCount);
    event AcceptedListedAds(
        address indexed sender,
        uint96 indexed id,
        uint256 indexed amount,
        uint8 adStatus
    );
    event LoanRepayment(
        address indexed sender,
        address indexed lender,
        uint96 id,
        uint256 amount,
        uint256 outstanding
    );
    event UpdateLoanableToken(
        address indexed _token,
        bytes32 _priceFeed,
        address indexed sender
    );
    event CollateralDeposited(
        address indexed _sender,
        address indexed _token,
        uint256 _value
    );

    event withdrawnAdsToken(
        address indexed sender,
        uint96 indexed _orderId,
        uint8 indexed orderStatus,
        uint256 _amount
    );

    event LoanListingCreated(
        uint96 indexed listingId,
        address indexed sender,
        address indexed tokenAddress,
        uint256 amount,
        uint256 minAmount,
        uint256 maxAmount,
        uint256 returnDate,
        uint16 interest,
        address currency
    );

    event RequestLiquidated(uint96 indexed requestId, address indexed lenderAddress, address indexed borrowerAddress, uint256  totalRepayment);
    event UpdatedGitPointScore(
        address indexed user,
        uint256 newScore
    );

    event UplinerRegistered(
        address indexed upliner,
        address indexed downliner
    );

    event ReferralPointsUpdated(
        address indexed user,
        uint256 newPoints
    );

    event ReferralPointsAwarded(
        address indexed upliner,
        address indexed user,
        uint256 referralPoints
    );

    event PointAwarderUpdated(
        address indexed awarder,
        bool approved
    );

    event GatewayPointsAwarded(
        address indexed user,
        uint256 amount,
        address indexed awarder
    );

    /// @notice The price freshness / confidence policy changed.
    /// @dev Emitted so a change to the bounds is auditable from logs. These two
    ///      values decide when the protocol refuses to price collateral, so
    ///      widening them is the quiet way to make liquidations possible that
    ///      the previous policy would have rejected.
    /// @param maxAge Oldest accepted Pyth publishTime, in seconds.
    /// @param maxConfBps Widest accepted confidence interval, in bps of price.
    event PriceBoundsUpdated(uint256 maxAge, uint256 maxConfBps);

    /// @notice One feed's freshness bound was overridden, or the override cleared.
    /// @dev Separate from PriceBoundsUpdated because the risk is different in
    ///      kind, not degree. The global bound is capped at one hour; a per-feed
    ///      override may reach 25, which is only defensible on a pegged asset.
    ///      Emitting it makes "which feed was allowed to go stale, and by how
    ///      much" answerable from logs alone, without reading storage per feed.
    /// @param priceFeed The feed id the override applies to.
    /// @param maxAge Oldest accepted publishTime for this feed, in seconds.
    ///        Zero means the override was cleared and the global bound applies.
    event FeedMaxAgeUpdated(bytes32 indexed priceFeed, uint256 maxAge);
}
