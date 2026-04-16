import { useState, useEffect } from 'react';
import { ethers } from 'ethers';

const MAINNET_RPC = "https://eth.llamarpc.com";
const CHAINLINK_ETH_USD_FEED = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419";
const AGGREGATOR_ABI = [
  "function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() external view returns (uint8)"
];

export const useEthPrice = () => {
  const [price, setPrice] = useState<number>(3000); // Default fallback
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPrice = async () => {
      try {
        const provider = new ethers.JsonRpcProvider(MAINNET_RPC);
        const feed = new ethers.Contract(CHAINLINK_ETH_USD_FEED, AGGREGATOR_ABI, provider);

        const [roundData, decimals] = await Promise.all([
          feed.latestRoundData(),
          feed.decimals()
        ]);

        const price = Number(ethers.formatUnits(roundData.answer, decimals));
        if (price > 0) {
            setPrice(price);
        }
        setLoading(false);
      } catch (error) {
        console.error("Failed to fetch ETH price from Chainlink:", error);
        setLoading(false);
      }
    };

    fetchPrice();
    const interval = setInterval(fetchPrice, 60000); // Update every minute
    return () => clearInterval(interval);
  }, []);

  return { price, loading };
};
