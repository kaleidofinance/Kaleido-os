import { useCallback, useEffect, useState } from 'react';
import { ethers } from 'ethers';
import { useDEXFactory } from './useDEXFactory';

const PAIR_ABI = [
  "event Sync(uint112 reserve0, uint112 reserve1)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
  "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
];

const ERC20_ABI = [
  "function decimals() external view returns (uint8)",
];

export interface PriceDataPoint {
  timestamp: number;
  price: number;
  blockNumber: number;
}

export const usePriceHistory = (token0Address?: string, token1Address?: string) => {
  const { getPairAddress } = useDEXFactory();
  const [priceHistory, setPriceHistory] = useState<PriceDataPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPriceHistory = useCallback(async () => {
    if (!token0Address || !token1Address) {
      setPriceHistory([]);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const provider = new ethers.BrowserProvider(window.ethereum);
      
      // Get pair address
      const pairAddress = await getPairAddress(token0Address, token1Address);
      
      if (!pairAddress) {
        setPriceHistory([]);
        setLoading(false);
        return;
      }

      const pair = new ethers.Contract(pairAddress, PAIR_ABI, provider);

      // Get token decimals
      const token0Contract = new ethers.Contract(token0Address, ERC20_ABI, provider);
      const token1Contract = new ethers.Contract(token1Address, ERC20_ABI, provider);
      
      const [decimals0, decimals1] = await Promise.all([
        token0Contract.decimals(),
        token1Contract.decimals(),
      ]);

      // Get current block
      const currentBlock = await provider.getBlockNumber();
      
      // Fetch last 50000 blocks (adjust based on network block time)
      // For Abstract Testnet, this should cover ~14 hours of data (at 1s block time)
      const fromBlock = Math.max(0, currentBlock - 50000);

      // Fetch Sync events
      const filter = pair.filters.Sync();
      const events = await pair.queryFilter(filter, fromBlock, currentBlock);

      if (events.length === 0) {
        // No events found, use current reserves
        const reserves = await pair.getReserves();
        const currentPrice = calculatePrice(
          reserves.reserve0,
          reserves.reserve1,
          Number(decimals0),
          Number(decimals1)
        );
        
        setPriceHistory([{
          timestamp: Date.now(),
          price: currentPrice,
          blockNumber: currentBlock,
        }]);
        setLoading(false);
        return;
      }

      // Process events to build price history
      const priceData: PriceDataPoint[] = [];
      
      for (const event of events) {
        const block = await event.getBlock();
        const args = (event as any).args;
        
        const price = calculatePrice(
          args.reserve0,
          args.reserve1,
          Number(decimals0),
          Number(decimals1)
        );

        priceData.push({
          timestamp: block.timestamp * 1000, // Convert to milliseconds
          price,
          blockNumber: event.blockNumber,
        });
      }

      // Sort by timestamp
      priceData.sort((a, b) => a.timestamp - b.timestamp);

      // If we have very few data points, sample them to create a smoother chart
      const sampledData = sampleDataPoints(priceData, 20);

      setPriceHistory(sampledData);
    } catch (err: any) {
      console.error('Error fetching price history:', err);
      setError(err.message || 'Failed to fetch price history');
    } finally {
      setLoading(false);
    }
  }, [token0Address, token1Address, getPairAddress]);

  useEffect(() => {
    fetchPriceHistory();
  }, [fetchPriceHistory]);

  return {
    priceHistory,
    loading,
    error,
    refetch: fetchPriceHistory,
  };
};

// Helper function to calculate price from reserves
function calculatePrice(
  reserve0: bigint,
  reserve1: bigint,
  decimals0: number,
  decimals1: number
): number {
  if (reserve0 === BigInt(0)) return 0;
  
  const reserve0Formatted = Number(ethers.formatUnits(reserve0, decimals0));
  const reserve1Formatted = Number(ethers.formatUnits(reserve1, decimals1));
  
  return reserve1Formatted / reserve0Formatted;
}

// Helper function to sample data points for smoother charts
function sampleDataPoints(data: PriceDataPoint[], targetCount: number): PriceDataPoint[] {
  if (data.length <= targetCount) return data;
  
  const step = Math.floor(data.length / targetCount);
  const sampled: PriceDataPoint[] = [];
  
  for (let i = 0; i < data.length; i += step) {
    sampled.push(data[i]);
  }
  
  // Always include the last data point
  if (sampled[sampled.length - 1] !== data[data.length - 1]) {
    sampled.push(data[data.length - 1]);
  }
  
  return sampled;
}
