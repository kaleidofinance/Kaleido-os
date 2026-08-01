// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "forge-std/Test.sol";
import "../contracts/facets/AgentPermissionFacet.sol";
import {LibAgentPermission} from "../contracts/libraries/LibAgentPermission.sol";
import "../contracts/model/Protocol.sol";
import "../contracts/utils/validators/Error.sol";

/**
 * @dev Inherits the facet so the library and the grant surface share one
 *      storage layout. In production the diamond provides that via
 *      delegatecall; two standalone contracts would each get their own slot.
 */
contract Harness is AgentPermissionFacet {
    function resolve(
        address onBehalfOf,
        uint32 action,
        address token,
        uint256 usdValue
    ) external returns (address) {
        return LibAgentPermission.resolveActor(onBehalfOf, action, token, usdValue);
    }

    function rate(address user, uint16 interestBps) external view {
        LibAgentPermission.enforceRate(user, interestBps);
    }

    function floor(address user) external view returns (uint256) {
        return LibAgentPermission.healthFloor(user);
    }
}

contract AgentPermissionTest is Test {
    Harness internal h;

    address internal user = address(0xA11CE);
    address internal agent = address(0xB0B);
    address internal token = address(0xC0FFEE);
    address internal other = address(0xDEAD);

    uint256 internal constant PER_ACTION = 1_000e18;
    uint256 internal constant PER_EPOCH = 5_000e18;
    uint64 internal constant EPOCH = 1 days;

    uint32 internal constant BORROW = 1; // LibAgentPermission.ACTION_BORROW
    uint32 internal constant REPAY = 4; // LibAgentPermission.ACTION_REPAY

    function setUp() public {
        h = new Harness();
        _grant(BORROW | REPAY);
    }

    function _grant(uint32 actions) internal {
        address[] memory tokens = new address[](1);
        tokens[0] = token;

        vm.prank(user);
        h.grantAgentPermission(
            agent,
            PER_ACTION,
            PER_EPOCH,
            EPOCH,
            uint64(block.timestamp + 30 days),
            500, // maxInterestBps = 5%
            12000, // minHealthFactorBps = 1.2
            actions,
            tokens
        );
    }

    /* ------------------------------------------------ happy path -- */

    function test_grantStoresBounds() public view {
        AgentPermission memory p = h.getAgentPermission(user, agent);
        assertEq(p.maxNotionalPerAction, PER_ACTION);
        assertEq(p.maxNotionalPerEpoch, PER_EPOCH);
        assertEq(p.minHealthFactorBps, 12000);
        assertFalse(p.revoked);
        assertTrue(h.isAgentTokenAllowed(user, agent, token));
    }

    function test_agentActsWithinLimits() public {
        vm.prank(agent);
        assertEq(h.resolve(user, BORROW, token, 400e18), user);
        assertEq(h.agentRemainingBudget(user, agent), PER_EPOCH - 400e18);
    }

    function test_selfActionNeedsNoGrant() public {
        // `other` has no permission at all but is acting for itself.
        vm.prank(other);
        assertEq(h.resolve(other, BORROW, token, 1_000_000e18), other);
    }

    /* ------------------------------------------------- the bounds -- */

    function test_revertsAbovePerActionCeiling() public {
        vm.prank(agent);
        vm.expectRevert(Protocol__ExceedsActionLimit.selector);
        h.resolve(user, BORROW, token, PER_ACTION + 1);
    }

    function test_revertsOnUnpermittedAction() public {
        _grant(REPAY); // borrow no longer granted
        vm.prank(agent);
        vm.expectRevert(Protocol__ActionNotPermitted.selector);
        h.resolve(user, BORROW, token, 1e18);
    }

    function test_revertsOnUnlistedToken() public {
        vm.prank(agent);
        vm.expectRevert(Protocol__TokenNotPermitted.selector);
        h.resolve(user, BORROW, address(0xBADBAD), 1e18);
    }

    function test_revertsForStranger() public {
        vm.prank(other);
        vm.expectRevert(Protocol__NoAgentPermission.selector);
        h.resolve(user, BORROW, token, 1e18);
    }

    function test_revertsAfterExpiry() public {
        vm.warp(block.timestamp + 31 days);
        vm.prank(agent);
        vm.expectRevert(Protocol__PermissionExpired.selector);
        h.resolve(user, BORROW, token, 1e18);
    }

    /* ----------------------------------------------------- budget -- */

    function test_epochBudgetAccumulatesThenBlocks() public {
        for (uint256 i = 0; i < 5; ++i) {
            vm.prank(agent);
            h.resolve(user, BORROW, token, 1_000e18);
        }
        assertEq(h.agentRemainingBudget(user, agent), 0);

        vm.prank(agent);
        vm.expectRevert(Protocol__ExceedsEpochLimit.selector);
        h.resolve(user, BORROW, token, 1e18);
    }

    function test_budgetResetsNextEpoch() public {
        vm.prank(agent);
        h.resolve(user, BORROW, token, 1_000e18);

        vm.warp(block.timestamp + EPOCH + 1);
        assertEq(h.agentRemainingBudget(user, agent), PER_EPOCH);

        vm.prank(agent);
        h.resolve(user, BORROW, token, 1_000e18);
        assertEq(h.agentRemainingBudget(user, agent), PER_EPOCH - 1_000e18);
    }

    /// @dev Repaying must not refund budget, or a compromised agent could
    ///      cycle borrow/repay to mint itself an unlimited allowance.
    function test_repayDoesNotRefundBudget() public {
        vm.prank(agent);
        h.resolve(user, BORROW, token, 1_000e18);
        vm.prank(agent);
        h.resolve(user, REPAY, token, 1_000e18);

        assertEq(h.agentRemainingBudget(user, agent), PER_EPOCH - 2_000e18);
    }

    /* --------------------------------------------------- kill sw -- */

    function test_revokeIsImmediate() public {
        vm.prank(user);
        h.revokeAgentPermission(agent);

        vm.prank(agent);
        vm.expectRevert(Protocol__PermissionRevoked.selector);
        h.resolve(user, BORROW, token, 1e18);

        assertEq(h.agentRemainingBudget(user, agent), 0);
    }

    function test_agentCannotRevokeForUser() public {
        // An agent revoking only touches its own (empty) grant mapping.
        vm.prank(agent);
        h.revokeAgentPermission(agent);

        vm.prank(agent);
        assertEq(h.resolve(user, BORROW, token, 1e18), user);
    }

    /// @dev Delegation must not compose: an agent granting onward writes under
    ///      its own address, never the user's.
    function test_agentCannotDelegateOnward() public {
        address subAgent = address(0xBEEF);
        address[] memory tokens = new address[](1);
        tokens[0] = token;

        vm.prank(agent);
        h.grantAgentPermission(
            subAgent, PER_ACTION, PER_EPOCH, EPOCH,
            uint64(block.timestamp + 1 days), 500, 12000, BORROW, tokens
        );

        vm.prank(subAgent);
        vm.expectRevert(Protocol__NoAgentPermission.selector);
        h.resolve(user, BORROW, token, 1e18);
    }

    /* ------------------------------------------------ rate + floor -- */

    function test_rejectsWorseRateThanPermitted() public {
        vm.prank(agent);
        vm.expectRevert(Protocol__InterestWorseThanPermitted.selector);
        h.rate(user, 501);

        vm.prank(agent);
        h.rate(user, 500); // exactly at the ceiling is fine
    }

    function test_healthFloorScaling() public {
        vm.prank(agent);
        assertEq(h.floor(user), 1.2e18); // 12000 BPS -> 1.2

        vm.prank(user);
        assertEq(h.floor(user), 0); // self-action has no floor
    }

    /* -------------------------------------------------- bad grants -- */

    function test_rejectsSelfAsAgent() public {
        address[] memory tokens = new address[](0);
        vm.prank(user);
        vm.expectRevert(Protocol__InvalidPermission.selector);
        h.grantAgentPermission(
            user, PER_ACTION, PER_EPOCH, EPOCH,
            uint64(block.timestamp + 1 days), 500, 12000, BORROW, tokens
        );
    }

    function test_rejectsHealthFloorBelowOne() public {
        address[] memory tokens = new address[](0);
        vm.prank(user);
        vm.expectRevert(Protocol__InvalidPermission.selector);
        h.grantAgentPermission(
            agent, PER_ACTION, PER_EPOCH, EPOCH,
            uint64(block.timestamp + 1 days), 500, 9999, BORROW, tokens
        );
    }

    function test_rejectsActionCeilingAboveEpochCeiling() public {
        address[] memory tokens = new address[](0);
        vm.prank(user);
        vm.expectRevert(Protocol__InvalidPermission.selector);
        h.grantAgentPermission(
            agent, PER_EPOCH + 1, PER_EPOCH, EPOCH,
            uint64(block.timestamp + 1 days), 500, 12000, BORROW, tokens
        );
    }
}
