// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * Testnet faucet: hands out a fixed drip of any listed ERC20, once per cooldown
 * per (asset, claimer).
 *
 * ── Why this is a token list and not USDC + KLD ─────────────────────────────
 *
 * It used to be exactly two hardcoded assets, `USDC` and `KLD`, with one claim
 * function each. That shape could not be deployed on any chain this repo targets,
 * for two independent reasons:
 *
 *   1. The constructor required a non-zero KLD address, and no contract in
 *      smart-contract/contracts mints KLD — see OWN_TOKENS in
 *      src/constants/registry.ts, whose `kld` entry carries `noContract`. A
 *      two-asset faucet where one asset does not exist is a faucet that reverts
 *      at deploy.
 *   2. Every deployed testnet carries THREE test stables, not one — `usdc`,
 *      `usdt` and `usde` in deployments.generated.ts — because the stable pages
 *      offer all three as collateral. A faucet that pays out one of them leaves
 *      two thirds of the product untestable.
 *
 * So the asset set is configuration, seeded at deploy and editable by the owner.
 * KLD simply is not in the list until a KLD ERC20 exists, which is a fact about
 * the repository rather than a special case in this file.
 *
 * ── Why it transfers rather than mints ─────────────────────────────────────
 *
 * The obvious alternative is for the faucet to mint, which would need no funding
 * at all. It does not work across the assets we actually have:
 *
 *   MockERC20 (mock USDC on 97 and 46630)   `mint` is public — anyone can mint
 *   USDT.sol / USDe.sol                     `mint` is onlyOwner, owner = deployer
 *   Circle USDC (Arc, Sepolia, Base)        not ours, cannot be minted at all
 *
 * A minting faucet would therefore work for one of the three and would bake the
 * mock's interface into a contract that also has to serve Circle's real token.
 * Transferring from its own balance is the one mechanism that covers all three,
 * and it is what makes `withdraw` below necessary rather than optional.
 *
 * It also decides what the wrapped native can do. WETH9 has no mint at all — the
 * only way to obtain it is to `deposit()` real native — so on every chain the
 * wrapped native is stocked by wrapping, off-chain, in the deploy script. Nothing
 * in here needs to know that: to the faucet it is an ERC20 with a balance, like
 * every other asset.
 *
 * ── The native gas token, handed out like any other asset ───────────────────
 *
 * A tester whose wallet is empty cannot pay for the transaction that claims the
 * ERC20s in the first place, so the faucet also hands out the chain's native gas
 * token. It is listed under the sentinel NATIVE_TOKEN (address(1)) and goes
 * through the same `claim`/`claimMany`, cooldown and stock machinery as every
 * ERC20; the only differences are that its stock is `address(this).balance` and
 * its payout is a value-bearing call rather than `safeTransfer`. It is funded by
 * a plain native send, which `receive()` accepts, and recovered with
 * `withdraw(NATIVE_TOKEN, …)`.
 *
 * address(1) is the ecrecover precompile, which answers a `balanceOf` staticcall
 * with decodable garbage instead of reverting — so every balance and transfer
 * path branches on the sentinel BEFORE it would reach IERC20. An unguarded native
 * entry would silently misreport its stock, not fail loudly.
 *
 * ── Claiming one asset or several ──────────────────────────────────────────
 *
 * `claim` pays one asset and reverts with the specific reason it could not.
 * `claimMany` pays every claimable member of a list and skips the rest, which is
 * what a tester setting up a fresh wallet on a six-asset chain actually wants.
 * The rules are shared — see _eligibility — so the two cannot drift about what
 * "claimable" means.
 */
