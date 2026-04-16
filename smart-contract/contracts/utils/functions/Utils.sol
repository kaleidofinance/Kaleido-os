// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

library Utils {
    /// @notice calculate percentage of a number
    /// @dev _percentage is in basis points (10000 = 100%, 100 = 1%, 1 = 0.01%)
    /// @param _number the number to calculate the percentage of
    /// @param _percentage the percentage in basis points
    /// @return the percentage of the number
    function calculatePercentage(
        uint256 _number,
        uint16 _percentage
    ) internal pure returns (uint256) {
        return (_number * _percentage) / 10000;
    }

    function calculateFeesPercentage (
        uint256 _amount,
        uint256 _percentage
    ) internal pure returns (uint256) {
        return (_amount * _percentage) / 10000;
    }


    /// @notice Calculates referral points as a percentage of individual points
    /// @param _individualPoint The base points earned by an individual
    /// @param _percentageBasisPoints The referral percentage in basis points (1% = 100 basis points)
    /// @return referralPoints The calculated referral points
    function calculateReferralPoints(uint256 _individualPoint, uint256 _percentageBasisPoints) internal pure returns (uint256 referralPoints) {
        // Use basis points for precision: percentage / 10,000
        referralPoints = (_individualPoint * _percentageBasisPoints) / 10000;
    }

}
