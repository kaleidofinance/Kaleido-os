// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import {LibAppStorage} from "../libraries/LibAppStorage.sol";
import {LibAgentPermission} from "../libraries/LibAgentPermission.sol";
import "../model/Protocol.sol";
import "../utils/validators/Error.sol";

/**
 * @title AgentPermissionFacet
 * @notice Lets a user grant an agent bounded, revocable authority to act on
 *         their positions, and lets anyone read those bounds.
 *
 * @dev Grants are always scoped to msg.sender. There is no admin path to
 *      create or widen a grant on someone else's behalf, and an agent can
 *      never grant onward — delegation does not compose.
 */
contract AgentPermissionFacet {
    event AgentPermissionGranted(
        address indexed user,
        address indexed agent,
        uint256 maxNotionalPerAction,
        uint256 maxNotionalPerEpoch,
        uint64 epochDuration,
        uint64 expiry,
        uint32 allowedActions
    );

    event AgentPermissionRevoked(address indexed user, address indexed agent);

    event AgentTokenSet(
        address indexed user,
        address indexed agent,
        address indexed token,
        bool allowed
    );

    /**
     * @notice Grants (or replaces) an agent's authority over the caller's positions.
     * @dev Replacing resets the epoch budget. That is intentional: changing the
     *      terms starts a fresh window rather than inheriting prior spend.
     *
     * @param _agent Address permitted to act. Cannot be the caller.
     * @param _maxNotionalPerAction USD (1e18) ceiling per action.
     * @param _maxNotionalPerEpoch USD (1e18) ceiling per epoch.
     * @param _epochDuration Epoch length in seconds. Use a very long value for
     *        a lifetime budget.
     * @param _expiry Unix timestamp after which the grant is dead.
     * @param _maxInterestBps Worst rate the agent may accept; 0 disables the check.
     * @param _minHealthFactorBps Health floor in BPS (10000 = 1.0).
     * @param _allowedActions Bitmask of LibAgentPermission.ACTION_* flags.
     * @param _tokens Tokens the agent may touch. An empty list grants nothing usable.
     */
    function grantAgentPermission(
        address _agent,
        uint256 _maxNotionalPerAction,
        uint256 _maxNotionalPerEpoch,
        uint64 _epochDuration,
        uint64 _expiry,
        uint16 _maxInterestBps,
        uint16 _minHealthFactorBps,
        uint32 _allowedActions,
        address[] calldata _tokens
    ) external {
        if (_agent == address(0) || _agent == msg.sender) {
            revert Protocol__InvalidPermission();
        }
        if (_expiry <= block.timestamp) revert Protocol__InvalidPermission();
        if (_epochDuration == 0) revert Protocol__InvalidPermission();
        if (_allowedActions == 0) revert Protocol__InvalidPermission();
        if (_maxNotionalPerAction == 0 || _maxNotionalPerEpoch == 0) {
            revert Protocol__InvalidPermission();
        }
        // A per-action ceiling above the epoch ceiling is meaningless and
        // almost always a mistake in the caller's units.
        if (_maxNotionalPerAction > _maxNotionalPerEpoch) {
            revert Protocol__InvalidPermission();
        }
        // Below 1.0 the position is already liquidatable, so a floor under
        // 10000 BPS would authorise handing the user straight to the bot.
        if (_minHealthFactorBps < 10000) revert Protocol__InvalidPermission();

        LibAppStorage.Layout storage s = LibAppStorage.layout();

        s.agentPermissions[msg.sender][_agent] = AgentPermission({
            maxNotionalPerAction: _maxNotionalPerAction,
            maxNotionalPerEpoch: _maxNotionalPerEpoch,
            spentInEpoch: 0,
            epochStart: uint64(block.timestamp),
            epochDuration: _epochDuration,
            expiry: _expiry,
            maxInterestBps: _maxInterestBps,
            minHealthFactorBps: _minHealthFactorBps,
            allowedActions: _allowedActions,
            revoked: false
        });

        for (uint256 i = 0; i < _tokens.length; ++i) {
            s.agentTokens[msg.sender][_agent][_tokens[i]] = true;
            emit AgentTokenSet(msg.sender, _agent, _tokens[i], true);
        }

        emit AgentPermissionGranted(
            msg.sender,
            _agent,
            _maxNotionalPerAction,
            _maxNotionalPerEpoch,
            _epochDuration,
            _expiry,
            _allowedActions
        );
    }

    /**
     * @notice Immediately and unconditionally kills an agent's authority.
     * @dev Deliberately minimal — no timelock, no conditions, no owner
     *      override. This is the panic button and must never be able to fail.
     */
    function revokeAgentPermission(address _agent) external {
        LibAppStorage.layout().agentPermissions[msg.sender][_agent].revoked = true;
        emit AgentPermissionRevoked(msg.sender, _agent);
    }

    /// @notice Adds or removes a single token from an agent's allowlist.
    function setAgentToken(address _agent, address _token, bool _allowed) external {
        LibAppStorage.layout().agentTokens[msg.sender][_agent][_token] = _allowed;
        emit AgentTokenSet(msg.sender, _agent, _token, _allowed);
    }

    /// @notice Reads a grant. Also the source of truth for any UI showing limits.
    function getAgentPermission(
        address _user,
        address _agent
    ) external view returns (AgentPermission memory) {
        return LibAppStorage.layout().agentPermissions[_user][_agent];
    }

    /// @notice Whether an agent may touch a given token for a given user.
    function isAgentTokenAllowed(
        address _user,
        address _agent,
        address _token
    ) external view returns (bool) {
        return LibAppStorage.layout().agentTokens[_user][_agent][_token];
    }

    /**
     * @notice USD (1e18) an agent can still spend for a user this epoch.
     * @dev Accounts for epoch rollover, so a UI can show remaining headroom
     *      without replicating the rollover rule.
     */
    function agentRemainingBudget(
        address _user,
        address _agent
    ) external view returns (uint256) {
        AgentPermission storage p = LibAppStorage.layout().agentPermissions[_user][
            _agent
        ];

        if (p.expiry == 0 || p.revoked || block.timestamp > p.expiry) return 0;

        if (block.timestamp >= uint256(p.epochStart) + uint256(p.epochDuration)) {
            return p.maxNotionalPerEpoch;
        }
        if (p.spentInEpoch >= p.maxNotionalPerEpoch) return 0;
        return p.maxNotionalPerEpoch - p.spentInEpoch;
    }
}
