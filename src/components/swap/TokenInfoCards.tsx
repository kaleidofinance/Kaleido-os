import React, { useMemo, useState, useEffect } from "react";
import { IToken } from "@/constants/types/dex";
import { usePriceHistory } from "@/hooks/dex/usePriceHistory";
import { useSwapRouter } from "@/hooks/dex/useSwapRouter";
import { ACTIVE_TOKENS } from "@/constants/tokens";
import { useEthPrice } from '@/hooks/useEthPrice';

interface TokenInfoCardsProps {
  fromToken: IToken | null;
  toToken: IToken | null;
}

const SingleTokenCard = ({ token }: { token: IToken }) => {
  const usdcToken = ACTIVE_TOKENS.find(t => t.symbol === "USDC");
  const isUSDC = token.symbol === "USDC";
  const { getAmountsOut } = useSwapRouter();
  const { price: ethPrice } = useEthPrice();
  
  const [externalData, setExternalData] = useState<{price: number, change: number} | null>(null);
  const [spotPrice, setSpotPrice] = useState(0);
  
  // Fetch spot price fallback
  useEffect(() => {
     if (isUSDC || externalData) return;
     
     const fetchSpot = async () => {
        try {
            const weth = ACTIVE_TOKENS.find(t => t.symbol === "WETH");
            if (!weth) return;
            
            // Try Token -> WETH
            const amountOut = await getAmountsOut("1", [token.address, weth.address], token.decimals, 18);
            if (amountOut && parseFloat(amountOut) > 0) {
                // Assume WETH = $2650 for testnet approximation
                setSpotPrice(parseFloat(amountOut) * ethPrice);
            }
        } catch (e) {
            console.error("Failed to fetch spot price", e);
        }
     };
     
     // Debounce slightly or just run
     fetchSpot();
  }, [token.address, isUSDC, externalData, getAmountsOut]);

  useEffect(() => {
    if (token.priceUrl) {
      fetch(token.priceUrl)
        .then(res => res.json())
        .then(data => {
          const item = Object.values(data)[0] as any;
          if (item) {
            setExternalData({
              price: item.usd,
              change: item.usd_24h_change
            });
          }
        })
        .catch(err => {
          console.error("Failed to fetch price:", err);
          setExternalData(null);
        });
    } else {
      setExternalData(null);
    }
  }, [token.priceUrl, token.address]);



  // Fetch history against USDC
  const { priceHistory: historyUSDC, loading: loadingUSDC } = usePriceHistory(
    token.address, 
    usdcToken?.address
  );
  
  // Fetch history against WETH (fallback)
  const wethToken = ACTIVE_TOKENS.find(t => t.symbol === "WETH");
  const { priceHistory: historyWETH, loading: loadingWETH } = usePriceHistory(
    token.address,
    wethToken?.address
  );

  const loading = loadingUSDC || loadingWETH;

  // Determine effective history source
  const priceHistory = useMemo(() => {
     if (historyUSDC && historyUSDC.length > 0) return historyUSDC;
     
     // If no USDC direct pair, try WETH pair and convert to USD
     if (historyWETH && historyWETH.length > 0) {
        // Approximate WETH price (use static $2650 or fetch real if needed, but for fallback this is fine)
        // Ideally we would fetch the real WETH-USDC price here too, but to avoid hook explosion we use a robust assumption for testnet
        // Or better: allow passing in the "Base Price" props.
        const ETH_PRICE = ethPrice; 
        
        // Convert ETH price points to USD
        return historyWETH.map(p => ({
           ...p,
           price: p.price * ETH_PRICE
        }));
     }
     
     return [];
  }, [historyUSDC, historyWETH]);

  // Adjust isToken0 for the derived pair
  const isToken0 = useMemo(() => {
    if (historyUSDC && historyUSDC.length > 0) {
        if (!usdcToken) return true;
        return token.address.toLowerCase() < usdcToken.address.toLowerCase();
    }
    if (historyWETH && historyWETH.length > 0) {
        if (!wethToken) return true;
        return token.address.toLowerCase() < wethToken.address.toLowerCase();
    }
    return true;
  }, [token.address, usdcToken?.address, wethToken?.address, historyUSDC, historyWETH]);

  const processedData = useMemo(() => {
    // Process chart data from history regardless of price source
    let chartData: {x: number, y: number}[] = [];
    if (priceHistory && priceHistory.length > 0) {
       chartData = priceHistory.map(p => ({
         x: p.timestamp,
         y: isToken0 ? p.price : (p.price > 0 ? 1 / p.price : 0)
       })).sort((a, b) => a.x - b.x);
    } else if (isUSDC) {
       chartData = Array(10).fill(0).map((_, i) => ({ x: i, y: 1 }));
    }

    // 1. External Data overrides everything for Price/Change
    if (externalData) {
      return {
        currentPrice: externalData.price,
        change24h: externalData.change,
        chartData
      };
    }

    // 2. Static USDC fallback
    if (isUSDC) {
      return {
        currentPrice: 1.0,
        change24h: 0,
        chartData
      };
    }

    // 3. WETH/ETH Mock Fallback (if on-chain is missing on testnet)
    if ((token.symbol === 'WETH' || token.symbol === 'ETH') && (!priceHistory || priceHistory.length === 0)) {
       // Generate a mock chart roughly around $2650
       const now = Math.floor(Date.now() / 1000) * 1000;
       const mockChart = Array(20).fill(0).map((_, i) => {
          return {
             x: now - (20 - i) * 3600 * 1000, 
             y: 2650 + Math.sin(i) * 50 // moderate fluctuation
          };
       });
       
       return {
         currentPrice: 2650.00, 
         change24h: 2.5,
         chartData: mockChart
       };
    }

    // 4. On-chain History fallback
    if (!priceHistory || priceHistory.length === 0) {
      if (spotPrice > 0) {
         return {
            currentPrice: spotPrice,
            change24h: 0,
            chartData: [] // Flat line or empty
         };
      }
      return {
        currentPrice: 0,
        change24h: 0,
        chartData: []
      };
    }

    const currentPrice = chartData[chartData.length - 1]?.y || 0;
    
    // Calculate 24h change
    const oneDayAgo = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
    const oldPoint = chartData.find(p => p.x >= oneDayAgo) || chartData[0];
    const oldPrice = oldPoint?.y || 0;
    
    const change24h = oldPrice > 0 ? ((currentPrice - oldPrice) / oldPrice) * 100 : 0;

    return {
      currentPrice,
      change24h,
      chartData
    };
  }, [priceHistory, isToken0, isUSDC, externalData, spotPrice]);

  const renderChart = (data: Array<{ x: number; y: number }>, isStable: boolean = false) => {
    if (isStable || data.length < 2) {
      return (
        <svg width="100%" height="40" className="overflow-hidden">
          <line
            x1="0"
            y1="20"
            x2="100%"
            y2="20"
            stroke="currentColor"
            strokeWidth="2"
          />
        </svg>
      );
    }

    const maxY = Math.max(...data.map(d => d.y));
    const minY = Math.min(...data.map(d => d.y));
    const range = maxY - minY || 1;
    
    const points = data.map((point, index) => {
      const x = (index / (data.length - 1)) * 100;
      const y = 40 - ((point.y - minY) / range) * 35;
      return `${x},${y}`;
    }).join(' ');

    return (
      <svg width="100%" height="40" className="overflow-hidden">
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
      </svg>
    );
  };

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };
  
  const isPositive = processedData.change24h >= 0;

  return (
    <div className="flex-1 bg-tokenSelector/5 backdrop-blur-sm rounded-xl p-4 border border-tokenSelector/50">
      <div className="flex items-center space-x-3 mb-3">
        <div className="w-12 h-12 bg-black rounded-lg flex items-center justify-center border border-tokenSelector/50">
          <img 
            src={token.logoURI} 
            alt={token.symbol}
            className="w-8 h-8 rounded"
            onError={(e) => {
              e.currentTarget.src = "/logo.png";
            }}
          />
        </div>
        <div>
          <h3 className="text-white font-bold text-lg">{token.symbol}</h3>
          <p className="text-textSecondary text-sm">{formatAddress(token.address)}</p>
        </div>
      </div>
      
      <div className="mb-3">
        <div className="text-white font-bold text-2xl">
          ${processedData.currentPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
        </div>
        <div className={`${isPositive ? 'text-green-300' : 'text-red-400'} text-sm font-medium`}>
          {isPositive ? '+' : ''}{processedData.change24h.toFixed(2)}%
        </div>
      </div>
      
      <div className={`h-10 ${isPositive ? 'text-green-400/60' : 'text-red-400/60'}`}>
        {renderChart(processedData.chartData, isUSDC || processedData.chartData.length === 0)}
      </div>
    </div>
  );
};

const TokenInfoCards: React.FC<TokenInfoCardsProps> = ({ fromToken, toToken }) => {
  return (
    <div className="flex flex-col lg:flex-row gap-4 w-full lg:w-[600px]">
      {fromToken && <SingleTokenCard token={fromToken} />}
      {toToken && <SingleTokenCard token={toToken} />}
    </div>
  );
};

export default TokenInfoCards;
