// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.9;

import "../lib/UnstructuredStorage.sol";


contract Pausable {
    using UnstructuredStorage for bytes32;

    event Stopped();
    event Resumed();

    // keccak256("kaleido.Pausable.activeFlag")
    bytes32 internal constant ACTIVE_FLAG_POSITION =
        0x1df5a87403d44e79bb5bae604cc35893f91579295110caa0a72ce3703878b001;

    function _whenNotStopped() internal view {
        require(ACTIVE_FLAG_POSITION.getStorageBool(), "CONTRACT_IS_STOPPED");
    }

    function _whenStopped() internal view {
        require(!ACTIVE_FLAG_POSITION.getStorageBool(), "CONTRACT_IS_ACTIVE");
    }

    function isStopped() public view returns (bool) {
        return !ACTIVE_FLAG_POSITION.getStorageBool();
    }

    function _stop() internal {
        _whenNotStopped();

        ACTIVE_FLAG_POSITION.setStorageBool(false);
        emit Stopped();
    }

    function _resume() internal {
        _whenStopped();

        ACTIVE_FLAG_POSITION.setStorageBool(true);
        emit Resumed();
    }
}