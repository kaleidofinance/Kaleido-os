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

        /// @dev bot address for executing trades
        address botAddress;

        /// @dev Address of the DEX router used for token swaps
        address swapRouter;
        /// @dev Interface to the Pyth oracle for price feeds
        IPythPriceOracle pythPriceOracle;


        /// @dev maps user address to their active order IDs
        mapping(address => uint96[]) userActiveRequet;
        mapping(address => Request[]) userActiveRequests;

        /// @dev maps addresses (bots/contracts) that are allowed to award points
        mapping(address => bool) approvedPointAwarders;

    }
    
        function layout() internal pure returns (Layout storage l) {
        bytes32 slot = STORAGE_SLOT;
        assembly {
            l.slot := slot
        }
    }
}
