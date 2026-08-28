// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * KLD — the Kaleido protocol token.
 *
 * This is the contract the rest of the repository has been compiled against
 * without it existing. Three deployed or deployable consumers already take a KLD
 * address as a constructor argument or a supported-asset entry:
 *
 *   KLDVaultV2      stake KLD, receive rebasing stKLD (Staking/Modernized/)
 *   MasterChef      farm emissions denominated in it (dex/core/)
 *   Faucet          hands it out on testnets, once the asset list includes it
 *
 * and `OWN_TOKENS` in src/constants/registry.ts has always described it —
 * symbol KLD, name "Kaleido", 18 decimals — carrying a `noContract` marker
 * reading "no KLD ERC20 in smart-contract/contracts — only consumers". That
 * marker is what this file removes. Nothing here is novel: the vault only ever
 * needed `IERC20.safeTransferFrom`, so the requirement was always a plain ERC20
 * plus a mint path.
 *
 * ── Nothing about supply is decided here ────────────────────────────────────
 *
 * `maxSupply` is a constructor argument, not a constant, and it is immutable
 * once set. That split is deliberate. A token whose ceiling is a literal in its
 * source forces a contract rewrite — and a fresh audit — every time tokenomics
 * moves a number, and tokenomics is settled later than code. A token whose
 * ceiling is mutable by an admin has no ceiling at all. A constructor argument
 * stored in an immutable is the only shape that lets the number be decided at
 * deploy and never again.
 *
 * The same reasoning covers distribution: this contract mints nothing in its
 * constructor. Genesis allocation is a sequence of `mint` calls made by the
 * deploy script, so the allocation table lives with the deployment record that
 * documents it rather than inside the token. Consequence worth stating plainly:
 * a freshly deployed KLD has zero supply and zero holders, and is inert until
 * something with MINTER_ROLE issues the first tokens.
 *
 * ── The two supply invariants ───────────────────────────────────────────────
 *
 * A token that is going to exist on several chains at once needs its supply
 * bound to be global, not per chain. Five chains each honouring a 1× ceiling
 * independently is a 5× ceiling. Two mechanisms enforce it:
 *
 * 1. ISSUANCE IS CAPPED ON CUMULATIVE MINTS, NOT ON `totalSupply()`.
 *    `totalIssued` only ever rises; burning does not hand back headroom. This
 *    matters specifically because of bridging. Under burn-and-mint, moving KLD
 *    off this chain burns it here — and if the cap were `totalSupply() + amount
 *    <= maxSupply`, bridging the entire supply away would restore the full
 *    headroom and let a minter issue `maxSupply` a second time. Capping the
 *    monotonic counter closes that. It also gives deflationary burns the
 *    semantics people assume they have: burnt KLD is gone, not reissuable.
 *
 * 2. ISSUANCE IS CONFINED TO ONE CHAIN, IN CODE.
 *    `MINTER_ROLE` cannot be granted anywhere except `homeChainId` — see the
 *    `_grantRole` override, which reverts rather than silently no-opping. So on
 *    every other chain the only way KLD can come into existence is a bridge
 *    moving supply that was already issued at home. This is the invariant that
 *    is usually left to operational discipline ("remember not to grant the
 *    minter role on the satellite deployments"); discipline is not a mechanism,
 *    and the failure is unrecoverable, so it is enforced here instead.
 *
 * ── Why a bridge gets its own role rather than MINTER_ROLE ──────────────────
 *
 * `BRIDGE_ROLE` mints without touching `totalIssued`, because a cross-chain
 * transfer is not issuance — the tokens were already counted against the cap on
 * the home chain and burnt there. Handing a bridge MINTER_ROLE instead would
 * consume real headroom on every inbound transfer and eventually wedge the
 * bridge at a cap that no new tokens had actually breached.
 *
 * Both roles reach the same `mint(address,uint256)` entry point, and
 * ERC20Burnable supplies `burn(uint256)` and `burnFrom(address,uint256)`. That
 * is not an accident of style: it is the exact surface Wormhole NTT expects of a
 * token in burning mode, and it is what LayerZero OFT adapters expect too. So
 * making KLD multichain is a matter of granting BRIDGE_ROLE to a manager
 * contract, with no change to this file. The Wormhole SDK is already a
 * dependency of smart-contract/package.json.
 *
 * A bridge holding BRIDGE_ROLE is trusted for its own accounting — nothing here
 * can tell a legitimate inbound transfer from an invented one. What it can do is
 * bound the blast radius, and it does: a bridge mint still cannot push this
 * chain's `totalSupply()` past the global `maxSupply`. That check is not the
 * cap (bridged supply was never issuance), it is a backstop, and it means the
 * worst case from a compromised bridge is a supply that looks wrong on one chain
 * rather than one that is unbounded.
 *
 * ── Deliberately not ERC20Votes ─────────────────────────────────────────────
 *
 * `OWN_TOKENS` tags KLD "governance", and the checkpointing extension is the
 * obvious reach. It is left out, and because adding it later means deploying a
 * different token, the reason belongs on the record.
 *
 * Vote checkpoints are per chain. On a multichain token they measure voting
 * power on whichever chain a holder's balance happens to be sitting on, which is
 * a property of their bridging history rather than of their stake — so the
 * extension would not deliver the thing it looks like it delivers, while adding
 * a write to every transfer and an `ERC20Permit`/`ERC20Votes` nonce collision to
 * resolve. Protocols that run this shape put voting in a separate contract that
 * holds or escrows the token; that stays available, needs no cooperation from
 * this file, and lets voting power be defined once across all chains instead of
 * once per chain.
 */
contract KLD is ERC20, ERC20Burnable, ERC20Permit, AccessControl {
    /**
     * Issuance. Grantable only on `homeChainId`, and consumes cap headroom.
     * Intended holders: the deployer at genesis, then an emissions contract
     * (MasterChef) and whatever pays staking rewards into the YieldTreasury.
     */
    bytes32 public constant MINTER_ROLE = keccak256("KLD_MINTER_ROLE");

    /**
     * Cross-chain transfer. Grantable on any chain, and does NOT consume cap
     * headroom — see the header. Intended holder: a bridge manager (NTT / OFT),
     * one per chain, and nothing else.
     */
    bytes32 public constant BRIDGE_ROLE = keccak256("KLD_BRIDGE_ROLE");

    /** Hard ceiling on cumulative issuance, in wei. Fixed at deploy. */
    uint256 public immutable maxSupply;

    /**
     * The one chain id where KLD may be issued. Everywhere else, supply can only
     * arrive over a bridge. Stored rather than compared against a constant so a
     * satellite deployment states its home explicitly and can be checked by
     * anyone reading the contract.
     */
    uint256 public immutable homeChainId;

    /**
     * Cumulative MINTER_ROLE issuance. Monotonic: burning does not decrement it,
     * which is invariant 1 in the header. Always 0 on a satellite chain, because
     * MINTER_ROLE cannot be granted there.
     */
    uint256 public totalIssued;

    /** Issuance that would take `totalIssued` past `maxSupply`. */
    error CapExceeded(uint256 requested, uint256 remaining);
    /** MINTER_ROLE grant attempted on a chain that is not `homeChainId`. */
    error IssuanceIsHomeChainOnly(uint256 expectedChainId, uint256 actualChainId);
    /** Caller holds neither MINTER_ROLE nor BRIDGE_ROLE. */
    error NotAuthorisedToMint(address caller);
    /** A bridge mint that would push this chain's supply past the global cap. */
    error BridgeMintExceedsGlobalCap(uint256 requested, uint256 remaining);
    error ZeroAddress();
    error ZeroMaxSupply();

    /** Issuance against the cap. `remaining` is the headroom left after it. */
    event Issued(address indexed to, uint256 amount, uint256 remaining);
    /** Supply arriving from another chain. Not issuance; see the header. */
    event BridgeMinted(address indexed bridge, address indexed to, uint256 amount);

    /**
     * @param _maxSupply  Global ceiling on cumulative issuance, in wei (18dp).
     * @param _homeChainId The only chain where MINTER_ROLE may be granted. Pass
     *        this chain's own id for a home deployment; pass the home chain's id
     *        when deploying a bridge-fed satellite.
     * @param _admin  Receives DEFAULT_ADMIN_ROLE, and MINTER_ROLE if this is the
     *        home chain. Role administration should move to the protocol
     *        multisig before mainnet, exactly as the Robinhood price feeds must.
     */
    constructor(
        uint256 _maxSupply,
        uint256 _homeChainId,
        address _admin
    ) ERC20("Kaleido", "KLD") ERC20Permit("Kaleido") {
        if (_maxSupply == 0) revert ZeroMaxSupply();
        if (_admin == address(0)) revert ZeroAddress();

        maxSupply = _maxSupply;
        homeChainId = _homeChainId;

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        /* Only on the home chain, and via the same guarded path as any later
         * grant rather than around it, so there is one rule and not two. */
        if (block.chainid == _homeChainId) {
            _grantRole(MINTER_ROLE, _admin);
        }
    }

    /** True where KLD may be issued rather than only received from a bridge. */
    function isHomeChain() public view returns (bool) {
        return block.chainid == homeChainId;
    }

    /** Issuance headroom left, in wei. Always 0 on a satellite chain. */
    function remainingIssuance() public view returns (uint256) {
        return maxSupply - totalIssued;
    }

    /**
     * Mint, by either role.
     *
     * One entry point rather than `mint` plus `bridgeMint` because NTT and OFT
     * adapters call exactly this signature, and a token that needs a bespoke
     * function to be bridged needs a bespoke bridge. The branch is on the
     * caller's role, and the two paths differ only in whether the amount counts
     * against the cap.
     */
    function mint(address to, uint256 amount) external {
        if (hasRole(MINTER_ROLE, msg.sender)) {
            uint256 remaining = maxSupply - totalIssued;
            if (amount > remaining) revert CapExceeded(amount, remaining);
            totalIssued += amount;
            _mint(to, amount);
            emit Issued(to, amount, remaining - amount);
            return;
        }

        if (hasRole(BRIDGE_ROLE, msg.sender)) {
            /* Not the cap — bridged supply was issued at home and counted there.
             * A backstop, so a broken bridge is bounded by the global ceiling
             * instead of unbounded. See the header. */
            uint256 supply = totalSupply();
            if (supply + amount > maxSupply) {
                revert BridgeMintExceedsGlobalCap(amount, maxSupply - supply);
            }
            _mint(to, amount);
            emit BridgeMinted(msg.sender, to, amount);
            return;
        }

        revert NotAuthorisedToMint(msg.sender);
    }

    /**
     * Invariant 2, enforced: MINTER_ROLE exists only on the home chain.
     *
     * This reverts rather than returning false. A silent refusal would let a
     * deploy script report a granted minter that does not exist, and the gap
     * would only surface later as a mint that reverts for no visible reason.
     */
    function _grantRole(
        bytes32 role,
        address account
    ) internal virtual override returns (bool) {
        if (role == MINTER_ROLE && block.chainid != homeChainId) {
            revert IssuanceIsHomeChainOnly(homeChainId, block.chainid);
        }
        return super._grantRole(role, account);
    }
}
