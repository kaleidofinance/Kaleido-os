// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/******************************************************************************\
* Author: Nick Mudge <nick@perfectabstractions.com> (https://twitter.com/mudgen)
* EIP-2535 Diamonds: https://eips.ethereum.org/EIPS/eip-2535
*
* Implementation of a diamond.
/******************************************************************************/

import {LibDiamond} from "./libraries/LibDiamond.sol";
import {IDiamondCut} from "./interfaces/IDiamondCut.sol";
import {LibAppStorage} from "./libraries/LibAppStorage.sol";
import "../contracts/utils/validators/Error.sol";

contract Diamond {
    LibAppStorage.Layout internal _appStorage;

    constructor(address _contractOwner, address _diamondCutFacet) payable {
        LibDiamond.setContractOwner(_contractOwner);

        // Add the diamondCut external function from the diamondCutFacet
        IDiamondCut.FacetCut[] memory cut = new IDiamondCut.FacetCut[](1);
        bytes4[] memory functionSelectors = new bytes4[](1);
        functionSelectors[0] = IDiamondCut.diamondCut.selector;
        cut[0] = IDiamondCut.FacetCut({
            facetAddress: _diamondCutFacet,
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: functionSelectors
        });
        LibDiamond.diamondCut(cut, address(0), "");
    }

    /// @dev Acts as our contructor
    ///
    /// NOT ON THE DEPLOY PATH. deploy.js initializes through
    /// `DiamondInit.init()` delivered as the `_init` argument of `diamondCut`,
    /// and never calls this — so nothing in a normal deploy runs it. It stays
    /// because it is owner-callable on the diamond directly and is the only
    /// bulk-registration entry point; the five deployed chains got their assets
    /// from register-tokens.js instead, which is why native is collateral on all
    /// five and loanable on none.
    ///
    /// Registers each token on BOTH sides at once: `s_isLoanable` and a price
    /// feed, which `_isTokenAllowed` reads, so an initialize token is borrowable
    /// and depositable. That is a blunter instrument than the two per-side owner
    /// calls in ProtocolFacet, and worth knowing before using it.
    ///
    /// This used to end by writing `_appStorage.swapRouter =
    /// 0x96ff7D9dbf52FdcAe79157d3b249282c7FABd409`, a pre-rebuild Abstract
    /// testnet router. It was removed rather than parameterised. Nothing in
    /// contracts/ reads `AppStorage.swapRouter` and it has no getter, so the
    /// write configured no behaviour; the literal is codeless on all five chains
    /// we deploy to, so the one thing it accomplished was to guarantee that the
    /// first reader anyone added would resolve to a dead address. Because this
    /// function is off the deploy path, no deployed diamond ever received it.
    /// An operator who wants the slot set has `setSwapRouter`, which deploy.js
    /// calls when SWAP_ROUTER is configured. Removing a write does not affect
    /// storage layout.
    ///
    /// @param _tokens address of all the tokens
    /// @param _priceFeeds address of all the pricefeed tokens
    function initialize(
        address[] memory _tokens,
        bytes32[] memory _priceFeeds
    ) public {
        LibDiamond.enforceIsContractOwner();
        if (_tokens.length != _priceFeeds.length) {
            revert Protocol__tokensAndPriceFeedsArrayMustBeSameLength();
        }
        for (uint8 i = 0; i < _tokens.length; i++) {
            _appStorage.s_isLoanable[_tokens[i]] = true;
            _appStorage.s_priceFeeds[_tokens[i]] = _priceFeeds[i];
            _appStorage.s_collateralToken.push(_tokens[i]);
        }
    }

    // Find facet for function that is called and execute the
    // function if a facet is found and return any value.
    fallback() external payable {
        LibDiamond.DiamondStorage storage ds;
        bytes32 position = LibDiamond.DIAMOND_STORAGE_POSITION;
        // get diamond storage
        assembly {
            ds.slot := position
        }
        // get facet from function selector
        address facet = ds.selectorToFacetAndPosition[msg.sig].facetAddress;
        require(facet != address(0), "Diamond: Function does not exist");
        // Execute external function from facet using delegatecall and return any value.
        assembly {
            // copy function selector and any arguments
            calldatacopy(0, 0, calldatasize())
            // execute function call using the facet
            let result := delegatecall(gas(), facet, 0, calldatasize(), 0, 0)
            // get any return value
            returndatacopy(0, 0, returndatasize())
            // return any return value or error back to the caller
            switch result
            case 0 {
                revert(0, returndatasize())
            }
            default {
                return(0, returndatasize())
            }
        }
    }

    //immutable function example
    function example() public pure returns (string memory) {
        return "THIS IS AN EXAMPLE OF AN IMMUTABLE FUNCTION";
    }

    receive() external payable {}
}
