// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IClaimFaucet {
    function claim(address token) external;

    function NATIVE_TOKEN() external view returns (address);
}

/**
 * Re-enters KaleidoTokenFaucet's native claim path from its receive hook.
 *
 * Used only by Faucet.test.js, and only with cooldown 0 — the one case where the
 * per-asset cooldown does NOT refuse a second claim in the same call (lastClaimed
 * is set before the payout, so at any positive cooldown CEI alone stops the
 * re-entry and the guard would look load-bearing when it was not). At cooldown 0
 * the nonReentrant guard is the only thing that can: a guardless faucet would pay
 * this contract twice, a guarded one pays it once and the single re-entry attempt
 * reverts.
 */
contract FaucetReentrant {
    IClaimFaucet public immutable faucet;

    /** Times receive() ran — 1 under a working guard, more if it can recurse. */
    uint256 public received;
    /** Whether the single re-entrant claim reverted (it should, on the guard). */
    bool public reentryReverted;

    bool private _armed;

    constructor(IClaimFaucet faucet_) {
        faucet = faucet_;
    }

    /** Claims native once; the re-entry is attempted inside receive() below. */
    function attack() external {
        _armed = true;
        faucet.claim(faucet.NATIVE_TOKEN());
        _armed = false;
    }

    receive() external payable {
        received += 1;
        if (!_armed) return;
        _armed = false; // one attempt only, so even a guardless faucet terminates
        try faucet.claim(faucet.NATIVE_TOKEN()) {
            reentryReverted = false;
        } catch {
            reentryReverted = true;
        }
    }
}
