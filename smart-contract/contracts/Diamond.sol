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

contract Diamond {
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

    /* There used to be an `initialize(address[], bytes32[])` here, and a
     * `LibAppStorage.Layout internal _appStorage` declared above it for it to
     * write into. Both are gone, and they had to go BEFORE a mainnet deploy
     * because a function compiled into the Diamond itself can never be removed
     * afterwards (LibDiamond.removeFunction refuses immutable functions).
     *
     * It was a live corruption path, not dead code. The Diamond put its layout at
     * slot 0; ProtocolFacet inherits ReentrancyGuard first, so `_status` takes
     * slot 0 there and the facet's copy of the same layout starts at slot 1.
     * Every write `initialize` made therefore landed one slot away from where the
     * facet reads it — `s_isLoanable = true` would have become a feed id of
     * 0x…01 on the token. It was owner-only and off the deploy path (deploy.js
     * initializes through DiamondInit via diamondCut, and assets are registered
     * by register-tokens.js through the facet's own setters), so no deployed
     * diamond was ever hurt by it; the risk was one mistaken owner call.
     *
     * The Diamond now declares no storage of its own. All of its state lives at
     * the EIP-2535 position in LibDiamond, which is what the fallback reads. */

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

    /* No `receive()` and no `example()`, removed before the Arc mainnet deploy for
     * the same reason `initialize` was: anything compiled into the Diamond can
     * never be removed.
     *
     * `receive()` accepted a plain native transfer and credited it to nobody. On
     * Arc the native currency is USDC, so a mistaken send was a real dollar stuck
     * in the diamond — with no liability total to tell it apart from user
     * collateral, no sweep could ever safely return it. Nothing legitimately
     * sends value here with empty calldata (no facet unwraps a wrapped-native
     * token; every payable facet call carries a selector and reaches the
     * fallback). Now a plain transfer hits the fallback's "Function does not
     * exist" and reverts, which returns the money to the sender. If a receive
     * path is ever needed, a facet can route the empty-calldata case later.
     *
     * `example()` was the EIP-2535 reference template's demo of an immutable
     * function: a permanent, useless selector. */
}
