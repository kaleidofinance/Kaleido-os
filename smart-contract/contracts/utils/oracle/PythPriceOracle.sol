// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

contract PythPriceOracle  {
    IPyth public immutable pyth;
    address internal owner;

    bytes32 public ethPriceId = 0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace;
    bytes32 public usdcPriceId = 0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a;

    event PriceUpdated(bytes32 indexed feedId, bytes[] priceUpdate);


////Errors
error NotAuthorized();


    modifier onlyOwner() {
      if(msg.sender !=  owner) revert NotAuthorized();
      _;
    }

    constructor(address pythContract) {
        pyth = IPyth(pythContract);
        owner = msg.sender;
    }

    /**
     * Submits a Pyth price update and emits the latest price.
     */
    function updatePrice(bytes[] calldata priceUpdate, bytes32 priceFeedId) onlyOwner external payable {
        uint fee = pyth.getUpdateFee(priceUpdate);
        pyth.updatePriceFeeds{ value: fee }(priceUpdate);

        // PythStructs.Price memory price = pyth.getPriceNoOlderThan(priceFeedId, 60);
        emit PriceUpdated(priceFeedId, priceUpdate);
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

    

    
}
