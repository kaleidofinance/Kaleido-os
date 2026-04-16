// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

interface IPythPriceOracle {
    event PriceUpdated(bytes32 indexed feedId, int64 price, uint64 conf, int32 expo, uint256 publishTime);

    /**
     * @dev Submit a Pyth price update and emit the latest price.
     */
    function updatePrice(bytes[] calldata priceUpdate, bytes32 priceFeedId) external payable;

    /**
     * @dev View the latest ETH price.
     */
    function getEthLatestPrice() external view returns (int64);

    /**
     * @dev View the latest USDC price.
     */
    function getUsdcLatestPrice() external view returns (int64);

    /**
     * @dev Set a new ETH price feed ID.
     */
    function setEthPriceId(bytes32 newPriceFeedId) external returns (bool);

    /**
     * @dev View the latest price for a given price feed.
     */
    function getPrice(bytes32 priceFeedId) external view returns (PythStructs.Price memory);

    /**
     * @dev View the safe price for a given price feed.
     */
    function getSafePrice(bytes32 priceFeedId) external view returns (PythStructs.Price memory);

    /**
     * @dev Set a new USDC price feed ID.
     */
    function setUsdcPriceId(bytes32 newPriceFeedId) external returns (bool);
}
