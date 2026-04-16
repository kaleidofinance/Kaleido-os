import { useCallback, useEffect, useState } from 'react';
import { ethers } from 'ethers';
import { KALEIDOSWAP_FACTORY } from '@/constants/utils/addresses';
import { ITradingPair } from '@/constants/types/dex';
import { ABSTRACT_TOKENS } from '@/constants/tokens';

const FACTORY_ABI = [
  "function allPairsLength() external view returns (uint)",
  "function allPairs(uint) external view returns (address)",
];

const PAIR_ABI = [
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
  "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function totalSupply() external view returns (uint256)",
  "function stable() external view returns (bool)",
  "event Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)"
];

const ERC20_ABI = [
  "function symbol() external view returns (string)",
  "function name() external view returns (string)",
  "function decimals() external view returns (uint8)",
];

import { useEthPrice } from '@/hooks/useEthPrice';

// Global cache to prevent multiple concurrent fetches
let cachedPools: ITradingPair[] = [];
let lastFetchTime = 0;
let activeFetchPromise: Promise<ITradingPair[]> | null = null;
const CACHE_DURATION = 30000; // 30 seconds

export const usePoolData = () => {
  const { price: ethPrice } = useEthPrice();
  const [pools, setPools] = useState<ITradingPair[]>(cachedPools);
  const [loading, setLoading] = useState(cachedPools.length === 0);
  const [error, setError] = useState<string | null>(null);

  const fetchPools = useCallback(async (force = false) => {
    // If there's an active fetch, wait for it
    if (activeFetchPromise) {
      try {
        const result = await activeFetchPromise;
        setPools(result);
        setLoading(false);
        return;
      } catch (e) {
        // Fall through to retry if it failed
      }
    }

    // Check cache
    const now = Date.now();
    if (!force && cachedPools.length > 0 && (now - lastFetchTime < CACHE_DURATION)) {
      setPools(cachedPools);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Create a new fetch promise
      activeFetchPromise = (async () => {
        if (typeof window === "undefined" || !window.ethereum) return [];
        const provider = new ethers.BrowserProvider(window.ethereum);
        const factory = new ethers.Contract(KALEIDOSWAP_FACTORY, FACTORY_ABI, provider);

        const pairsLength = await factory.allPairsLength();
        const pairsCount = Number(pairsLength);

        if (pairsCount === 0) {
          return [];
        }

        // Parallelize address fetching (10x Speedup)
        const pairAddresses: string[] = await Promise.all(
          Array.from({ length: pairsCount }, (_, i) => factory.allPairs(i))
        );

        // RPC Context for Volume (Fetch once for all pools)
        const rpcUrl = "https://api.testnet.abs.xyz";
        const rpcProvider = new ethers.JsonRpcProvider(rpcUrl);
        const currentBlock = await rpcProvider.getBlockNumber();
        const fromBlock = Math.max(0, currentBlock - 5000); 

        const poolsData = await Promise.all(pairAddresses.map(async (pairAddress) => {
          try {
            const pair = new ethers.Contract(pairAddress, PAIR_ABI, provider);
            
            // Fetch basic pair info in parallel
            const [token0Address, token1Address, reserves, totalSupply, isStablePool] = await Promise.all([
              pair.token0(),
              pair.token1(),
              pair.getReserves(),
              pair.totalSupply(),
              pair.stable().catch(() => false) // Resilient to missing stable() function
            ]);
            
            const reserve0 = reserves.reserve0;
            const reserve1 = reserves.reserve1;

            let token0 = ABSTRACT_TOKENS.find(t => t.address.toLowerCase() === token0Address.toLowerCase());
            let token1 = ABSTRACT_TOKENS.find(t => t.address.toLowerCase() === token1Address.toLowerCase());

            // Fetch missing token info in parallel if needed
            if (!token0) {
              const token0Contract = new ethers.Contract(token0Address, ERC20_ABI, provider);
              const [symbol, name, decimals] = await Promise.all([
                token0Contract.symbol(),
                token0Contract.name(),
                token0Contract.decimals(),
              ]);
              token0 = {
                address: token0Address,
                symbol,
                name,
                decimals: Number(decimals),
                chainId: 11124,
                verified: false,
                logoURI: '',
              };
            }

            if (!token1) {
              const token1Contract = new ethers.Contract(token1Address, ERC20_ABI, provider);
              const [symbol, name, decimals] = await Promise.all([
                token1Contract.symbol(),
                token1Contract.name(),
                token1Contract.decimals(),
              ]);
              token1 = {
                address: token1Address,
                symbol,
                name,
                decimals: Number(decimals),
                chainId: 11124,
                verified: false,
                logoURI: '',
              };
            }

            const reserve0Formatted = Number(ethers.formatUnits(reserve0, token0.decimals));
            const reserve1Formatted = Number(ethers.formatUnits(reserve1, token1.decimals));

            const price = reserve0Formatted > 0 ? reserve1Formatted / reserve0Formatted : 0;

            let liquidityUSD = 0;
            const stablecoins = ['USDC', 'USDT', 'DAI'];
            const isToken0Stable = stablecoins.includes(token0.symbol.toUpperCase());
            const isToken1Stable = stablecoins.includes(token1.symbol.toUpperCase());

            if (isStablePool) {
                liquidityUSD = reserve0Formatted + reserve1Formatted;
            } else if (isToken0Stable) {
                liquidityUSD = reserve0Formatted * 2;
            } else if (isToken1Stable) {
                liquidityUSD = reserve1Formatted * 2;
            } else if (token0.symbol === 'WETH' || token1.symbol === 'WETH') {
               const wethAmount = token0.symbol === 'WETH' ? reserve0Formatted : reserve1Formatted;
               const currentEthPrice = ethPrice > 0 ? ethPrice : 3000;
               liquidityUSD = wethAmount * currentEthPrice * 2;
            }

            // Volume Section using shared rpcProvider context
            let volume24h = 0;
            let fees24h = 0;
            let apr = 0;

            try {
               const pairContract = new ethers.Contract(pairAddress, PAIR_ABI, rpcProvider);
               const swapFilter = pairContract.filters.Swap();
               const swapEvents = await pairContract.queryFilter(swapFilter, fromBlock, currentBlock);
               
               let volumeUSD = 0;
               for (const event of swapEvents) {
                   const args = (event as any).args;
                   if (!args) continue;
                   const amount0In = Number(ethers.formatUnits(args[1], token0.decimals));
                   const amount1In = Number(ethers.formatUnits(args[2], token1.decimals));
                   const amount0Out = Number(ethers.formatUnits(args[3], token0.decimals));
                   const amount1Out = Number(ethers.formatUnits(args[4], token1.decimals));

                   let tradeVol = 0;
                   if (isToken1Stable) tradeVol = amount1In + amount1Out;
                   else if (isToken0Stable) tradeVol = amount0In + amount0Out;
                   else if (token1.symbol === 'WETH') tradeVol = (amount1In + amount1Out) * 3000;
                   else if (token0.symbol === 'WETH') tradeVol = (amount0In + amount0Out) * 3000;
                   
                   volumeUSD += tradeVol;
               }

               volume24h = volumeUSD * 17.28; // Extrapolate to 24h
               fees24h = volume24h * (isStablePool ? 0.0005 : 0.003);
               if (liquidityUSD > 0) apr = ((fees24h * 365) / liquidityUSD) * 100;
            } catch (e) {
                // Non-blocking volume fail
            }

            return {
              address: pairAddress,
              token0,
              token1,
              reserves: { reserve0: reserve0.toString(), reserve1: reserve1.toString() },
              price,
              totalSupply: Number(totalSupply),
              volume24h: Number(volume24h.toFixed(2)), 
              fees24h: Number(fees24h.toFixed(2)),
              volumeChange24h: 0,
              liquidity: Number(liquidityUSD.toFixed(2)), 
              liquidityChange24h: 0,
              apr: Number(apr.toFixed(2)), 
              stable: isStablePool,
              createdAt: Math.floor(Date.now() / 1000), 
            };
          } catch (pairError) {
            console.error(`Error fetching data for pair ${pairAddress}:`, pairError);
            return null;
          }
        }));

        const validPools = poolsData.filter((p): p is ITradingPair => p !== null);
        cachedPools = validPools;
        lastFetchTime = Date.now();
        return validPools;
      })();

      const finalPools = await activeFetchPromise;
      setPools(finalPools);
    } catch (err: any) {
      console.error('Error fetching pools:', err);
      setError(err.message || 'Failed to fetch pools');
    } finally {
      activeFetchPromise = null;
      setLoading(false);
    }
  }, [ethPrice]);

  useEffect(() => {
    fetchPools();

    const interval = setInterval(() => {
      fetchPools(true); // Force refetch on interval
    }, CACHE_DURATION);

    return () => clearInterval(interval);
  }, [fetchPools]);

  return {
    pools,
    loading,
    error,
    refetch: () => fetchPools(true),
  };
};
