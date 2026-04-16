// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;
import {LibAppStorage} from "../libraries/LibAppStorage.sol";
import {Constants} from "../utils/constants/constant.sol";
import {Validator} from "../utils/validators/Validator.sol";
import {LibDiamond} from "../libraries/LibDiamond.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
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
        if (_token == Constants.NATIVE_TOKEN && msg.value <= 0) {
            revert Protocol__MustBeMoreThanZero();
        }
        _;
    }

    /**
     * @dev Ensure that only bot address can call this function
     * @param _requestId the id of the request that will be liquidate
     */
    modifier onlyBot(uint96 _requestId) {
        if (_appStorage.botAddress != msg.sender) {
            revert Protocol__OnlyBotCanAccess();
        }

        if (_requestId <= 0) {
            revert Protocol__MustBeMoreThanZero();
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
        if (_token == Constants.NATIVE_TOKEN && msg.value <= 0) {
            revert Protocol__MustBeMoreThanZero();
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
        _appStorage.addressToUser[msg.sender].gitCoinPoint += Constants
            .GITPOINT;
        _awardReferralPoints(msg.sender, Constants.GITPOINT);

        if (_tokenCollateralAddress != Constants.NATIVE_TOKEN) {
            bool _success = IERC20(_tokenCollateralAddress).transferFrom(
                msg.sender,
                address(this),
                _amountOfCollateral
            );
            if (!_success) {
                revert Protocol__TransferFailed();
            }
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
        _newRequest.totalRepayment = _calculateLoanInterest(
            _returnDate,
            _amount,
            _interest
        );
        _newRequest.loanRequestAddr = _loanCurrency;
        _newRequest.collateralTokens = _collateralTokens;
        _newRequest.status = Status.OPEN;
        _appStorage.addressToUser[msg.sender].gitCoinPoint += Constants
            .SPECIAL_GITPOINT;
        _awardReferralPoints(msg.sender, Constants.SPECIAL_GITPOINT);
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

        _foundRequest.lender = msg.sender;
        _Request.lender = msg.sender;
        _foundRequest.status = Status.SERVICED;
        _Request.status = Status.SERVICED;
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

        if (_healthFactor(_foundRequest.author, _loanUsdValue) < 1e16) {
            revert Protocol__InsufficientCollateral();
        }

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
            bool success = IERC20(_tokenAddress).transferFrom(
                msg.sender,
                _foundRequest.author,
                amountToLend
            );
            require(success, "Protocol__TransferFailed");
        } else {
            _appStorage.addressToUser[msg.sender].gitCoinPoint += Constants
                .EXTRA_POINT;
            _awardReferralPoints(msg.sender, Constants.EXTRA_POINT);
            (bool sent, ) = payable(_foundRequest.author).call{
                value: amountToLend
            }("");
            require(sent, "Protocol__TransferFailed");
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

        if (_tokenCollateralAddress == Constants.NATIVE_TOKEN) {
            (bool sent, ) = payable(msg.sender).call{value: _amount}("");
            require(sent, "Protocol__TransferFailed");
        } else {
            bool success = IERC20(_tokenCollateralAddress).transfer(
                msg.sender,
                _amount
            );
            require(success, "Protocol__TransferFailed");
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

    function addUserActiveRequest(address user, Request memory request) public {
        LibDiamond.enforceIsContractOwner();

        // Check if request already exists to avoid duplicates
        Request[] storage userRequests = _appStorage.userActiveRequests[user];
        for (uint256 i = 0; i < userRequests.length; i++) {
            if (userRequests[i].requestId == request.requestId) {
                return; // Already exists, don't add duplicate
            }
        }

        // Add the full request object
        _appStorage.userActiveRequests[user].push(request);
    }

    function removeUserActiveRequest(address user, uint96 requestId) external {
        LibDiamond.enforceIsContractOwner();

        Request[] storage userRequests = _appStorage.userActiveRequests[user];
        for (uint256 i = 0; i < userRequests.length; i++) {
            if (userRequests[i].requestId == requestId) {
                // Move last element to this position and pop
                userRequests[i] = userRequests[userRequests.length - 1];
                userRequests.pop();
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
            require(sent, "Protocol__TransferFailed");
        } else {
            bool success = IERC20(_newListing.tokenAddress).transfer(
                msg.sender,
                _amount
            );
            require(success, "Protocol__TransferFailed");
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
     * @param _amount The total amount of the loan to be listed
     * @param _min_amount The minimum amount that can be borrowed from the listing
     * @param _max_amount The maximum amount that can be borrowed from the listing
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

        if (_loanCurrency != Constants.NATIVE_TOKEN) {
            if (IERC20(_loanCurrency).balanceOf(msg.sender) < _amount)
                revert Protocol__InsufficientBalance();

            if (
                IERC20(_loanCurrency).allowance(msg.sender, address(this)) <
                _amount
            ) revert Protocol__InsufficientAllowance();
        }

        uint8 decimal = _getTokenDecimal(_loanCurrency);

        //get usd value
        uint256 _loanUsdValue = getUsdValue(_loanCurrency, _amount, decimal);

        if (_loanUsdValue == 0) revert Protocol__InvalidAmount();
        if (_loanUsdValue < Constants.MIN_LOAN_AMOUNT) {
            revert Protocol__LoanAmountTooLow();
        }

        if (_loanCurrency == Constants.NATIVE_TOKEN) {
            _appStorage.addressToUser[msg.sender].gitCoinPoint += Constants
                .SPECIAL_GITPOINT;
            _awardReferralPoints(msg.sender, Constants.SPECIAL_GITPOINT);
            _amount = msg.value;
        }

        if (_loanCurrency != Constants.NATIVE_TOKEN) {
            _appStorage.addressToUser[msg.sender].gitCoinPoint += Constants
                .EXTRA_POINT;
            _awardReferralPoints(msg.sender, Constants.EXTRA_POINT);
            bool _success = IERC20(_loanCurrency).transferFrom(
                msg.sender,
                address(this),
                _amount
            );
            if (!_success) {
                revert Protocol__TransferFailed();
            }
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
        newRequest.totalRepayment = _calculateLoanInterest(
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
        _appStorage
            .addressToUser[msg.sender]
            .totalLoanCollected += loanUsdValue;

        // Transfer funds to borrower
        if (_listing.tokenAddress == Constants.NATIVE_TOKEN) {
            _appStorage.addressToUser[msg.sender].gitCoinPoint += Constants
                .SPECIAL_GITPOINT;
            _awardReferralPoints(msg.sender, Constants.SPECIAL_GITPOINT);
            (bool sent, ) = payable(msg.sender).call{value: _amount}("");
            require(sent, "Protocol__TransferFailed");
        } else {
            _appStorage.addressToUser[msg.sender].gitCoinPoint += Constants
                .EXTRA_POINT;
            _awardReferralPoints(msg.sender, Constants.EXTRA_POINT);
            bool success = IERC20(_listing.tokenAddress).transfer(
                msg.sender,
                _amount
            );
            require(success, "Protocol__TransferFailed");
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

        if (_request.loanRequestAddr == Constants.NATIVE_TOKEN) {
            _amount = msg.value;
            //proceed to collect protocol fee
            if (_appStorage.kaleidoFeeVault == address(0))
                revert Protocol__InvalidFeeVault();
            if (_appStorage.ONE_PERCENT_BPS == 0)
                revert Protocol__InvalidFeeBps();
            uint256 protocolFee = Utils.calculateFeesPercentage(
                _amount,
                _appStorage.ONE_PERCENT_BPS
            );
            // Transfer the protocol fee to the protocol address
            (bool success, ) = _appStorage.kaleidoFeeVault.call{
                value: protocolFee
            }("");
            require(success, "Protocol fee transfer failed");
            _returnedAmount = _amount - protocolFee;
        } else {
            IERC20 _token = IERC20(_request.loanRequestAddr);
            uint256 protocolFee = Utils.calculateFeesPercentage(
                _amount,
                _appStorage.ONE_PERCENT_BPS
            );
            _returnedAmount = _amount - protocolFee;
            if (_token.balanceOf(msg.sender) < _amount) {
                revert Protocol__InsufficientBalance();
            }
            if (_token.allowance(msg.sender, address(this)) < _amount)
                revert Protocol__InsufficientAllowance();
            _token.transferFrom(msg.sender, address(this), _amount);
            _token.transfer(_appStorage.kaleidoFeeVault, protocolFee);
        }

        if (_amount >= _request.totalRepayment) {
            _amount = _request.totalRepayment;
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

        for (uint i = 0; i < _request.collateralTokens.length; i++) {
            _appStorage.s_addressToAvailableBalance[_request.author][
                    _request.collateralTokens[i]
                ] += _appStorage.s_idToCollateralTokenAmount[_requestId][
                _request.collateralTokens[i]
            ];
        }
        if (loanCollected > _loanUsdValue) {
            _appStorage.addressToUser[msg.sender].totalLoanCollected =
                loanCollected -
                _loanUsdValue;
        } else {
            _appStorage.addressToUser[msg.sender].totalLoanCollected = 0;
        }

        emit LoanRepayment(msg.sender, _requestId, _amount);
    }

    /// @notice Liquidates a user's loan position if health factor is below threshold or loan is overdue
    /// @dev Only callable by authorized bot address
    /// @param requestId The ID of the loan request to liquidate
    function liquidateUserRequest(
        uint96 requestId
    ) external onlyBot(requestId) nonReentrant {
        Request memory _foundRequest = getActiveRequestsByRequestId(requestId);
        // Request storage _foundRequest = _appStorage.s_requests[requestId - 1];
        address loanCurrency = _foundRequest.loanRequestAddr;
        address lenderAddress = _foundRequest.lender;
        address borrowerAddress = _foundRequest.author;
        uint8 loanTokenDecimals = _getTokenDecimal(loanCurrency);

        uint256 loanUsdValue = getUsdValue(
            loanCurrency,
            _foundRequest.totalRepayment,
            loanTokenDecimals
        );
        require(loanUsdValue > 0, "Protocol__InvalidAmount");
        if (_foundRequest.status != Status.SERVICED)
            revert Protocol__RequestNotServiced();

        if (
            _healthFactor(_foundRequest.author, 0) >= Constants.PRECISION &&
            block.timestamp <= _foundRequest.returnDate
        ) {
            revert Protocol__PositionHealthy();
        } else {
            uint256 totalCollateralUsdValue = 0;
            uint256 len = _foundRequest.collateralTokens.length;

            if (_appStorage.kaleidoFeeVault == address(0))
                revert Protocol__InvalidFeeVault();
            if (_appStorage.LIQUIDITY_BPS == 0)
                revert Protocol__InvalidFeeBps();

            uint256 remainingLoanUsdToCover = loanUsdValue;
            for (uint256 i = 0; i < len && remainingLoanUsdToCover > 0; ++i) {
                address collateralToken = _foundRequest.collateralTokens[i];
                uint256 amountOfCollateralToken = _appStorage
                    .s_idToCollateralTokenAmount[requestId][collateralToken];
                require(
                    amountOfCollateralToken > 0,
                    "amountOfCollateralToken must be more than zero"
                );
                // if (amountOfCollateralToken == 0) continue;

                uint8 collateralDecimals = _getTokenDecimal(collateralToken);
                uint256 collateralUsd = getUsdValue(
                    collateralToken,
                    amountOfCollateralToken,
                    collateralDecimals
                );

                // Fixed liquidation logic with proper balance checking
                if (collateralUsd <= remainingLoanUsdToCover) {
                    // Take all - but check available balances first
                    uint256 userDepositedBalance = _appStorage
                        .s_addressToCollateralDeposited[_foundRequest.author][
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
                            _foundRequest.author
                        ][collateralToken] -= actualAmountToSeize;
                        _appStorage.s_idToCollateralTokenAmount[requestId][
                            collateralToken
                        ] = 0;
                        remainingLoanUsdToCover -= collateralUsd;
                        totalCollateralUsdValue += collateralUsd;
                    }
                } else {
                    // Take only what's needed
                    uint256 neededCollateralUsd = remainingLoanUsdToCover;
                    uint256 tokensToSeize = getTokenAmountFromUsd(
                        collateralToken,
                        neededCollateralUsd,
                        collateralDecimals
                    );

                    uint256 userDepositedBalance = _appStorage
                        .s_addressToCollateralDeposited[_foundRequest.author][
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
                            _foundRequest.author
                        ][collateralToken] -= actualTokensToSeize;
                        _appStorage.s_idToCollateralTokenAmount[requestId][
                                collateralToken
                            ] -= actualTokensToSeize;
                        totalCollateralUsdValue += neededCollateralUsd;
                        remainingLoanUsdToCover -= neededCollateralUsd;
                    }

                    if (remainingLoanUsdToCover <= 0) {
                        remainingLoanUsdToCover = 0;
                    }
                }
            }

            require(
                totalCollateralUsdValue > 0,
                "totalCollateralUsdValue must be more than zero"
            );
            uint256 liquidationValueInLoanToken = getTokenAmountFromUsd(
                loanCurrency,
                totalCollateralUsdValue,
                loanTokenDecimals
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

            uint256 repaymentAmount;
            if (totalCollateralUsdValue >= loanUsdValue) {
                // Full repayment amount if collateral covers or exceeds loan value
                repaymentAmount = _foundRequest.totalRepayment;
            } else {
                repaymentAmount =
                    (_foundRequest.totalRepayment * totalCollateralUsdValue) /
                    loanUsdValue;
            }

            uint256 liquidityPenaltyFee = Utils.calculateFeesPercentage(
                liquidationValueInLoanToken,
                _appStorage.LIQUIDITY_BPS
            );

            require(
                repaymentAmount > 0,
                "repaymentAmount must be more than zero"
            );

            require(
                liquidityPenaltyFee > 0,
                "liquidityPenaltyFee must be more than zero"
            );
            require(
                repaymentAmount >= liquidityPenaltyFee,
                "Fee exceeds repayment"
            );
            uint256 repaymentAmountAfterFee = repaymentAmount -
                liquidityPenaltyFee;
            require(
                repaymentAmountAfterFee > 0,
                "repaymentAmountAfterFee must be more than zero"
            );
            if (loanCurrency == Constants.NATIVE_TOKEN) {
                (bool success, ) = _appStorage.kaleidoFeeVault.call{
                    value: liquidityPenaltyFee
                }("");
                if (!success) revert Protocol__TransferFailed();
            } else {
                bool success = IERC20(loanCurrency).transfer(
                    _appStorage.kaleidoFeeVault,
                    liquidityPenaltyFee
                );
                if (!success) revert Protocol__TransferFailed();
            }

            if (loanCurrency == Constants.NATIVE_TOKEN) {
                (bool sent, ) = payable(lenderAddress).call{
                    value: repaymentAmountAfterFee
                }("");
                if (!sent) revert Protocol__TransferFailed();
            } else {
                bool sent = IERC20(loanCurrency).transfer(
                    lenderAddress,
                    repaymentAmountAfterFee
                );
                if (!sent) revert Protocol__TransferFailed();
            }

            if (repaymentAmount >= _foundRequest.totalRepayment) {
                _appStorage.request[requestId].totalRepayment = 0;
                _appStorage.s_requests[requestId - 1].totalRepayment = 0;
                // _appStorage.request[requestId].status = Status.CLOSED;
            } else {
                _appStorage
                    .request[requestId]
                    .totalRepayment -= repaymentAmount;
                _appStorage
                    .s_requests[requestId - 1]
                    .totalRepayment -= repaymentAmount;
                // _appStorage.request[requestId].status = Status.CLOSED;
            }

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

            emit RequestLiquidated(
                requestId,
                lenderAddress,
                borrowerAddress,
                repaymentAmount
            );
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

    function getLiquidityBPS() public view returns (uint256) {
        return _appStorage.LIQUIDITY_BPS;
    }

    /// @notice Sets the authorized bot address for liquidations
    /// @dev Only callable by contract owner
    /// @param _botAddress The address of the bot to authorize
    function setBotAddress(address _botAddress) external {
        LibDiamond.enforceIsContractOwner();
        _appStorage.botAddress = _botAddress;
    }

    /// @notice Sets the Uniswap router address for token swaps
    /// @dev Only callable by contract owner
    /// @param _swapRouter The address of the Uniswap V2 router
    function setSwapRouter(address _swapRouter) external {
        LibDiamond.enforceIsContractOwner();
        _appStorage.swapRouter = _swapRouter;
    }

    /// @notice Sets the base points for protocol fee calculations
    /// @dev Only callable by contract owner
    /// @param _bps The base points value to set
    function setBPS(uint256 _bps) external {
        LibDiamond.enforceIsContractOwner();
        _appStorage.ONE_PERCENT_BPS = _bps;
    }

    /// @notice Sets the base points for liquidation penalty calculations
    /// @dev Only callable by contract owner
    /// @param _bps The base points value to set
    function setLiquidityBps(uint256 _bps) external {
        LibDiamond.enforceIsContractOwner();
        _appStorage.LIQUIDITY_BPS = _bps;
    }

    /// @notice Sets the address where protocol fees are collected
    /// @dev Only callable by contract owner
    /// @param _feeVault The address of the fee vault
    function setFeeVault(address _feeVault) external {
        LibDiamond.enforceIsContractOwner();
        _appStorage.kaleidoFeeVault = _feeVault;
    }

    ///////////////////////
    /// VIEW FUNCTIONS ///
    //////////////////////

    /// @notice Calculates token amount from USD value
    /// @param token Address of the token to convert to
    /// @param usdAmount Amount in USD (18 decimals)
    /// @param tokenDecimals Decimals of the target token
    /// @return uint256 Token amount based on current price
    function getTokenAmountFromUsd(
        address token,
        uint256 usdAmount,
        uint8 tokenDecimals
    ) public view returns (uint256) {
        bytes32 priceFeedId = _appStorage.s_priceFeeds[token];
        IPythPriceOracle oracle = IPythPriceOracle(_appStorage.pythPriceOracle);
        require(address(oracle) != address(0), "Oracle not set");

        PythStructs.Price memory priceInfo = oracle.getPrice(priceFeedId);
        require(priceInfo.price > 0, "Invalid price");

        int256 expo = int256(priceInfo.expo);
        uint256 price = uint256(uint64(priceInfo.price));

        if (expo < 0) {
            price = price * (10 ** uint256(-expo));
        } else if (expo > 0) {
            price = price / (10 ** uint256(expo));
        }

        // Convert USD amount (18 decimals) to token amount
        // tokenAmount = (usdAmount / price) * 10^decimals
        return (usdAmount * (10 ** tokenDecimals)) / price;
    }

    /// @notice Calculates USD value of token amount
    /// @param token Address of the token to get value for
    /// @param amount Amount of tokens
    /// @param tokenDecimals Decimals of the token
    /// @return uint256 USD value with 18 decimals

    function getUsdValue(
        address token,
        uint256 amount,
        uint8 tokenDecimals
    ) public view returns (uint256) {
        // LibAppStorage.Layout storage s = LibAppStorage.layout();
        bytes32 priceFeedId = _appStorage.s_priceFeeds[token];
        IPythPriceOracle oracle = IPythPriceOracle(_appStorage.pythPriceOracle);
        require(address(oracle) != address(0), "Oracle not set");
        require(priceFeedId != bytes32(0), "Price feed not set");

        PythStructs.Price memory priceInfo = oracle.getPrice(priceFeedId);
        require(priceInfo.price > 0, "Invalid price");

        int256 expo = int256(priceInfo.expo);
        uint256 price = uint256(uint64(priceInfo.price));

        if (expo < 0) {
            price = price * (10 ** uint256(-expo));
        } else if (expo > 0) {
            price = price / (10 ** uint256(expo));
        }

        uint256 normalizedAmount = (amount * 1e18) / (10 ** tokenDecimals);
        return (normalizedAmount * price) / 1e18;
    }

    /// @notice Sets the Pyth oracle address
    /// @param _oracle Address of the Pyth oracle contract
    /// @dev Only callable by contract owner
    function setPythOracle(address _oracle) external {
        LibDiamond.enforceIsContractOwner();
        _appStorage.pythPriceOracle = IPythPriceOracle(_oracle);
    }

    /// @notice Gets the current Pyth oracle address
    /// @return address Current oracle contract address

    function getPythPriceOracle() external view returns (address) {
        return address(LibAppStorage.layout().pythPriceOracle);
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

        if ((_totalBurrowInUsd == 0) && (_borrow_Value == 0))
            return (_collateralAdjustedForThreshold * Constants.PRECISION);

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
    function _calculateLoanInterest(
        uint256 _returnDate,
        uint256 _amount,
        uint16 _interest
    ) internal view returns (uint256 _totalRepayment) {
        if (_returnDate < block.timestamp)
            revert Protocol__DateMustBeInFuture();
        // Calculate the total repayment amount including interest
        _totalRepayment =
            _amount +
            Utils.calculatePercentage(_amount, _interest);
        return _totalRepayment;
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
        Request[] memory storedRequests = _appStorage.userActiveRequests[_user];
        uint256 activeCount = 0;

        // First pass: count actually active requests
        for (uint256 i = 0; i < storedRequests.length; i++) {
            uint96 requestId = storedRequests[i].requestId;
            Status currentStatus = _appStorage.request[requestId].status;

            if (currentStatus == Status.SERVICED) {
                activeCount++;
            }
        }

        // Second pass: collect active requests
        Request[] memory activeRequests = new Request[](activeCount);
        uint256 index = 0;

        for (uint256 i = 0; i < storedRequests.length; i++) {
            uint96 requestId = storedRequests[i].requestId;
            Request memory currentRequest = _appStorage.request[requestId];

            if (currentRequest.status == Status.SERVICED) {
                activeRequests[index] = currentRequest; // Use latest on-chain data
                index++;
            }
        }

        return activeRequests;
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
     */
    function getUserCollateralTokens(
        address _user
    ) public view returns (address[] memory _collaterals) {
        address[] memory tokens = _appStorage.s_collateralToken;
        uint8 userLength = 0;

        for (uint256 i = 0; i < tokens.length; i++) {
            if (_appStorage.s_addressToAvailableBalance[_user][tokens[i]] > 0) {
                userLength++;
            }
        }

        address[] memory userTokens = new address[](userLength);

        for (uint256 i = 0; i < tokens.length; i++) {
            if (
                _appStorage.s_addressToCollateralDeposited[_user][tokens[i]] > 0
            ) {
                userTokens[userLength - 1] = tokens[i];
                userLength--;
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
