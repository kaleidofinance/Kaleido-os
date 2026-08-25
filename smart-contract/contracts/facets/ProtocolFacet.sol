// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;
import {LibAppStorage} from "../libraries/LibAppStorage.sol";
import {Constants} from "../utils/constants/constant.sol";
import {Validator} from "../utils/validators/Validator.sol";
import {LibDiamond} from "../libraries/LibDiamond.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../utils/validators/Error.sol";
import "../model/Event.sol";
import "../model/Protocol.sol";
import "../interfaces/IUniswapV2Router02.sol";
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import {IPythPriceOracle} from "../interfaces/IPythPriceFeed.sol";
import "../utils/functions/Utils.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ProtocolFacet Contract
/// @author Kaleido
contract ProtocolFacet is ReentrancyGuard, IKaleidoEvents {
    /* Every one of the six ERC20 calls in this file already checked the returned
     * bool, so unlike the stablecoin module this was never a silent-failure bug.
     * It is the opposite failure: solc's ABI decoder reverts on zero-length
     * returndata, so against a token that returns nothing at all — which real
     * Ethereum USDT does, on both transfer and transferFrom — the call cannot
     * complete even when the transfer itself succeeded. Deposit collateral,
     * withdraw collateral, service a request, create or close a listing and
     * borrow from one are all unusable for such a token. SafeERC20 handles the
     * empty return and the false return in one place, so both directions are
     * covered rather than trading one for the other.
     *
     * Nothing is lost by dropping the explicit bool checks: SafeERC20 reverts
     * with SafeERC20FailedOperation(token) where these reverted with
     * Protocol__TransferFailed(), which is strictly more information — the
     * frontend previously could not tell which token failed.
     *
     * The four native-value paths that shared those checks now revert with
     * `Protocol__TransferFailed()` rather than `require(sent,
     * "Protocol__TransferFailed")`. A string that spells a custom error's name
     * is a decode trap: `ethers-decode-error` puts a string revert in `reason`
     * and leaves `fragment` null, so every hook in the frontend that matches on
     * `err.fragment.name` — three of them — silently failed to recognise these,
     * while the two matching on `err.reason` worked. Now all six match, and
     * four 24-byte strings leave the bytecode, which this facet needs: it has
     * about 1,100 bytes of EIP-170 headroom. */
    using SafeERC20 for IERC20;

    LibAppStorage.Layout internal _appStorage;
    IPyth public pyth;
    IPythPriceOracle public pythPriceOracle;

    //////////////////
    /// Modifiers ///
    ////////////////

    /**
     * @dev Ensures that the provided token is allowed by checking
     *  if a price feed exists for it in the protocol
     * @param _token The address of the token to be verified
     */
    modifier _isTokenAllowed(address _token) {
        if (_appStorage.s_priceFeeds[_token] == bytes32(0)) {
            revert Protocol__TokenNotAllowed();
        }
        _;
    }

    /**
     * @dev Ensures that the provided amount is greater than zero
     * @param _amount The amount to be validated
     */
    modifier _moreThanZero(uint256 _amount) {
        if (_amount <= 0) {
            revert Protocol__MustBeMoreThanZero();
        }
        _;
    }

    /**
     * @dev Ensures that the provided amount Of the Native Token passed is greater than zero
     * @param _token The address of the token to be validated
     */
    modifier _nativeMoreThanZero(address _token) {
        if (_token == Constants.NATIVE_TOKEN) {
            if (msg.value <= 0) revert Protocol__MustBeMoreThanZero();
        } else if (msg.value != 0) {
            /* The ERC20 side of the same question.
             *
             * This modifier already knew which currency the call operates on and
             * only asserted the native case, so ETH attached to an ERC20 call
             * passed straight through: nothing downstream reads msg.value on that
             * branch, so it was credited to no ledger and left sitting in the
             * diamond, recoverable only by an owner sweep. Checking both
             * directions of the branch it is already testing costs nothing. */
            revert Protocol__UnexpectedNativeValue(msg.value);
        }
        _;
    }

    /**
     * @dev Ensures that the provided amount is greater than zero for depositing and withdraeing
     * @param _amount The amount to be validated
     * @param _token The address of the token to be validated
     */
    modifier _valueMoreThanZero(uint256 _amount, address _token) {
        if (_amount <= 0) {
            revert Protocol__MustBeMoreThanZero();
        }
        if (_token == Constants.NATIVE_TOKEN) {
            if (msg.value <= 0) revert Protocol__MustBeMoreThanZero();
        } else if (msg.value != 0) {
            /* See _nativeMoreThanZero — same stranding, same fix. */
            revert Protocol__UnexpectedNativeValue(msg.value);
        }
        _;
    }

    //////////////////
    /// FUNCTIONS ///
    ////////////////

    /// @param _tokenCollateralAddress The address of the token to deposit as collateral
    /// @param _amountOfCollateral The amount of collateral to deposit
    function depositCollateral(
        address _tokenCollateralAddress,
        uint256 _amountOfCollateral
    )
        external
        payable
        _valueMoreThanZero(_amountOfCollateral, _tokenCollateralAddress)
        _isTokenAllowed(_tokenCollateralAddress)
        nonReentrant
    {
        if (_tokenCollateralAddress == Constants.NATIVE_TOKEN) {
            _amountOfCollateral = msg.value;
        }

        _appStorage.s_addressToCollateralDeposited[msg.sender][
                _tokenCollateralAddress
            ] += _amountOfCollateral;
        _appStorage.s_addressToAvailableBalance[msg.sender][
                _tokenCollateralAddress
            ] += _amountOfCollateral;

        /* No points here.
         *
         * This awarded GITPOINT (100) plus a referral share, and
         * `withdrawCollateral` returns the deposit without deducting either — so
         * deposit/withdraw in a loop minted points for the price of gas, and paid
         * an upliner for the same loop. Points are awarded on settlement instead
         * (serviceRequest, requestLoanFromListing, repayLoan), where the action
         * cannot be undone.
         *
         * If collateral supply should be rewarded, that belongs on a
         * time-weighted balance snapshot, not on a per-transaction hook: the hook
         * pays for the act of depositing, which is free to reverse, rather than
         * for capital actually left at risk. */

        if (_tokenCollateralAddress != Constants.NATIVE_TOKEN) {
            IERC20(_tokenCollateralAddress).safeTransferFrom(
                msg.sender,
                address(this),
                _amountOfCollateral
            );
        }
        emit CollateralDeposited(
            msg.sender,
            _tokenCollateralAddress,
            _amountOfCollateral
        );
    }

    /**
     * @notice Creates a request for a loan
     * @param _amount The principal amount of the loan
     * @param _interest The interest rate of the loan (in percentage points)
     * @param _returnDate The unix timestamp by when the loan should be repaid
     * @param _loanCurrency The currency in which the loan is denominated
     * @dev This function calculates the required repayments and checks the borrower's collateral before accepting a loan request.
     */
    function createLendingRequest(
        uint128 _amount,
        uint16 _interest,
        uint256 _returnDate,
        address _loanCurrency
    ) external _moreThanZero(_amount) nonReentrant {
        if (!_appStorage.s_isLoanable[_loanCurrency]) {
            revert Protocol__TokenNotLoanable();
        }
        if (
            _appStorage.s_addressToCollateralDeposited[msg.sender][
                _loanCurrency
            ] > 0
        ) {
            revert Protocol__CannotBorrowCollateralAsset();
        }
        if (_returnDate <= block.timestamp + 1 days) {
            revert Protocol__DateMustBeInFuture();
        }

        //get token decimal
        uint8 decimal = _getTokenDecimal(_loanCurrency);

        //get usd value
        uint256 _loanUsdValue = getUsdValue(_loanCurrency, _amount, decimal);

        if (_loanUsdValue == 0) revert Protocol__InvalidAmount();
        if (_loanUsdValue < Constants.MIN_LOAN_AMOUNT) {
            revert Protocol__LoanAmountTooLow();
        }

        uint256 collateralValueInLoanCurrency = getAccountCollateralValue(
            msg.sender
        );
        if (collateralValueInLoanCurrency == 0) {
            revert Protocol__NoCollateralDeposited();
        }

        uint256 maxLoanableAmount = (collateralValueInLoanCurrency *
            Constants.COLLATERALIZATION_RATIO) / 100;

        if (
            _appStorage.addressToUser[msg.sender].totalLoanCollected +
                _loanUsdValue >=
            maxLoanableAmount
        ) {
            revert Protocol__InsufficientCollateral();
        }
        //
        address[] memory _collateralTokens = getUserCollateralTokens(
            msg.sender
        );

        _appStorage.requestId = _appStorage.requestId + 1;
        Request storage _newRequest = _appStorage.request[
            _appStorage.requestId
        ];
        _newRequest.requestId = _appStorage.requestId;
        _newRequest.author = msg.sender;
        _newRequest.amount = _amount;
        _newRequest.interest = _interest;
        _newRequest.returnDate = _returnDate;
        (
            _newRequest.totalRepayment,
            _newRequest.interestAccrued
        ) = _calculateLoanInterest(_returnDate, _amount, _interest);
        _newRequest.loanRequestAddr = _loanCurrency;
        _newRequest.collateralTokens = _collateralTokens;
        _newRequest.status = Status.OPEN;

        /* No points here either, and this was the cheapest of the three farms: a
         * request escrows nothing at all, so SPECIAL_GITPOINT (600) plus referral
         * was paid for a transaction that only wrote storage, and `closeRequest`
         * reopens the loop at will. A borrower earns at requestLoanFromListing or
         * repayLoan instead, once a loan actually exists. */

        uint256 collateralToLock = (_loanUsdValue * 100 * Constants.PRECISION) /
            maxLoanableAmount;

        for (uint256 i = 0; i < _collateralTokens.length; i++) {
            address token = _collateralTokens[i];
            uint8 _decimalToken = _getTokenDecimal(token);
            uint256 userBalance = _appStorage.s_addressToCollateralDeposited[
                msg.sender
            ][token];

            // Calculate the amount to lock for each token based on its proportion of the total collateral
            uint256 amountToLockUSD = (getUsdValue(
                token,
                userBalance,
                _decimalToken
            ) * collateralToLock) / 100;
            uint256 amountToLock = ((((amountToLockUSD) * 10) /
                getUsdValue(token, 10, 0)) * (10 ** _decimalToken)) /
                (Constants.PRECISION);

            _appStorage.s_idToCollateralTokenAmount[_appStorage.requestId][
                    token
                ] = amountToLock;
        }
        _appStorage.s_requests.push(_newRequest);
        _indexUserRequest(msg.sender, _newRequest.requestId);

        emit RequestCreated(
            msg.sender,
            _appStorage.requestId,
            _amount,
            _interest,
            _loanCurrency
        );
    }

    /// @notice Directly services a lending request by transferring funds to the borrower
    /// @param _requestId Identifier of the request being serviced
    /// @param _tokenAddress Token in which the funds are being transferred
    function serviceRequest(
        uint96 _requestId,
        address _tokenAddress
    ) external payable _nativeMoreThanZero(_tokenAddress) nonReentrant {
        Request storage _foundRequest = _appStorage.request[_requestId];
        Request storage _Request = _appStorage.s_requests[_requestId - 1];

        if (_foundRequest.status != Status.OPEN)
            revert Protocol__RequestNotOpen();
        if (_foundRequest.loanRequestAddr != _tokenAddress)
            revert Protocol__InvalidToken();
        if (_foundRequest.author == msg.sender) {
            revert Protocol__CantFundSelf();
        }
        if (_foundRequest.returnDate <= block.timestamp) {
            revert Protocol__RequestExpired();
        }

        uint256 amountToLend = _foundRequest.amount;

        // Check if the lender has enough balance and the allowance to transfer the tokens
        if (_tokenAddress == Constants.NATIVE_TOKEN) {
            if (msg.value < amountToLend) {
                revert Protocol__InsufficientAmount();
            }
        } else {
            if (IERC20(_tokenAddress).balanceOf(msg.sender) < amountToLend)
                revert Protocol__InsufficientBalance();
            if (
                IERC20(_tokenAddress).allowance(msg.sender, address(this)) <
                amountToLend
            ) revert Protocol__InsufficientAllowance();
        }

        uint8 _decimalToken = _getTokenDecimal(_tokenAddress);
        uint256 _loanUsdValue = getUsdValue(
            _tokenAddress,
            amountToLend,
            _decimalToken
        );
        if (_loanUsdValue == 0) revert Protocol__InvalidAmount();
        // _foundRequest.totalRepayment = _foundRequest.totalRepayment;
        // _Request.totalRepayment = _Request.totalRepayment;

        /* Constants.PRECISION, not 1e16. _healthFactor returns a ratio scaled by
         * PRECISION, so 1e16 asked for a health factor of 0.01 — it admitted a
         * borrower 100x under-collateralised. requestLoanFromListing, the other way
         * into a loan, already compared against PRECISION for the same check, so
         * the identical protection differed by 100x depending on which path the
         * loan came through. */
        if (
            _healthFactor(_foundRequest.author, _loanUsdValue) <
            Constants.PRECISION
        ) {
            revert Protocol__InsufficientCollateral();
        }

        /* Serviced *after* the health check, not before it.
         *
         * `_healthFactor` is passed `_loanUsdValue` because this loan is the
         * marginal borrow the check exists to price. Its other input,
         * `getLoanCollectedInUsd`, sums the totalRepayment of every request the
         * borrower has that currently reads SERVICED — so flipping the status
         * first put this same loan on both sides of the division and the gate
         * demanded roughly twice the collateral it was written to demand.
         *
         * Latent until now: the index those SERVICED requests are read from had
         * no writer outside an owner-only backfill, so the sum was always zero
         * and the ordering could not be observed. `requestLoanFromListing` checks
         * before it writes `Status.SERVICED`, and this is the same protection, so
         * the two paths agree again — which is the point of the note above. */
        _foundRequest.lender = msg.sender;
        _Request.lender = msg.sender;
        _foundRequest.status = Status.SERVICED;
        _Request.status = Status.SERVICED;

        // Update the request's status to serviced
        _appStorage
            .addressToUser[_foundRequest.author]
            .totalLoanCollected += _loanUsdValue;

        for (uint i = 0; i < _foundRequest.collateralTokens.length; i++) {
            uint256 availableBalance = _appStorage.s_addressToAvailableBalance[
                _foundRequest.author
            ][_foundRequest.collateralTokens[i]];
            uint256 requiredCollateral = _appStorage
                .s_idToCollateralTokenAmount[_requestId][
                    _foundRequest.collateralTokens[i]
                ];

            if (availableBalance < requiredCollateral) {
                revert Protocol__InsufficientCollateralBalance();
            }

            _appStorage.s_addressToAvailableBalance[_foundRequest.author][
                _foundRequest.collateralTokens[i]
            ] = availableBalance - requiredCollateral;
        }
        // Transfer the funds from the lender to the borrower
        if (_tokenAddress != Constants.NATIVE_TOKEN) {
            _appStorage.addressToUser[msg.sender].gitCoinPoint += Constants
                .SPECIAL_GITPOINT;
            _awardReferralPoints(msg.sender, Constants.SPECIAL_GITPOINT);
            IERC20(_tokenAddress).safeTransferFrom(
                msg.sender,
                _foundRequest.author,
                amountToLend
            );
        } else {
            _appStorage.addressToUser[msg.sender].gitCoinPoint += Constants
                .EXTRA_POINT;
            _awardReferralPoints(msg.sender, Constants.EXTRA_POINT);
            (bool sent, ) = payable(_foundRequest.author).call{
                value: amountToLend
            }("");
            if (!sent) revert Protocol__TransferFailed();
        }

        // Emit a success event with relevant details
        emit RequestServiced(
            _requestId,
            msg.sender,
            _foundRequest.author,
            amountToLend,
            _tokenAddress
        );
    }

    /// @notice Withdraws collateral from the protocol
    /// @param _tokenCollateralAddress Address of the collateral token
    /// @param _amount Amount of collateral to withdraw
    function withdrawCollateral(
        address _tokenCollateralAddress,
        uint128 _amount
    )
        external
        _isTokenAllowed(_tokenCollateralAddress)
        _moreThanZero(_amount)
        nonReentrant
    {
        uint256 depositedAmount = _appStorage.s_addressToAvailableBalance[
            msg.sender
        ][_tokenCollateralAddress];

        if (depositedAmount < _amount) {
            revert Protocol__InsufficientCollateralDeposited();
        }

        _appStorage.s_addressToCollateralDeposited[msg.sender][
            _tokenCollateralAddress
        ] -= _amount;
        _appStorage.s_addressToAvailableBalance[msg.sender][
            _tokenCollateralAddress
        ] -= _amount;

        /* Asserted on the decremented state, so it is the position the
         * withdrawal leaves behind that has to be healthy — not the one it
         * started from. The available-balance check above already stops a
         * borrower touching collateral earmarked to a funded loan; this stops
         * them stripping the *free* collateral out of a position whose ratio no
         * longer has room for it. See the note on the helper for why the two are
         * not the same bound. */
        _revertIfHealthFactorIsBroken(msg.sender);

        if (_tokenCollateralAddress == Constants.NATIVE_TOKEN) {
            (bool sent, ) = payable(msg.sender).call{value: _amount}("");
            if (!sent) revert Protocol__TransferFailed();
        } else {
            IERC20(_tokenCollateralAddress).safeTransfer(msg.sender, _amount);
        }
        emit CollateralWithdrawn(msg.sender, _tokenCollateralAddress, _amount);
    }

    /// @notice Adds new collateral tokens to the protocol
    /// @param _tokens Array of new collateral token addresses
    /// @param _priceFeeds Array of price feed addresses for the new collateral tokens

    function addCollateralTokens(
        address[] memory _tokens,
        bytes32[] memory _priceFeeds
    ) external {
        LibDiamond.enforceIsContractOwner();

        if (_tokens.length != _priceFeeds.length) {
            revert Protocol__tokensAndPriceFeedsArrayMustBeSameLength();
        }
        for (uint8 i = 0; i < _tokens.length; i++) {
            if (_appStorage.s_priceFeeds[_tokens[i]] != bytes32(0)) {
                revert Protocol__TokenAlreadyExists();
            }
            _appStorage.s_priceFeeds[_tokens[i]] = _priceFeeds[i];
            _appStorage.s_collateralToken.push(_tokens[i]);
        }
        emit UpdatedCollateralTokens(
            msg.sender,
            uint8(_appStorage.s_collateralToken.length)
        );
    }

    function addCollateralToken(address _token, bytes32 _priceFeed) external {
        LibDiamond.enforceIsContractOwner();
        if (_appStorage.s_priceFeeds[_token] != bytes32(0)) {
            revert Protocol__TokenAlreadyExists();
        }
        _appStorage.s_priceFeeds[_token] = _priceFeed;
        _appStorage.s_collateralToken.push(_token);

        emit UpdatedCollateralTokens(
            msg.sender,
            uint8(_appStorage.s_collateralToken.length)
        );
    }

    /**
     * @notice Records `requestId` against `user` so the debt side of their
     *         position is visible on chain.
     *
     * @dev Called from both sites that create a Request, which is the whole fix.
     *      Until this existed the index had exactly one writer — the owner-gated
     *      `addUserActiveRequest` below — so `getUserActiveRequests` was empty for
     *      every real borrower, `getLoanCollectedInUsd` returned 0, and
     *      `_healthFactor` had nothing to divide collateral by:
     *      `getHealthFactor` answered type(uint256).max for a borrower with live
     *      loans and `liquidateUserRequest` could only ever fire on an overdue
     *      term. Solvency was outsourced to a keyed off-chain keeper.
     *
     *      No duplicate scan here. `requestId` comes from `_appStorage.requestId`,
     *      which only increments, and each id is created exactly once — so a
     *      duplicate is unreachable from this path, and paying O(n) SLOADs to rule
     *      it out would be the entire cost of the fix spent on nothing. The
     *      owner-facing backfill does scan, because a manual call has no such
     *      guarantee.
     */
    function _indexUserRequest(address user, uint96 requestId) internal {
        _appStorage.userActiveRequet[user].push(requestId);
    }

    function addUserActiveRequest(address user, Request memory request) public {
        LibDiamond.enforceIsContractOwner();

        /* Only the id is kept — see the note on the storage field. The struct
           parameter stays in the signature because server/src/syncUserActiveRequets.ts
           calls this and `batchAddUserRequests` with full Request structs, and
           this is a backfill for loans created before _indexUserRequest existed,
           not a path worth breaking a running service over. */
        Request memory onChain = _appStorage.request[request.requestId];
        /* The author is checked against storage, not taken from the argument.
           Indexing a request into the wrong user's array adds that request's
           totalRepayment to their debt, which is enough on its own to make a
           healthy position liquidatable — so the one input that decides whose
           solvency this affects is not allowed to come from calldata. */
        if (onChain.author == address(0)) revert Protocol__IdNotExist();
        if (onChain.author != user) revert Protocol__NotOwner();

        uint96[] storage ids = _appStorage.userActiveRequet[user];
        for (uint256 i = 0; i < ids.length; i++) {
            if (ids[i] == request.requestId) {
                return; // Already indexed, don't add duplicate
            }
        }

        ids.push(request.requestId);
    }

    function removeUserActiveRequest(address user, uint96 requestId) external {
        LibDiamond.enforceIsContractOwner();

        uint96[] storage ids = _appStorage.userActiveRequet[user];
        for (uint256 i = 0; i < ids.length; i++) {
            if (ids[i] == requestId) {
                // Move last element to this position and pop
                ids[i] = ids[ids.length - 1];
                ids.pop();
                break;
            }
        }
    }

    function batchAddUserRequests(
        address user,
        Request[] calldata requests
    ) external {
        LibDiamond.enforceIsContractOwner();

        for (uint256 i = 0; i < requests.length; i++) {
            addUserActiveRequest(user, requests[i]);
        }
    }

    /// @notice Removes collateral tokens from the protocol
    /// @param _tokens Array of collateral token addresses to remove
    function removeCollateralTokens(address[] memory _tokens) external {
        LibDiamond.enforceIsContractOwner();

        for (uint8 i = 0; i < _tokens.length; i++) {
            _appStorage.s_priceFeeds[_tokens[i]] = bytes32(0);
            for (uint8 j = 0; j < _appStorage.s_collateralToken.length; j++) {
                if (_appStorage.s_collateralToken[j] == _tokens[i]) {
                    _appStorage.s_collateralToken[j] = _appStorage
                        .s_collateralToken[
                            _appStorage.s_collateralToken.length - 1
                        ];
                    _appStorage.s_collateralToken.pop();
                }
            }
        }
        emit UpdatedCollateralTokens(
            msg.sender,
            uint8(_appStorage.s_collateralToken.length)
        );
    }

    /// @dev For adding more tokens that are loanable on the platform
    /// @param _token the address of the token you want to be loanable on the protocol
    /// @param _priceFeed the address of the currency pair on chainlink
    function addLoanableToken(address _token, bytes32 _priceFeed) external {
        LibDiamond.enforceIsContractOwner();
        _appStorage.s_isLoanable[_token] = true;
        _appStorage.s_priceFeeds[_token] = _priceFeed;
        _appStorage.s_loanableToken.push(_token);
        emit UpdateLoanableToken(_token, _priceFeed, msg.sender);
    }

    /// @dev for upating git coin post score
    /// @param _user the address to the user you want to update
    /// @param _score the gitcoin point score.
    function updateGPScore(address _user, uint256 _score) public {
        LibDiamond.enforceIsContractOwner();
        _appStorage.addressToUser[_user].gitCoinPoint = _score;
        emit UpdatedGitPointScore(_user, _score);
    }

    /// @notice Registers referral relationship
    /// @dev Only callable by contract owner
    /// @param _upliner Sponsor address
    /// @param _downliner New member address

    function registerUpliner(address _upliner, address _downliner) external {
        LibDiamond.enforceIsContractOwner();
        if (
            address(_upliner) == address(0) || address(_downliner) == address(0)
        ) {
            revert Protocol__InvalidAddress();
        }
        if (address(_upliner) == address(_downliner)) {
            revert Protocol__UplinerCannotBeDownliner();
        }
        if (_appStorage.referral[_downliner] != address(0)) {
            revert Protocol__DownlinerAlreadyHasUpliner();
        }

        address current = _upliner;
        while (current != address(0)) {
            if (current == _downliner) {
                revert Protocol__CyclicReferral();
            }
            current = _appStorage.referral[current];
        }
        _appStorage.referral[_downliner] = _upliner;
        uint256 index = _appStorage.referralCount[_upliner];
        _appStorage.downliners[_upliner][index] = _downliner;
        _appStorage.referralCount[_upliner] = index + 1;
        emit UplinerRegistered(_upliner, _downliner);
    }

    /// @notice Awards referral points to upliner based on user's current points
    /// @param user The address of the user who earned points
    function _awardReferralPoints(address user, uint256 point) internal {
        // uint256 point = _appStorage.addressToUser[user].gitCoinPoint;
        uint256 referralpoints = Utils.calculateReferralPoints(
            point,
            Constants.REFERRAL_PERCENTAGE
        );
        address upliner = _appStorage.referral[user];
        if (upliner != address(0) && referralpoints > 0) {
            _appStorage.addressToUser[upliner].gitCoinPoint += referralpoints;
            _appStorage.referralPoints[upliner] += referralpoints;
            emit ReferralPointsAwarded(upliner, user, referralpoints);
        }
    }

    function getUpliner(address _downliner) public view returns (address) {
        return _appStorage.referral[_downliner];
    }

    function getDownliners(
        address _refferal,
        uint256 _index
    ) external view returns (address) {
        return _appStorage.downliners[_refferal][_index];
    }

    function getDownlinersCount(
        address _upliner
    ) external view returns (uint256) {
        return _appStorage.referralCount[_upliner];
    }

    function getReferralPoints(address _user) external view returns (uint256) {
        return _appStorage.referralPoints[_user];
    }

    /**
     * @notice Allows a user to withdraw the deposited ads token for a specific order
     * @dev Withdraws the ads token associated with an open order, closes the order, and emits an event
     * @param _listingId The ID of the order to withdraw the token from
     */
    function closeListingAd(uint96 _listingId) external nonReentrant {
        LoanListing storage _newListing = _appStorage.loanListings[_listingId];
        if (_newListing.listingStatus != ListingStatus.OPEN)
            revert Protocol__OrderNotOpen();
        if (_newListing.author != msg.sender)
            revert Protocol__OwnerCreatedOrder();
        if (_newListing.amount == 0) revert Protocol__MustBeMoreThanZero();

        uint256 _amount = _newListing.amount;
        _newListing.amount = 0;
        _newListing.listingStatus = ListingStatus.CLOSED;

        if (_newListing.tokenAddress == Constants.NATIVE_TOKEN) {
            (bool sent, ) = payable(msg.sender).call{value: _amount}("");
            if (!sent) revert Protocol__TransferFailed();
        } else {
            IERC20(_newListing.tokenAddress).safeTransfer(msg.sender, _amount);
        }

        emit withdrawnAdsToken(
            msg.sender,
            _listingId,
            uint8(_newListing.listingStatus),
            _amount
        );
    }

    function closeRequest(uint96 _requestId) external {
        Request storage _foundRequest = _appStorage.request[_requestId];
        Request storage _Request = _appStorage.s_requests[_requestId - 1];

        if (_foundRequest.status != Status.OPEN)
            revert Protocol__RequestNotOpen();
        if (_foundRequest.author != msg.sender) revert Protocol__NotOwner();

        _foundRequest.status = Status.CLOSED;
        _Request.status = Status.CLOSED;
    }

    /**
     * @notice Allows a user to create loan listing ads for a specific token with borrow limit
     * @dev creates a listing, transfers token from user to protocol, and emits an event
     * @param _amount The total amount of the loan to be listed. IGNORED when
     * `_loanCurrency` is the native sentinel — `msg.value` is authoritative
     * there and overwrites this before any validation.
     * @param _min_amount The minimum amount that can be borrowed from the
     * listing. Must not exceed `_max_amount`.
     * @param _max_amount The maximum amount that can be borrowed from the
     * listing. Must not exceed the escrowed amount.
     * @param _returnDate The total number of days the loan must be returned
     * @param _interest The interest rate to be applied to the loan
     * @param _loanCurrency The token address for the loan currency
     */
    function createLoanListing(
        uint256 _amount,
        uint256 _min_amount,
        uint256 _max_amount,
        uint256 _returnDate,
        uint16 _interest,
        address _loanCurrency
    )
        external
        payable
        _valueMoreThanZero(_amount, _loanCurrency)
        _moreThanZero(_amount)
        _moreThanZero(_max_amount)
        nonReentrant
    {
        if (!_appStorage.s_isLoanable[_loanCurrency]) {
            revert Protocol__TokenNotLoanable();
        }

        if (_returnDate <= block.timestamp + 1 days) {
            revert Protocol__DateMustBeInFuture();
        }

        /* Settle the escrowed amount BEFORE anything validates or rewards it.
         * On the native path `msg.value` is the only real deposit and the
         * `_amount` parameter is an unfunded caller claim, so it replaces
         * `_amount` up front rather than at the bottom next to the transfer,
         * which is where it used to sit.
         *
         * That ordering left three holes, all the same bug — validating an
         * input that is not the input being used — and all three close here:
         *   1. `SPECIAL_GITPOINT` (600) was awarded before the replacement, so
         *      1 wei plus gas farmed it repeatably, paying more than the ERC20
         *      path's `EXTRA_POINT` (500). That award has since been removed
         *      outright (see below), so this one is closed twice over.
         *   2. The 10 USD `MIN_LOAN_AMOUNT` floor was measured against the
         *      claim while the escrow was `msg.value`.
         *   3. The stored listing mixed a `msg.value` amount with bounds
         *      derived from the claim.
         * `_valueMoreThanZero` requires `_amount > 0` and, for native, that
         * `msg.value > 0` — but never that the two agree, which is the whole
         * gap. It caught none of them.
         *
         * Reachable only by a crafted call: useCreateLoanListing.ts sends
         * `{ value: _weiAmount }`, making this a no-op for the UI. And native
         * is loanable on none of the five deployed chains today — which is the
         * reason to fix it now, before that owner flag is flipped by someone
         * who does not know what it arms. */
        if (_loanCurrency == Constants.NATIVE_TOKEN) {
            _amount = msg.value;
        } else {
            if (IERC20(_loanCurrency).balanceOf(msg.sender) < _amount)
                revert Protocol__InsufficientBalance();

            if (
                IERC20(_loanCurrency).allowance(msg.sender, address(this)) <
                _amount
            ) revert Protocol__InsufficientAllowance();
        }

        /* The borrow bounds must bracket what was actually escrowed, or the
         * listing is funded and unfillable: `requestLoanFromListing` requires
         * `_amount >= min_amount` and `_amount <= _listing.amount` at the same
         * time, so `min_amount > amount` admits no satisfying draw. The author's
         * only exit is `closeListingAd`, which does refund — so this stranded
         * funds behind a second transaction rather than burning them.
         *
         * This is the invariant the contract already maintains everywhere else:
         * after every fill `requestLoanFromListing` clamps `max_amount` down to
         * the remaining `amount` and zeroes a `min_amount` that exceeds it.
         * Creation was the one path that never established it. Bounds equal to
         * `amount` are the ordinary case, so both checks are strict. */
        if (_min_amount > _max_amount) revert Protocol__InvalidAmount();
        if (_max_amount > _amount) revert Protocol__InvalidAmount();

        uint8 decimal = _getTokenDecimal(_loanCurrency);

        //get usd value
        uint256 _loanUsdValue = getUsdValue(_loanCurrency, _amount, decimal);

        if (_loanUsdValue == 0) revert Protocol__InvalidAmount();
        if (_loanUsdValue < Constants.MIN_LOAN_AMOUNT) {
            revert Protocol__LoanAmountTooLow();
        }

        /* No points here — the third and last of the reversible-action awards.
         * This paid SPECIAL_GITPOINT (600) on the native branch and EXTRA_POINT
         * (500) on the ERC20 one, and `closeListingAd` refunds the whole listing
         * without deducting either: 10 USD of USDC recycled indefinitely, one
         * award per round trip, gas the only cost.
         *
         * The award was not dropped, it moved: requestLoanFromListing credits
         * `_listing.author` a flat EXTRA_POINT when the listing is actually drawn
         * against, which is where the lender's capital genuinely leaves their
         * control and where it can no longer be recalled for free.
         *
         * The 600-vs-500 split looked unintentional too — the native path paid
         * more for strictly less work — so the move settles that as well. */

        if (_loanCurrency != Constants.NATIVE_TOKEN) {
            IERC20(_loanCurrency).safeTransferFrom(
                msg.sender,
                address(this),
                _amount
            );
        }

        _appStorage.listingId = _appStorage.listingId + 1;
        LoanListing storage _newListing = _appStorage.loanListings[
            _appStorage.listingId
        ];
        _newListing.listingId = _appStorage.listingId;
        _newListing.author = msg.sender;
        _newListing.amount = _amount;
        _newListing.min_amount = _min_amount;
        _newListing.max_amount = _max_amount;
        _newListing.interest = _interest;
        _newListing.returnDate = _returnDate;
        _newListing.tokenAddress = _loanCurrency;
        _newListing.listingStatus = ListingStatus.OPEN;
        _newListing.isFeatured = false; // Default: user-created, not featured

        // Check if this is a featured pool (created by admin/vault address)
        // You can add a whitelist or check specific address here
        // For now, we'll leave it as false by default

        emit LoanListingCreated(
            _appStorage.listingId,
            msg.sender,
            _loanCurrency,
            _amount,
            _min_amount,
            _max_amount,
            _returnDate,
            _interest,
            _loanCurrency
        );
    }

    /**
     * @notice Mark a listing as featured (admin only)
     * @dev Only contract owner can mark listings as featured
     * @param _listingId The ID of the listing to feature
     */
    function setListingFeatured(uint96 _listingId, bool _featured) external {
        LibDiamond.enforceIsContractOwner();
        LoanListing storage _listing = _appStorage.loanListings[_listingId];
        require(_listing.listingId != 0, "Protocol: Listing does not exist");

        _listing.isFeatured = _featured;

        emit LoanListingCreated(
            _listingId,
            _listing.author,
            _listing.tokenAddress,
            _listing.amount,
            _listing.min_amount,
            _listing.max_amount,
            _listing.returnDate,
            _listing.interest,
            _listing.tokenAddress
        );
    }

    /**
     * @notice Allows a user to request a loan from a listing ad
     * @dev creates a request from the listing, transfers token from protocol to user and emits an event
     * @param _listingId The id of the listing to request a loan from
     * @param _amount The amount that should be borrowed from the listing
     */

    function requestLoanFromListing(
        uint96 _listingId,
        uint256 _amount
    ) public _moreThanZero(_amount) nonReentrant {
        LoanListing storage _listing = _appStorage.loanListings[_listingId];
        if (_listing.listingStatus != ListingStatus.OPEN)
            revert Protocol__ListingNotOpen();

        if (_listing.author == msg.sender)
            revert Protocol__OwnerCreatedListing();

        if ((_amount < _listing.min_amount) || (_amount > _listing.max_amount))
            revert Protocol__InvalidAmount();

        if (_amount > _listing.amount) revert Protocol__InvalidAmount();
        if (
            _appStorage.s_addressToCollateralDeposited[msg.sender][
                _listing.tokenAddress
            ] > 0
        ) {
            revert Protocol__CannotBorrowCollateralAsset();
        }
        uint8 loanTokenDecimals = _getTokenDecimal(_listing.tokenAddress);
        uint256 loanUsdValue = getUsdValue(
            _listing.tokenAddress,
            _amount,
            loanTokenDecimals
        );

        if (_healthFactor(msg.sender, loanUsdValue) < Constants.PRECISION)
            revert Protocol__InsufficientCollateral();

        uint256 collateralValueUsd = getAccountCollateralValue(msg.sender);
        uint256 maxLoanableUsd = (collateralValueUsd *
            Constants.COLLATERALIZATION_RATIO) / 100;

        /* The borrow limit, enforced here rather than merely implied.
         *
         * The health factor check above prices collateral at
         * LIQUIDATION_THRESHOLD (80), so on its own it admits a loan of up to
         * 80% of collateral value — while `maxLoanableUsd` is 75%, and
         * `collateralPortionToLock` below is a fraction *of* `maxLoanableUsd`.
         * Anything in that five-point gap therefore produces a portion above
         * 1e18, and the lock loop subtracts more than the borrower deposited:
         * an arithmetic panic, not Protocol__InsufficientCollateral. While the
         * ratio and the threshold were both 80 the portion could not exceed
         * 1e18 and this check was unnecessary; it is the price of separating
         * them.
         *
         * Cumulative rather than per-loan, for the same reason. Every request
         * computes its portion against the borrower's entire deposited balance
         * (getAccountCollateralValue and the loop below both read
         * s_addressToCollateralDeposited, which locking does not decrement), so
         * the locks only fit inside that balance if the sum of all outstanding
         * loans respects the limit. Bounding this loan alone would let two pass
         * and the second underflow. Holds in both price directions, because the
         * limit is checked against the current collateral value while earlier
         * locks were fixed as token amounts.
         *
         * createLendingRequest has always carried this check, which is why that
         * path was never exposed to either failure. This one was safe only by
         * coincidence.
         *
         * It also covers `maxLoanableUsd == 0`, which would divide by zero on
         * the next line. */
        if (
            _appStorage.addressToUser[msg.sender].totalLoanCollected +
                loanUsdValue >=
            maxLoanableUsd
        ) {
            revert Protocol__InsufficientCollateral();
        }

        // Calculate what portion of total collateral value to lock
        uint256 collateralPortionToLock = (loanUsdValue * Constants.PRECISION) /
            maxLoanableUsd;

        // Update listing
        _listing.amount -= _amount;

        if (_listing.amount <= _listing.max_amount) {
            _listing.max_amount = _listing.amount;
        }

        if (_listing.amount <= _listing.min_amount) {
            _listing.min_amount = 0;
        }

        if (_listing.amount == 0) {
            _listing.listingStatus = ListingStatus.CLOSED;
        }

        address[] memory userCollateralTokens = getUserCollateralTokens(
            msg.sender
        );

        // Create request
        _appStorage.requestId += 1;
        Request storage newRequest = _appStorage.request[_appStorage.requestId];
        newRequest.requestId = _appStorage.requestId;
        newRequest.author = msg.sender;
        newRequest.listingId = _listingId;
        newRequest.lender = _listing.author;
        newRequest.amount = _amount;
        newRequest.interest = _listing.interest;
        newRequest.returnDate = _listing.returnDate;
        (
            newRequest.totalRepayment,
            newRequest.interestAccrued
        ) = _calculateLoanInterest(
            _listing.returnDate,
            _amount,
            _listing.interest
        );
        newRequest.loanRequestAddr = _listing.tokenAddress;
        newRequest.collateralTokens = userCollateralTokens;
        newRequest.status = Status.SERVICED;

        for (uint256 i = 0; i < userCollateralTokens.length; i++) {
            address token = userCollateralTokens[i];
            uint8 tokenDecimals = _getTokenDecimal(token);
            uint256 userBalance = _appStorage.s_addressToCollateralDeposited[
                msg.sender
            ][token];

            // Get USD value of user balance
            uint256 userBalanceUsd = getUsdValue(
                token,
                userBalance,
                tokenDecimals
            );

            // Calculate how much USD of this token to lock (proportional to its share of total collateral)
            uint256 usdToLockFromToken = (userBalanceUsd *
                collateralPortionToLock) / Constants.PRECISION;

            // convert that USD value back to token amount
            uint256 tokenAmountToLock = (usdToLockFromToken *
                (10 ** tokenDecimals)) /
                getUsdValue(token, 10 ** tokenDecimals, tokenDecimals);

            _appStorage.s_idToCollateralTokenAmount[_appStorage.requestId][
                    token
                ] = tokenAmountToLock;
            _appStorage.s_addressToAvailableBalance[msg.sender][
                    token
                ] -= tokenAmountToLock;
        }

        _appStorage.s_requests.push(newRequest);
        _indexUserRequest(msg.sender, newRequest.requestId);
        _appStorage
            .addressToUser[msg.sender]
            .totalLoanCollected += loanUsdValue;

        /* The lender's award, paid here rather than at createLoanListing.
         *
         * Credited to `_listing.author`, not msg.sender — msg.sender is the
         * borrower on this path, as the transfers below show. This is the other
         * half of removing the creation award: without it a lender who funds the
         * market by posting a listing would earn nothing at any point in its
         * lifecycle, while a lender who services a request still earns at
         * serviceRequest. The award moves to the fill, it does not disappear.
         *
         * Flat EXTRA_POINT for either currency, deliberately not the 600/500
         * native-vs-ERC20 split used just below: that split paid more for the
         * native path and nothing suggests it was intended.
         *
         * The author cannot farm this. Self-filling reverts at
         * Protocol__OwnerCreatedListing above, and a second wallet drawing the
         * listing owes the interest fixed by _calculateLoanInterest whether it
         * repays immediately or not — so a fill costs real money to manufacture. */
        _appStorage.addressToUser[_listing.author].gitCoinPoint += Constants
            .EXTRA_POINT;
        _awardReferralPoints(_listing.author, Constants.EXTRA_POINT);

        // Transfer funds to borrower
        if (_listing.tokenAddress == Constants.NATIVE_TOKEN) {
            _appStorage.addressToUser[msg.sender].gitCoinPoint += Constants
                .SPECIAL_GITPOINT;
            _awardReferralPoints(msg.sender, Constants.SPECIAL_GITPOINT);
            (bool sent, ) = payable(msg.sender).call{value: _amount}("");
            if (!sent) revert Protocol__TransferFailed();
        } else {
            _appStorage.addressToUser[msg.sender].gitCoinPoint += Constants
                .EXTRA_POINT;
            _awardReferralPoints(msg.sender, Constants.EXTRA_POINT);
            IERC20(_listing.tokenAddress).safeTransfer(msg.sender, _amount);
        }

        emit RequestCreated(
            msg.sender,
            _appStorage.requestId,
            _amount,
            _listing.interest,
            _listing.tokenAddress
        );
    }

    /// @notice Allows a borrower to repay their loan
    /// @dev Handles both native token and ERC20 token repayments, including protocol fee calculations
    /// @param _requestId The ID of the loan request to repay
    /// @param _amount The amount to repay
    function repayLoan(
        uint96 _requestId,
        uint256 _amount
    ) external payable nonReentrant {
        require(_amount > 0, "Protocol__MustBeMoreThanZero");
        Request storage _request = _appStorage.request[_requestId];
        Request storage _foundRequest = _appStorage.s_requests[_requestId - 1];
        uint256 _returnedAmount;
        if (_request.status != Status.SERVICED)
            revert Protocol__RequestNotServiced();

        if (msg.sender != _request.author) revert Protocol__NotOwner();

        bool _isNative = _request.loanRequestAddr == Constants.NATIVE_TOKEN;

        /* Native ignores the _amount parameter — the payment is whatever was
         * sent — so it has to be resolved before the clamp below, and
         * re-checked: the require at the top of the function only saw the
         * parameter, so repayLoan(id, 1) with no value reached the accounting
         * below as a zero payment and still awarded points. */
        if (_isNative) {
            _amount = msg.value;
            require(_amount > 0, "Protocol__MustBeMoreThanZero");
        } else if (msg.value != 0) {
            /* The ERC20 branch below pulls the repayment with transferFrom and
             * never reads msg.value, and _nativeRefund is only ever set on the
             * native path — so ETH attached here was neither used, refunded nor
             * credited to any ledger. It stayed in the diamond as an unowned
             * balance.
             *
             * This cannot use the modifiers the other three payable entry points
             * share: the currency is _request.loanRequestAddr, which is not known
             * until the request has been read out of storage. */
            revert Protocol__UnexpectedNativeValue(msg.value);
        }

        /* Clamp before anything moves. The borrower owes at most
         * totalRepayment, so that is the most that should leave their wallet,
         * the most the protocol fee should be charged on, and the most the
         * lender should be credited.
         *
         * This used to happen *after* both transfers and applied only to
         * _amount, while _returnedAmount — the figure actually credited to the
         * lender — kept its unclamped value. Overpaying therefore handed the
         * lender the excess, refunded the borrower nothing, and skimmed a fee
         * off the overpayment as well. */
        uint256 _outstanding = _request.totalRepayment;
        bool _fullyRepaid = _amount >= _outstanding;

        /* Native value has already arrived, so an overpayment can only be sent
         * back. An ERC20 has not been pulled yet, so the clamp alone is the
         * whole fix there: the excess never leaves the borrower's wallet and
         * there is nothing to refund. */
        uint256 _nativeRefund = 0;
        if (_fullyRepaid) {
            if (_isNative) _nativeRefund = _amount - _outstanding;
            _amount = _outstanding;
        }

        /* The protocol's cut is a share of the interest, never of the principal.
         *
         * This used to charge ONE_PERCENT_BPS against `_amount`, which is
         * principal *plus* interest — so the fee scaled with the size of the
         * loan rather than with what the loan earned. Because the fee is taken
         * out of the repayment before the lender is credited, that made lending
         * loss-making on any term short enough that the interest had not yet
         * caught up with the toll: at 100 bps on 10% APR the lender was
         * underwater until day 36.9, and MIN_LOAN_DURATION is 1 day. A lender
         * funding a one-day loan of 1000 collected 0.27 in interest and paid
         * 10.00 in fee.
         *
         * No comparable protocol prices it this way. Aave's reserve factor,
         * Compound v3's rate spread, Morpho Blue's `interest.wMulDown(fee)` and
         * Lido's 10% are all fractions of yield; Aave's flashloan premium is the
         * one fee on principal, for a loan with no duration to earn over.
         *
         * Charging interest only makes the lender's return strictly positive at
         * every term — the fee cannot exceed what the position earned, because
         * it is a fraction of it.
         *
         * Both guards were on the native branch only. The ERC20 branch computed
         * a fee with an unset bps (silently zero) and transferred it to an unset
         * vault (address(0), which for most tokens is a burn). Hoisted so one
         * check covers both. */
        if (_appStorage.kaleidoFeeVault == address(0))
            revert Protocol__InvalidFeeVault();
        if (_appStorage.ONE_PERCENT_BPS == 0) revert Protocol__InvalidFeeBps();

        uint256 protocolFee = _repaymentFee(_request, _amount);
        _returnedAmount = _amount - protocolFee;

        if (_isNative) {
            /* Skipped when the fee floors to zero. A zero-value call is not
             * free — it executes the vault's receive() — and on a dust payment
             * the interest share can round to nothing. */
            if (protocolFee > 0) {
                (bool success, ) = _appStorage.kaleidoFeeVault.call{
                    value: protocolFee
                }("");
                require(success, "Protocol fee transfer failed");
            }
        } else {
            IERC20 _token = IERC20(_request.loanRequestAddr);
            if (_token.balanceOf(msg.sender) < _amount) {
                revert Protocol__InsufficientBalance();
            }
            if (_token.allowance(msg.sender, address(this)) < _amount)
                revert Protocol__InsufficientAllowance();
            /* Return values were discarded here. A token that reports failure
             * by returning false rather than reverting would have left the
             * repayment credited to the lender with nothing having moved. */
            require(
                _token.transferFrom(msg.sender, address(this), _amount),
                "Repayment transfer failed"
            );
            if (protocolFee > 0) {
                require(
                    _token.transfer(_appStorage.kaleidoFeeVault, protocolFee),
                    "Protocol fee transfer failed"
                );
            }
        }

        if (_fullyRepaid) {
            _request.totalRepayment = 0;
            _foundRequest.totalRepayment = 0;
            _request.status = Status.CLOSED;
            _foundRequest.status = Status.CLOSED;
        } else {
            _request.totalRepayment -= _amount;
            _foundRequest.totalRepayment -= _amount;
        }

        uint8 decimal = _getTokenDecimal(_request.loanRequestAddr);
        uint256 _loanUsdValue = getUsdValue(
            _request.loanRequestAddr,
            _amount,
            decimal
        );
        uint256 loanCollected = getLoanCollectedInUsd(msg.sender);

        _appStorage.s_addressToCollateralDeposited[_request.lender][
                _request.loanRequestAddr
            ] += _returnedAmount;
        _appStorage.s_addressToAvailableBalance[_request.lender][
                _request.loanRequestAddr
            ] += _returnedAmount;
        _appStorage.addressToUser[msg.sender].gitCoinPoint += Constants
            .SPECIAL_GITPOINT;
        _awardReferralPoints(msg.sender, Constants.SPECIAL_GITPOINT);

        /* Collateral is released only when the loan actually closes, and each
         * amount is zeroed as it is credited.
         *
         * This loop used to sit at function level and never clear the
         * mapping, so a 1-wei payment unlocked the borrower's entire
         * collateral, and every further payment credited the same amount
         * again: the position could be emptied without the loan ever being
         * repaid. Both halves matter. The gate stops a partial payment
         * releasing anything; the zeroing makes the release happen once.
         *
         * `serviceRequest` debited s_addressToAvailableBalance by exactly
         * this mapping when the loan was funded, so crediting it back is
         * that operation's inverse. s_addressToCollateralDeposited is
         * deliberately untouched: it is the total deposited, which locking
         * and releasing do not change. */
        if (_fullyRepaid) {
            for (uint i = 0; i < _request.collateralTokens.length; i++) {
                address _collateralToken = _request.collateralTokens[i];
                uint256 _lockedAmount = _appStorage.s_idToCollateralTokenAmount[
                    _requestId
                ][_collateralToken];
                if (_lockedAmount == 0) continue;
                _appStorage.s_idToCollateralTokenAmount[_requestId][
                    _collateralToken
                ] = 0;
                _appStorage.s_addressToAvailableBalance[_request.author][
                    _collateralToken
                ] += _lockedAmount;
            }
        }
        if (loanCollected > _loanUsdValue) {
            _appStorage.addressToUser[msg.sender].totalLoanCollected =
                loanCollected -
                _loanUsdValue;
        } else {
            _appStorage.addressToUser[msg.sender].totalLoanCollected = 0;
        }

        /* Last, after every state write: this is an external call to an address
         * the borrower controls. nonReentrant already guards the function, but
         * ordering it here means a re-entrant callee would find the loan
         * already closed and the collateral already released.
         *
         * Reverting on a failed refund is deliberate. The alternative is
         * keeping the excess, and it would be credited to nobody — it would
         * simply sit in the diamond — so a borrower whose fallback rejects ETH
         * is better served by the transaction failing and being retried with
         * the exact amount. */
        if (_nativeRefund > 0) {
            (bool refunded, ) = msg.sender.call{value: _nativeRefund}("");
            require(refunded, "Refund failed");
        }

        /* `lender` is indexed so the party being repaid can filter for this at
         * all: a repayment is the one loan event the counterparty learns about
         * from nobody, since the borrower's own wallet confirms their transaction
         * but nothing tells the lender their capital came back.
         *
         * `outstanding` is _request.totalRepayment read after the clamp above, so
         * it is 0 exactly when the loan closed and positive for an instalment.
         * Carried in the event so a subscriber can tell those apart without a
         * follow-up read. */
        emit LoanRepayment(
            msg.sender,
            _request.lender,
            _requestId,
            _amount,
            _request.totalRepayment
        );
    }

    /// @notice Liquidates a user's loan position if health factor is below threshold or loan is overdue
    /// @dev Permissionless: anyone may call this, and the caller is paid a share
    ///      of the penalty in collateral for doing so.
    /// @param requestId The ID of the loan request to liquidate
    /**
     * @dev Settles by handing the seized collateral over as collateral. Nothing
     *      leaves the diamond here and no token is swapped.
     *
     *      That is the change that makes this function solvent. It used to pay
     *      the lender, the liquidator and the fee vault in the *loan* currency,
     *      through three loan-currency payout legs, while bringing in no
     *      loan-currency
     *      tokens whatsoever — the liquidator repaid nothing, and the seized
     *      collateral was decremented from the borrower and credited to nobody.
     *      Every liquidation therefore paid out real tokens that the diamond
     *      held only because other users had deposited them. It drained
     *      third-party deposits, and the shortfall surfaced much later as a
     *      failed `withdrawCollateral` for whoever happened to be last out.
     *
     *      Paying in collateral is what a peer-to-peer book can actually do.
     *      Aave, Compound v3 and Morpho Blue can demand the loan asset because
     *      the pool is the counterparty and holds it; here `serviceRequest`
     *      sends the loan lender -> borrower directly, so the diamond never
     *      held a unit of it. The protocols where the lender is a specific
     *      person settle the way this now does: NFTfi transfers the collateral
     *      to the lender on default, and Blend lets the lender take possession
     *      of the collateral when no one refinances. The lender ends up with the
     *      asset and sells it themselves, on their own timing and slippage.
     *
     *      The waterfall is unchanged in substance — the lender's claim first,
     *      then the penalty, then the borrower keeps whatever was not seized —
     *      but it is now computed in USD once and applied pro-rata to each
     *      seized token, so every recipient receives the same mix of assets
     *      rather than one of them taking whichever token was enumerated first.
     *      A position too far underwater to cover both yields a reduced penalty
     *      or none at all, because the shortfall belongs on the penalty and
     *      never on the lender.
     *
     *      Each recipient is credited on *both* ledgers.
     *      `s_addressToCollateralDeposited` is the accounting total and
     *      `s_addressToAvailableBalance` is what `withdrawCollateral` pays
     *      against; crediting one without the other would either strand the
     *      tokens or release more than came in. Because the three credits sum to
     *      exactly the amount seized, the sum of all deposited balances is
     *      invariant across a liquidation — the diamond's token balance already
     *      backed that collateral and still does. Solvent by construction,
     *      rather than by assumption about a price.
     *
     *      One consequence worth knowing: the lender, the liquidator and the
     *      fee vault each come away with an internal collateral position rather
     *      than a transfer, and each must call `withdrawCollateral` to take the
     *      tokens out. For the fee vault that means liquidation revenue accrues
     *      inside the diamond until the multisig withdraws it.
     */
    function liquidateUserRequest(uint96 requestId) external nonReentrant {
        /* Was `onlyBot`, which also performed this check. The gate is gone
         * because settlement is now solvent: there is nothing for an arbitrary
         * caller to extract, so competition for the penalty is safe to allow,
         * and it is what Aave, Compound v3 and Morpho Blue all rely on to get
         * positions closed promptly. Bot-only made a single protocol-run key a
         * liveness dependency for every position in the book. */
        if (requestId == 0) revert Protocol__MustBeMoreThanZero();

        Request memory _foundRequest = getActiveRequestsByRequestId(requestId);
        // Request storage _foundRequest = _appStorage.s_requests[requestId - 1];

        /* Scoped, and the lender and borrower read off `_foundRequest` at the
         * two places that need them rather than bound here.
         *
         * This is the first of four reductions in how much of this function is
         * live at once; the seizure, the USD waterfall and the settlement are
         * now the three private functions below it. Whole, it carried about
         * twenty live locals by the settlement leg and solc's legacy code
         * generator ran out of addressable stack slots at three separate points
         * in it. Scoping alone was not enough at any of them — each fix moved
         * the error further down rather than removing it, which is what
         * eventually established that the limit was the function's total live
         * set and not any one statement. See the note on
         * `_seizeCollateralForLiquidation` for why the facet also carries a
         * `viaIR` override in hardhat.config.js. */
        uint256 loanUsdValue;
        {
            address loanCurrency = _foundRequest.loanRequestAddr;
            loanUsdValue = getUsdValue(
                loanCurrency,
                _foundRequest.totalRepayment,
                _getTokenDecimal(loanCurrency)
            );
        }
        require(loanUsdValue > 0, "Protocol__InvalidAmount");
        if (_foundRequest.status != Status.SERVICED)
            revert Protocol__RequestNotServiced();

        if (
            _healthFactor(_foundRequest.author, 0) >= Constants.PRECISION &&
            block.timestamp <= _foundRequest.returnDate
        ) {
            revert Protocol__PositionHealthy();
        } else {
            uint256 len = _foundRequest.collateralTokens.length;

            if (_appStorage.kaleidoFeeVault == address(0))
                revert Protocol__InvalidFeeVault();
            if (_appStorage.LIQUIDITY_BPS == 0)
                revert Protocol__InvalidFeeBps();

            /* Seize the debt *plus* the penalty. This was `loanUsdValue` alone,
             * which is what forced the penalty to be carved out of the lender's
             * proceeds — there was nothing else to take it from. The loop stops
             * early when the borrower's collateral runs out, so asking for more
             * than the position holds is safe: it just seizes everything. */
            (
                uint256[] memory seizedAmounts,
                uint256 totalCollateralUsdValue
            ) = _seizeCollateralForLiquidation(
                    requestId,
                    _foundRequest.author,
                    _foundRequest.collateralTokens,
                    loanUsdValue +
                        Utils.calculateFeesPercentage(
                            loanUsdValue,
                            _appStorage.LIQUIDITY_BPS
                        )
                );

            require(
                totalCollateralUsdValue > 0,
                "totalCollateralUsdValue must be more than zero"
            );

            for (uint256 i = 0; i < len; ++i) {
                address collateralToken = _foundRequest.collateralTokens[i];
                uint256 lockedAmountRemaining = _appStorage
                    .s_idToCollateralTokenAmount[requestId][collateralToken];

                if (lockedAmountRemaining > 0) {
                    // Unlock it back to user
                    _appStorage.s_addressToAvailableBalance[
                        _foundRequest.author
                    ][collateralToken] += lockedAmountRemaining;
                    _appStorage.s_idToCollateralTokenAmount[requestId][
                        collateralToken
                    ] = 0;
                }
            }

            if (loanUsdValue == 0) revert Protocol__LoanValueZero();

            (
                uint256 liquidatorUsd,
                uint256 protocolUsd
            ) = _liquidationPenaltySplitUsd(
                    totalCollateralUsdValue,
                    loanUsdValue
                );

            /* Written off in full. The request is CLOSED below and can never be
             * repaid, so leaving a positive `totalRepayment` behind would be
             * unreachable state that only misreports the loan as still owing on
             * every read path. A lender whose collateral fell short has no
             * residual claim — that is the fixed-term peer-to-peer convention,
             * where the collateral *is* the recovery, and it is why the lender
             * prices default risk into the interest rather than relying on
             * recourse the protocol cannot enforce. */
            _appStorage.request[requestId].totalRepayment = 0;
            _appStorage.s_requests[requestId - 1].totalRepayment = 0;

            uint256 loanCollected = getLoanCollectedInUsd(_foundRequest.author);
            if (loanCollected > loanUsdValue) {
                _appStorage
                    .addressToUser[_foundRequest.author]
                    .totalLoanCollected = loanCollected - loanUsdValue;
            } else {
                _appStorage
                    .addressToUser[_foundRequest.author]
                    .totalLoanCollected = 0;
            }

            _appStorage.request[requestId].status = Status.CLOSED;
            _appStorage.s_requests[requestId - 1].status = Status.CLOSED;

            /* Settlement. Runs only once the request reads CLOSED and the
             * borrower's balances are settled, which is the same ordering the
             * three payout legs this replaced eventually adopted — kept
             * because `withdrawCollateral` is reachable by any of these
             * addresses in a later transaction, so the state they will observe
             * should be the finished one.
             *
             * These are ledger writes, not transfers: no token moves, no
             * external call is made, and nothing here can fail on a hostile
             * recipient. A contract that cannot receive ETH, a token with a
             * blocklist, a fee-on-transfer collateral — none of them can block a
             * liquidation any more, because the liquidation no longer needs the
             * recipient to accept anything. */
            _settleLiquidationProceeds(
                _foundRequest,
                seizedAmounts,
                totalCollateralUsdValue,
                liquidatorUsd,
                protocolUsd
            );

            /* The fourth field is the debt discharged, which is now always the
             * whole of it. What the lender actually recovered is denominated in
             * collateral tokens and cannot be expressed in this event's single
             * loan-currency field; it is readable from the balances credited
             * just above. The signature is left alone because
             * `useProtocolEvents` filters on the three indexed addresses and
             * reads only `requestId`. */
            emit RequestLiquidated(
                requestId,
                _foundRequest.lender,
                _foundRequest.author,
                _foundRequest.totalRepayment
            );
        }
    }

    /// @notice Takes a borrower's collateral, up to a USD target, and clears
    ///         what it takes from both the per-request lock and their deposit.
    /// @dev First of the three pieces `liquidateUserRequest` was split into, for
    ///      the stack rather than for reuse. Whole, that function carried about
    ///      twenty live locals by its settlement leg and solc's legacy code
    ///      generator ran out of addressable stack slots at three separate
    ///      points in it. The split is not on its own enough to make the facet
    ///      buildable — `createLoanListing`, which nothing in this repo has
    ///      edited, fails the same way, and hardhat.config.js therefore carries
    ///      a `viaIR` override for this file. What the split buys is that the
    ///      liquidation path is no longer one edit away from re-breaking, and
    ///      that each piece can be read without holding the other two.
    ///
    ///      This one has a single caller and is meaningless without the
    ///      settlement that follows it there: on its own it debits the borrower
    ///      and credits nobody. Private, so it adds no diamond selector.
    /// @param requestId The request whose locked collateral is being seized.
    /// @param borrower The request's author, whose deposits are debited.
    /// @param collateralTokens The token list recorded on the request.
    /// @param targetUsd Debt plus penalty. Asking for more than the position
    ///        holds is safe — the loop stops when the collateral runs out, and
    ///        the caller checks the total it got back.
    /// @return seizedAmounts Per token, positionally aligned with
    ///         `collateralTokens`.
    /// @return totalSeizedUsd USD value of everything seized.
    function _seizeCollateralForLiquidation(
        uint96 requestId,
        address borrower,
        address[] memory collateralTokens,
        uint256 targetUsd
    )
        private
        returns (uint256[] memory seizedAmounts, uint256 totalSeizedUsd)
    {
        uint256 len = collateralTokens.length;
        uint256 remaining = targetUsd;

        /* What each collateral token actually gave up. Settlement hands these
         * very amounts over, so it needs them per token — the running USD total
         * cannot be decomposed back into them, and re-deriving each from a price
         * would let two reads of the same oracle disagree within one
         * transaction. One memory word per collateral asset named on the
         * request. */
        seizedAmounts = new uint256[](len);

        for (uint256 i = 0; i < len && remaining > 0; ++i) {
            address collateralToken = collateralTokens[i];
            uint256 amountOfCollateralToken = _appStorage
                .s_idToCollateralTokenAmount[requestId][collateralToken];

            /* Was `require(amountOfCollateralToken > 0)`, which bricked the
             * entire liquidation over a single unlocked token.
             * `collateralTokens` is assigned the borrower's whole token list
             * at request time, and the lock loop in `requestLoanFromListing`
             * writes a zero for any token whose proportional share rounds
             * down to nothing — so one dust balance was enough to make a
             * position permanently unliquidatable. Skip the token instead;
             * there is nothing locked under it to take. */
            if (amountOfCollateralToken == 0) continue;

            uint8 collateralDecimals = _getTokenDecimal(collateralToken);
            uint256 collateralUsd = getUsdValue(
                collateralToken,
                amountOfCollateralToken,
                collateralDecimals
            );

            // Fixed liquidation logic with proper balance checking
            if (collateralUsd <= remaining) {
                // Take all - but check available balances first
                uint256 userDepositedBalance = _appStorage
                    .s_addressToCollateralDeposited[borrower][
                        collateralToken
                    ];
                uint256 actualAmountToSeize = amountOfCollateralToken;

                // If we don't have enough in deposited balance, take what's available
                if (userDepositedBalance < amountOfCollateralToken) {
                    actualAmountToSeize = userDepositedBalance;
                    // Recalculate the USD value based on what we can actually seize
                    collateralUsd = getUsdValue(
                        collateralToken,
                        actualAmountToSeize,
                        collateralDecimals
                    );
                }

                // Only subtract if we have something to subtract
                if (
                    actualAmountToSeize > 0 &&
                    userDepositedBalance >= actualAmountToSeize
                ) {
                    _appStorage.s_addressToCollateralDeposited[
                        borrower
                    ][collateralToken] -= actualAmountToSeize;
                    _appStorage.s_idToCollateralTokenAmount[requestId][
                        collateralToken
                    ] = 0;
                    seizedAmounts[i] = actualAmountToSeize;
                    remaining -= collateralUsd;
                    totalSeizedUsd += collateralUsd;
                }
            } else {
                // Take only what's needed
                uint256 neededCollateralUsd = remaining;
                uint256 tokensToSeize = getTokenAmountFromUsd(
                    collateralToken,
                    neededCollateralUsd,
                    collateralDecimals
                );

                uint256 userDepositedBalance = _appStorage
                    .s_addressToCollateralDeposited[borrower][
                        collateralToken
                    ];
                uint256 actualTokensToSeize = tokensToSeize;

                // If we don't have enough deposited, take what's available
                if (userDepositedBalance < tokensToSeize) {
                    actualTokensToSeize = userDepositedBalance;
                    // Recalculate the USD value based on what we can actually seize
                    neededCollateralUsd = getUsdValue(
                        collateralToken,
                        actualTokensToSeize,
                        collateralDecimals
                    );
                }

                // Only subtract if we have something to subtract
                if (
                    actualTokensToSeize > 0 &&
                    userDepositedBalance >= actualTokensToSeize
                ) {
                    _appStorage.s_addressToCollateralDeposited[
                        borrower
                    ][collateralToken] -= actualTokensToSeize;
                    _appStorage.s_idToCollateralTokenAmount[requestId][
                            collateralToken
                        ] -= actualTokensToSeize;
                    seizedAmounts[i] = actualTokensToSeize;
                    totalSeizedUsd += neededCollateralUsd;
                    remaining -= neededCollateralUsd;
                }

                if (remaining <= 0) {
                    remaining = 0;
                }
            }
        }
    }

    /// @notice Divides what a liquidation seized into the penalty's two
    ///         halves, in USD. The lender's recovery is the remainder and is
    ///         never computed here — see `_settleLiquidationProceeds`.
    /// @dev Second of the three pieces `liquidateUserRequest` was broken into;
    ///      the reason is on `_seizeCollateralForLiquidation`. `view` rather
    ///      than `pure` only because the penalty rate lives in storage.
    /// @param totalSeizedUsd What the seizure actually took, which may be less
    ///        than it asked for.
    /// @param loanUsdValue The debt being discharged.
    /// @return liquidatorUsd The caller's share of the penalty.
    /// @return protocolUsd The fee vault's share.
    function _liquidationPenaltySplitUsd(
        uint256 totalSeizedUsd,
        uint256 loanUsdValue
    ) private view returns (uint256 liquidatorUsd, uint256 protocolUsd) {
        /* The waterfall, in USD. Split once here rather than per token so
         * every recipient receives the same proportional mix of collateral
         * assets, instead of one of them taking whichever token happened to
         * be enumerated first.
         *
         * The lender's claim is the debt, or everything seized when the
         * position could not cover it. The penalty is whatever was seized
         * above that claim, capped at LIQUIDITY_BPS of it — the caller's
         * seizure target asked for exactly debt + penalty, so a position that
         * still holds enough yields the full penalty and an underwater one
         * yields less or nothing. That is the whole point of the ordering:
         * the shortfall lands on the penalty, never on the lender. */
        uint256 lenderClaimUsd = totalSeizedUsd < loanUsdValue
            ? totalSeizedUsd
            : loanUsdValue;
        uint256 penaltyCapUsd = Utils.calculateFeesPercentage(
            lenderClaimUsd,
            _appStorage.LIQUIDITY_BPS
        );
        uint256 surplusUsd = totalSeizedUsd - lenderClaimUsd;
        uint256 penaltyUsd = surplusUsd < penaltyCapUsd
            ? surplusUsd
            : penaltyCapUsd;

        /* Three quarters to the liquidator, the rest to the protocol.
         *
         * Not an even split, because of what the liquidator is actually paid
         * in here. They do not receive the loan currency they can bank on
         * the spot — they receive a share of the borrower's collateral as an
         * internal position, and then have to withdraw it and sell it
         * themselves, wearing the gas on both legs, the spread, and whatever
         * the price does in between. Half of a 640 bps penalty is 320 bps to
         * cover all of that, which is thin enough that positions in anything
         * but the most liquid collateral would sit unclosed.
         *
         * At 75/25 the liquidator clears 480 bps and the protocol 160. The
         * protocol taking the smaller share is the point: it is a bystander
         * to this transaction, while the liquidator is the party doing the
         * work of getting a bad position off the book. Morpho Blue pays the
         * entire incentive to the liquidator and takes no protocol fee on
         * liquidation at all; Compound v3 pays liquidators nothing directly
         * and decouples their profit into a separate buyCollateral() call.
         * Aave v3 does keep a cut (liquidationProtocolFee) and takes it out
         * of the bonus rather than on top, which is the shape used here.
         *
         * The remainder rather than a second multiplication, so the two
         * legs sum to exactly `penaltyUsd` and the truncation cannot leave a
         * wei of the borrower's collateral unassigned. */
        liquidatorUsd = (penaltyUsd * 75) / 100;
        protocolUsd = penaltyUsd - liquidatorUsd;
    }

    /// @notice Credits seized collateral out to the lender, the liquidator and
    ///         the fee vault, pro rata across every token seized.
    /// @dev Third of the three pieces `liquidateUserRequest` was broken into;
    ///      the reason is on `_seizeCollateralForLiquidation`. Takes the whole
    ///      `Request` rather than its lender and token list separately because
    ///      one memory pointer costs one stack slot and two arguments cost two,
    ///      which is the entire point of the split.
    /// @param _request The liquidated request, read for its lender and its
    ///        collateral token list.
    /// @param seizedAmounts Per-token amounts from
    ///        `_seizeCollateralForLiquidation`, positionally aligned with
    ///        `_request.collateralTokens`.
    /// @param totalSeizedUsd Denominator for the pro-rata split; the caller has
    ///        already required it to be non-zero.
    /// @param liquidatorUsd The liquidator's penalty share, in USD.
    /// @param protocolUsd The protocol's penalty share, in USD.
    function _settleLiquidationProceeds(
        Request memory _request,
        uint256[] memory seizedAmounts,
        uint256 totalSeizedUsd,
        uint256 liquidatorUsd,
        uint256 protocolUsd
    ) private {
        address feeVault = _appStorage.kaleidoFeeVault;
        uint256 len = seizedAmounts.length;

        for (uint256 i = 0; i < len; ++i) {
            uint256 seizedAmount = seizedAmounts[i];
            if (seizedAmount == 0) continue;
            address collateralToken = _request.collateralTokens[i];

            /* Truncating division on the two penalty legs with the lender
             * taking the remainder, so the three credits sum to exactly
             * `seizedAmount`. That equality is the solvency invariant: the
             * borrower was debited this amount and no more than this amount
             * is credited back out, so the total of all deposited balances
             * does not move and the tokens already sitting in the diamond
             * still back every claim on them. */
            uint256 liquidatorCut = (seizedAmount * liquidatorUsd) /
                totalSeizedUsd;
            uint256 protocolCut = (seizedAmount * protocolUsd) /
                totalSeizedUsd;
            uint256 lenderCut = seizedAmount - liquidatorCut - protocolCut;

            _creditCollateral(_request.lender, collateralToken, lenderCut);
            _creditCollateral(msg.sender, collateralToken, liquidatorCut);
            _creditCollateral(feeVault, collateralToken, protocolCut);
        }
    }

    /// @notice Retrieves an active loan request by its ID
    /// @dev Reverts if request is not in SERVICED status
    /// @param _requestId The ID of the request to retrieve
    /// @return Request memory The loan request data
    function getActiveRequestsByRequestId(
        uint96 _requestId
    ) private view returns (Request memory) {
        Request memory _request = _appStorage.request[_requestId];
        if (_request.status != Status.SERVICED) {
            revert Protocol__RequestNotServiced();
        }
        return _request;
    }

    /// @notice The protocol's cut of loan interest, in basis points
    /// @return uint256 The configured fee, or 0 if it has never been set
    /// @dev There was no reader for this. `getLiquidityBPS` had one, so the
    ///      liquidation penalty could be shown but the lending fee could not —
    ///      which is why the frontend quoted a hardcoded percentage instead of
    ///      the live value. A fee the user cannot read before signing is not a
    ///      disclosed fee.
    function getBPS() public view returns (uint256) {
        return _appStorage.ONE_PERCENT_BPS;
    }

    function getLiquidityBPS() public view returns (uint256) {
        return _appStorage.LIQUIDITY_BPS;
    }

    /// @notice Records a DEX router address in protocol storage
    /// @dev Only callable by contract owner.
    /// @dev NOTHING READS WHAT THIS WRITES. `AppStorage.swapRouter` has no
    ///      consumer in any facet and no getter, so this cannot be read back
    ///      either — see the field's comment in LibAppStorage. Swaps run on the
    ///      V3 periphery directly, never through the diamond. Left in place
    ///      because it is deployed on all five chains and removing a selector
    ///      costs a facet cut for no behavioural gain; treat it as a reserved
    ///      slot, and add the reader before treating it as configuration.
    /// @param _swapRouter The router address to record. Not validated: it is
    ///        never called, so there is nothing to validate it against.
    function setSwapRouter(address _swapRouter) external {
        LibDiamond.enforceIsContractOwner();
        _appStorage.swapRouter = _swapRouter;
    }

    /// @notice Sets the protocol's cut of loan interest, in basis points
    /// @dev Only callable by contract owner
    /// @param _bps The fee in basis points; 1000 is 10% of the interest accrued
    /// @dev Bounded. This took any uint256, and the fee is subtracted from the
    ///      repayment before the lender is credited, so 10000 would have sent
    ///      the lender's entire principal to the fee vault and any value above
    ///      that would have underflowed `_amount - protocolFee` and reverted
    ///      every repayment on the protocol. Zero is rejected rather than
    ///      accepted as "no fee", because `repayLoan` and `liquidateUserRequest`
    ///      already treat 0 as "never configured" and revert on it; allowing it
    ///      here would give the owner a way to brick repayment that looks like
    ///      a fee waiver. To waive the fee, set 1 bp.
    function setBPS(uint256 _bps) external {
        LibDiamond.enforceIsContractOwner();
        if (_bps == 0 || _bps > Constants.MAX_PROTOCOL_FEE_BPS) {
            revert Protocol__InvalidFeeBps();
        }
        _appStorage.ONE_PERCENT_BPS = _bps;
    }

    /// @notice Sets the liquidation penalty, in basis points
    /// @dev Only callable by contract owner
    /// @param _bps The penalty in basis points; 1000 is 10% of seized collateral
    /// @dev Bounded for the same reason as `setBPS`, and against the same
    ///      sentinel: `liquidateUserRequest` reverts when this is 0.
    function setLiquidityBps(uint256 _bps) external {
        LibDiamond.enforceIsContractOwner();
        if (_bps == 0 || _bps > Constants.MAX_LIQUIDATION_PENALTY_BPS) {
            revert Protocol__InvalidFeeBps();
        }
        _appStorage.LIQUIDITY_BPS = _bps;
    }

    /// @notice Sets the address where protocol fees are collected
    /// @dev Only callable by contract owner
    /// @param _feeVault The address of the fee vault
    /// @dev Rejects the zero address: `repayLoan` and `liquidateUserRequest`
    ///      both revert when the vault is unset, so writing zero here disables
    ///      repayment and liquidation protocol-wide.
    function setFeeVault(address _feeVault) external {
        LibDiamond.enforceIsContractOwner();
        if (_feeVault == address(0)) revert Protocol__InvalidFeeVault();
        _appStorage.kaleidoFeeVault = _feeVault;
    }

    ///////////////////////
    /// VIEW FUNCTIONS ///
    //////////////////////

    /// @notice Reads a Pyth feed and returns the price at a fixed 18-decimal scale
    /// @param priceFeedId The Pyth feed id registered for the token
    /// @return uint256 Price of one whole token in USD, scaled by 1e18
    /// @dev Pyth reports a price as `price * 10^expo`, where `expo` is per-feed
    ///      metadata. `getUsdValue` and `getTokenAmountFromUsd` each carried their
    ///      own copy of the conversion and both had it inverted: they multiplied by
    ///      `10**(-expo)` for a negative exponent where reaching a fixed scale needs
    ///      `10**(18 + expo)`. Since the raw price already carries `10**(-expo)`,
    ///      that squared it — the returned scale was `10**(-2*expo)`, which is 1e16
    ///      for the usual -8 feed and silently different for any other exponent. A
    ///      positive exponent divided instead, truncating the price to zero or near
    ///      it. Nothing was visibly wrong only because every feed in use is -8 and
    ///      the two functions were inverses of each other at the same wrong scale,
    ///      so they round-tripped and MIN_LOAN_AMOUNT had been calibrated to match.
    ///
    ///      Normalising in one place means the exponent cannot disagree between the
    ///      two, and registering a feed with a different exponent no longer rescales
    ///      every USD figure in the protocol.
    ///
    ///      Freshness and confidence are checked here too, for the same reason:
    ///      this is the single point every USD figure in the protocol passes
    ///      through, so a bound applied here covers health factors, borrow
    ///      limits and liquidation alike, and cannot be bypassed by whichever
    ///      caller forgot to check.
    ///
    ///      The oracle installed here is one of two, and which one changes what
    ///      the bounds below are worth.
    ///
    ///      `PythPriceOracle` reads through `pyth.getPriceUnsafe`, whose
    ///      contract is to return the last published price *at any age* — Pyth
    ///      names it "unsafe" precisely because it has no freshness guarantee.
    ///      Updates are pushed by `PythPriceOracle.updatePrice`, which is
    ///      permissionless: Pyth verifies each update's Wormhole signatures
    ///      on-chain, so relaying one proves nothing about the relayer and anyone
    ///      may refresh a feed that has gone quiet — including a liquidator, in
    ///      the same transaction, which is the pull-oracle pattern Pyth is built
    ///      for. What is NOT guaranteed is that anybody bothers: a feed nobody
    ///      pays to update stays frozen, and the protocol then quotes a stale
    ///      price while believing it is current. The bound below is what turns
    ///      that from a wrong answer into a refusal to answer, and it is the only
    ///      thing that does.
    ///
    ///      This clause previously read `onlyOwner`, and concluded that open
    ///      liquidation was therefore exploitable by waiting for a frozen price
    ///      to drift. That gate came off because it protected nothing and made
    ///      liveness depend on one hot key — measured on Arc Testnet, whose
    ///      native currency is USDC and whose USDC/USD feed was 16.3h stale. The
    ///      conclusion changes with it: a stale price is now something any
    ///      participant can fix, so the residual risk is a bound set looser than
    ///      the asset's volatility, not an unrefreshable feed.
    ///      The oracle exposes `getSafePrice`, which wraps
    ///      `getPriceNoOlderThan(id, 60)`, but nothing in the protocol ever
    ///      called it and its 60 seconds is hardcoded — too tight for a push
    ///      cadence the operator controls. The bound is read from storage
    ///      instead so it can be matched to that cadence per deployment.
    ///
    ///      `AggregatorPriceOracle` reads a Chainlink feed or an API3 dAPI
    ///      proxy, both of which the provider maintains, so there is nobody who
    ///      has to be paid to keep it warm and nothing a participant could do if
    ///      it stopped — the trade against the Pyth path is that freshness is not
    ///      ours to fix either way. What it
    ///      cannot supply is `conf`: neither provider publishes an uncertainty
    ///      band, so that oracle returns zero, zero passes any `maxConfBps`, and
    ///      the confidence half of this policy does nothing while it is
    ///      installed. It is not hidden — `oracleKind()` names the backend, and
    ///      the adapter enforces the round-integrity checks an aggregator does
    ///      support in place of `conf`. Judge the two bounds accordingly:
    ///      against Pyth both are live, against an aggregator only the age is.
    ///
    ///      `conf` is Pyth's own uncertainty on the number. Rejecting a wide
    ///      interval matters most for the same reason: liquidating off a
    ///      midpoint the publishers do not agree on is a coin toss on somebody
    ///      else's collateral.
    ///
    ///      Both bounds fail closed when unset. A zero read as "no limit" would
    ///      mean the protocol shipped with the check disabled and no way to tell
    ///      from the outside, which is the failure mode this is here to prevent;
    ///      scripts/deploy.js sets both before the first price is ever read.
    function _priceScaled18(
        bytes32 priceFeedId
    ) private view returns (uint256) {
        IPythPriceOracle oracle = IPythPriceOracle(_appStorage.pythPriceOracle);
        require(address(oracle) != address(0), "Oracle not set");
        /* getTokenAmountFromUsd did not check this before, so an unregistered
         * token queried feed id 0 rather than reverting for the actual reason. */
        require(priceFeedId != bytes32(0), "Price feed not set");

        uint256 maxAge = _appStorage.s_feedMaxAge[priceFeedId];
        /* Falls back to the global bound. Zero is "no override" rather than "no
         * limit", so an unset feed inherits the protocol-wide policy instead of
         * silently escaping it — the same fail-closed reading the two bounds
         * below get. */
        if (maxAge == 0) maxAge = _appStorage.priceMaxAge;
        uint256 maxConfBps = _appStorage.priceMaxConfBps;
        if (maxAge == 0 || maxConfBps == 0)
            revert Protocol__PriceBoundsNotConfigured();

        PythStructs.Price memory priceInfo = oracle.getPrice(priceFeedId);
        /* Guards the int64 -> uint64 cast below: a negative price would wrap to
         * an enormous positive one. */
        require(priceInfo.price > 0, "Invalid price");

        /* A publishTime in the future is treated as age zero rather than
         * reverting: Pyth timestamps come from its own clock, so a small skew
         * ahead of the block is normal and is not evidence of a stale feed.
         * Subtracting unguarded would underflow. */
        if (priceInfo.publishTime < block.timestamp) {
            uint256 age = block.timestamp - priceInfo.publishTime;
            if (age > maxAge) revert Protocol__StalePrice(age, maxAge);
        }

        uint256 price = uint256(uint64(priceInfo.price));

        /* Compared in basis points of the price, so the bound means the same
         * thing on a $1 stablecoin and a $3000 asset. `conf` and `price` carry
         * the same exponent, so the ratio is scale-free and the raw values can
         * be used directly. */
        uint256 confBps = (uint256(priceInfo.conf) * Constants.BASIS_POINTS) /
            price;
        if (confBps > maxConfBps)
            revert Protocol__PriceConfidenceTooWide(confBps, maxConfBps);

        int256 scaleExpo = int256(18) + int256(priceInfo.expo);

        if (scaleExpo >= 0) {
            return price * (10 ** uint256(scaleExpo));
        }
        return price / (10 ** uint256(-scaleExpo));
    }

    /// @notice Calculates token amount from USD value
    /// @param token Address of the token to convert to
    /// @param usdAmount Amount in USD (18 decimals)
    /// @param tokenDecimals Decimals of the target token
    /// @return uint256 Token amount, in base units
    function getTokenAmountFromUsd(
        address token,
        uint256 usdAmount,
        uint8 tokenDecimals
    ) public view returns (uint256) {
        uint256 price = _priceScaled18(_appStorage.s_priceFeeds[token]);

        // tokenAmount = (usdAmount / price) * 10^decimals, both sides at 1e18 so
        // the scale cancels and the result is base units.
        return (usdAmount * (10 ** tokenDecimals)) / price;
    }

    /// @notice Calculates USD value of token amount
    /// @param token Address of the token to get value for
    /// @param amount Amount of tokens, in base units
    /// @param tokenDecimals Decimals of the token
    /// @return uint256 USD value with 18 decimals
    function getUsdValue(
        address token,
        uint256 amount,
        uint8 tokenDecimals
    ) public view returns (uint256) {
        uint256 price = _priceScaled18(_appStorage.s_priceFeeds[token]);

        uint256 normalizedAmount = (amount * 1e18) / (10 ** tokenDecimals);
        return (normalizedAmount * price) / 1e18;
    }

    /// @notice Sets the Pyth oracle address
    /// @param _oracle Address of the Pyth oracle contract
    /// @dev Only callable by contract owner
    /// @dev Rejects the zero address. It took any value, and the storage slot
    ///      starts at zero, so the oracle could be cleared as easily as it could
    ///      be set — and every function that reads a price goes through
    ///      `_priceScaled18`, which would then call into an empty address. That
    ///      is not a contained failure: deposits, borrows, health factors and
    ///      liquidation all price collateral, so a zero oracle takes the whole
    ///      protocol offline while leaving deposited collateral locked.
    ///
    /// @dev Despite the name, `_oracle` is not necessarily Pyth-backed. Three of
    ///      the five deploy targets are given an `AggregatorPriceOracle` here
    ///      instead — Sepolia and BSC Testnet read Chainlink, Robinhood reads an
    ///      API3 dAPI — because Pyth is stale or absent on them. The cast to
    ///      `IPythPriceOracle` does not check that the target implements the
    ///      interface, and it does not need to: `_priceScaled18` calls
    ///      `getPrice(bytes32)` and nothing else on it, and both backends
    ///      implement exactly that, returning a `PythStructs.Price` normalised to
    ///      `expo = -8`. Ask the deployed contract's `oracleKind()` to find out
    ///      which one is installed.
    ///
    ///      The rest of `IPythPriceOracle` — `getSafePrice`, `getEthLatestPrice`,
    ///      `updatePrice` — is unimplemented on the aggregator backend and would
    ///      revert. Nothing in this repository calls any of it (verified across
    ///      `contracts/` and `src/`), so do not add a call to one without
    ///      checking it exists on both.
    function setPythOracle(address _oracle) external {
        LibDiamond.enforceIsContractOwner();
        if (_oracle == address(0)) revert Protocol__InvalidAddress();
        _appStorage.pythPriceOracle = IPythPriceOracle(_oracle);
    }

    /// @notice Gets the current Pyth oracle address
    /// @return address Current oracle contract address
    /// @dev Reads `_appStorage`, not `LibAppStorage.layout()`. Those are two
    ///      different regions of the diamond's storage and this function used
    ///      the wrong one, so it returned the zero address no matter what
    ///      `setPythOracle` had been given.
    ///
    ///      `_appStorage` is declared as a state variable on this facet, and
    ///      ReentrancyGuard's `_status` takes slot 0 ahead of it, so the layout
    ///      occupies slots 1..33 — one per struct field, except that `requestId`
    ///      and `s_orderId` pack into a single slot. That upper bound moves every
    ///      time a field is appended to the struct (it was 1..32 before
    ///      `s_feedMaxAge`), so treat it as a fact about the current struct and
    ///      not a fixed boundary. `LibAppStorage.layout()` instead points at
    ///      keccak256("diamond.standard.app.storage"). Every other line in this
    ///      facet — including `setPythOracle` and `_priceScaled18` — uses
    ///      `_appStorage`, so pricing itself was never affected; only this
    ///      getter disagreed with the value actually in force.
    ///
    ///      The two regions hold different data, which is safe only because no
    ///      field is read from both. `AgentPermissionFacet` uses
    ///      `LibAppStorage.layout()` exclusively and this facet never touches
    ///      `agentPermissions` or `agentTokens`, so the split is currently
    ///      harmless. Reading an agent mapping from `_appStorage` here would
    ///      silently see an empty one.
    ///
    ///      It is not cosmetic. `scripts/deploy.js` reads this back after
    ///      calling `setPythOracle` to prove the selector routed to the facet
    ///      rather than the diamond's fallback, so a getter hardwired to zero
    ///      aborts the deploy on its first configuration step, after the cut.
    function getPythPriceOracle() external view returns (address) {
        return address(_appStorage.pythPriceOracle);
    }

    /// @notice Sets the freshness and confidence bounds every price read enforces
    /// @param _maxAge Oldest accepted Pyth publishTime, in seconds
    /// @param _maxConfBps Widest accepted confidence interval, in bps of price
    /// @dev Both together, because they are one policy: how much the protocol
    ///      trusts the feed. Setting them in one call means there is no window
    ///      in which one bound is live and the other is still zero.
    ///
    ///      Neither may be zero. `_priceScaled18` reverts while either is unset
    ///      rather than treating it as unbounded, so this is also the call that
    ///      brings the protocol online — see the comment there.
    ///
    ///      Upper bounds exist so the setter cannot be used to disable the
    ///      check while appearing to configure it. `MAX_PRICE_AGE` is a ceiling
    ///      on how stale is arguable, not a recommendation; pick a value that
    ///      matches the pusher's actual cadence with room for a missed round,
    ///      because every second of slack here is a second during which a
    ///      liquidation can be priced off a number that has stopped being true.
    function setPriceBounds(uint256 _maxAge, uint256 _maxConfBps) external {
        LibDiamond.enforceIsContractOwner();
        if (_maxAge == 0 || _maxAge > Constants.MAX_PRICE_AGE) {
            revert Protocol__InvalidPriceBounds();
        }
        if (_maxConfBps == 0 || _maxConfBps > Constants.MAX_PRICE_CONF_BPS) {
            revert Protocol__InvalidPriceBounds();
        }
        _appStorage.priceMaxAge = _maxAge;
        _appStorage.priceMaxConfBps = _maxConfBps;
        emit PriceBoundsUpdated(_maxAge, _maxConfBps);
    }

    /// @notice The configured price freshness bound, in seconds. 0 = unconfigured
    /// @dev Readable so the frontend can say why a price read reverted. A
    ///      protocol that rejects a stale price and cannot explain that it did
    ///      looks broken rather than careful.
    function getPriceMaxAge() external view returns (uint256) {
        return _appStorage.priceMaxAge;
    }

    /// @notice The configured confidence bound, in bps of price. 0 = unconfigured
    function getPriceMaxConfBps() external view returns (uint256) {
        return _appStorage.priceMaxConfBps;
    }

    /// @notice Override the freshness bound for one feed
    /// @param _priceFeed The feed id to override
    /// @param _maxAge Oldest accepted publishTime for this feed, in seconds.
    ///        Zero clears the override and returns the feed to the global bound.
    /// @dev Exists because one number cannot describe the publisher cadences the
    ///      protocol has to read. On Sepolia the Chainlink ETH/USD answer
    ///      measured 1,594 seconds old and USDC/USD 13,438 — an 8x spread on one
    ///      chain. A global bound loose enough for the stablecoin would accept a
    ///      four-hour-old ETH price to liquidate against; tight enough for ETH
    ///      and the stablecoin never prices, which takes `/borrow` down on that
    ///      chain entirely. Overriding the one slow feed leaves the strict bound
    ///      in force everywhere else, which a global loosening does not.
    ///
    ///      Bounded by `MAX_FEED_PRICE_AGE` (25 hours), not `MAX_PRICE_AGE`
    ///      (one hour), because API3 offers a 24-hour heartbeat as its only
    ///      option and an hour-capped override could not cover the case it
    ///      exists for. That ceiling is the reason this is a separate function
    ///      rather than an extra argument to `setPriceBounds`: the two have
    ///      different limits and different justifications, and one call setting
    ///      both would blur them.
    ///
    ///      Only defensible on a pegged asset. A day-old USDC quote is very
    ///      probably still a dollar; a day-old ETH quote is an invitation to
    ///      liquidate healthy positions at a price that stopped being true.
    ///      Using this to silence a reverting volatile feed converts a refusal
    ///      to price into a wrong price, which is strictly worse. The event is
    ///      emitted so that choice is auditable from logs.
    ///
    ///      Zero is accepted, and means "clear", not "no limit" — `_priceScaled18`
    ///      falls back to the global bound and still reverts if that is unset.
    ///      There is no state in which setting this disables the age check.
    function setFeedMaxAge(bytes32 _priceFeed, uint256 _maxAge) external {
        LibDiamond.enforceIsContractOwner();
        if (_priceFeed == bytes32(0)) revert Protocol__InvalidPriceBounds();
        if (_maxAge > Constants.MAX_FEED_PRICE_AGE) {
            revert Protocol__InvalidPriceBounds();
        }
        _appStorage.s_feedMaxAge[_priceFeed] = _maxAge;
        emit FeedMaxAgeUpdated(_priceFeed, _maxAge);
    }

    /// @notice This feed's freshness override, in seconds. 0 = uses the global bound
    /// @dev Readable for the same reason `getPriceMaxAge` is: when a price read
    ///      reverts as stale, the frontend needs the bound that was actually
    ///      applied to that feed to say why, and the global value is the wrong
    ///      answer whenever an override is set.
    function getFeedMaxAge(bytes32 _priceFeed) external view returns (uint256) {
        return _appStorage.s_feedMaxAge[_priceFeed];
    }

    ///@notice get the expected amount in converting tokens
    function getConvertValue(
        address _from,
        address _to,
        uint256 _amount
    ) public view returns (uint256 value) {
        uint8 fromDecimal = _getTokenDecimal(_from);
        uint8 toDecimal = _getTokenDecimal(_to);
        uint256 fromUsd = getUsdValue(_from, _amount, fromDecimal);
        value = (((fromUsd * 10) / getUsdValue(_to, 10, 0)) *
            (10 ** toDecimal));
    }

    /// @notice This gets the amount of collateral a user has deposited in USD
    /// @param _user the address who you want to get their collateral value
    function getAccountCollateralValue(
        address _user
    ) public view returns (uint256 _totalCollateralValueInUsd) {
        for (
            uint256 index = 0;
            index < _appStorage.s_collateralToken.length;
            index++
        ) {
            address _token = _appStorage.s_collateralToken[index];
            uint256 _amount = _appStorage.s_addressToCollateralDeposited[_user][
                _token
            ];
            uint8 _tokenDecimal = _getTokenDecimal(_token);
            _totalCollateralValueInUsd += getUsdValue(
                _token,
                _amount,
                _tokenDecimal
            );
        }
    }

    /**
     * @notice Calculates the total available collateral value (in USD) for a user's account
     * @dev Iterates through all supported collateral tokens, sums their USD-equivalent values
     *      using the user's available balances. Return value is scaled to 18 decimals.
     * @param _user The address of the user to check available collateral for
     * @return _totalAvailableValueInUsd Total value of available collateral in USD
     */
    function getAccountAvailableValue(
        address _user
    ) public view returns (uint256 _totalAvailableValueInUsd) {
        for (
            uint256 index = 0;
            index < _appStorage.s_collateralToken.length;
            index++
        ) {
            address _token = _appStorage.s_collateralToken[index];
            uint256 _amount = _appStorage.s_addressToAvailableBalance[_user][
                _token
            ];
            uint8 _tokenDecimal = _getTokenDecimal(_token);
            _totalAvailableValueInUsd += getUsdValue(
                _token,
                _amount,
                _tokenDecimal
            );
        }
    }

    /**
     * @notice Retrieves all the requests stored in the system
     * @dev Returns an array of all requests
     * @return An array of `Request` structs representing all stored requests
     */
    function getAllRequests(
        uint256 offset,
        uint256 limit
    ) external view returns (Request[] memory) {
        uint256 totalRequests = _appStorage.s_requests.length;
        if (offset >= totalRequests) return new Request[](0);

        uint256 end = offset + limit > totalRequests
            ? totalRequests
            : offset + limit;
        uint256 length = end - offset;

        Request[] memory requests = new Request[](length);
        for (uint256 i = 0; i < length; i++) {
            requests[i] = _appStorage.s_requests[offset + i];
        }
        return requests;
    }

    /**
     * @notice Retrieves all requests with the status `SERVICED`
     * @dev Performs two passes over the stored requests array:
     *      1. Counts the number of requests with `SERVICED` status to allocate memory
     *      2. Collects and returns all such requests in a fixed-size array
     * @return servicedRequests An array of `Request` structs that have been serviced
     */
    function getServicedRequests() external view returns (Request[] memory) {
        uint256 totalRequests = _appStorage.s_requests.length;
        uint256 count = 0;

        // First pass: count how many requests have SERVICED status
        for (uint256 i = 0; i < totalRequests; i++) {
            if (_appStorage.s_requests[i].status == Status.SERVICED) {
                count++;
            }
        }

        Request[] memory servicedRequests = new Request[](count);
        uint256 index = 0;

        for (uint256 i = 0; i < totalRequests; i++) {
            if (_appStorage.s_requests[i].status == Status.SERVICED) {
                servicedRequests[index] = _appStorage.s_requests[i];
                index++;
            }
        }

        return servicedRequests;
    }

    /**
     * @notice Retrieves the details of a specific loan listing by its ID
     * @dev Returns the listing if it exists, otherwise reverts if the listing's author is the zero address
     * @param _listingId The ID of the listing to retrieve
     * @return The `LoanListing` struct containing details of the specified listing
     */
    function getLoanListing(
        uint96 _listingId
    ) external view returns (LoanListing memory) {
        LoanListing memory _listing = _appStorage.loanListings[_listingId];
        if (_listing.author == address(0)) revert Protocol__IdNotExist();
        return _listing;
    }

    /**
     * @notice Retrieves the details of a specific request by its ID
     * @dev Returns the request if it exists, otherwise reverts if the request's author is the zero address
     * @param _requestId The ID of the request to retrieve
     * @return The `Request` struct containing details of the specified request
     */
    function getRequest(
        uint96 _requestId
    ) external view returns (Request memory) {
        Request memory _request = _appStorage.request[_requestId];
        if (_request.author == address(0)) revert Protocol__NotOwner();
        return _request;
    }

    /// @notice This gets the account info of any account
    /// @param _user a parameter for the user account info you want to get
    /// @return _totalBurrowInUsd returns the total amount of SC the  user has minted
    /// @return _collateralValueInUsd returns the total collateral the user has deposited in USD
    function _getAccountInfo(
        address _user
    )
        private
        view
        returns (uint256 _totalBurrowInUsd, uint256 _collateralValueInUsd)
    {
        _totalBurrowInUsd = getLoanCollectedInUsd(_user);
        _collateralValueInUsd = getAccountCollateralValue(_user);
    }

    /// @notice Checks the health Factor which is a way to check if the user has enough collateral
    /// @param _user a parameter for the address to check
    /// @return uint256 returns the health factor which is supoose to be >= 1
    function getHealthFactor(address _user) external view returns (uint256) {
        return _healthFactor(_user, 0);
    }

    /// @notice Checks the health Factor which is a way to check if the user has enough collateral to mint
    /// @param _user a parameter for the address to check
    /// @param _borrow_Value amount the user wants to borrow in usd
    /// @return uint256 returns the health factor which is supoose to be >= 1e18
    function _healthFactor(
        address _user,
        uint256 _borrow_Value
    ) private view returns (uint256) {
        (
            uint256 _totalBurrowInUsd,
            uint256 _collateralValueInUsd
        ) = _getAccountInfo(_user);
        uint256 _collateralAdjustedForThreshold = (_collateralValueInUsd *
            Constants.LIQUIDATION_THRESHOLD) / 100;

        /* Unbounded, not "collateral × 1e18".
         *
         * That old expression was a USD value with an extra PRECISION stapled
         * on, not a ratio, and it collapsed to 0 for a user holding no
         * collateral at all. Zero is below MIN_HEALTH_FACTOR, so any caller
         * comparing this against that constant rejected the one case that is
         * unambiguously safe — a user with no loans withdrawing their last
         * collateral. Nothing to divide by means unboundedly healthy.
         *
         * Only reachable from getHealthFactor and
         * _revertIfHealthFactorIsBroken: both origination checks pass a
         * non-zero _borrow_Value, and the liquidation gate only runs against a
         * SERVICED request, whose author therefore has non-zero
         * getLoanCollectedInUsd. */
        if ((_totalBurrowInUsd == 0) && (_borrow_Value == 0))
            return type(uint256).max;

        return
            (_collateralAdjustedForThreshold * Constants.PRECISION) /
            (_totalBurrowInUsd + _borrow_Value);
    }

    function _getTokenDecimal(
        address _token
    ) internal view returns (uint8 decimal) {
        if (_token == Constants.NATIVE_TOKEN) {
            decimal = 18;
        } else {
            decimal = ERC20(_token).decimals();
        }
    }

    /// @dev get the collection of all collateral token
    /// @return {address[] memory} the collection of collateral addresses
    function getAllCollateralToken() external view returns (address[] memory) {
        return _appStorage.s_collateralToken;
    }

    /// @notice This checks the health factor to see if  it is broken if it is it reverts
    /// @param _user a parameter for the address we want to check the health factor for
    /// @dev Called by withdrawCollateral, on the state *after* the ledgers are
    ///      decremented, so the ratio it tests is the position the withdrawal
    ///      leaves behind.
    ///
    ///      The available-balance earmark is not sufficient on its own, which is
    ///      why this is wired rather than deleted. `s_addressToAvailableBalance`
    ///      is denominated in token base units and fixed at origination, but
    ///      `_healthFactor` divides *total* deposited collateral at live prices
    ///      by the debt. So the earmark bounds the token amount a borrower may
    ///      remove, not what removing it does to the ratio:
    ///
    ///        - At origination prices the earmark alone is enough. It locks
    ///          collateral worth loanUsd / (COLLATERALIZATION_RATIO/100), the
    ///          reciprocal of the LTV, so stripping every unit of free
    ///          collateral lands on exactly LIQUIDATION_THRESHOLD /
    ///          COLLATERALIZATION_RATIO = 0.80/0.75 = 1.0667 — the maxed-out
    ///          borrower's health factor, independent of how much was borrowed.
    ///        - Once collateral has fallen to k of its origination value that
    ///          floor becomes 1.0667k, while the position is still out of
    ///          liquidation range until k < debt/(0.8 × collateral). For an
    ///          under-borrower those two do not coincide: at 60% LTV the gap is
    ///          k in (0.75, 0.9375), a band in which the position is healthy,
    ///          the free collateral is withdrawable, and withdrawing it drops
    ///          the health factor below 1 on the spot.
    ///
    ///      That is the borrower taking the equity out of a position and leaving
    ///      the debt, and it is what produces bad debt rather than a clean
    ///      liquidation: at k = 0.76 the collateral still on the books after the
    ///      withdrawal is worth ~1.013× the debt against the ~1.064× that debt
    ///      plus penalty needs, whereas the untouched position holds ~1.267×.
    function _revertIfHealthFactorIsBroken(address _user) internal view {
        uint256 _userHealthFactor = _healthFactor(_user, 0);
        if (_userHealthFactor < Constants.MIN_HEALTH_FACTOR) {
            revert Protocol__BreaksHealthFactor();
        }
    }

    /// @dev gets the amount of collateral auser has deposited
    /// @param _sender the user who has the collateral
    /// @param _tokenAddr the user who has the collateral
    /// @return {uint256} the return variables of a contract’s function state variable
    function gets_addressToCollateralDeposited(
        address _sender,
        address _tokenAddr
    ) external view returns (uint256) {
        return _appStorage.s_addressToCollateralDeposited[_sender][_tokenAddr];
    }

    /// @dev gets the amount of token balance avialble to the user
    /// @param _sender the user who has the balance
    /// @param _tokenAddr the user who has the balance
    /// @return {uint256} the return variables of a contract’s function state variable
    function gets_addressToAvailableBalance(
        address _sender,
        address _tokenAddr
    ) external view returns (uint256) {
        return _appStorage.s_addressToAvailableBalance[_sender][_tokenAddr];
    }

    function getRequestToColateral(
        uint96 _requestId,
        address _token
    ) external view returns (uint256) {
        return _appStorage.s_idToCollateralTokenAmount[_requestId][_token];
    }

    /// @dev calculates the loan interest and add it to the loam
    /// @param _returnDate the date at which the loan should be returned
    /// @param _amount the amount the user want to borrow
    /// @param _interest the percentage the user has agreed to payback
    /// @return _totalRepayment the amount the user is to payback
    /// @return _interestAmount the interest component alone
    /**
     * @dev Prices a loan by pro-rating the APR over its actual duration.
     *
     *      Previously this applied `_interest` as a flat percentage and ignored
     *      `_returnDate` entirely, so 10% over 7 days cost the same as 10% over
     *      two years. That left the marketplace with no comparable price: two
     *      listings could not be ranked without mentally dividing by term, and
     *      any displayed "APY" was not one.
     *
     *      `_interest` is now an APR in basis points.
     *
     *      Returns the interest separately as well as folded into the total.
     *      The protocol fee is charged on interest, and this is the only place
     *      the two components are ever distinguishable — the caller stores the
     *      interest on the Request because `totalRepayment` gets decremented as
     *      the loan is paid down and the split is lost after the first payment.
     */
    function _calculateLoanInterest(
        uint256 _returnDate,
        uint256 _amount,
        uint16 _interest
    ) internal view returns (uint256 _totalRepayment, uint256 _interestAmount) {
        if (_returnDate <= block.timestamp)
            revert Protocol__DateMustBeInFuture();

        uint256 _duration = _returnDate - block.timestamp;
        if (_duration < Constants.MIN_LOAN_DURATION)
            revert Protocol__TermTooShort();

        _interestAmount =
            (_amount * uint256(_interest) * _duration) /
            (Constants.BASIS_POINTS * Constants.SECONDS_PER_YEAR);

        // Integer division floors, so a small enough amount or short enough
        // term would otherwise produce a free loan.
        if (_interestAmount == 0) revert Protocol__InterestTooSmall();

        _totalRepayment = _amount + _interestAmount;
    }

    /**
     * @notice Credits `_amount` of `_token` to `_to`'s collateral position.
     *
     * @dev Writes both ledgers, which is the point of having this as a function
     *      at all. `s_addressToCollateralDeposited` is the accounting total that
     *      collateral value and health factor are computed from, and
     *      `s_addressToAvailableBalance` is the only balance
     *      `withdrawCollateral` will pay against. Credit the first alone and the
     *      tokens are stranded — visible in the position, impossible to
     *      withdraw. Credit the second alone and `withdrawCollateral` decrements
     *      a deposited balance that was never incremented, so it underflows and
     *      reverts, stranding them differently.
     *
     *      Used by liquidation to move seized collateral between users. It is a
     *      pure bookkeeping move: no token leaves the diamond, so the diamond's
     *      real balance keeps backing the sum of these ledgers exactly as it did
     *      before the call.
     *
     *      Zero is a no-op, so a share that rounded away costs two SLOADs and
     *      nothing else.
     *
     * @param _to Recipient of the collateral claim.
     * @param _token Collateral token being credited.
     * @param _amount Amount in `_token`'s units.
     */
    function _creditCollateral(
        address _to,
        address _token,
        uint256 _amount
    ) internal {
        if (_amount == 0) return;

        _appStorage.s_addressToCollateralDeposited[_to][_token] += _amount;
        _appStorage.s_addressToAvailableBalance[_to][_token] += _amount;
    }

    /**
     * @notice The protocol's cut of a repayment: a share of interest only.
     *
     * @dev A payment is part principal and part interest in the same ratio as
     *      the loan itself, so the interest inside a payment of `_payment` is
     *
     *          _payment * interestAccrued / (amount + interestAccrued)
     *
     *      and the fee is ONE_PERCENT_BPS of that. `amount` (principal) and
     *      `interestAccrued` are both fixed at origination and never mutated,
     *      which is what makes the denominator stable across partial payments —
     *      `totalRepayment` is decremented as the loan is paid down and could
     *      not serve as one.
     *
     *      Both divisions floor, so the fees charged over a sequence of partial
     *      payments sum to at most ONE_PERCENT_BPS of the interest, never more.
     *      Rounding therefore favours the borrower and the lender and can never
     *      overcharge; a dust payment can round the fee to zero, which the
     *      caller handles by skipping the transfer.
     *
     * @param _request The loan being repaid.
     * @param _payment The payment, already clamped to the outstanding balance.
     * @return The fee in loan-token units.
     */
    function _repaymentFee(
        Request storage _request,
        uint256 _payment
    ) internal view returns (uint256) {
        uint256 _originalTotal = _request.amount + _request.interestAccrued;
        if (_originalTotal == 0) return 0;

        uint256 _interestShare = (_payment * _request.interestAccrued) /
            _originalTotal;

        return
            Utils.calculateFeesPercentage(
                _interestShare,
                _appStorage.ONE_PERCENT_BPS
            );
    }

    /**
     * @notice What repaying `_amount` on a loan will cost in protocol fees.
     * @dev So a borrower can see the fee before signing and a lender can see
     *      what they will net. There was no way to read either: the fee was
     *      computed inside `repayLoan` and nothing exposed it, which is why the
     *      UI had no fee row on the repay path at all.
     *
     *      Applies the same clamp `repayLoan` does, so quoting an overpayment
     *      returns the fee on what would actually be taken.
     *
     * @param _requestId The loan.
     * @param _amount The intended payment, in loan-token units.
     * @return fee The protocol fee.
     * @return toLender What the lender is credited: payment minus fee.
     */
    function getRepaymentFee(
        uint96 _requestId,
        uint256 _amount
    ) external view returns (uint256 fee, uint256 toLender) {
        Request storage _request = _appStorage.request[_requestId];

        uint256 _outstanding = _request.totalRepayment;
        if (_amount > _outstanding) _amount = _outstanding;

        fee = _repaymentFee(_request, _amount);
        toLender = _amount - fee;
    }

    /**
     * @notice Quotes a loan without originating it.
     * @dev This is what makes the order book sortable: the UI and Luca both
     *      call it to compare offers on equal terms. Deliberately does not
     *      apply the duration floor or the zero-interest guard, so a caller can
     *      display a quote for terms that would be rejected at origination.
     *
     * @param _amount Principal.
     * @param _interest APR in basis points.
     * @param _returnDate Maturity timestamp.
     * @return totalRepayment Principal plus pro-rated interest.
     * @return interestAmount Interest component alone.
     * @return durationSeconds Term length used for the calculation.
     */
    function getQuote(
        uint256 _amount,
        uint16 _interest,
        uint256 _returnDate
    )
        external
        view
        returns (
            uint256 totalRepayment,
            uint256 interestAmount,
            uint256 durationSeconds
        )
    {
        if (_returnDate <= block.timestamp) return (_amount, 0, 0);

        durationSeconds = _returnDate - block.timestamp;
        interestAmount =
            (_amount * uint256(_interest) * durationSeconds) /
            (Constants.BASIS_POINTS * Constants.SECONDS_PER_YEAR);
        totalRepayment = _amount + interestAmount;
    }

    /**
     * @notice Quotes borrowing `_amount` from an existing listing.
     * @dev The single call a marketplace row needs to render a comparable
     *      price, so clients don't have to re-implement the interest formula.
     */
    function getListingQuote(
        uint96 _listingId,
        uint256 _amount
    )
        external
        view
        returns (
            uint256 totalRepayment,
            uint256 interestAmount,
            uint256 durationSeconds,
            uint16 aprBps
        )
    {
        LoanListing storage _listing = _appStorage.loanListings[_listingId];
        aprBps = _listing.interest;

        if (_listing.returnDate <= block.timestamp) return (_amount, 0, 0, aprBps);

        durationSeconds = _listing.returnDate - block.timestamp;
        interestAmount =
            (_amount * uint256(aprBps) * durationSeconds) /
            (Constants.BASIS_POINTS * Constants.SECONDS_PER_YEAR);
        totalRepayment = _amount + interestAmount;
    }

    /// @dev for getting the gitcoinpoint score
    /// @param _user the address of you want to check the score for.
    /// @return _score the user scors.
    function get_gitCoinPoint(
        address _user
    ) external view returns (uint256 _score) {
        // LibDiamond.enforceIsContractOwner();
        _score = _appStorage.addressToUser[_user].gitCoinPoint;
    }

    /// @return _assets the collection of token that can be loaned in the protocol
    function getLoanableAssets()
        external
        view
        returns (address[] memory _assets)
    {
        _assets = _appStorage.s_loanableToken;
    }

    /// @dev gets a request from a user
    /// @param _user the addresss of the user
    /// @param _requestId the id of the request that was created by the user
    /// @return Documents the return variables of a contract’s function state variable
    function getUserRequest(
        address _user,
        uint96 _requestId
    ) external view returns (Request memory) {
        Request memory _request = _appStorage.request[_requestId];
        if (_request.author != _user) revert Protocol__NotOwner();
        return _request;
    }

    /**
     * @notice Retrieves a loan listing created by the caller.
     * @dev Ensures that the caller is the author of the specified loan listing.
     * @param _listingId The ID of the loan listing to retrieve.
     * @return A copy of the `LoanListing` struct corresponding to the given listing ID.
     * @custom:reverts Protocol__OwnerCreatedOrder if the caller is not the author of the listing.
     */
    function getUserLoanListing(
        uint96 _listingId
    ) external view returns (LoanListing memory) {
        LoanListing storage _newListing = _appStorage.loanListings[_listingId];
        if (_newListing.author != msg.sender)
            revert Protocol__OwnerCreatedOrder();
        return _newListing;
    }

    /**
     * @notice Gets all active loan requests for a specific user
     * @dev Returns array of Request structs that haven't been repaid or liquidated
     * @param _user Address of the user to get active requests for
     * @return _requests Array of Request structs representing active loans
     */
    // function getUserActiveRequests(
    //     address _user
    // ) public view returns (Request[] memory _requests) {
    //     Request[] memory requests = _appStorage.s_requests;
    //     uint64 requestLength;
    //     for (uint i = 0; i < requests.length; i++) {
    //         if (
    //             requests[i].author == _user &&
    //             requests[i].status == Status.SERVICED
    //         ) {
    //             requestLength++;
    //         }
    //     }

    //     _requests = new Request[](requestLength);

    //     for (uint i = 0; i < requests.length; i++) {
    //         if (
    //             requests[i].author == _user &&
    //             requests[i].status == Status.SERVICED
    //         ) {
    //             _requests[requestLength - 1] = requests[i];
    //             requestLength--;
    //         }
    //     }
    // }

    // function getUserActiveRequests(
    //     address _user
    // ) public view returns (Request[] memory _requests) {
    //     return _appStorage.userActiveRequests[_user];
    // }

    function getUserActiveRequests(
        address _user
    ) public view returns (Request[] memory _requests) {
        uint96[] memory ids = _appStorage.userActiveRequet[_user];
        uint256 activeCount = 0;

        // First pass: count actually active requests
        for (uint256 i = 0; i < ids.length; i++) {
            if (_appStorage.request[ids[i]].status == Status.SERVICED) {
                activeCount++;
            }
        }

        // Second pass: collect active requests
        _requests = new Request[](activeCount);
        uint256 index = 0;

        for (uint256 i = 0; i < ids.length; i++) {
            Request memory currentRequest = _appStorage.request[ids[i]];

            if (currentRequest.status == Status.SERVICED) {
                _requests[index] = currentRequest; // Use latest on-chain data
                index++;
            }
        }
    }

    /**
     * @notice Gets all serviced loan requests for a specific lender
     * @dev Returns array of Request structs where the lender has provided funds
     * @param _lender Address of the lender to query serviced requests for
     * @return _requests Array of Request structs serviced by the specified lender
     */
    function getServicedRequestByLender(
        address _lender
    ) public view returns (Request[] memory _requests) {
        Request[] memory requests = _appStorage.s_requests;
        uint64 requestLength;
        for (uint i = 0; i < requests.length; i++) {
            if (requests[i].lender == _lender) {
                requestLength++;
            }
        }

        _requests = new Request[](requestLength);

        for (uint i = 0; i < requests.length; i++) {
            if (requests[i].lender == _lender) {
                _requests[requestLength - 1] = requests[i];
                requestLength--;
            }
        }
    }

    /**
     * @notice Calculates total value of active loans for a user in USD
     * @dev Aggregates USD value of all outstanding loans for the specified user
     * @param _user Address of the user to calculate loan value for
     * @return _value Total USD value of all active loans for the user
     */
    function getLoanCollectedInUsd(
        address _user
    ) public view returns (uint256 _value) {
        Request[] memory userActiveRequest = getUserActiveRequests(_user);
        uint256 loans = 0;
        for (uint i = 0; i < userActiveRequest.length; i++) {
            uint8 tokenDecimal = _getTokenDecimal(
                userActiveRequest[i].loanRequestAddr
            );
            loans += getUsdValue(
                userActiveRequest[i].loanRequestAddr,
                userActiveRequest[i].totalRepayment,
                tokenDecimal
            );
        }
        _value = loans;
    }

    function getListingId() external view returns (uint256) {
        return _appStorage.listingId;
    }

    function getRequestId() external view returns (uint256) {
        return _appStorage.s_requests.length;
    }

    /**
     * @notice Gets array of collateral token addresses deposited by user
     * @dev Returns list of ERC20 token addresses used as collateral
     * @param _user Address of the user to get collateral tokens for
     * @return _collaterals Array of token addresses representing user's collateral
     *
     * @dev Both loops test the SAME mapping. They did not: the count tested
     *      `s_addressToAvailableBalance` while the fill tested
     *      `s_addressToCollateralDeposited`, and the fill wrote backwards from
     *      `userTokens[userLength - 1]`, decrementing as it went.
     *
     *      Available balance is deposited minus whatever active loans have
     *      locked, so it is <= deposited by construction and the two predicates
     *      disagree for every fully-locked token. The fill loop then ran more
     *      times than the count had allocated, `userLength` reached 0, and
     *      `userLength - 1` underflowed — a bare panic, not a named revert.
     *
     *      That was reachable from ordinary use and it blocked borrowing
     *      outright: a user with one token fully locked by an existing loan and
     *      other collateral sitting free could not open ANY new request,
     *      because both loan paths call this first (`createLendingRequest`,
     *      `requestLoanFromListing`) and it reverted before either had a chance
     *      to check anything. The failure named no cause.
     *
     *      `deposited` is the correct predicate, not merely the safe one. It is
     *      what this function's own docstring promises, what
     *      `getAccountCollateralValue` sums, and what both callers' lock loops
     *      read when sizing the proportional lock — so counting on `available`
     *      described a different set from the one every consumer then used.
     *
     *      Including a partially-locked token is safe here because the borrow
     *      limit bounds the sum of lock portions at 1: each portion is
     *      `loanUsd / (collateralUsd * COLLATERALIZATION_RATIO / 100)` and the
     *      cumulative check refuses a loan once total borrowings reach that
     *      denominator. Without that check this function would hand the lock
     *      loop a token it then over-locks, so the two changes are load-bearing
     *      together.
     */
    function getUserCollateralTokens(
        address _user
    ) public view returns (address[] memory _collaterals) {
        address[] memory tokens = _appStorage.s_collateralToken;

        /* Was `uint8`. `s_collateralToken` grows by owner-only
         * `addCollateralToken` with no cap, so 256 registered assets would have
         * silently wrapped the count and returned a short array. */
        uint256 userLength = 0;

        for (uint256 i = 0; i < tokens.length; i++) {
            if (
                _appStorage.s_addressToCollateralDeposited[_user][tokens[i]] > 0
            ) {
                userLength++;
            }
        }

        address[] memory userTokens = new address[](userLength);

        /* Forward, with its own cursor. The old loop counted the destination
         * index down from the allocated length, which only lands correctly when
         * both loops match on every token — the assumption that broke above. */
        uint256 index = 0;

        for (uint256 i = 0; i < tokens.length; i++) {
            if (
                _appStorage.s_addressToCollateralDeposited[_user][tokens[i]] > 0
            ) {
                userTokens[index] = tokens[i];
                index++;
            }
        }

        return userTokens;
    }

    /**
     * @notice Authorizes (or deauthorizes) an address to award points
     * @param _awarder The address of the bot/contract
     * @param _approved True to approve, false to revoke
     */
    function setApprovedPointAwarder(address _awarder, bool _approved) external {
        LibDiamond.enforceIsContractOwner();
        _appStorage.approvedPointAwarders[_awarder] = _approved;
        emit PointAwarderUpdated(_awarder, _approved);
    }

    /**
     * @notice Awards points to a user from an approved source (e.g. off-chain indexer)
     * @param _user The user receiving points
     * @param _amount The amount of points to award
     */
    function awardPoints(address _user, uint256 _amount) external {
        if (!_appStorage.approvedPointAwarders[msg.sender]) {
            revert Protocol__Unauthorized();
        }
        
        _appStorage.addressToUser[_user].gitCoinPoint += _amount;
        
        // Emit specific event for off-chain tracking
        emit GatewayPointsAwarded(_user, _amount, msg.sender);
        
        // Also trigger referral points if applicable (optional, keeping consistent with native actions)
        // _awardReferralPoints(_user, _amount); 
    }

    fallback() external {
        revert("ProtocolFacet: fallback");
    }
}
