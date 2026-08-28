// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * KLD vesting — the token generation event's allocation table, on chain.
 *
 * Every one of the eight KLD buckets is expressed here as one `Schedule`, so the
 * distribution is a thing anyone can read off the contract rather than a
 * spreadsheet the protocol asks to be trusted on.
 *
 * ── One shape, not eight ────────────────────────────────────────────────────
 *
 * The eight schedules look different in prose and are the same arithmetic:
 *
 *   released(t) = tgeAmount
 *               + (t >= cliffAt ? cliffAmount : 0)
 *               + linearAmount * clamp(t - linearStart, 0, linearDuration)
 *                                                       / linearDuration
 *
 * That covers all of them, including the two that a plain cliff-plus-linear
 * vesting wallet cannot express:
 *
 *   Public Sale     100% at TGE                  tge = all, no cliff, no tail
 *   Seed Round      20% TGE, 20% at month 3,     tge, cliffAmount at 3mo, and a
 *                   60% linear over 10 months    tail starting at month 3
 *   Community       25% TGE, 6 months linear     tge + tail from month 0
 *   Liquidity       50% TGE, 50% over 24 months  tge + tail from month 0
 *   Team            12mo cliff, 36mo linear      tail from month 12
 *   Grants          3mo cliff, 12mo linear       tail from month 3
 *   Treasury        12mo cliff, 36mo linear      tail from month 12
 *   Advisors        6mo cliff, 24mo linear       tail from month 6
 *
 * The Seed Round is the reason `cliffAmount` exists as a distinct field. Its
 * "20% unlock at Month 3" is a step, not the start of a ramp, and folding it into
 * the linear tail would pay it out gradually over the following ten months —
 * a different schedule that happens to end at the same place.
 *
 * OpenZeppelin's `VestingWallet` was the alternative. It is one beneficiary per
 * deployment and its `_vestingSchedule` hook expresses a cliff but not a step, so
 * matching this table meant eight deployments and a subclass. One contract with
 * eight rows is less to deploy, and it makes the whole allocation legible in one
 * place, which is the property that matters for a token distribution.
 *
 * ── A month is 30 days ──────────────────────────────────────────────────────
 *
 * The schedules are quoted in months, which is not a unit a chain has. `MONTH`
 * below is 30 days. So "36-month linear" is 1,080 days, and the schedules drift
 * from calendar months by about five days a year. The alternative conventions
 * (30.4375 days, or real calendar arithmetic) buy accuracy nobody reads a vesting
 * curve to that precision for, and 30 days is what the surrounding industry
 * means by a vesting month. Stated here because it is a convention, not a fact.
 *
 * ── Over-allocation is impossible, by construction ──────────────────────────
 *
 * The failure mode for a contract like this is registering schedules that sum to
 * more than it holds: everything looks correct for months, and then the last
 * beneficiaries find an empty contract. `addSchedule` therefore refuses unless
 * the contract already holds enough unallocated KLD to cover the new row in
 * full — so it must be funded before it is allocated, and the sum of all
 * schedules can never exceed the tokens present. `unallocated()` is that
 * headroom, and it is a view anyone can check.
 *
 * The inverse invariant is worth naming too, because it makes circulating supply
 * computable without an indexer: every KLD this contract holds is unreleased, so
 *
 *   circulating = kld.totalSupply() - kld.balanceOf(vesting)
 *
 * ── Claiming is permissionless, payment is not ──────────────────────────────
 *
 * Anyone may call `claim` for any schedule; the tokens always move to that
 * schedule's `beneficiary`, which is fixed when the row is added and cannot be
 * changed afterwards. So a third party can pay the gas to push a vested tranche
 * out, and cannot redirect it. There is no admin path to move a beneficiary's
 * tokens, and no pause: a vesting contract that can be frozen by its owner has
 * not made the commitment it appears to make.
 */
