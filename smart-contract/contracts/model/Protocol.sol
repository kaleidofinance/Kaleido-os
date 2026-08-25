// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.9;

struct User {
    address userAddr;
    uint gitCoinPoint;
    uint totalLoanCollected;
}

struct Request {
    uint96 listingId; //new
    uint96 requestId;
    address author;
    uint256 amount;
    uint16 interest;
    uint256 totalRepayment;
    uint256 returnDate;
    address lender;
    address loanRequestAddr;
    address[] collateralTokens; // Addresses of collateral tokens
    Status status;
    /// @dev Interest priced at origination, in loan-token units. Never mutated.
    ///
    ///      The protocol fee is a share of interest, not of principal, so it
    ///      needs the interest figure to charge against. `totalRepayment` cannot
    ///      supply it: `repayLoan` decrements that field on every partial
    ///      payment, so after the first one the split between principal and
    ///      interest is gone. Principal (`amount`) is never mutated either, so
    ///      the original total is recoverable as `amount + interestAccrued` and
    ///      each payment's interest share can be pro-rated exactly.
    ///
    ///      DELIBERATELY APPENDED AFTER `status`. Two consumers read this struct
    ///      positionally — useGetActiveRequest.ts reads req[5]/req[8] and
    ///      lib/ai/planDeps.ts documents requestId 1, totalRepayment 5,
    ///      tokenAddress 8, status 10 — so inserting a field anywhere earlier
    ///      would silently shift every one of those indices. Append only.
    uint256 interestAccrued;
}

struct Order {
    uint256 orderId;
    address loanAddress;
    address author;
    uint256 amount;
    uint16 interest;
    uint256 totalRepayment;
    uint256 returnDate;
    OrderStatus orderStatus;
}

struct LoanListing {
    uint96 listingId;
    address author;
    address tokenAddress;
    uint256 amount;
    uint256 min_amount;
    uint256 max_amount;
    uint256 returnDate;
    uint16 interest;
    ListingStatus listingStatus;
    bool isFeatured; // NEW: Marks this as a featured "pool-like" listing
}

/// @dev A user's revocable grant of bounded authority to an agent.
/// Every field is a ceiling the agent cannot exceed, enforced on-chain so
/// the limits hold regardless of which frontend or RPC the agent uses.
struct AgentPermission {
    /// @dev USD (1e18) ceiling for any single action
    uint256 maxNotionalPerAction;
    /// @dev USD (1e18) ceiling for all actions within one epoch
    uint256 maxNotionalPerEpoch;
    /// @dev USD (1e18) consumed in the current epoch
    uint256 spentInEpoch;
    /// @dev start of the current epoch
    uint64 epochStart;
    /// @dev epoch length in seconds; set very long for a lifetime budget
    uint64 epochDuration;
    /// @dev grant expiry; 0 means no grant exists
    uint64 expiry;
    /// @dev worst interest rate (BPS) the agent may accept on the user's behalf
    uint16 maxInterestBps;
    /// @dev health factor floor (BPS, 10000 = 1.0) the agent must leave intact
    uint16 minHealthFactorBps;
    /// @dev bitmask of permitted actions; see Constants.AGENT_ACTION_*
    uint32 allowedActions;
    /// @dev immediate kill switch, independent of expiry
    bool revoked;
}

enum Status {
    OPEN,
    SERVICED,
    CLOSED
}

enum OrderStatus {
    OPEN,
    ACCEPTED,
    CLOSED
}

enum ListingStatus {
    OPEN,
    CLOSED
}



