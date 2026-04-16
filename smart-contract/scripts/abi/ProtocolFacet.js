export const diamondAbi = [
  {
    inputs: [],
    name: "NotDiamondOwner",
    type: "error",
  },
  {
    inputs: [],
    name: "Protocol__CannotBorrowCollateralAsset",
    type: "error",
  },
  {
    inputs: [],
    name: "Protocol__CantFundSelf",
    type: "error",
  },
  {
    inputs: [],
    name: "Protocol__CyclicReferral",
    type: "error",
  },
  {
    inputs: [],
    name: "Protocol__DateMustBeInFuture",
    type: "error",
  },
  {
    inputs: [],
    name: "Protocol__DownlinerAlreadyHasUpliner",
    type: "error",
  },
  {
    inputs: [],
    name: "Protocol__IdNotExist",
    type: "error",
  },
  {
    inputs: [],
    name: "Protocol__InsufficientAllowance",
    type: "error",
  },
  {
    inputs: [],
    name: "Protocol__InsufficientAmount",
    type: "error",
  },
  {
    inputs: [],
    name: "Protocol__InsufficientBalance",
    type: "error",
  },
  {
    inputs: [],
    name: "Protocol__InsufficientCollateral",
    type: "error",
  },
  {
    inputs: [],
    name: "Protocol__InsufficientCollateralBalance",
    type: "error",
  },
  {
    inputs: [],
    name: "Protocol__InsufficientCollateralDeposited",
    type: "error",
  },
  {
    inputs: [],
    name: "Protocol__InvalidAddress",
    type: "error",
  },
  {
    inputs: [],
    name: "Protocol__InvalidAmount",
    type: "error",
  },
  {
    inputs: [],
    name: "Protocol__InvalidFeeBps",
    type: "error",
  },
  {
    inputs: [],
    name: "Protocol__InvalidFeeVault",
    type: "error",
  },
  {
    inputs: [],
    name: "Protocol__InvalidToken",
    type: "error",
  },
  {
    inputs: [],
    name: "Protocol__ListingNotOpen",
    type: "error",
  },
  {
    inputs: [],
    name: "Protocol__LoanAmountTooLow",
    type: "error",
  },
  {
    inputs: [],
    name: "Protocol__LoanValueZero",
    type: "error",
  },
  {
    inputs: [],
    name: "Protocol__MustBeMoreThanZero",
    type: "error",
  },
  {
    inputs: [],
    name: "Protocol__NoCollateralDeposited",
    type: "error",
  },
  {
    inputs: [],
    name: "Protocol__NotOwner",
    type: "error",
  },
  {
    inputs: [],
    name: "Protocol__OnlyBotCanAccess",
    type: "error",
  },
  {
    inputs: [],
    name: "Protocol__OrderNotOpen",
    type: "error",
  },
  {
    inputs: [],
    name: "Protocol__OwnerCreatedListing",
    type: "error",
  },
  {
    inputs: [],
    name: "Protocol__OwnerCreatedOrder",
    type: "error",
  },
  {
    inputs: [],
    name: "Protocol__PositionHealthy",
    type: "error",
  },
  {
    inputs: [],
    name: "Protocol__RequestExpired",
    type: "error",
  },
  {
    inputs: [],
    name: "Protocol__RequestNotOpen",
    type: "error",
  },
  {
    inputs: [],
    name: "Protocol__RequestNotServiced",
    type: "error",
  },
  {
    inputs: [],
    name: "Protocol__TokenAlreadyExists",
    type: "error",
  },
  {
    inputs: [],
    name: "Protocol__TokenNotAllowed",
    type: "error",
  },
  {
    inputs: [],
    name: "Protocol__TokenNotLoanable",
    type: "error",
  },
  {
    inputs: [],
    name: "Protocol__TransferFailed",
    type: "error",
  },
  {
    inputs: [],
    name: "Protocol__UplinerCannotBeDownliner",
    type: "error",
  },
  {
    inputs: [],
    name: "Protocol__tokensAndPriceFeedsArrayMustBeSameLength",
    type: "error",
  },
  {
    inputs: [],
    name: "ReentrancyGuardReentrantCall",
    type: "error",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "_sender",
        type: "address",
      },
      {
        indexed: true,
        internalType: "address",
        name: "_token",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "_value",
        type: "uint256",
      },
    ],
    name: "CollateralDeposited",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "sender",
        type: "address",
      },
      {
        indexed: true,
        internalType: "address",
        name: "_tokenCollateralAddress",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "_amount",
        type: "uint256",
      },
    ],
    name: "CollateralWithdrawn",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint96",
        name: "listingId",
        type: "uint96",
      },
      {
        indexed: true,
        internalType: "address",
        name: "sender",
        type: "address",
      },
      {
        indexed: true,
        internalType: "address",
        name: "tokenAddress",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "minAmount",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "maxAmount",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "returnDate",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint16",
        name: "interest",
        type: "uint16",
      },
      {
        indexed: false,
        internalType: "address",
        name: "currency",
        type: "address",
      },
    ],
    name: "LoanListingCreated",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "sender",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint96",
        name: "id",
        type: "uint96",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount",
        type: "uint256",
      },
    ],
    name: "LoanRepayment",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "upliner",
        type: "address",
      },
      {
        indexed: true,
        internalType: "address",
        name: "user",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "referralPoints",
        type: "uint256",
      },
    ],
    name: "ReferralPointsAwarded",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "_borrower",
        type: "address",
      },
      {
        indexed: true,
        internalType: "uint96",
        name: "requestId",
        type: "uint96",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "_amount",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint16",
        name: "_interest",
        type: "uint16",
      },
      {
        indexed: true,
        internalType: "address",
        name: "tokenAddress",
        type: "address",
      },
    ],
    name: "RequestCreated",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint96",
        name: "requestId",
        type: "uint96",
      },
      {
        indexed: true,
        internalType: "address",
        name: "lenderAddress",
        type: "address",
      },
      {
        indexed: true,
        internalType: "address",
        name: "borrowerAddress",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "totalRepayment",
        type: "uint256",
      },
    ],
    name: "RequestLiquidated",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint96",
        name: "_requestId",
        type: "uint96",
      },
      {
        indexed: true,
        internalType: "address",
        name: "_lender",
        type: "address",
      },
      {
        indexed: true,
        internalType: "address",
        name: "_borrower",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "_amount",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "address",
        name: "tokenAddress",
        type: "address",
      },
    ],
    name: "RequestServiced",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "_token",
        type: "address",
      },
      {
        indexed: false,
        internalType: "bytes32",
        name: "_priceFeed",
        type: "bytes32",
      },
      {
        indexed: true,
        internalType: "address",
        name: "sender",
        type: "address",
      },
    ],
    name: "UpdateLoanableToken",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "sender",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint8",
        name: "newTokensCount",
        type: "uint8",
      },
    ],
    name: "UpdatedCollateralTokens",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "user",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "newScore",
        type: "uint256",
      },
    ],
    name: "UpdatedGitPointScore",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "upliner",
        type: "address",
      },
      {
        indexed: true,
        internalType: "address",
        name: "downliner",
        type: "address",
      },
    ],
    name: "UplinerRegistered",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "sender",
        type: "address",
      },
      {
        indexed: true,
        internalType: "uint96",
        name: "_orderId",
        type: "uint96",
      },
      {
        indexed: true,
        internalType: "uint8",
        name: "orderStatus",
        type: "uint8",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "_amount",
        type: "uint256",
      },
    ],
    name: "withdrawnAdsToken",
    type: "event",
  },
  {
    stateMutability: "nonpayable",
    type: "fallback",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_token",
        type: "address",
      },
      {
        internalType: "bytes32",
        name: "_priceFeed",
        type: "bytes32",
      },
    ],
    name: "addCollateralToken",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address[]",
        name: "_tokens",
        type: "address[]",
      },
      {
        internalType: "bytes32[]",
        name: "_priceFeeds",
        type: "bytes32[]",
      },
    ],
    name: "addCollateralTokens",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_token",
        type: "address",
      },
      {
        internalType: "bytes32",
        name: "_priceFeed",
        type: "bytes32",
      },
    ],
    name: "addLoanableToken",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint96",
        name: "_listingId",
        type: "uint96",
      },
    ],
    name: "closeListingAd",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint96",
        name: "_requestId",
        type: "uint96",
      },
    ],
    name: "closeRequest",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint128",
        name: "_amount",
        type: "uint128",
      },
      {
        internalType: "uint16",
        name: "_interest",
        type: "uint16",
      },
      {
        internalType: "uint256",
        name: "_returnDate",
        type: "uint256",
      },
      {
        internalType: "address",
        name: "_loanCurrency",
        type: "address",
      },
    ],
    name: "createLendingRequest",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "_amount",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "_min_amount",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "_max_amount",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "_returnDate",
        type: "uint256",
      },
      {
        internalType: "uint16",
        name: "_interest",
        type: "uint16",
      },
      {
        internalType: "address",
        name: "_loanCurrency",
        type: "address",
      },
    ],
    name: "createLoanListing",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_tokenCollateralAddress",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "_amountOfCollateral",
        type: "uint256",
      },
    ],
    name: "depositCollateral",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_user",
        type: "address",
      },
    ],
    name: "getAccountAvailableValue",
    outputs: [
      {
        internalType: "uint256",
        name: "_totalAvailableValueInUsd",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_user",
        type: "address",
      },
    ],
    name: "getAccountCollateralValue",
    outputs: [
      {
        internalType: "uint256",
        name: "_totalCollateralValueInUsd",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getAllCollateralToken",
    outputs: [
      {
        internalType: "address[]",
        name: "",
        type: "address[]",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "offset",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "limit",
        type: "uint256",
      },
    ],
    name: "getAllRequests",
    outputs: [
      {
        components: [
          {
            internalType: "uint96",
            name: "listingId",
            type: "uint96",
          },
          {
            internalType: "uint96",
            name: "requestId",
            type: "uint96",
          },
          {
            internalType: "address",
            name: "author",
            type: "address",
          },
          {
            internalType: "uint256",
            name: "amount",
            type: "uint256",
          },
          {
            internalType: "uint16",
            name: "interest",
            type: "uint16",
          },
          {
            internalType: "uint256",
            name: "totalRepayment",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "returnDate",
            type: "uint256",
          },
          {
            internalType: "address",
            name: "lender",
            type: "address",
          },
          {
            internalType: "address",
            name: "loanRequestAddr",
            type: "address",
          },
          {
            internalType: "address[]",
            name: "collateralTokens",
            type: "address[]",
          },
          {
            internalType: "enum Status",
            name: "status",
            type: "uint8",
          },
        ],
        internalType: "struct Request[]",
        name: "",
        type: "tuple[]",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_from",
        type: "address",
      },
      {
        internalType: "address",
        name: "_to",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "_amount",
        type: "uint256",
      },
    ],
    name: "getConvertValue",
    outputs: [
      {
        internalType: "uint256",
        name: "value",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_refferal",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "_index",
        type: "uint256",
      },
    ],
    name: "getDownliners",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_upliner",
        type: "address",
      },
    ],
    name: "getDownlinersCount",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_user",
        type: "address",
      },
    ],
    name: "getHealthFactor",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getLiquidityBPS",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getListingId",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_user",
        type: "address",
      },
    ],
    name: "getLoanCollectedInUsd",
    outputs: [
      {
        internalType: "uint256",
        name: "_value",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint96",
        name: "_listingId",
        type: "uint96",
      },
    ],
    name: "getLoanListing",
    outputs: [
      {
        components: [
          {
            internalType: "uint96",
            name: "listingId",
            type: "uint96",
          },
          {
            internalType: "address",
            name: "author",
            type: "address",
          },
          {
            internalType: "address",
            name: "tokenAddress",
            type: "address",
          },
          {
            internalType: "uint256",
            name: "amount",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "min_amount",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "max_amount",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "returnDate",
            type: "uint256",
          },
          {
            internalType: "uint16",
            name: "interest",
            type: "uint16",
          },
          {
            internalType: "enum ListingStatus",
            name: "listingStatus",
            type: "uint8",
          },
        ],
        internalType: "struct LoanListing",
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getLoanableAssets",
    outputs: [
      {
        internalType: "address[]",
        name: "_assets",
        type: "address[]",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getPythPriceOracle",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_user",
        type: "address",
      },
    ],
    name: "getReferralPoints",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint96",
        name: "_requestId",
        type: "uint96",
      },
    ],
    name: "getRequest",
    outputs: [
      {
        components: [
          {
            internalType: "uint96",
            name: "listingId",
            type: "uint96",
          },
          {
            internalType: "uint96",
            name: "requestId",
            type: "uint96",
          },
          {
            internalType: "address",
            name: "author",
            type: "address",
          },
          {
            internalType: "uint256",
            name: "amount",
            type: "uint256",
          },
          {
            internalType: "uint16",
            name: "interest",
            type: "uint16",
          },
          {
            internalType: "uint256",
            name: "totalRepayment",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "returnDate",
            type: "uint256",
          },
          {
            internalType: "address",
            name: "lender",
            type: "address",
          },
          {
            internalType: "address",
            name: "loanRequestAddr",
            type: "address",
          },
          {
            internalType: "address[]",
            name: "collateralTokens",
            type: "address[]",
          },
          {
            internalType: "enum Status",
            name: "status",
            type: "uint8",
          },
        ],
        internalType: "struct Request",
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getRequestId",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint96",
        name: "_requestId",
        type: "uint96",
      },
      {
        internalType: "address",
        name: "_token",
        type: "address",
      },
    ],
    name: "getRequestToColateral",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_lender",
        type: "address",
      },
    ],
    name: "getServicedRequestByLender",
    outputs: [
      {
        components: [
          {
            internalType: "uint96",
            name: "listingId",
            type: "uint96",
          },
          {
            internalType: "uint96",
            name: "requestId",
            type: "uint96",
          },
          {
            internalType: "address",
            name: "author",
            type: "address",
          },
          {
            internalType: "uint256",
            name: "amount",
            type: "uint256",
          },
          {
            internalType: "uint16",
            name: "interest",
            type: "uint16",
          },
          {
            internalType: "uint256",
            name: "totalRepayment",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "returnDate",
            type: "uint256",
          },
          {
            internalType: "address",
            name: "lender",
            type: "address",
          },
          {
            internalType: "address",
            name: "loanRequestAddr",
            type: "address",
          },
          {
            internalType: "address[]",
            name: "collateralTokens",
            type: "address[]",
          },
          {
            internalType: "enum Status",
            name: "status",
            type: "uint8",
          },
        ],
        internalType: "struct Request[]",
        name: "_requests",
        type: "tuple[]",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getServicedRequests",
    outputs: [
      {
        components: [
          {
            internalType: "uint96",
            name: "listingId",
            type: "uint96",
          },
          {
            internalType: "uint96",
            name: "requestId",
            type: "uint96",
          },
          {
            internalType: "address",
            name: "author",
            type: "address",
          },
          {
            internalType: "uint256",
            name: "amount",
            type: "uint256",
          },
          {
            internalType: "uint16",
            name: "interest",
            type: "uint16",
          },
          {
            internalType: "uint256",
            name: "totalRepayment",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "returnDate",
            type: "uint256",
          },
          {
            internalType: "address",
            name: "lender",
            type: "address",
          },
          {
            internalType: "address",
            name: "loanRequestAddr",
            type: "address",
          },
          {
            internalType: "address[]",
            name: "collateralTokens",
            type: "address[]",
          },
          {
            internalType: "enum Status",
            name: "status",
            type: "uint8",
          },
        ],
        internalType: "struct Request[]",
        name: "",
        type: "tuple[]",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "token",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "usdAmount",
        type: "uint256",
      },
      {
        internalType: "uint8",
        name: "tokenDecimals",
        type: "uint8",
      },
    ],
    name: "getTokenAmountFromUsd",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_downliner",
        type: "address",
      },
    ],
    name: "getUpliner",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "token",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256",
      },
      {
        internalType: "uint8",
        name: "tokenDecimals",
        type: "uint8",
      },
    ],
    name: "getUsdValue",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_user",
        type: "address",
      },
    ],
    name: "getUserActiveRequests",
    outputs: [
      {
        components: [
          {
            internalType: "uint96",
            name: "listingId",
            type: "uint96",
          },
          {
            internalType: "uint96",
            name: "requestId",
            type: "uint96",
          },
          {
            internalType: "address",
            name: "author",
            type: "address",
          },
          {
            internalType: "uint256",
            name: "amount",
            type: "uint256",
          },
          {
            internalType: "uint16",
            name: "interest",
            type: "uint16",
          },
          {
            internalType: "uint256",
            name: "totalRepayment",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "returnDate",
            type: "uint256",
          },
          {
            internalType: "address",
            name: "lender",
            type: "address",
          },
          {
            internalType: "address",
            name: "loanRequestAddr",
            type: "address",
          },
          {
            internalType: "address[]",
            name: "collateralTokens",
            type: "address[]",
          },
          {
            internalType: "enum Status",
            name: "status",
            type: "uint8",
          },
        ],
        internalType: "struct Request[]",
        name: "_requests",
        type: "tuple[]",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_user",
        type: "address",
      },
    ],
    name: "getUserCollateralTokens",
    outputs: [
      {
        internalType: "address[]",
        name: "_collaterals",
        type: "address[]",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint96",
        name: "_listingId",
        type: "uint96",
      },
    ],
    name: "getUserLoanListing",
    outputs: [
      {
        components: [
          {
            internalType: "uint96",
            name: "listingId",
            type: "uint96",
          },
          {
            internalType: "address",
            name: "author",
            type: "address",
          },
          {
            internalType: "address",
            name: "tokenAddress",
            type: "address",
          },
          {
            internalType: "uint256",
            name: "amount",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "min_amount",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "max_amount",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "returnDate",
            type: "uint256",
          },
          {
            internalType: "uint16",
            name: "interest",
            type: "uint16",
          },
          {
            internalType: "enum ListingStatus",
            name: "listingStatus",
            type: "uint8",
          },
        ],
        internalType: "struct LoanListing",
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_user",
        type: "address",
      },
      {
        internalType: "uint96",
        name: "_requestId",
        type: "uint96",
      },
    ],
    name: "getUserRequest",
    outputs: [
      {
        components: [
          {
            internalType: "uint96",
            name: "listingId",
            type: "uint96",
          },
          {
            internalType: "uint96",
            name: "requestId",
            type: "uint96",
          },
          {
            internalType: "address",
            name: "author",
            type: "address",
          },
          {
            internalType: "uint256",
            name: "amount",
            type: "uint256",
          },
          {
            internalType: "uint16",
            name: "interest",
            type: "uint16",
          },
          {
            internalType: "uint256",
            name: "totalRepayment",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "returnDate",
            type: "uint256",
          },
          {
            internalType: "address",
            name: "lender",
            type: "address",
          },
          {
            internalType: "address",
            name: "loanRequestAddr",
            type: "address",
          },
          {
            internalType: "address[]",
            name: "collateralTokens",
            type: "address[]",
          },
          {
            internalType: "enum Status",
            name: "status",
            type: "uint8",
          },
        ],
        internalType: "struct Request",
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_user",
        type: "address",
      },
    ],
    name: "get_gitCoinPoint",
    outputs: [
      {
        internalType: "uint256",
        name: "_score",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_sender",
        type: "address",
      },
      {
        internalType: "address",
        name: "_tokenAddr",
        type: "address",
      },
    ],
    name: "gets_addressToAvailableBalance",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_sender",
        type: "address",
      },
      {
        internalType: "address",
        name: "_tokenAddr",
        type: "address",
      },
    ],
    name: "gets_addressToCollateralDeposited",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint96",
        name: "requestId",
        type: "uint96",
      },
    ],
    name: "liquidateUserRequest",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "pyth",
    outputs: [
      {
        internalType: "contract IPyth",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "pythPriceOracle",
    outputs: [
      {
        internalType: "contract IPythPriceOracle",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_upliner",
        type: "address",
      },
      {
        internalType: "address",
        name: "_downliner",
        type: "address",
      },
    ],
    name: "registerUpliner",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address[]",
        name: "_tokens",
        type: "address[]",
      },
    ],
    name: "removeCollateralTokens",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint96",
        name: "_requestId",
        type: "uint96",
      },
      {
        internalType: "uint256",
        name: "_amount",
        type: "uint256",
      },
    ],
    name: "repayLoan",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint96",
        name: "_listingId",
        type: "uint96",
      },
      {
        internalType: "uint256",
        name: "_amount",
        type: "uint256",
      },
    ],
    name: "requestLoanFromListing",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint96",
        name: "_requestId",
        type: "uint96",
      },
      {
        internalType: "address",
        name: "_tokenAddress",
        type: "address",
      },
    ],
    name: "serviceRequest",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "_bps",
        type: "uint256",
      },
    ],
    name: "setBPS",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_botAddress",
        type: "address",
      },
    ],
    name: "setBotAddress",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_feeVault",
        type: "address",
      },
    ],
    name: "setFeeVault",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "_bps",
        type: "uint256",
      },
    ],
    name: "setLiquidityBps",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_oracle",
        type: "address",
      },
    ],
    name: "setPythOracle",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_swapRouter",
        type: "address",
      },
    ],
    name: "setSwapRouter",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_user",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "_score",
        type: "uint256",
      },
    ],
    name: "updateGPScore",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_tokenCollateralAddress",
        type: "address",
      },
      {
        internalType: "uint128",
        name: "_amount",
        type: "uint128",
      },
    ],
    name: "withdrawCollateral",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
];