contract KLDVesting is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /** The vesting month. See the header — this is a convention, not a fact. */
    uint64 public constant MONTH = 30 days;

    struct Schedule {
        /** Who receives it. Fixed at creation; there is no setter. */
        address beneficiary;
        /** Human label for the bucket, e.g. "Seed Round". Emitted and readable. */
        string label;
        /** tgeAmount + cliffAmount + linearAmount. Checked on creation. */
        uint256 total;
        /** Released the moment `start` passes. */
        uint256 tgeAmount;
        /** A step, released in full at `cliffAt`. Zero for most buckets. */
        uint256 cliffAmount;
        /** Seconds after `start` at which `cliffAmount` unlocks. */
        uint64 cliffAt;
        /** The linear tail. */
        uint256 linearAmount;
        /** Seconds after `start` at which the tail begins to accrue. */
        uint64 linearStart;
        /** Seconds the tail takes to accrue in full. Zero iff linearAmount is 0. */
        uint64 linearDuration;
        /** Cumulative amount already transferred out for this row. */
        uint256 claimed;
    }

    /** The token being vested. */
    IERC20 public immutable kld;

    /**
     * TGE. Every schedule is measured from this one timestamp, so the buckets
     * cannot drift apart by being registered in different blocks.
     */
    uint64 public immutable start;

    Schedule[] private _schedules;

    /** Sum of every row's `total`. Never exceeds the tokens held plus claimed. */
    uint256 public totalAllocated;
    /** Sum of every row's `claimed`. */
    uint256 public totalClaimed;

    error ZeroAddress();
    error ZeroAmount();
    error ComponentsDoNotSumToTotal(uint256 sum, uint256 total);
    error LinearDurationMismatch(uint256 linearAmount, uint64 linearDuration);
    error CliffBeforeNothing();
    error InsufficientUnallocatedBalance(uint256 needed, uint256 available);
    error NoSuchSchedule(uint256 id);
    error NothingToClaim(uint256 id);

    event ScheduleAdded(
        uint256 indexed id,
        address indexed beneficiary,
        string label,
        uint256 total
    );
    event Claimed(uint256 indexed id, address indexed beneficiary, uint256 amount);

    /**
     * @param _kld   The KLD token.
     * @param _start TGE timestamp. Past values are permitted deliberately: it is
     *        how a testnet deployment exercises a mid-schedule state instead of
     *        waiting a year for a team cliff to pass.
     */
    constructor(address _kld, uint64 _start, address _owner) Ownable(_owner) {
        if (_kld == address(0) || _owner == address(0)) revert ZeroAddress();
        if (_start == 0) revert ZeroAmount();
        kld = IERC20(_kld);
        start = _start;
    }

    /* ── Views ──────────────────────────────────────────────────────────────*/

    function scheduleCount() external view returns (uint256) {
        return _schedules.length;
    }

    function schedules(uint256 id) external view returns (Schedule memory) {
        if (id >= _schedules.length) revert NoSuchSchedule(id);
        return _schedules[id];
    }

    /**
     * KLD held here that no schedule has a claim on. This is the amount
     * `addSchedule` can still allocate.
     *
     * Held balance covers the unclaimed part of every existing row
     * (`totalAllocated - totalClaimed`); anything above that is free. Written as
     * a guarded subtraction because a stray transfer out — there is no path for
     * one in this contract, but the token is not ours to constrain — should read
     * as zero headroom rather than revert every view that touches it.
     */
    function unallocated() public view returns (uint256) {
        uint256 held = kld.balanceOf(address(this));
        uint256 committed = totalAllocated - totalClaimed;
        return held > committed ? held - committed : 0;
    }

    /** Total released for a schedule by `timestamp`, claimed or not. */
    function vestedAt(uint256 id, uint64 timestamp) public view returns (uint256) {
        if (id >= _schedules.length) revert NoSuchSchedule(id);
        Schedule storage s = _schedules[id];

        if (timestamp < start) return 0;
        uint64 elapsed = timestamp - start;

        uint256 released = s.tgeAmount;
        if (elapsed >= s.cliffAt) released += s.cliffAmount;

        if (s.linearAmount > 0 && elapsed > s.linearStart) {
            uint64 into = elapsed - s.linearStart;
            if (into >= s.linearDuration) {
                released += s.linearAmount;
            } else {
                released += (s.linearAmount * into) / s.linearDuration;
            }
        }
        return released;
    }

    /** Total released for a schedule as of now. */
    function vested(uint256 id) public view returns (uint256) {
        return vestedAt(id, uint64(block.timestamp));
    }

    /** Released and not yet transferred out. What `claim` would move. */
    function claimable(uint256 id) public view returns (uint256) {
        return vested(id) - _schedules[id].claimed;
    }

    /** Still locked for a schedule: its total less what has vested. */
    function locked(uint256 id) external view returns (uint256) {
        return _schedules[id].total - vested(id);
    }

    /* ── Allocation ─────────────────────────────────────────────────────────*/

    /**
     * Register one bucket. Requires the contract to already hold enough
     * unallocated KLD to cover it — fund first, then allocate.
     *
     * The three component amounts must sum to `total`. That is the check that
     * makes a typo in the allocation table fail at deploy rather than surface as
     * a bucket that pays out 90% of itself and strands the rest.
     */
    function addSchedule(
        address beneficiary,
        string calldata label,
        uint256 tgeAmount,
        uint256 cliffAmount,
        uint64 cliffAt,
        uint256 linearAmount,
        uint64 linearStart,
        uint64 linearDuration
    ) external onlyOwner returns (uint256 id) {
        if (beneficiary == address(0)) revert ZeroAddress();

        uint256 total = tgeAmount + cliffAmount + linearAmount;
        if (total == 0) revert ZeroAmount();

        /* A tail with no duration would divide by zero; a duration with no tail
         * is a schedule field that does nothing, which is worth catching because
         * it usually means the amount was meant to be non-zero. */
        if ((linearAmount == 0) != (linearDuration == 0)) {
            revert LinearDurationMismatch(linearAmount, linearDuration);
        }
        /* A cliff time with nothing to release at it is the same class of
         * mistake, and reads in a block explorer as a step that never happens. */
        if (cliffAmount == 0 && cliffAt != 0) revert CliffBeforeNothing();

        uint256 free = unallocated();
        if (free < total) revert InsufficientUnallocatedBalance(total, free);

        _schedules.push(
            Schedule({
                beneficiary: beneficiary,
                label: label,
                total: total,
                tgeAmount: tgeAmount,
                cliffAmount: cliffAmount,
                cliffAt: cliffAt,
                linearAmount: linearAmount,
                linearStart: linearStart,
                linearDuration: linearDuration,
                claimed: 0
            })
        );
        totalAllocated += total;

        id = _schedules.length - 1;
        emit ScheduleAdded(id, beneficiary, label, total);
    }

    /* ── Claiming ───────────────────────────────────────────────────────────*/

    /**
     * Push a schedule's vested-and-unclaimed KLD to its beneficiary.
     *
     * Callable by anyone; see the header. `nonReentrant` is belt and braces
     * given the state is written before the transfer and KLD is a known token,
     * but this contract holds the entire supply at genesis and the cost of the
     * guard is not worth arguing about.
     */
    function claim(uint256 id) external nonReentrant returns (uint256 amount) {
        if (id >= _schedules.length) revert NoSuchSchedule(id);
        Schedule storage s = _schedules[id];

        amount = vested(id) - s.claimed;
        if (amount == 0) revert NothingToClaim(id);

        s.claimed += amount;
        totalClaimed += amount;
        kld.safeTransfer(s.beneficiary, amount);

        emit Claimed(id, s.beneficiary, amount);
    }

    /**
     * Claim every schedule that has something outstanding.
     *
     * Skips rather than reverts on rows with nothing due, so one bucket sitting
     * behind a cliff does not block the rest. Reverts only if no row paid out at
     * all, which distinguishes "nothing is due anywhere" from a silent success.
     */
    function claimAll() external nonReentrant returns (uint256 total) {
        uint256 n = _schedules.length;
        for (uint256 i = 0; i < n; i++) {
            Schedule storage s = _schedules[i];
            uint256 amount = vested(i) - s.claimed;
            if (amount == 0) continue;

            s.claimed += amount;
            totalClaimed += amount;
            total += amount;
            kld.safeTransfer(s.beneficiary, amount);
            emit Claimed(i, s.beneficiary, amount);
        }
        if (total == 0) revert NothingToClaim(type(uint256).max);
    }

    /**
     * Recover tokens that are not KLD, or KLD in excess of every commitment.
     *
     * Deliberately cannot touch allocated KLD: the cap is `unallocated()`, so a
     * beneficiary's unclaimed tranche is not reachable by the owner under any
     * argument. Present because a contract that will hold a billion tokens for
     * four years will be sent something by mistake.
     */
    function sweep(address token, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (token == address(kld)) {
            uint256 free = unallocated();
            if (amount > free) revert InsufficientUnallocatedBalance(amount, free);
        }
        IERC20(token).safeTransfer(to, amount);
    }
}
