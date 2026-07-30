// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "forge-std/Test.sol";
import {ProtocolFacet} from "../contracts/facets/ProtocolFacet.sol";

/**
 * @dev Exercises the APR pricing via getQuote, which is external and reads no
 *      storage, so the facet can be deployed standalone. getQuote and
 *      _calculateLoanInterest share the same formula; the origination guards
 *      (duration floor, zero-interest revert) are deliberately not in getQuote
 *      and are covered separately once a full diamond fixture exists.
 */
contract LoanInterestTest is Test {
    ProtocolFacet internal p;

    uint256 internal constant AMOUNT = 1_000e18;
    uint16 internal constant APR_10PCT = 1000; // basis points

    function setUp() public {
        p = new ProtocolFacet();
        // Move off timestamp 0 so `returnDate` arithmetic is realistic.
        vm.warp(1_700_000_000);
    }

    /// @dev A full year at 10% APR must cost exactly 10%.
    function test_fullYearEqualsTheHeadlineRate() public view {
        (uint256 total, uint256 interest, uint256 duration) = p.getQuote(
            AMOUNT,
            APR_10PCT,
            block.timestamp + 365 days
        );

        assertEq(interest, 100e18);
        assertEq(total, 1_100e18);
        assertEq(duration, 365 days);
    }

    /// @dev The bug this change fixes: a short loan must cost proportionally
    ///      less than a long one at the same quoted rate.
    function test_shortTermCostsLessThanLongTerm() public view {
        (, uint256 thirtyDay, ) = p.getQuote(
            AMOUNT,
            APR_10PCT,
            block.timestamp + 30 days
        );
        (, uint256 yearLong, ) = p.getQuote(
            AMOUNT,
            APR_10PCT,
            block.timestamp + 365 days
        );

        assertLt(thirtyDay, yearLong);
        // 1000 * 10% * (30/365) = 8.2191...
        assertApproxEqAbs(thirtyDay, 8.219178e18, 1e13);
    }

    /// @dev Interest scales linearly in duration.
    function test_doublingTermDoublesInterest() public view {
        (, uint256 oneMonth, ) = p.getQuote(
            AMOUNT,
            APR_10PCT,
            block.timestamp + 30 days
        );
        (, uint256 twoMonths, ) = p.getQuote(
            AMOUNT,
            APR_10PCT,
            block.timestamp + 60 days
        );

        assertApproxEqAbs(twoMonths, oneMonth * 2, 2);
    }

    /// @dev Interest scales linearly in rate, so the book is rankable by APR.
    function test_doublingRateDoublesInterest() public view {
        (, uint256 at10, ) = p.getQuote(
            AMOUNT,
            APR_10PCT,
            block.timestamp + 90 days
        );
        (, uint256 at20, ) = p.getQuote(
            AMOUNT,
            2000,
            block.timestamp + 90 days
        );

        assertApproxEqAbs(at20, at10 * 2, 2);
    }

    /// @dev Two offers at the same APR but different terms must be orderable —
    ///      this is precisely what flat interest made impossible.
    function test_sameAprDifferentTermsAreDistinguishable() public view {
        (uint256 shortTotal, , ) = p.getQuote(
            AMOUNT,
            APR_10PCT,
            block.timestamp + 7 days
        );
        (uint256 longTotal, , ) = p.getQuote(
            AMOUNT,
            APR_10PCT,
            block.timestamp + 730 days
        );

        assertTrue(shortTotal != longTotal);
    }

    function test_zeroRateCostsNothing() public view {
        (uint256 total, uint256 interest, ) = p.getQuote(
            AMOUNT,
            0,
            block.timestamp + 30 days
        );
        assertEq(interest, 0);
        assertEq(total, AMOUNT);
    }

    function test_pastDateQuotesPrincipalOnly() public view {
        (uint256 total, uint256 interest, uint256 duration) = p.getQuote(
            AMOUNT,
            APR_10PCT,
            block.timestamp - 1
        );
        assertEq(total, AMOUNT);
        assertEq(interest, 0);
        assertEq(duration, 0);
    }

    /// @dev Large principal over a long term must not overflow.
    function test_noOverflowAtScale() public view {
        (uint256 total, uint256 interest, ) = p.getQuote(
            1_000_000_000e18,
            5000, // 50% APR
            block.timestamp + 3650 days
        );
        assertGt(interest, 0);
        assertGt(total, 1_000_000_000e18);
    }
}
