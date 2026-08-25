// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

contract PythPriceOracle  {
    IPyth public immutable pyth;
    /**
     * @dev `public`, not `internal`. It was internal with no getter, so the one
     *      privileged account on this contract could not be read from outside
     *      it — a deployment could not prove who held it, and neither could an
     *      explorer. See `transferOwnership` for the other half of that.
     */
    address public owner;

    bytes32 public ethPriceId = 0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace;
    bytes32 public usdcPriceId = 0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a;

    event PriceUpdated(bytes32 indexed feedId, int64 price, uint64 conf, int32 expo, uint256 publishTime);
    event OwnershipTransferred(address indexed from, address indexed to);


////Errors
error NotAuthorized();
error InvalidAddress();
error InsufficientFee(uint256 required, uint256 sent);
error RefundFailed();


    modifier onlyOwner() {
      if(msg.sender !=  owner) revert NotAuthorized();
      _;
    }

    constructor(address pythContract) {
        pyth = IPyth(pythContract);
        owner = msg.sender;
    }

    /**
     * @notice Relay a signed Pyth price update on-chain, then report what the
     *         named feed now reads.
     *
     * @dev Permissionless, and deliberately so. This was `onlyOwner`, which gated
     *      something Pyth itself does not gate: `updatePriceFeeds` verifies the
     *      update's Wormhole signatures on-chain, so a caller cannot submit a
     *      price that Pyth's publishers did not sign. Restricting *who may relay
     *      an already-signed price* therefore stops nothing an attacker wants,
     *      while making the protocol's liveness depend on one key being online —
     *      because `getPrice` reads `getPriceUnsafe` and ProtocolFacet then
     *      enforces a staleness bound on every deposit, borrow, health-factor
     *      read and liquidation.
     *
     *      That cost is not theoretical. Measured on Arc Testnet (5042002) on
     *      2026-08-21: ETH/USD and BTC/USD were 4s old, USDC/USD was 58,510s
     *      (16.3h) old, and USDT/USD and USDE/USD were 8,375,146s (97 days) old.
     *      Arc's native currency is USDC, so on that chain the gas token is the
     *      asset with the stalest feed. With this function gated, the only account
     *      that could bring it back was the deployer's hot key; ungated, anyone
     *      with a Hermes blob and the fee can, which is the pull-oracle model Pyth
     *      is built around and how a borrower's own transaction is meant to carry
     *      its own price update.
     *
     *      The caller pays the fee and gets the surplus back. Previously the fee
     *      was taken from `address(this)` while `msg.value` was ignored entirely,
     *      so an overpaying caller's change stayed here permanently — and there is
     *      no withdraw function on this contract, so "permanently" is literal.
     *      Making the function permissionless without this would have turned a
     *      dormant bug into one anyone could hit.
     */
    function updatePrice(bytes[] calldata priceUpdate, bytes32 priceFeedId) external payable {
        uint256 fee = pyth.getUpdateFee(priceUpdate);
        /* Checked explicitly rather than left to fail inside Pyth: the fee can
         * change between the caller's off-chain estimate and this block, and
         * `{value: fee}` against a short `msg.value` would otherwise silently draw
         * on this contract's balance instead of naming the cause. */
        if (msg.value < fee) revert InsufficientFee(fee, msg.value);
        pyth.updatePriceFeeds{ value: fee }(priceUpdate);

        /* `priceFeedId` is a separate argument from the blob, so a caller can push
         * a batch that does not contain it — and `getPriceUnsafe` reverts for a
         * feed Pyth has never populated. Reverting there would roll back a valid
         * price update for the sake of an event, so the read is guarded and the
         * event is simply not emitted when the named id is not served. The update
         * still landed; only the report is missing. */
        try pyth.getPriceUnsafe(priceFeedId) returns (PythStructs.Price memory price) {
            emit PriceUpdated(priceFeedId, price.price, price.conf, price.expo, price.publishTime);
        } catch {}

        /* Last statement, so there is nothing left to reenter into: the only state
         * this contract holds is `owner` and the two feed ids, none of which this
         * function touches, and a reentrant call would be another permissionless
         * `updatePrice`. `call` rather than `transfer` because a keeper is as
         * likely to be a contract or multisig as an EOA, and 2300 gas is not
         * enough for either. Reverting on a failed refund rather than keeping the
         * change is the whole point. */
        uint256 refund = msg.value - fee;
        if (refund > 0) {
            (bool sent, ) = msg.sender.call{ value: refund }("");
            if (!sent) revert RefundFailed();
        }
    }

    /**
     * View latest ETH price.
     */
    function getEthLatestPrice() public view returns (int64) {
        return pyth.getPriceUnsafe(ethPriceId).price;
    }

    /**
     * View latest USDC price.
     */
    function getUsdcLatestPrice() public view returns (int64) {
        return pyth.getPriceUnsafe(usdcPriceId).price;
    }

    /**
     * Set new ETH price feed ID.
     */
    function setEthPriceId(bytes32 newPriceFeedId) external onlyOwner returns (bool) {
        ethPriceId = newPriceFeedId;
        return true;
    }

  function getPrice(bytes32 priceFeedId) public view returns (PythStructs.Price memory ) {
        PythStructs.Price memory price = pyth.getPriceUnsafe(priceFeedId);
        return price;
    }
   function getSafePrice(bytes32 priceFeedId) public view returns (PythStructs.Price memory ) {
        PythStructs.Price memory price = pyth.getPriceNoOlderThan(priceFeedId, 60);
        return price;
    }
    

    /**
     * Set new USDC price feed ID.
     */
    function setUsdcPriceId(bytes32 newPriceFeedId) external onlyOwner returns (bool) {
        usdcPriceId = newPriceFeedId;
        return true;
    }

    /**
     * @notice Which backend this oracle reads, for a deployment script to branch on.
     *
     * @dev Returns "pyth". AggregatorPriceOracle returns "aggregator-v3" from the
     *      same selector, and the two are otherwise indistinguishable from
     *      outside: ProtocolFacet stores either behind the same
     *      `IPythPriceOracle` type and calls only `getPrice(bytes32)` on it, so
     *      an address alone does not say which one it is.
     *
     *      That matters because the surrounding tooling differs, not the facet.
     *      register-tokens.js proves a feed id by calling
     *      `pyth.getPriceUnsafe(id)` on Pyth's own contract, which an aggregator
     *      chain has none of; and the freshness policy is per-provider (Pyth
     *      publishes every ~90s, a Chainlink testnet feed every ~25 minutes, an
     *      API3 dAPI on a 24-hour heartbeat). Detecting the backend by catching a
     *      revert from a function only one of them has would work, but it makes
     *      "the RPC dropped the call" and "this is the other backend" the same
     *      observation. This makes the answer positive on both sides.
     */
    function oracleKind() external pure returns (string memory) {
        return "pyth";
    }

    /**
     * @notice Hand the owner role to another account.
     *
     * @dev This did not exist, and its absence is a launch problem rather than a
     *      missing convenience. `setEthPriceId` and `setUsdcPriceId` are
     *      `onlyOwner`, and `owner` was set once in the constructor with no way to
     *      change it — so the deploying EOA kept those rights permanently. The
     *      deployment plan transfers the diamond to a multisig; without this the
     *      oracle the diamond prices everything through would stay behind a single
     *      hot key on every Pyth chain, and the only remedy would be redeploying
     *      the oracle and calling `setPythOracle` again.
     *
     *      Single-step rather than two-step accept. A two-step handover protects
     *      against handing ownership to an address that cannot act; the mitigation
     *      here is that nothing about pricing depends on the owner — `getPrice` is
     *      unrestricted — so a botched transfer costs the ability to change feed
     *      ids, not the ability to read prices.
     */
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        address previous = owner;
        owner = newOwner;
        emit OwnershipTransferred(previous, newOwner);
    }
}
