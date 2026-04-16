"use client";
import React, { useState } from "react";
import { ITradingPair } from "@/constants/types/dex";
import { useEffect } from "react";
import TokenIcon from "../icons/tokenIcon";
import { useMasterChef } from "@/hooks/dex/useMasterChef";
import { useActiveAccount } from "thirdweb/react";
import { ethers } from "ethers";
import { ChevronDown, ChevronUp, X, HelpCircle, CheckCircle, Flame } from "lucide-react";
import Link from "next/link";
import { ABSTRACT_TOKENS, ABSTRACT_MAINNET_CHAIN_ID } from "@/constants/tokens";
import StakeModal from "../farms/StakeModal";
import { usePoolData } from "@/hooks/dex/usePoolData";
import Loading from "@/components/ui/loading";
import { KLD_ADDRESS, WETH_ADDRESS } from "@/constants/utils/addresses";
import { useEthPrice } from "@/hooks/useEthPrice";
import LiquidityModal from "../modals/LiquidityModal";

interface AllPoolProps {
  viewMode?: 'card' | 'table';
  searchQuery?: string;
}

export default function AllPool({ viewMode = 'card', searchQuery = '' }: AllPoolProps) {
  const { deposit, withdraw, harvest, getPoolLength, getPoolInfo, getUserInfo, getPendingKld, getTotalAllocPoint, getKldPerBlock } = useMasterChef();
  const account = useActiveAccount();
  const { pools: realPools, loading: poolsLoading } = usePoolData();
  const { price: ethPrice } = useEthPrice();
  
  const [farmData, setFarmData] = useState<{ [key: string]: { 
    pid: number;
    farmApr: number; 
    farmMultiplier: string; 
    earnedKLD: string; 
    lpSymbol: string;
    stakedBalance: string;
    rewardDebt: string;
  } }>({});

  // Fetch Farm Data
  useEffect(() => {
    const fetchFarmData = async () => {
      try {
        const length = await getPoolLength();
        const totalAlloc = await getTotalAllocPoint();
        const kldPerBlockStr = await getKldPerBlock();
        const kldPerBlock = parseFloat(kldPerBlockStr);

        const newFarmData: typeof farmData = {};

        for (let pid = 0; pid < length; pid++) {
          const poolInfo = await getPoolInfo(pid);
          if (!poolInfo) continue;

          // Normalize LP address
          const lpAddress = poolInfo.lpToken.toLowerCase();
          
          // Calculate dynamic KLD Price from KLD/WETH pool if available
          let kldPrice = 0.1; // Fallback
          
          const kldWethPool = realPools.find(p => 
            (p.token0.address.toLowerCase() === KLD_ADDRESS.toLowerCase() && p.token1.address.toLowerCase() === WETH_ADDRESS.toLowerCase()) ||
            (p.token0.address.toLowerCase() === WETH_ADDRESS.toLowerCase() && p.token1.address.toLowerCase() === KLD_ADDRESS.toLowerCase())
          );

          if (kldWethPool && ethPrice > 0) {
             if (kldWethPool.token0.address.toLowerCase() === KLD_ADDRESS.toLowerCase()) {
                 // price is Token1(WETH) per Token0(KLD)
                 kldPrice = kldWethPool.price * ethPrice;
             } else {
                 // price is Token1(KLD) per Token0(WETH) -> 1/price is WETH per KLD
                 if (kldWethPool.price > 0) {
                     kldPrice = (1 / kldWethPool.price) * ethPrice;
                 }
             }
          }
          
          // Calculate APR
          // APR = (KLD per Year * KLD Price * Pool Weight) / Pool TVL
          // We need Pool TVL. We can try to find it in `realPools`.
          const poolInList = realPools.find(p => p.address.toLowerCase() === lpAddress);
          let liquidityUSD = 0;
          if (poolInList && poolInList.liquidity) {
             liquidityUSD = parseFloat(String(poolInList.liquidity).replace(/[^0-9.]/g, '')) || 0;
          }

          const poolWeight = poolInfo.allocPoint / (totalAlloc || 1);
          const blocksPerYear = 31536000; // 1s block time
          const kldPerYear = kldPerBlock * blocksPerYear;
          const kldValuePerYear = kldPerYear * kldPrice * poolWeight;
          
          let apr = 0;
          if (liquidityUSD > 0) {
            apr = (kldValuePerYear / liquidityUSD) * 100;
          }

          // Multiplier
          const multiplier = (poolInfo.allocPoint / 100).toFixed(1) + "X";

          // User Info
          let stakedBalance = "0";
          let rewardDebt = "0";
          let earnedKLD = "0";

          if (account) {
            const uInfo = await getUserInfo(pid, account.address);
            stakedBalance = uInfo.amount;
            rewardDebt = uInfo.rewardDebt;
            earnedKLD = await getPendingKld(pid, account.address);
          }
          
          // Find LP Symbol
          // If in pool list, use symbols
          let lpSymbol = "LP Token";
          if (poolInList) {
             lpSymbol = `${poolInList.token0?.symbol}-${poolInList.token1?.symbol} LP`;
          }

          newFarmData[lpAddress] = {
            pid,
            farmApr: apr || 0,
            farmMultiplier: multiplier,
            earnedKLD: parseFloat(earnedKLD).toFixed(4),
            lpSymbol,
            stakedBalance,
            rewardDebt
          };
        }
        setFarmData(newFarmData);
      } catch (e) {
        console.error("Error fetching farm data:", e);
      }
    };

    fetchFarmData();
    const interval = setInterval(fetchFarmData, 10000); // Storage update every 10s
    return () => clearInterval(interval);
  }, [getPoolLength, getPoolInfo, getUserInfo, getPendingKld, getTotalAllocPoint, getKldPerBlock, account, realPools, ethPrice]);

  const getUserPosition = (poolAddress: string) => {
    const data = farmData[poolAddress.toLowerCase()];
    if (!data) return {
      stakedBalance: "0",
      pointsEarnedFormatted: "0",
      unclaimedPointsFormatted: "0",
      earnings: "0"
    };
    return {
      stakedBalance: data.stakedBalance,
      stakedBalanceFormatted: parseFloat(data.stakedBalance).toFixed(4),
      pointsEarnedFormatted: "0", // Points system separate? Keeping 0 for now as 'points' usually implies non-token
      unclaimedPointsFormatted: "0", 
      earnings: data.earnedKLD, // This is KLD
      // If modal needs separate 'earnedKLD' key, it is passed via prop 'earnedKLD' too.
    };
  };
  
  const [isStakingMap, setIsStakingMap] = useState<{ [key: string]: boolean }>({});
  const [isUnstakingMap, setIsUnstakingMap] = useState<{ [key: string]: boolean }>({});

  const stake = async (poolAddress: string, amount: string) => {
    const data = farmData[poolAddress.toLowerCase()];
    if (!data) return;
    setIsStakingMap(prev => ({ ...prev, [poolAddress]: true }));
    try {
       await deposit(data.pid, amount);
       // Refresh data?
    } catch (e) {
       console.error("Stake failed", e);
    } finally {
       setIsStakingMap(prev => ({ ...prev, [poolAddress]: false }));
    }
  };
  
  const unstake = async (poolAddress: string, amount: string) => {
    const data = farmData[poolAddress.toLowerCase()];
    if (!data) return;
    setIsUnstakingMap(prev => ({ ...prev, [poolAddress]: true }));
    try {
      await withdraw(data.pid, amount);
    } catch (e) {
      console.error("Unstake failed", e);
    } finally {
      setIsUnstakingMap(prev => ({ ...prev, [poolAddress]: false }));
    }
  };
  
  const claimPoints = (poolAddress: string) => {
    console.log(`Claiming points from pool ${poolAddress}`);
    // Not implemented in MasterChef directly (Points usually offchain or different contract)
  };

  const handleHarvest = async (poolAddress: string) => {
    const data = farmData[poolAddress.toLowerCase()];
    if (!data) return;
    
    setIsHarvesting(prev => ({ ...prev, [poolAddress]: true }));
    try {
      await harvest(data.pid);
      console.log(`Harvested KLD from pool ${poolAddress}`);
    } catch (error) {
      console.error('Harvest failed:', error);
    } finally {
      setIsHarvesting(prev => ({ ...prev, [poolAddress]: false }));
    }
  };
  
  const isStaking = isStakingMap;
  const isUnstaking = isUnstakingMap;
  const isClaiming = { [""]: false } as { [key: string]: boolean };
  const [expandedPools, setExpandedPools] = useState<{ [key: string]: boolean }>({});
  const [showAPYDisclaimer, setShowAPYDisclaimer] = useState(false);
  const [hoveredAPR, setHoveredAPR] = useState<string | null>(null);
  const [hoveredMultiplier, setHoveredMultiplier] = useState<string | null>(null);
  const [stakeModalOpen, setStakeModalOpen] = useState<{ [key: string]: boolean }>({});
  
  // Farm functionality
  const [isHarvesting, setIsHarvesting] = useState<{ [key: string]: boolean }>({});

  const [liquidityModalOpen, setLiquidityModalOpen] = useState(false);
  const [selectedPool, setSelectedPool] = useState<ITradingPair | null>(null);

  const openLiquidityModal = (pair: ITradingPair) => {
    setSelectedPool(pair);
    setLiquidityModalOpen(true);
  };

  // Filter pools based on search query
  const filteredPools = React.useMemo(() => {
    const poolsToFilter = realPools;
    
    if (!searchQuery.trim()) return poolsToFilter;
    
    const query = searchQuery.toLowerCase().trim();
    
    return poolsToFilter.filter(pool => {
      const token0Symbol = pool.token0?.symbol?.toLowerCase() || '';
      const token1Symbol = pool.token1?.symbol?.toLowerCase() || '';
      const pairName = `${token0Symbol}/${token1Symbol}`;
      const reversePairName = `${token1Symbol}/${token0Symbol}`;
      
      // Check if query matches any part of the pair
      const matches = 
        token0Symbol.includes(query) || 
        token1Symbol.includes(query) || 
        pairName.includes(query) || 
        reversePairName.includes(query);
      
      return matches;
    });
  }, [searchQuery, realPools]);



  // Only specific pools have farm features - these are the featured farming pools
  const featuredFarmPools = [
    "0x8286b07adc7833ffD2Afa430AA208e57B23401a3", // USDC-WETH - Actual LP Address on Abstract Testnet (PID 0)
    "0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640", // Placeholder for another pool if needed
  ];

  // Mock farm data for featured pools only
  // Get Farm Data from state
  const getFarmData = (poolAddress: string) => {
     const data = farmData[poolAddress.toLowerCase()];
     if (!data) return null;
     
     return {
        farmApr: data.farmApr,
        farmMultiplier: data.farmMultiplier,
        earnedKLD: data.earnedKLD,
        lpSymbol: data.lpSymbol,
        isFeatured: true // All added pools are featured implicitly? Or check featured list
     };
  };

  // Get pool labels for normal pools
  const getPoolLabels = (pair: ITradingPair) => {
    const labels = [];
    
    if (pair.stable) {
      labels.push({ text: 'Stable', color: 'bg-blue-500/20 text-blue-400' });
    }
    
    // Check if it's a new pool (created within last 7 days)
    const currentTime = Math.floor(Date.now() / 1000);
    const sevenDaysAgo = currentTime - (7 * 24 * 60 * 60);
    const isNewPool = pair.createdAt && pair.createdAt > sevenDaysAgo;
    
    if (isNewPool) {
      labels.push({ text: 'New', color: 'bg-purple-500/20 text-purple-400' });
    }
    
    // Check if it's high liquidity (over $10M)
    const isHighLiquidity = (pair.liquidity || 0) > 10000000;
    
    if (isHighLiquidity) {
      labels.push({ 
        text: '', 
        color: 'bg-green-500/20 text-green-400',
        icon: <Flame size={16} className="text-green-400" />
      });
    }
    
    return labels;
  };

  const togglePoolExpansion = (poolAddress: string) => {
    setExpandedPools(prev => ({
      ...prev,
      [poolAddress]: !prev[poolAddress]
    }));
  };

  const openStakeModal = (poolAddress: string) => {
    setStakeModalOpen(prev => ({
      ...prev,
      [poolAddress]: true
    }));
  };

  const closeStakeModal = (poolAddress: string) => {
    setStakeModalOpen(prev => ({
      ...prev,
      [poolAddress]: false
    }));
  };

  if (poolsLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loading />
      </div>
    );
  }

  return (
    <div>
      {viewMode === 'table' ? (
        <div className="bg-board/80 backdrop-blur-sm w-full rounded-xl min-h-44 border border-borderline/60 overflow-auto relative">
        {/* Subtle overlay for transparency effect with faint green tint */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#00ff99]/5 via-transparent to-[#00ff99]/10 pointer-events-none"></div>
        
        {/* Desktop Header - hidden on mobile */}
            <div className="hidden lg:grid grid-cols-7 gap-4 p-5 text-sm relative z-10">
          <p className="text-start">Pool</p>
              <p className="text-end">Liquidity(TVL)</p>
          <p className="text-end">APR</p>
              <p className="text-end">Multiplier</p>
          <p className="text-end">Volume(24h)</p>
          <p className="text-end">Fees</p>
              <p className="text-end">Action</p>
        </div>
        {/* Desktop Header separator - hidden on mobile */}
        <div className="hidden lg:block border-b border-borderline/60 w-full relative z-10" />
        {/* Pool rows */}
        <div className="flex flex-col relative z-10">
          {filteredPools.map((pair, index) => (
            <div key={pair.address}>
              {/* Desktop Layout */}
              <Link
                  href={`/pool/poolinfo/${pair.address}?tokenA=${pair.token0?.address || ''}&tokenB=${pair.token1?.address || ''}&symbolA=${pair.token0?.symbol || ''}&symbolB=${pair.token1?.symbol || ''}`}
                  className="hidden lg:grid grid-cols-7 gap-4 p-5 items-center text-sm cursor-pointer hover:bg-borderline/60 transition-all duration-200 border border-borderline/20 rounded-lg"
              >
                  {/* Pool column - keep left aligned */}
                  <div className="flex flex-row items-center text-start">
                    <div className="flex flex-row relative">
                      <TokenIcon
                        size="sm"
                        variant="minimal"
                        address={pair.token0?.address || ''}
                        chainId={ABSTRACT_MAINNET_CHAIN_ID}
                        name={pair.token0?.name || ''}
                        symbol={pair.token0?.symbol || ''}
                        decimals={pair.token0?.decimals || 18}
                        verified={pair.token0?.verified || false}
                        logoURI={pair.token0?.logoURI || ''}
                      />
                      <div className="absolute left-4 z-10">
                        <TokenIcon
                          size="sm"
                          variant="minimal"
                          address={pair.token1?.address || ''}
                          chainId={ABSTRACT_MAINNET_CHAIN_ID}
                          name={pair.token1?.name || ''}
                          symbol={pair.token1?.symbol || ''}
                          decimals={pair.token1?.decimals || 18}
                          verified={pair.token1?.verified || false}
                          logoURI={pair.token1?.logoURI || ''}
                        />
                      </div>
                    </div>
                    <div className="ml-6">
                          <div className="flex items-center space-x-2">
                      <span className="font-medium text-sm">
                              {pair.token0?.symbol || 'Unknown'}/{pair.token1?.symbol || 'Unknown'}
                            </span>
                            {getFarmData(pair.address) ? (
                              <>
                                <span className="bg-green-500/20 text-green-400 px-2 py-1 rounded text-xs font-medium">
                                  Farm
                                </span>
                                <CheckCircle size={16} className="text-yellow-400" />
                              </>
                            ) : (
                              getPoolLabels(pair).map((label, index) => (
                                <span key={index} className={`${label.color} ${label.text ? 'px-2 py-1' : 'p-1'} rounded text-xs font-medium flex items-center gap-1`}>
                                  {label.icon && label.icon}
                                  {label.text}
                      </span>
                              ))
                            )}
                          </div>
                    </div>
                  </div>
                  {/* Other columns - right aligned */}
                  <p className="truncate text-end">${pair.liquidity}</p>
                  <div className="text-end text-green-400 flex items-center justify-end gap-1 relative">
                    {pair.apr}%
                    <div
                      className="relative"
                      onMouseEnter={() => setHoveredAPR(pair.address)}
                      onMouseLeave={() => setHoveredAPR(null)}
                    >
                      <HelpCircle className="w-3 h-3 cursor-help" />
                      {hoveredAPR === pair.address && (
                        <div className="absolute bottom-full right-0 mb-2 w-48 bg-[#2a2a2a] text-white text-xs rounded-lg p-3 shadow-lg z-50">
                          <div className="space-y-1">
                            <div className="font-medium">Farm APR: {((pair.apr || 0) * 0.95).toFixed(2)}%</div>
                            <div className="font-medium">Trading Fee APR: {((pair.apr || 0) * 0.05).toFixed(2)}%</div>
                          </div>
                          <div className="absolute top-full right-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-800"></div>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="text-end text-orange-400 flex items-center justify-end gap-1 relative">
                    ×{2.0 + (index * 0.5)}
                    <div
                      className="relative"
                      onMouseEnter={() => setHoveredMultiplier(pair.address)}
                      onMouseLeave={() => setHoveredMultiplier(null)}
                    >
                      <HelpCircle className="w-3 h-3 cursor-help" />
                      {hoveredMultiplier === pair.address && (
                        <div className="absolute bottom-full right-0 mb-2 w-48 bg-[#2a2a2a] text-white text-xs rounded-lg p-3 shadow-lg z-50">
                          <div className="space-y-1">
                            <div className="font-medium">Points Multiplier: ×{2.0 + (index * 0.5)}</div>
                            <div>This pool offers a {2.0 + (index * 0.5)}x multiplier for staking LP tokens. You&apos;ll earn {(2.0 + (index * 0.5))}x more points compared to the base rate.</div>
                          </div>
                          <div className="absolute top-full right-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-800"></div>
                        </div>
                      )}
                    </div>
                  </div>
                   <p className="truncate text-end">${pair.volume24h}</p>
                   <p className="truncate text-end">${pair.fees24h}</p>
                  <div className="flex items-center justify-end space-x-2">
                    {/* Deposit button for all pools */}
                    <button 
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        openLiquidityModal(pair);
                      }}
                      className="px-3 py-1 bg-[#2a2a2a] hover:bg-[#363636] text-white text-sm rounded transition-colors"
                    >
                      Deposit
                    </button>
                    
                    {/* Stake button only for featured pools */}
                    {getFarmData(pair.address) && (
                      <button 
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          openStakeModal(pair.address);
                        }}
                        className="px-3 py-1 bg-green-500 hover:bg-green-600 text-white text-sm rounded transition-colors"
                      >
                        Stake
                      </button>
                    )}
                </div>
              </Link>
              
              
              {/* Mobile Layout */}
              <Link
                  href={`/pool/poolinfo/${pair.address}?tokenA=${pair.token0?.address || ''}&tokenB=${pair.token1?.address || ''}&symbolA=${pair.token0?.symbol || ''}&symbolB=${pair.token1?.symbol || ''}`}
                  className="lg:hidden p-4 hover:bg-borderline/60 transition-all duration-200 border border-borderline/20 rounded-lg block"
              >
                  <div className="flex flex-col space-y-3">
                    {/* Pool info */}
                    <div className="flex flex-row items-center">
                      <div className="flex flex-row relative">
                        <TokenIcon
                          size="sm"
                          variant="minimal"
                          address={pair.token0?.address || ''}
                          chainId={ABSTRACT_MAINNET_CHAIN_ID}
                          name={pair.token0?.name || ''}
                          symbol={pair.token0?.symbol || ''}
                          decimals={pair.token0?.decimals || 18}
                          verified={pair.token0?.verified || false}
                          logoURI={pair.token0?.logoURI || ''}
                        />
                        <div className="absolute left-4 z-10">
                          <TokenIcon
                            size="sm"
                            variant="minimal"
                            address={pair.token1?.address || ''}
                            chainId={ABSTRACT_MAINNET_CHAIN_ID}
                            name={pair.token1?.name || ''}
                            symbol={pair.token1?.symbol || ''}
                            decimals={pair.token1?.decimals || 18}
                            verified={pair.token1?.verified || false}
                            logoURI={pair.token1?.logoURI || ''}
                          />
                        </div>
                      </div>
                      <div className="ml-6">
                          <div className="flex items-center space-x-2">
                        <span className="font-medium text-base">
                              {pair.token0?.symbol || 'Unknown'}/{pair.token1?.symbol || 'Unknown'}
                            </span>
                            {getFarmData(pair.address) ? (
                              <>
                                <span className="bg-green-500/20 text-green-400 px-2 py-1 rounded text-xs font-medium">
                                  Farm
                                </span>
                                <CheckCircle size={16} className="text-yellow-400" />
                              </>
                            ) : (
                              getPoolLabels(pair).map((label, index) => (
                                <span key={index} className={`${label.color} ${label.text ? 'px-2 py-1' : 'p-1'} rounded text-xs font-medium flex items-center gap-1`}>
                                  {label.icon && label.icon}
                                  {label.text}
                        </span>
                              ))
                            )}
                          </div>
                      </div>
                    </div>
                    {/* Mobile data grid - shows on mobile and small screens */}
                    <div className="grid grid-cols-2 gap-3 text-sm">
                       <div>
                        <p className="text-gray-400 text-xs">Liquidity (TVL)</p>
                        <p className="font-medium">${pair.liquidity}</p>
                      </div>
                      <div>
                        <p className="text-gray-400 text-xs">APR</p>
                        <div className="font-medium text-green-400 flex items-center gap-1 relative">
                          {pair.apr}%
                          <div
                            className="relative"
                            onMouseEnter={() => setHoveredAPR(pair.address)}
                            onMouseLeave={() => setHoveredAPR(null)}
                          >
                            <HelpCircle className="w-3 h-3 cursor-help" />
                            {hoveredAPR === pair.address && (
                              <div className="absolute bottom-full right-0 mb-2 w-48 bg-[#2a2a2a] text-white text-xs rounded-lg p-3 shadow-lg z-50">
                                <div className="space-y-1">
                                  <div className="font-medium">Farm APR: {((pair.apr || 0) * 0.95).toFixed(2)}%</div>
                                  <div className="font-medium">Trading Fee APR: {((pair.apr || 0) * 0.05).toFixed(2)}%</div>
                                </div>
                                <div className="absolute top-full right-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-800"></div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      <div>
                        <p className="text-gray-400 text-xs">Multiplier</p>
                        <div className="font-medium text-orange-400 flex items-center gap-1 relative">
                          ×{2.0 + (index * 0.5)}
                          <div
                            className="relative"
                            onMouseEnter={() => setHoveredMultiplier(pair.address)}
                            onMouseLeave={() => setHoveredMultiplier(null)}
                          >
                            <HelpCircle className="w-3 h-3 cursor-help" />
                            {hoveredMultiplier === pair.address && (
                              <div className="absolute bottom-full right-0 mb-2 w-48 bg-[#2a2a2a] text-white text-xs rounded-lg p-3 shadow-lg z-50">
                                <div className="space-y-1">
                                  <div className="font-medium">Points Multiplier: ×{2.0 + (index * 0.5)}</div>
                                  <div>This pool offers a {2.0 + (index * 0.5)}x multiplier for staking LP tokens. You&apos;ll earn {(2.0 + (index * 0.5))}x more points compared to the base rate.</div>
                                </div>
                                <div className="absolute top-full right-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-800"></div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                       <div>
                        <p className="text-gray-400 text-xs">Volume (24h)</p>
                        <p className="font-medium">${pair.volume24h}</p>
                      </div>
                      <div>
                        <p className="text-gray-400 text-xs">Fees (24h)</p>
                        <p className="font-medium">${pair.fees24h}</p>
                      </div>
                    </div>
                  </div>
                </Link>

            </div>
          ))}
        </div>
      </div>
      ) : (
        /* Card Layout */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredPools.map((pair, index) => (
            <Link
              key={pair.address}
              href={`/pool/poolinfo/${pair.address}?tokenA=${pair.token0?.address || ''}&tokenB=${pair.token1?.address || ''}&symbolA=${pair.token0?.symbol || ''}&symbolB=${pair.token1?.symbol || ''}`}
              className="bg-board/80 backdrop-blur-sm rounded-xl border border-borderline/60 p-6 hover:border-borderline/80 transition-all duration-200 block"
            >
              {/* Card Header */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-3">
                  <div className="flex -space-x-2">
                    <TokenIcon
                      size="md"
                      variant="minimal"
                      address={pair.token0?.address || ''}
                      chainId={ABSTRACT_MAINNET_CHAIN_ID}
                      name={pair.token0?.name || ''}
                      symbol={pair.token0?.symbol || ''}
                      decimals={pair.token0?.decimals || 18}
                      verified={pair.token0?.verified || false}
                      logoURI={pair.token0?.logoURI || ''}
                    />
                    <TokenIcon
                      size="md"
                      variant="minimal"
                      address={pair.token1?.address || ''}
                      chainId={ABSTRACT_MAINNET_CHAIN_ID}
                      name={pair.token1?.name || ''}
                      symbol={pair.token1?.symbol || ''}
                      decimals={pair.token1?.decimals || 18}
                      verified={pair.token1?.verified || false}
                      logoURI={pair.token1?.logoURI || ''}
                    />
                      </div>
                      <div>
                    <h3 className="font-semibold text-white">
                      {pair.token0?.symbol || 'Unknown'}/{pair.token1?.symbol || 'Unknown'}
                    </h3>
                    <div className="flex items-center space-x-2 mt-1">
                      {getFarmData(pair.address) ? (
                        <>
                          <span className="bg-green-500/20 text-green-400 px-2 py-1 rounded text-xs font-medium">
                            Farm
                          </span>
                          <CheckCircle size={16} className="text-yellow-400" />
                        </>
                      ) : (
                        getPoolLabels(pair).map((label, labelIndex) => (
                          <span key={labelIndex} className={`${label.color} ${label.text ? 'px-2 py-1' : 'p-1'} rounded text-xs font-medium flex items-center gap-1`}>
                            {label.icon && label.icon}
                            {label.text}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Card Stats */}
              <div className="space-y-3 mb-6">
                 <div className="flex justify-between items-center">
                  <span className="text-gray-400 text-sm">Liquidity(TVL)</span>
                  <span className="text-white font-medium">${pair.liquidity}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400 text-sm">APR</span>
                  <div className="flex items-center gap-1">
                    <span className="text-green-400 font-medium">{pair.apr}%</span>
                    <div
                      className="relative"
                      onMouseEnter={() => setHoveredAPR(pair.address)}
                      onMouseLeave={() => setHoveredAPR(null)}
                    >
                      <HelpCircle className="w-3 h-3 cursor-help" />
                      {hoveredAPR === pair.address && (
                        <div className="absolute bottom-full right-0 mb-2 w-48 bg-[#2a2a2a] text-white text-xs rounded-lg p-3 shadow-lg z-50">
                          <div className="space-y-1">
                            <div className="font-medium">Farm APR: {((pair.apr || 0) * 0.95).toFixed(2)}%</div>
                            <div className="font-medium">Trading Fee APR: {((pair.apr || 0) * 0.05).toFixed(2)}%</div>
                          </div>
                          <div className="absolute top-full right-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-800"></div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400 text-sm">Multiplier</span>
                  <div className="flex items-center gap-1">
                    <span className="text-orange-400 font-medium">×{2.0 + (index * 0.5)}</span>
                    <div
                      className="relative"
                      onMouseEnter={() => setHoveredMultiplier(pair.address)}
                      onMouseLeave={() => setHoveredMultiplier(null)}
                    >
                      <HelpCircle className="w-3 h-3 cursor-help" />
                      {hoveredMultiplier === pair.address && (
                        <div className="absolute bottom-full right-0 mb-2 w-48 bg-[#2a2a2a] text-white text-xs rounded-lg p-3 shadow-lg z-50">
                          <div className="space-y-1">
                            <div className="font-medium">Points Multiplier: ×{2.0 + (index * 0.5)}</div>
                            <div>This pool offers a {2.0 + (index * 0.5)}x multiplier for staking LP tokens. You&apos;ll earn {(2.0 + (index * 0.5))}x more points compared to the base rate.</div>
                          </div>
                          <div className="absolute top-full right-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-800"></div>
                      </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400 text-sm">Volume (24h)</span>
                  <span className="text-white font-medium">${pair.volume24h}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400 text-sm">Fees (24h)</span>
                  <span className="text-white font-medium">${pair.fees24h}</span>
                  </div>
                </div>

              {/* Card Actions */}
              <div className="flex space-x-2">
                <button 
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openLiquidityModal(pair);
                  }}
                  className="flex-1 px-4 py-2 bg-[#2a2a2a] hover:bg-[#363636] text-white text-sm rounded transition-colors"
                >
                  Deposit
                </button>
                {getFarmData(pair.address) && (
                  <button 
                    onClick={() => openStakeModal(pair.address)}
                    className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white text-sm rounded transition-colors"
                  >
                    Stake
                  </button>
                )}
              </div>

            </Link>
          ))}
        </div>
      )}

      {/* Liquidity Modal */}
      {selectedPool && (
        <LiquidityModal
          isOpen={liquidityModalOpen}
          onClose={() => setLiquidityModalOpen(false)}
          tokenA={selectedPool.token0?.address || ""}
          tokenB={selectedPool.token1?.address || ""}
        />
      )}

      {/* Stake Modals - Outside card structure for proper positioning */}
      {filteredPools.map((pair) => (
        getFarmData(pair.address) && (
          <StakeModal
            key={`modal-${pair.address}`}
            isOpen={stakeModalOpen[pair.address] || false}
            onClose={() => closeStakeModal(pair.address)}
            poolAddress={pair.address}
            pair={{
              token0: pair.token0,
              token1: pair.token1,
            }}
            userPosition={getUserPosition(pair.address)}
            onStake={stake}
            onUnstake={unstake}
            onClaim={claimPoints}
            onHarvest={handleHarvest}
            isStaking={isStaking[pair.address] || false}
            isUnstaking={isUnstaking[pair.address] || false}
            isClaiming={isClaiming[pair.address] || false}
            isHarvesting={isHarvesting[pair.address] || false}
            farmApr={getFarmData(pair.address)?.farmApr}
            farmMultiplier={getFarmData(pair.address)?.farmMultiplier}
            earnedKLD={getFarmData(pair.address)?.earnedKLD}
            lpSymbol={getFarmData(pair.address)?.lpSymbol}
          />
        )
      ))}

      {/* APY Disclaimer Modal */}
      {showAPYDisclaimer && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md mx-4 relative">
            <button
              onClick={() => setShowAPYDisclaimer(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
            >
              <X className="w-5 h-5" />
            </button>
            
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Combined APR: <span className="text-purple-600 font-bold">30.73%</span>
              </h3>
              <div className="text-sm text-gray-600 mb-2">
                • LP Fee APR: <span className="font-bold">30.73%</span>
              </div>
            </div>
            
            <div className="text-sm text-gray-600 space-y-2">
              <p>
                APRs are calculated using the total liquidity in the pool versus the total reward amount. 
                Actual APRs may be higher as some liquidity is not staked or in-range.
              </p>
              <p>
                APRs for individual positions may vary based on your specific liquidity range and market conditions.
              </p>
              <p className="text-xs text-gray-500 mt-3">
                <strong>Note:</strong> APR (Annual Percentage Rate) represents the simple interest rate, 
                while APY (Annual Percentage Yield) includes compound interest effects. 
                The displayed rates are APR unless otherwise specified.
              </p>
            </div>
        </div>
      </div>
      )}
    </div>
  );
}