contract KaleidoTokenFaucet is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /**
     * Sentinel for the native gas token, listed and claimed exactly like an ERC20.
     *
     * MUST equal Constants.NATIVE_TOKEN — the protocol's lending sentinel — and
     * the frontend's NATIVE_SENTINEL.lending, so a wallet that claims native here
     * and deposits it as collateral there names one asset. It is deliberately NOT
     * the DEX's 0xEeee… convention; the two must never be interchanged.
     */
    address public constant NATIVE_TOKEN = address(1);

    /**
     * A listed asset's payout.
     *
     * `listed` is tracked separately from `amount` so zero is not overloaded: a
     * listed asset with amount 0 is paused and keeps its history and its slot in
     * `assets`, where an unlisted one was never configured. Delisting would
     * shuffle the array and change what `assets(i)` means between two reads of
     * the same page, so nothing delists.
     */
    struct Drip {
        /** Paid per claim, in the token's own base units. */
        uint256 amount;
        bool listed;
    }

    mapping(address => Drip) public drips;

    /** Every asset ever listed, in listing order. Append-only; see Drip.listed. */
    address[] public assets;

    /** Seconds a claimer must wait between claims of the SAME asset. */
    uint256 public cooldown;

    /** token => claimer => unix seconds of their last claim of that token. */
    mapping(address => mapping(address => uint256)) public lastClaimed;

    /** token => cumulative base units paid out. */
    mapping(address => uint256) public totalClaimed;

    /*
     * Unique claimers, counted once each.
     *
     * The two-asset version pushed to `allUsers` from BOTH claim functions, each
     * behind its own first-time flag, so anyone who claimed USDC and KLD was
     * counted twice and getTotalUsers() over-reported. One flag across all assets
     * is what "users" means, and the per-asset first-claim question is answered by
     * lastClaimed[token][user] != 0 without needing a second mapping.
     */
    address[] public allUsers;
    mapping(address => bool) public hasClaimedBefore;

    /*
     * KaleidoTokenFaucet_FailToSendToken is deliberately gone. It was declared and
     * never reverted: the transfer goes through SafeERC20.safeTransfer, which
     * already reverts on a false return or a failed call, with its own error. A
     * declared-but-unreachable error still lands in the ABI, so the frontend's
     * decoder carried a case that could not occur — see TxFactory.ts.
     */
    error KaleidoTokenFaucet_InsufficientContractBalance();
    error KaleidoTokenFaucet_CooldownNotOver();
    error KaleidoTokenFaucet_AssetNotListed();
    error KaleidoTokenFaucet_BadConfig();

    /**
     * A native payout or withdrawal's low-level call returned false — the
     * recipient rejected the value or exhausted the gas forwarded to its receive
     * hook. The ERC20 path cannot reach this; SafeERC20 carries its own revert.
     */
    error KaleidoTokenFaucet_NativeTransferFailed();

    /**
     * `claimMany` paid nothing at all.
     *
     * Distinct from the three single-asset errors because it is not any one of
     * them: a batch of six can fail because two are paused, three are on cooldown
     * and one is out of stock, and no single reason describes that. The batch
     * deliberately does not report which — see the note on _eligibility.
     */
    error KaleidoTokenFaucet_NothingClaimable();

    /**
     * Indexed on token and claimer — the two things anyone filters by.
     *
     * The old TokenClaim indexed `amount` and `date` instead, which cannot be
     * queried usefully: a topic filter is equality only, so it could answer "which
     * claims were for exactly 100000000 base units" and never "which claims
     * happened this week". Both are values now, and the pair that identifies a
     * claim is indexed.
     */
    event Claimed(
        address indexed token,
        address indexed claimer,
        uint256 amount,
        uint256 date
    );
    event DripSet(address indexed token, uint256 amount);
    event CooldownSet(uint256 seconds_);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);

    /**
     * @param tokens          Assets to list at deploy, usually a chain's test stables.
     * @param amounts         Payout per claim for each, in that token's base units.
     * @param cooldownSeconds Wait between claims of one asset. May be 0.
     */
    constructor(
        address[] memory tokens,
        uint256[] memory amounts,
        uint256 cooldownSeconds
    ) Ownable(msg.sender) {
        if (tokens.length != amounts.length) {
            revert KaleidoTokenFaucet_BadConfig();
        }
        cooldown = cooldownSeconds;
        emit CooldownSet(cooldownSeconds);
        for (uint256 i; i < tokens.length; ++i) {
            _setDrip(tokens[i], amounts[i]);
        }
    }

    /**
     * Accepts native funding. The faucet pays the native token out of its own
     * balance just as it pays an ERC20 (see NATIVE_TOKEN), so it must be able to
     * hold it; refilling is a plain send and `withdraw(NATIVE_TOKEN, …)` is the
     * matching recovery. Deliberately empty of claim logic — funding and claiming
     * are separate, and a payable claim path would let value ride in on a claim.
     */
    receive() external payable {}

    /* ------------------------------------------------------------- claiming -- */

    function claim(address token) external nonReentrant {
        uint8 code = _eligibility(token, msg.sender);
        if (code == _NOT_LISTED) revert KaleidoTokenFaucet_AssetNotListed();
        if (code == _ON_COOLDOWN) revert KaleidoTokenFaucet_CooldownNotOver();
        if (code == _NO_STOCK) {
            revert KaleidoTokenFaucet_InsufficientContractBalance();
        }
        _pay(token, drips[token].amount);
    }

    /**
     * Claims every asset in `tokens` that is currently claimable, skipping the
     * rest. Returns how many were paid.
     *
     * ── Why this exists ────────────────────────────────────────────────────────
     *
     * A chain in this wave lists up to six assets — three test stables, the
     * wrapped native, and on Arc also EURC and cirBTC. Setting up one test wallet
     * through `claim` alone is six transactions and six wallet confirmations, for
     * an action whose entire purpose is to get out of the way before the real
     * testing starts.
     *
     * ── Why it skips instead of reverting ─────────────────────────────────────
     *
     * Reverting the batch when one member is unavailable would make it useless on
     * the second press: the cooldown is per (asset, claimer), so a wallet that
     * claimed USDC a minute ago could not then claim the other five. "Give me
     * everything I am owed right now" is the semantic a tester wants, and it is
     * the one that stays useful.
     *
     * It reverts only when NOTHING was claimable, because a transaction that
     * succeeds having moved no tokens looks identical to one that worked, and the
     * caller would pay gas to learn nothing. Which members were skipped is
     * deliberately not reported: `assetInfo` already returns the drip, the stock
     * and the per-asset deadline in one call, so the frontend knows the reason for
     * every asset before it builds the list, and encoding six reasons into a
     * revert or an event would duplicate a read that is already cheaper.
     *
     * A duplicated address grants nothing new. Once paid, its lastClaimed is set,
     * so the second occurrence is skipped for the same reason a second `claim`
     * would revert — except when cooldown is 0, where calling `claim` twice in one
     * block is already permitted and this is no different.
     *
     * There is deliberately no `claimAll()`. It would loop over `assets`, which is
     * append-only and includes paused entries, so its gas cost would grow forever
     * and eventually exceed the block limit — taking the only batch path down with
     * it. The caller passes the list, and it already has it from `assetInfo`.
     */
    function claimMany(
        address[] calldata tokens
    ) external nonReentrant returns (uint256 paid) {
        for (uint256 i; i < tokens.length; ++i) {
            address token = tokens[i];
            if (_eligibility(token, msg.sender) != _OK) continue;
            _pay(token, drips[token].amount);
            ++paid;
        }
        if (paid == 0) revert KaleidoTokenFaucet_NothingClaimable();
    }

    /* ---------------------------------------------------------------- reads -- */

    function assetCount() external view returns (uint256) {
        return assets.length;
    }

    function getTotalUsers() external view returns (uint256) {
        return allUsers.length;
    }

    /**
     * When `user` may next claim `token`, in unix seconds. 0 means now.
     *
     * Returning a deadline rather than a remaining duration keeps this a pure
     * function of state: a countdown computed here is stale the moment it is
     * returned, and the caller has a clock.
     */
    function claimableAt(
        address token,
        address user
    ) public view returns (uint256) {
        uint256 last = lastClaimed[token][user];
        if (last == 0) return 0;
        uint256 ready = last + cooldown;
        return ready > block.timestamp ? ready : 0;
    }

    /**
     * Everything a faucet page needs, for one caller, in one eth_call.
     *
     * The alternative is 1 + 3n calls (assetCount, then amount/balance/deadline per
     * asset), which on a five-asset chain is sixteen round trips to render one
     * screen. Paused assets are included: the page has to be able to say an asset
     * exists but is not paying out, and dropping them would make a paused asset
     * indistinguishable from an unlisted one.
     */
    function assetInfo(
        address user
    )
        external
        view
        returns (
            address[] memory tokens,
            uint256[] memory amounts,
            uint256[] memory balances,
            uint256[] memory nextClaimAt
        )
    {
        uint256 n = assets.length;
        tokens = new address[](n);
        amounts = new uint256[](n);
        balances = new uint256[](n);
        nextClaimAt = new uint256[](n);

        for (uint256 i; i < n; ++i) {
            address token = assets[i];
            tokens[i] = token;
            amounts[i] = drips[token].amount;
            balances[i] = token == NATIVE_TOKEN
                ? address(this).balance
                : IERC20(token).balanceOf(address(this));
            nextClaimAt[i] = claimableAt(token, user);
        }
    }

    /* ---------------------------------------------------------------- owner -- */

    /** Lists a new asset, or changes/pauses an existing one. 0 pauses. */
    function setDrip(address token, uint256 amount) external onlyOwner {
        _setDrip(token, amount);
    }

    /**
     * Lists, changes or pauses many assets at once.
     *
     * Same reason the constructor takes arrays: bringing the wrapped native and
     * Arc's EURC and cirBTC onto the five deployed testnets is seven listings, and
     * doing them one transaction at a time is seven chances to stop half way and
     * leave the chains disagreeing about what the faucet hands out. Length
     * mismatch reverts rather than truncating, exactly as the constructor does — a
     * silently short list would pair the wrong amount with the wrong token from the
     * mismatch onward.
     */
    function setDrips(
        address[] calldata tokens,
        uint256[] calldata amounts
    ) external onlyOwner {
        if (tokens.length != amounts.length) {
            revert KaleidoTokenFaucet_BadConfig();
        }
        for (uint256 i; i < tokens.length; ++i) {
            _setDrip(tokens[i], amounts[i]);
        }
    }

    function setCooldown(uint256 seconds_) external onlyOwner {
        cooldown = seconds_;
        emit CooldownSet(seconds_);
    }

    /**
     * Recovers funding. `amount` 0 sends the whole balance.
     *
     * The two-asset version had no withdraw at all, which meant anything sent to
     * it — including a token listed by mistake, or the surplus after a testnet is
     * retired — was stranded. Refilling is a plain transfer in, so recovery is the
     * matching half of that and belongs here.
     */
    function withdraw(
        address token,
        address to,
        uint256 amount
    ) external onlyOwner {
        if (to == address(0)) revert KaleidoTokenFaucet_BadConfig();

        if (token == NATIVE_TOKEN) {
            uint256 nativeValue = amount == 0 ? address(this).balance : amount;
            (bool ok, ) = payable(to).call{value: nativeValue}("");
            if (!ok) revert KaleidoTokenFaucet_NativeTransferFailed();
            emit Withdrawn(token, to, nativeValue);
            return;
        }

        uint256 value = amount == 0
            ? IERC20(token).balanceOf(address(this))
            : amount;
        IERC20(token).safeTransfer(to, value);
        emit Withdrawn(token, to, value);
    }

    /* ------------------------------------------------------------- internal -- */

    /*
     * Eligibility codes.
     *
     * The rules live in one private view rather than being written twice because
     * the two callers need opposite things from them. `claim` must revert with the
     * SPECIFIC reason — the frontend decodes _AssetNotListed, _CooldownNotOver and
     * _InsufficientContractBalance into three different sentences (see
     * TxFactory.ts), so collapsing them would make "come back in an hour"
     * indistinguishable from "we are out of this token". `claimMany` must not
     * revert on any of them. Same rules, so one implementation returns a code and
     * each caller decides what it means.
     */
    uint8 private constant _OK = 0;
    uint8 private constant _NOT_LISTED = 1;
    uint8 private constant _ON_COOLDOWN = 2;
    uint8 private constant _NO_STOCK = 3;

    function _eligibility(
        address token,
        address claimer
    ) private view returns (uint8) {
        Drip memory drip = drips[token];
        if (!drip.listed || drip.amount == 0) return _NOT_LISTED;

        /*
         * `last != 0` rather than relying on the subtraction.
         *
         * The old check was `block.timestamp - lastClaimed[msg.sender] < COOLDOWN`,
         * which treats a never-claimed user as having claimed at the unix epoch.
         * That is only accidentally right: on a freshly started chain whose
         * block.timestamp is itself smaller than the cooldown, every first claim
         * reverts. Asking whether they have claimed at all is the actual question.
         */
        uint256 last = lastClaimed[token][claimer];
        if (last != 0 && block.timestamp - last < cooldown) return _ON_COOLDOWN;

        uint256 stock = token == NATIVE_TOKEN
            ? address(this).balance
            : IERC20(token).balanceOf(address(this));
        if (stock < drip.amount) {
            return _NO_STOCK;
        }
        return _OK;
    }

    /** Pays msg.sender `amount` of `token`. Caller must have checked eligibility. */
    function _pay(address token, uint256 amount) private {
        lastClaimed[token][msg.sender] = block.timestamp;
        totalClaimed[token] += amount;

        if (!hasClaimedBefore[msg.sender]) {
            allUsers.push(msg.sender);
            hasClaimedBefore[msg.sender] = true;
        }

        if (token == NATIVE_TOKEN) {
            (bool ok, ) = payable(msg.sender).call{value: amount}("");
            if (!ok) revert KaleidoTokenFaucet_NativeTransferFailed();
        } else {
            IERC20(token).safeTransfer(msg.sender, amount);
        }
        emit Claimed(token, msg.sender, amount, block.timestamp);
    }

    function _setDrip(address token, uint256 amount) private {
        if (token == address(0)) revert KaleidoTokenFaucet_BadConfig();
        Drip storage drip = drips[token];
        if (!drip.listed) {
            drip.listed = true;
            assets.push(token);
        }
        drip.amount = amount;
        emit DripSet(token, amount);
    }
}
