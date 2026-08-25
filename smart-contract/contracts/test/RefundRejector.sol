// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IUpdatePrice {
    function updatePrice(bytes[] calldata priceUpdate, bytes32 priceFeedId) external payable;
}

/**
 * @title RefundRejector
 * @notice A caller that cannot receive ether, for proving PythPriceOracle's refund
 *         reverts instead of silently keeping the surplus.
 *
 * @dev No `receive` and no `fallback`, so the plain-value `call` back to it fails.
 *      This is the only way to reach the `RefundFailed` branch: an EOA always
 *      accepts a refund, and the bug being guarded against — ignoring the `call`'s
 *      return value — is invisible from an EOA test because the refund succeeds
 *      either way.
 *
 *      Not contrived: a keeper pushing prices on a schedule is as likely to be a
 *      contract or a multisig as an EOA, and one that cannot take the change back
 *      needs to be told so rather than quietly donating it to an oracle with no
 *      withdraw function.
 */
contract RefundRejector {
    function push(
        address oracle,
        bytes[] calldata priceUpdate,
        bytes32 priceFeedId
    ) external payable {
        IUpdatePrice(oracle).updatePrice{ value: msg.value }(priceUpdate, priceFeedId);
    }
}
