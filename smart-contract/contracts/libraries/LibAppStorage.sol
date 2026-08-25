// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;
import {IPythPriceOracle} from "../interfaces/IPythPriceFeed.sol";
import "../model/Protocol.sol";

library LibAppStorage {

     bytes32 internal constant STORAGE_SLOT = keccak256("diamond.standard.app.storage");
    struct Layout {
        /// @dev maps collateral token to their price feed
        mapping(address token => bytes32 priceFeed) s_priceFeeds;
        /// @dev maps address of a token to see if it is loanable
        mapping(address token => bool isLoanable) s_isLoanable;
        /// @dev maps user to the value of balance he has collaterised
        mapping(address => mapping(address token => uint256 balance)) s_addressToCollateralDeposited;
        /// @dev maps user to the value of balance he has available
        mapping(address => mapping(address token => uint256 balance)) s_addressToAvailableBalance;
        ///@dev mapping the address of a user to its Struct
        mapping(address => User) addressToUser;
        ///@dev mapping of users to their address
        mapping(uint96 requestId => Request) request;
        ///@dev mapping a requestId to the collaterals used in a request
        mapping(uint96 requestId => mapping(address => uint256)) s_idToCollateralTokenAmount;
        ///@dev mapping of id to orders
        mapping(uint96 orderId => Order) order;
        ///@dev mapping of id to loanListing
        mapping(uint96 listingId => LoanListing) loanListings;

        /// @notice Maps a downliner to their upliner (referrer)
        mapping(address => address)  referral;

        /// @notice Maps an upliner to their downliners by index
        mapping(address => mapping(uint256 => address))  downliners;

        /// @notice Tracks the number of downliners for each upliner
        mapping(address => uint256)  referralCount;

        mapping(address => uint256)  referralPoints;

        /// @dev Collection of all colleteral Adresses
        address[] s_collateralToken;
        /// @dev all loanable assets
        address[] s_loanableToken;
        /// @dev Address of the fee collection vault for Kaleido protocol
        address  kaleidoFeeVault;
        /// @dev Collection of all all the resquest;
        Request[] s_requests;
        Order[] s_order;
        /// @dev request id;
        uint96 requestId;
        uint96 s_orderId;
        uint96 listingId;
        /// @dev Base points representation of one percent (100 BPS = 1%)
        uint256 ONE_PERCENT_BPS;
        uint256 LIQUIDITY_BPS;

        /// @dev UNUSED. Was the liquidation bot allowlist, read by ProtocolFacet's
        ///      `onlyBot` modifier. Liquidation is permissionless now — settlement
        ///      is a ledger transfer of the seized collateral, so there is nothing
        ///      an arbitrary caller can extract and no reason to gate it — and the
        ///      modifier, its setter and its error are gone. The slot is kept
        ///      rather than deleted only so removing it does not shift every field
        ///      below it in both of the storage regions this struct is laid out
        ///      over. Nothing reads or writes it; do not add a setter back without
        ///      also adding the reader that gives it meaning.
        address botAddress;

        /// @dev UNREAD. Written by ProtocolFacet.setSwapRouter and read by
        ///      nothing — no facet, and no getter either, so its value cannot be
        ///      observed from outside at all. The DEX is the standalone V3
        ///      periphery (contracts/dex-v3/periphery/SwapRouter.sol); callers
        ///      reach it directly, resolving it per chain from the deployment
        ///      registry, and no protocol path routes a swap through the diamond.
        ///      Kept for the same slot-stability reason as botAddress above, and
        ///      because the setter is already live on five chains — but the same
        ///      rule applies: give it a reader before treating it as configuration.
        ///      deploy.js used to warn that swaps were unusable without it, which
        ///      described this slot as load-bearing when it never has been.
        address swapRouter;
        /// @dev Interface to the Pyth oracle for price feeds
        IPythPriceOracle pythPriceOracle;


        /// @dev user => the ids of every request they have authored, in creation
        ///      order. Written by the protocol itself at both sites that create a
        ///      Request; `getUserActiveRequests` filters it by live status, so an
        ///      id is never removed when a loan closes — it simply stops matching.
        ///
        ///      Declared for this purpose and wired to nothing until now. Ids
        ///      rather than copies, because `getUserActiveRequests` re-reads
        ///      `request[id]` for every entry precisely so a stale snapshot can
        ///      never be what the health factor divides by — which makes storing
        ///      the struct pure cost, since a Request carries a dynamic
        ///      `collateralTokens` array and pushing one is ~10 SSTOREs of data
        ///      nothing reads back.
        mapping(address => uint96[]) userActiveRequet;
        /// @dev RETIRED — no longer read or written. Was the index
        ///      `getUserActiveRequests` iterated, and its only writers were the
        ///      owner-gated `addUserActiveRequest` / `batchAddUserRequests`. That
        ///      made an off-chain keeper (server/src/syncUserActiveRequets.ts) the
        ///      sole source of the figure `getLoanCollectedInUsd` — and therefore
        ///      `_healthFactor` — is derived from. With no keeper running, every
        ///      borrower's debt read as zero, `getHealthFactor` answered
        ///      type(uint256).max for a position with live loans, and
        ///      `liquidateUserRequest`'s `_healthFactor(...) >= PRECISION` guard
        ///      was permanently true: an overdue term was the only route to
        ///      liquidation, never under-collateralisation. Measured on Sepolia
        ///      against three real loans.
        ///
        ///      Kept as a field rather than deleted. Every mapping below it would
        ///      shift down one slot, corrupting live storage on five chains.
        mapping(address => Request[]) userActiveRequests;

        /// @dev maps addresses (bots/contracts) that are allowed to award points
        mapping(address => bool) approvedPointAwarders;

        // --- Agent delegation. Appended only; never reorder the fields above,
        // --- doing so would corrupt every existing storage slot.

        /// @dev user => agent => bounded authority granted by that user
        mapping(address => mapping(address => AgentPermission)) agentPermissions;
        /// @dev user => agent => token => whether the agent may touch that token
        mapping(address => mapping(address => mapping(address => bool))) agentTokens;

        /// @dev Oldest Pyth publishTime the protocol will price against, in
        ///      seconds. The oracle reads through `pyth.getPriceUnsafe`, which
        ///      by design returns the last published price at any age, so
        ///      without this bound a price pusher that stops leaves the
        ///      protocol quoting a frozen number indefinitely. Zero means
        ///      unconfigured and every price read reverts — see
        ///      ProtocolFacet._priceScaled18 for why that is the safe default.
        uint256 priceMaxAge;

        /// @dev Widest Pyth confidence interval accepted, in basis points of
        ///      the price itself. Pyth publishes `conf` as roughly the standard
        ///      error of the aggregate; a wide interval means the publishers
        ///      disagree, which is exactly the condition under which a
        ///      liquidation priced off the midpoint is a coin toss. Zero means
        ///      unconfigured and every price read reverts.
        uint256 priceMaxConfBps;

        /// @dev Per-feed override of `priceMaxAge`, keyed by price feed id.
        ///      Zero means "no override, use the global bound".
        ///
        ///      A single global bound cannot cover the feeds this protocol has
        ///      to read, and the gap is not marginal. Measured 2026-08-21 on the
        ///      five chains in the deployment wave, the age of the newest
        ///      available answer ranged over three orders of magnitude:
        ///
        ///        Pyth, Base Sepolia / Arc      86-104s
        ///        Chainlink, BSC ETH/USD        355s
        ///        Chainlink, Sepolia ETH/USD    1,594s
        ///        Chainlink, Sepolia USDC/USD   13,438s
        ///        API3, Robinhood              24h heartbeat, its only option
        ///
        ///      Sepolia alone spans 8x between its ETH and USDC feeds. Setting
        ///      the global bound loose enough for the stablecoin would mean
        ///      accepting a four-hour-old ETH price to liquidate against, and
        ///      setting it tight enough for ETH means the stablecoin never
        ///      prices and `/borrow` is dead on the chain. Neither is a
        ///      configuration mistake — it is one number being asked to describe
        ///      two different publisher cadences.
        ///
        ///      So the override is per feed, opt-in, and bounded by its own
        ///      ceiling (`Constants.MAX_FEED_PRICE_AGE`) rather than the global
        ///      one. It is only defensible on an asset whose price is pegged:
        ///      a day-old quote on USDC is very probably still a dollar, and a
        ///      day-old quote on ETH is an invitation to liquidate healthy
        ///      positions at a price that stopped being true. See
        ///      ProtocolFacet.setFeedMaxAge.
        mapping(bytes32 priceFeed => uint256 maxAgeSeconds) s_feedMaxAge;

    }
    
        function layout() internal pure returns (Layout storage l) {
        bytes32 slot = STORAGE_SLOT;
        assembly {
            l.slot := slot
        }
    }
}
