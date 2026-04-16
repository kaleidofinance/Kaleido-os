// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.9;
import "./Error.sol";

library Validator {


    function _moreThanZero(uint256 _amount) internal pure {
        if (_amount <= 0) {
            revert Protocol__MustBeMoreThanZero();
        }
    }

    function _isTokenAllowed(address _token, mapping(address => address) storage s_priceFeeds) internal view {
        if (s_priceFeeds[_token] == address(0)) {
            revert Protocol__TokenNotAllowed();
        }
    }
}


