// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import {LibAppStorage} from "./LibAppStorage.sol";
import "../model/Protocol.sol";
import "../utils/validators/Error.sol";

/**
 * @title LibAgentPermission
 * @notice Enforcement half of agent delegation. Internal so facets call it
 *         without an external hop; grants and revocations live in
 *         AgentPermissionFacet.
 *
 * @dev The security model in one line: a user grants an agent a *ceiling*,
 *      and the diamond refuses anything above it no matter who is asking.
 *      Off-chain checks in an API route are UX; this is the boundary.
 */
library LibAgentPermission {
    /// @dev Action bitmask. Grants should be as narrow as the job allows —
    ///      an auto-repay agent needs REPAY and nothing else.
    uint32 internal constant ACTION_BORROW = 1;
    uint32 internal constant ACTION_LEND = 2;
    uint32 internal constant ACTION_REPAY = 4;
    uint32 internal constant ACTION_DEPOSIT_COLLATERAL = 8;
    uint32 internal constant ACTION_WITHDRAW_COLLATERAL = 16;
    uint32 internal constant ACTION_CLOSE = 32;

    /// @dev 10000 BPS = health factor 1.0, matching Constants.PRECISION (1e18).
    uint256 internal constant HF_BPS_SCALE = 1e14;

    event AgentActionConsumed(
        address indexed user,
        address indexed agent,
        uint32 action,
        address token,
        uint256 usdValue
    );

    /**
     * @notice Resolves who an action is for, enforcing the grant when an
     *         agent is acting on someone else's behalf.
     * @dev Consumes budget as a side effect, so callers must treat this as a
     *      state-changing call and follow checks-effects-interactions.
     *
     *      Health factor is deliberately NOT checked here: `_healthFactor`
     *      lives in ProtocolFacet and depends on post-action state. Callers
     *      must read `minHealthFactorBps` via {healthFloor} and assert it
     *      AFTER the action lands. Skipping that check leaves an agent able
     *      to respect every size cap while walking a user to liquidation.
     *
     * @param _onBehalfOf The user being acted for. Zero or self means the
     *        caller is acting for themselves and no grant is required.
     * @param _action One of the ACTION_* flags.
     * @param _token Token involved; must be on the grant's allowlist.
     * @param _usdValue Action size in USD (1e18).
     * @return user The address whose position is affected.
     */
    function resolveActor(
        address _onBehalfOf,
        uint32 _action,
        address _token,
        uint256 _usdValue
    ) internal returns (address user) {
        if (_onBehalfOf == address(0) || _onBehalfOf == msg.sender) {
            return msg.sender;
        }

        LibAppStorage.Layout storage s = LibAppStorage.layout();
        AgentPermission storage p = s.agentPermissions[_onBehalfOf][msg.sender];

        if (p.expiry == 0) revert Protocol__NoAgentPermission();
        if (p.revoked) revert Protocol__PermissionRevoked();
        if (block.timestamp > p.expiry) revert Protocol__PermissionExpired();
        if (p.allowedActions & _action == 0) revert Protocol__ActionNotPermitted();
        if (!s.agentTokens[_onBehalfOf][msg.sender][_token]) {
            revert Protocol__TokenNotPermitted();
        }
        if (_usdValue > p.maxNotionalPerAction) revert Protocol__ExceedsActionLimit();

        // Roll the epoch forward before spending against it.
        if (block.timestamp >= uint256(p.epochStart) + uint256(p.epochDuration)) {
            p.epochStart = uint64(block.timestamp);
            p.spentInEpoch = 0;
        }

        // Budget is monotonic within an epoch. Repaying does NOT refund it —
        // a compromised agent must not be able to cycle for a fresh allowance.
        uint256 spent = p.spentInEpoch + _usdValue;
        if (spent > p.maxNotionalPerEpoch) revert Protocol__ExceedsEpochLimit();
        p.spentInEpoch = spent;

        emit AgentActionConsumed(_onBehalfOf, msg.sender, _action, _token, _usdValue);
        return _onBehalfOf;
    }

    /**
     * @notice Reverts if an agent is accepting a worse rate than permitted.
     * @dev No-op when the user acts for themselves.
     */
    function enforceRate(address _user, uint16 _interestBps) internal view {
        if (_user == msg.sender) return;

        AgentPermission storage p = LibAppStorage.layout().agentPermissions[_user][
            msg.sender
        ];
        if (p.maxInterestBps != 0 && _interestBps > p.maxInterestBps) {
            revert Protocol__InterestWorseThanPermitted();
        }
    }

    /**
     * @notice Health factor floor (scaled to 1e18) the caller must respect for
     *         this user, or 0 when the user is acting for themselves.
     */
    function healthFloor(address _user) internal view returns (uint256) {
        if (_user == msg.sender) return 0;

        AgentPermission storage p = LibAppStorage.layout().agentPermissions[_user][
            msg.sender
        ];
        return uint256(p.minHealthFactorBps) * HF_BPS_SCALE;
    }
}
