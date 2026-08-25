// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @dev Holds all the constant for our protocol
library Constants {
    uint256 constant NEW_PRECISION = 1e10;
    uint256 constant PRECISION = 1e18;
    uint256 constant LIQUIDATION_THRESHOLD = 80;
    /// @dev The health factor is a ratio scaled by PRECISION, so "1.0" is 1e18 —
    ///      see ProtocolFacet._healthFactor, whose ratio branch multiplies by
    ///      PRECISION. This was `1`, which made the only comparison against it
    ///      (`_revertIfHealthFactorIsBroken`) true solely for a health factor of
    ///      exactly zero, i.e. no collateral at all. That function is now called
    ///      from withdrawCollateral, so the constant is both correct and live.
    uint256 constant MIN_HEALTH_FACTOR = PRECISION;
    /// @dev Maximum loan-to-value at origination, as a percentage. Deliberately
    ///      BELOW LIQUIDATION_THRESHOLD (80): that gap is the borrower's safety
    ///      band, and without it a position is liquidatable the instant it opens.
    ///
    ///      This was also 80. With both at 80 a borrower taking their maximum
    ///      loan opened at a health factor of exactly 1e18 — and the two
    ///      comparisons are not symmetric. Origination requires
    ///      `_healthFactor(...) >= PRECISION` and liquidation requires
    ///      `< PRECISION`, so the position sat on the exact boundary between
    ///      "allowed to open" and "allowed to seize". The first tick of interest
    ///      accrual pushed totalRepayment up and the health factor below 1e18,
    ///      making a brand-new, fully-collateralised loan liquidatable with no
    ///      price movement at all. Combined with the settlement bug that used to
    ///      pay liquidation proceeds out of other users' deposits, that was a
    ///      repeatable, price-risk-free drain rather than a rounding annoyance.
    ///
    ///      At 75 against a threshold of 80, a maxed-out borrower opens at a
    ///      health factor of 0.80/0.75 = 1.0667, so collateral has to lose about
    ///      6.25% of its value before liquidation becomes possible. Aave v3 uses
    ///      exactly this shape (an LTV strictly below the liquidation threshold
    ///      per asset). Morpho Blue deliberately does NOT — it has one LLTV and
    ///      documents that holding a buffer under it is the borrower's job — which
    ///      is a coherent choice, but it relies on borrowers who monitor their
    ///      own positions, and it is not what this protocol's UI implies.
    ///
    ///      Cost of the change: maximum leverage drops from 1/0.80 = 1.25x to
    ///      1/0.75 = 1.333x of collateral locked per unit borrowed. Used by both
    ///      borrow-limit checks (ProtocolFacet lines ~173 and ~811); it is not a
    ///      health-factor input, so raising it back would widen the borrow limit
    ///      without moving the liquidation point.
    uint256 constant COLLATERALIZATION_RATIO = 75;
    uint256 constant BASIS_POINTS = 10000;
    /// @dev Currently unreferenced. It was the depositCollateral award, removed
    ///      because withdrawCollateral reverses a deposit without deducting the
    ///      points, making deposit/withdraw a points farm. Kept as the recorded
    ///      figure in case collateral supply is rewarded again — but that reward
    ///      belongs on a time-weighted balance snapshot, not on a per-deposit
    ///      hook, so re-adding it here is very unlikely to be what you want.
    uint256 constant GITPOINT = 100 * SCALING_FACTOR;
    /// @dev Awarded on settlement only: serviceRequest, requestLoanFromListing
    ///      and repayLoan. Deliberately not on createLendingRequest or
    ///      createLoanListing, which are free to reverse.
    uint256 constant SPECIAL_GITPOINT = 600 * SCALING_FACTOR;
    uint256 constant EXTRA_POINT = 500 * SCALING_FACTOR;
    uint256 constant REFERRAL_PERCENTAGE = 1000; 
    /// @dev Sentinel for native value, not a real address. Chain-agnostic by
    ///      construction, so it stays a compile-time constant. The frontend
    ///      mirrors it as NATIVE_SENTINEL.lending; the DEX uses the separate
    ///      0xEeee… convention, and the two must not be interchanged.
    address constant NATIVE_TOKEN = address(1);
    uint256 constant SCALING_FACTOR = 1e18;

    /*
     * REMOVED: WETH, USDC, and the ETH_USD / WETH_USD / USDC_USD price feed
     * ids.
     *
     * The two addresses were Abstract-testnet values written as Solidity
     * `constant`s, which bakes them into the bytecode of every chain this is
     * deployed to. Kaleido now targets eleven networks, so a literal that is
     * only correct on one of them is a deployment hazard rather than a
     * convenience.
     *
     * All five were dead: nothing outside this file referenced
     * Constants.WETH, Constants.USDC, or any of the feed ids. ProtocolFacet is
     * the sole importer of this library and uses only NATIVE_TOKEN and the
     * numeric constants.
     *
     * Where the live equivalents come from instead:
     *   - wrapped native  -> constructor argument (KaleidoSwapRouter.WETH is
     *                        already `immutable`, set at deploy)
     *   - collateral/loan tokens and their price feed ids -> registered at
     *     runtime via addCollateralToken(token, priceFeed) and
     *     addLoanableToken(token, priceFeed), which is already how the
     *     protocol learns about assets
     *
     * Pyth feed ids are global rather than per-chain, so they belong with the
     * per-chain token registration that supplies them, not in a shared
     * compile-time constant that implies one fixed asset set.
     */


    /// @dev Floor on the USD value of a loan, at PRECISION (18 decimals) — the
    ///      scale ProtocolFacet.getUsdValue documents and, since the Pyth exponent
    ///      normalisation was fixed, actually returns.
    ///
    ///      This was `10 * 1e16`, still labelled "10 USD". It was not a different
    ///      convention, it was calibration against a bug: getUsdValue multiplied
    ///      by 10**(-expo) where it should have divided, so its output carried
    ///      10**(-2*expo) — 1e16 for the usual -8 feed, and something else for any
    ///      other exponent. The floor tracked the accident rather than the unit, so
    ///      a feed with a different exponent would have moved the minimum loan by
    ///      orders of magnitude while this line still read "10 USD".
    uint256 constant MIN_LOAN_AMOUNT = 10 * PRECISION; // 10 USD

    /// @dev Interest is quoted as an APR, so rates are comparable across terms.
    uint256 constant SECONDS_PER_YEAR = 365 days;
    /// @dev Floor on loan duration. Without one, APR pricing makes near-instant
    ///      loans round down to zero interest.
    uint256 constant MIN_LOAN_DURATION = 1 days;

    /// @dev Ceiling on the protocol's cut of loan interest (ONE_PERCENT_BPS).
    ///      25%, matching Morpho Blue's MAX_FEE of 0.25e18 — the closest
    ///      comparable, since it is likewise a share of interest rather than a
    ///      toll on principal. Aave's reserve factors sit at 10-20% of borrower
    ///      interest and Lido takes 10% of staking rewards, so the intended
    ///      operating point is well inside this; the cap exists so a compromised
    ///      or fat-fingered owner cannot set the fee to 100% and expropriate the
    ///      lender's entire return in one transaction. `setBPS` had no bound at
    ///      all, and the fee is deducted before the lender is credited, so an
    ///      unbounded value was a live path to taking the whole repayment.
    uint256 constant MAX_PROTOCOL_FEE_BPS = 2500;

    /// @dev Ceiling on the liquidation penalty (LIQUIDITY_BPS). 15%, the upper
    ///      end of Aave v3's liquidation bonus range for volatile collateral.
    ///      The penalty is what makes liquidating worth someone's gas, so it
    ///      cannot be tiny; it is also taken out of a position that is already
    ///      underwater, so it cannot be large without turning insolvency into
    ///      confiscation.
    uint256 constant MAX_LIQUIDATION_PENALTY_BPS = 1500;

    /// @dev Ceiling on priceMaxAge — the oldest Pyth publishTime the protocol
    ///      may be configured to accept. One hour.
    ///
    ///      This is a bound on how wrong the configuration may be, not a target.
    ///      Pyth publishes sub-second on its own network; what sets the real
    ///      cadence here is who relays those updates on-chain via
    ///      `PythPriceOracle.updatePrice`, which is permissionless — so the
    ///      cadence is whatever the cheapest interested party is willing to pay
    ///      for, and on a quiet testnet feed that can be nobody for hours.
    ///      Configure the interval actually observed plus room for one missed
    ///      round, and measure it rather than assuming: scripts/probe-pyth.js
    ///      exists for that. An hour is chosen as the ceiling because a
    ///      price that old can still be defensible on a quiet stablecoin pair
    ///      and is indefensible on anything volatile — beyond it there is no
    ///      asset for which the value is arguable, so it is the point where a
    ///      misconfiguration stops being a policy choice.
    uint256 constant MAX_PRICE_AGE = 3600;

    /// @dev Ceiling on a per-feed `s_feedMaxAge` override. 25 hours.
    ///
    ///      Deliberately far above MAX_PRICE_AGE, and deliberately a separate
    ///      constant rather than a raised value of it. The reasoning above — that
    ///      past an hour no asset's price is arguable — holds for the global
    ///      bound, which applies to every feed at once including volatile
    ///      collateral. It does not hold for a feed the operator has singled
    ///      out, and refusing to admit that has a cost: the providers available
    ///      on three of the five wave chains do not publish inside an hour.
    ///      Chainlink's Sepolia USDC/USD answer measured 13,438 seconds old, and
    ///      API3 offers a 24-hour heartbeat as its ONLY option (its update
    ///      trigger is a deviation threshold — 5 / 2.5 / 1 / 0.5 / 0.25 % — with
    ///      the heartbeat as the floor). Capping the override at an hour would
    ///      leave the override unable to do the one job it exists for.
    ///
    ///      25 hours is API3's heartbeat plus an hour of slack, so a feed that
    ///      publishes only on its heartbeat still clears the bound rather than
    ///      failing at the boundary every day.
    ///
    ///      A value this large is defensible ONLY for a pegged asset, and it is
    ///      not defensible at all as a way to make a volatile feed stop
    ///      reverting. Setting it there converts "the protocol refused to price
    ///      a stale asset" into "the protocol liquidated against a price from
    ///      yesterday". The override is per feed and emits an event precisely so
    ///      that choice is visible in the logs instead of buried in a global.
    uint256 constant MAX_FEED_PRICE_AGE = 90000;

    /// @dev Ceiling on priceMaxConfBps — the widest Pyth confidence interval the
    ///      protocol may be configured to accept, as basis points of the price.
    ///      500 = 5%.
    ///
    ///      Pyth's `conf` is roughly a standard error, so a 5% interval is most
    ///      of a 640 bps liquidation penalty — which is why this is a ceiling on
    ///      how wrong the configuration may be and not a recommended value; the
    ///      shipped default is 100 (1%). Past this point the penalty stops being
    ///      a penalty and starts being noise: whether a liquidation was
    ///      profitable would depend on which side of the interval the true price
    ///      sat, which is not a risk a borrower's collateral should be settling.
    uint256 constant MAX_PRICE_CONF_BPS = 500;
}
