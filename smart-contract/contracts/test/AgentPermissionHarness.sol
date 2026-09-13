// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import {AgentPermissionFacet} from "../facets/AgentPermissionFacet.sol";
import {LibAgentPermission} from "../libraries/LibAgentPermission.sol";

/**
 * @title AgentPermissionHarness
 * @notice Test-only harness exposing the internal enforcement half of agent
 *         delegation (`LibAgentPermission`) so a unit test can call it directly.
 *
 * @dev Inherits {AgentPermissionFacet} so the grant surface and the library
 *      share ONE storage layout — in the diamond that sharing comes from
 *      delegatecall into a single `LibAppStorage` slot; two unrelated contracts
 *      would each get their own slot and the grant a test wrote would be
 *      invisible to the resolver it is testing. Standalone here, the harness IS
 *      that one slot.
 *
 *      Never deployed anywhere real. It lives under contracts/test/ next to the
 *      other mocks and exists only to give Hardhat a callable surface over
 *      library functions that are `internal` by design (a facet reaches them
 *      without an external hop; a test cannot).
 */
contract AgentPermissionHarness is AgentPermissionFacet {
    /// @notice Runs the actor resolution + budget consumption for `msg.sender`.
    function resolve(
        address onBehalfOf,
        uint32 action,
        address token,
        uint256 usdValue
    ) external returns (address) {
        return
            LibAgentPermission.resolveActor(onBehalfOf, action, token, usdValue);
    }

    /// @notice Reverts if `msg.sender` (as agent) accepts a worse rate than granted.
    function rate(address user, uint16 interestBps) external view {
        LibAgentPermission.enforceRate(user, interestBps);
    }

    /// @notice The health-factor floor (scaled 1e18) the agent must leave `user` above.
    function floor(address user) external view returns (uint256) {
        return LibAgentPermission.healthFloor(user);
    }
}
