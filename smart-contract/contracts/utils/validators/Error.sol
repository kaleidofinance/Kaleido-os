// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

///////////////
/// errors ///
/////////////
error Governance__NotEnoughTokenBalance();
error Governance__NotEnoughAllowance();
error Governance__ProposalDoesNotExist();
error Governance__ProposalInactive();
error Governance__ProposalExpired();
error Governance__NotEnoughVotingPower();
error Governance__AlreadyVoted();
error Governance__AlreadyStaked();
error Governance__NoStakedToken();
error Governance__OptionDoesNotExist();

error Protocol__MustBeMoreThanZero();
error Protocol__tokensAndPriceFeedsArrayMustBeSameLength();
error Protocol__TokenNotAllowed();
error Protocol__TransferFailed();
error Protocol__BreaksHealthFactor();
error Protocol__InsufficientCollateral();
error Protocol__RequestNotOpen();
error Protocol__InsufficientBalance();
error Protocol__IdNotExist();
error Protocol__InvalidId();
error Protocol__Unauthorized();
error Protocol__OrderNotOpen();
error Protocol__InvalidToken();
error Protocol__InsufficientAllowance();
error Protocol__RequestNotServiced();
error Protocol__TokenNotLoanable();
error Protocol__DateMustBeInFuture();
error Protocol__CantFundSelf();
error Protocol__RequestExpired();
error Protocol__EmailNotVerified();
error Protocol__InsufficientCollateralDeposited();
error Protocol__RepayAmountExceedsDebt();
error Protocol__LoanNotServiced();
error Protocol__InvalidAmount();
error Protocol__NotOwner();
error Protocol__OwnerCreatedOrder();
error Protocol__OrderNotServiced();
error Protocol__ListingNotOpen();
error Protocol__OwnerCreatedListing();
error Protocol__InsufficientAmount();
error Protocol__OnlyBotCanAccess();
error Protocol__NoCollateralDeposited();
error Protocol__InvalidFeeBps();
error Protocol__InvalidFeeVault();
error Protocol__PositionHealthy();
error Protocol__LoanValueZero();
error Protocol__TokenAlreadyExists();
error Protocol__CannotBorrowCollateralAsset();
error Protocol__InvalidAddress();
error Protocol__UplinerCannotBeDownliner();
error Protocol__DownlinerAlreadyHasUpliner();
error Protocol__CyclicReferral();
error Protocol__InvalidRequestId();
error Protocol__RequestNotFound();
error Protocol__InsufficientCollateralBalance();
error Protocol__LoanAmountTooLow();