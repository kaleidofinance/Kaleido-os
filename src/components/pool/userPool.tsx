"use client";
import Button from "@/components/shared/Button";
import Link from "next/link";
import React, { useState } from "react";
import TokenIcon from "../icons/tokenIcon";
import PointsDisplay from "../staking/PointsDisplay";
import StakeModal from "../farms/StakeModal";
import { X, CheckCircle, Flame } from "lucide-react";
import { ILiquidityPosition } from "@/constants/types/dex";
import { ABSTRACT_TOKENS, ABSTRACT_MAINNET_CHAIN_ID } from "@/constants/tokens";
import { useUserPoolData } from "@/hooks/dex/useUserPoolData";
import Loading from "@/components/ui/loading";
import LiquidityModal from "../modals/LiquidityModal";



interface UserPoolProps {
  viewMode?: 'card' | 'table';
  searchQuery?: string;
}

export default function UserPool({ viewMode = 'card', searchQuery = '' }: UserPoolProps) {
  const { userPositions: realPositions, loading: positionsLoading } = useUserPoolData();
  
  // Mock points data for demonstration
  const totalPoints = "125000"; // 125K points
  const unclaimedPoints = "5000"; // 5K unclaimed points
  const multiplier = 2.5;
  const [showAPYDisclaimer, setShowAPYDisclaimer] = useState(false);
  
  const [expandedPools, setExpandedPools] = useState<{ [key: string]: boolean }>({});
  const [stakeModalOpen, setStakeModalOpen] = useState<{ [key: string]: boolean }>({});
  
  // Farm functionality
  const [isHarvesting, setIsHarvesting] = useState<{ [key: string]: boolean }>({});

  const [liquidityModalOpen, setLiquidityModalOpen] = useState(false);
  const [selectedPool, setSelectedPool] = useState<any | null>(null);

  const openLiquidityModal = (pair: any) => {
    setSelectedPool(pair);
    setLiquidityModalOpen(true);
  };

  // Filter pools based on search query
  const filteredPools = React.useMemo(() => {
    const positionsToFilter = realPositions;
    
    if (!searchQuery.trim()) return positionsToFilter;
    
    const query = searchQuery.toLowerCase().trim();
    
    return positionsToFilter.filter(position => {
      const token0Symbol = position.pair.token0?.symbol?.toLowerCase() || '';
      const token1Symbol = position.pair.token1?.symbol?.toLowerCase() || '';
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
  }, [searchQuery, realPositions]);

  const handleHarvest = async (poolAddress: string) => {
    setIsHarvesting(prev => ({ ...prev, [poolAddress]: true }));
    try {
      // Simulate harvest transaction
      await new Promise(resolve => setTimeout(resolve, 2000));
      console.log(`Harvesting KLD rewards from pool ${poolAddress}`);
      // In real implementation, call farm contract here
    } catch (error) {
      console.error('Harvest failed:', error);
    } finally {
      setIsHarvesting(prev => ({ ...prev, [poolAddress]: false }));
    }
  };

  // Only specific pools have farm features - these are the featured farming pools
  const featuredFarmPools = [
    "0x742d35Cc6663C0532e2a33Ac5D2C1DCEfA57d7B8", // WETH-USDC - Featured for farming
    "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640", // USDC-USDT - Featured for farming
  ];

  // Mock farm data for featured pools only
  const getFarmData = (poolAddress: string) => {
    // Check if this pool is featured for farming
    if (!featuredFarmPools.includes(poolAddress)) {
      return null; // No farm data for non-featured pools
    }

    const farmData: { [key: string]: { farmApr: number; farmMultiplier: string; earnedKLD: string; lpSymbol: string; isFeatured: boolean } } = {
      "0x742d35Cc6663C0532e2a33Ac5D2C1DCEfA57d7B8": {
        farmApr: 45.2,
        farmMultiplier: "15X",
        earnedKLD: "12.5",
        lpSymbol: "WETH-USDC LP",
        isFeatured: true
      },
      "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640": {
        farmApr: 38.7,
        farmMultiplier: "25X",
        earnedKLD: "8.3",
        lpSymbol: "USDC-USDT LP",
        isFeatured: true
      }
    };
    return farmData[poolAddress] || null;
  };

  // Get pool labels for normal pools
  const getPoolLabels = (pair: any) => {
    const labels = [];
    
    // Check if it's a stablecoin pair
    const stablecoins = ['USDC', 'USDT', 'DAI', 'BUSD', 'FRAX'];
    const isStablePair = stablecoins.includes(pair.token0?.symbol || '') && 
                        stablecoins.includes(pair.token1?.symbol || '');
    
    if (isStablePair) {
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
    const isHighLiquidity = pair.liquidity && pair.liquidity > 10000000;
    
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

  if (positionsLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loading />
      </div>
    );
  }

  return (
    <div className="text-white  flex flex-col space-y-8 w-full">
      {/* Points Display */}
      <PointsDisplay
        totalPoints={totalPoints}
        unclaimedPoints={unclaimedPoints}
        multiplier={multiplier}
      />

      {/* User Liquidity Positions */}
      {viewMode === 'table' ? (
        <div className="bg-board/80 backdrop-blur-sm w-full rounded-xl min-h-44 border border-borderline/60 overflow-auto relative">
        {/* Subtle overlay for transparency effect with faint green tint */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#00ff99]/5 via-transparent to-[#00ff99]/10 pointer-events-none"></div>
        
          {/* Desktop Header - hidden on mobile */}
          <div className="hidden lg:grid grid-cols-6 gap-4 p-5 text-sm relative z-10">
          <p className="text-start">Pool</p>
          <p className="text-end">Your Liquidity</p>
          <p className="text-end">Your Share</p>
          <p className="text-end">Unclaimed Fees</p>
          <p className="text-end">Total Value</p>
          <p className="text-end">Action</p>
          </div>
          {/* Desktop Header separator - hidden on mobile */}
        <div className="hidden lg:block border-b border-borderline/60 w-full relative z-10" />
          {/* Pool rows */}
          <div className="flex flex-col relative z-10">
          {filteredPools.map((pair) => (
              <div key={pair.pairAddress}>
                {/* Desktop Layout */}
                <Link
                  href={`/pool/pair/${pair.pairAddress}?tokenA=${pair.pair.token0?.address || ''}&tokenB=${pair.pair.token1?.address || ''}&symbolA=${pair.pair.token0?.symbol || ''}&symbolB=${pair.pair.token1?.symbol || ''}`}
                  className="hidden lg:grid grid-cols-6 gap-4 p-5 items-center text-sm cursor-pointer hover:bg-borderline border border-borderline/20 rounded-lg"
                >
                    {/* Pool column - keep left aligned */}
                    <div className="flex flex-row items-center text-start">
                      <div className="flex flex-row relative">
                        <TokenIcon
                          size="sm"
                          variant="minimal"
                          address={pair.pair.address}
                        chainId={ABSTRACT_MAINNET_CHAIN_ID}
                        name={pair.pair.token0?.name || ''}
                        symbol={pair.pair.token0?.symbol || ''}
                        decimals={pair.pair.token0?.decimals || 18}
                        verified={pair.pair.token0?.verified || false}
                        logoURI={pair.pair.token0?.logoURI || ''}
                        />
                        <div className="absolute left-4 z-10">
                          <TokenIcon
                            size="sm"
                            variant="minimal"
                          address={pair.pair.token1?.address || ''}
                          chainId={ABSTRACT_MAINNET_CHAIN_ID}
                          name={pair.pair.token1?.name || ''}
                          symbol={pair.pair.token1?.symbol || ''}
                          decimals={pair.pair.token1?.decimals || 18}
                          verified={pair.pair.token1?.verified || false}
                          logoURI={pair.pair.token1?.logoURI || ''}
                          />
                        </div>
                      </div>
                      <div className="ml-6">
                        <div className="flex items-center space-x-2">
                          <span className="font-medium text-sm">
                            {pair.pair.token0?.symbol || 'Unknown'}/{pair.pair.token1?.symbol || 'Unknown'}
                          </span>
                          {getFarmData(pair.pairAddress) ? (
                            <>
                              <span className="bg-green-500/20 text-green-400 px-2 py-1 rounded text-xs font-medium">
                                Farm
                              </span>
                              <CheckCircle size={16} className="text-yellow-400" />
                            </>
                          ) : (
                            getPoolLabels(pair.pair).map((label, index) => (
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
                  <p className="truncate text-end">{pair.lpTokenBalanceFormatted}</p>
                  <p className="truncate text-end">{pair.shareOfPool}%</p>
                  <p className="truncate text-end">${pair.unclaimedFees.toFixed(2)}</p>
                  <p className="truncate text-end">${pair.totalValue.toFixed(2)}</p>
                  <div className="text-end flex items-center justify-end gap-2">
                    {/* Claim button - now opens Manage Liquidity modal */}
                    <button 
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        openLiquidityModal(pair.pair);
                      }}
                      className="px-3 py-1 bg-[#2a2a2a] hover:bg-[#363636] text-white text-sm rounded transition-colors"
                    >
                      Manage
                    </button>
                    
                    {/* Stake button only for featured pools */}
                    {getFarmData(pair.pairAddress) && (
                      <button 
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          openStakeModal(pair.pairAddress);
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
                  href={`/pool/pair/${pair.pairAddress}?tokenA=${pair.pair.token0?.address || ''}&tokenB=${pair.pair.token1?.address || ''}&symbolA=${pair.pair.token0?.symbol || ''}&symbolB=${pair.pair.token1?.symbol || ''}`}
                  className="lg:hidden p-4 hover:bg-borderline/60 transition-all duration-200 border border-borderline/20 rounded-lg block"
                >
                    <div className="flex flex-col space-y-3">
                      {/* Pool info */}
                      <div className="flex flex-row items-center">
                        <div className="flex flex-row relative">
                          <TokenIcon
                            size="sm"
                            variant="minimal"
                            address={pair.pair.address}
                          chainId={ABSTRACT_MAINNET_CHAIN_ID}
                          name={pair.pair.token0?.name || ''}
                          symbol={pair.pair.token0?.symbol || ''}
                          decimals={pair.pair.token0?.decimals || 18}
                          verified={pair.pair.token0?.verified || false}
                          logoURI={pair.pair.token0?.logoURI || ''}
                          />
                          <div className="absolute left-4 z-10">
                            <TokenIcon
                              size="sm"
                              variant="minimal"
                            address={pair.pair.token1?.address || ''}
                            chainId={ABSTRACT_MAINNET_CHAIN_ID}
                            name={pair.pair.token1?.name || ''}
                            symbol={pair.pair.token1?.symbol || ''}
                            decimals={pair.pair.token1?.decimals || 18}
                            verified={pair.pair.token1?.verified || false}
                            logoURI={pair.pair.token1?.logoURI || ''}
                            />
                          </div>
                        </div>
                        <div className="ml-6">
                          <div className="flex items-center space-x-2">
                            <span className="font-medium text-base">
                              {pair.pair.token0?.symbol || 'Unknown'}/{pair.pair.token1?.symbol || 'Unknown'}
                            </span>
                          {getFarmData(pair.pairAddress) ? (
                            <>
                              <span className="bg-green-500/20 text-green-400 px-2 py-1 rounded text-xs font-medium">
                                Farm
                              </span>
                              <CheckCircle size={16} className="text-yellow-400" />
                            </>
                          ) : (
                            getPoolLabels(pair.pair).map((label, index) => (
                              <span key={index} className={`${label.color} ${label.text ? 'px-2 py-1' : 'p-1'} rounded text-xs font-medium flex items-center gap-1`}>
                                {label.icon && label.icon}
                                {label.text}
                              </span>
                            ))
                          )}
                          </div>
                        </div>
                    </div>
                    
                    {/* Stats grid */}
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-gray-400 text-xs">Your Liquidity</p>
                        <p className="font-medium">{pair.lpTokenBalanceFormatted}</p>
                      </div>
                        <div>
                        <p className="text-gray-400 text-xs">Your Share</p>
                        <p className="font-medium">{pair.shareOfPool}%</p>
                        </div>
                        <div>
                        <p className="text-gray-400 text-xs">Unclaimed Fees</p>
                        <p className="font-medium">${pair.unclaimedFees.toFixed(2)}</p>
                        </div>
                        <div>
                        <p className="text-gray-400 text-xs">Total Value</p>
                        <p className="font-medium">${pair.totalValue.toFixed(2)}</p>
                      </div>
                    </div>
                    
                    {/* Action buttons */}
                    <div className="flex justify-end gap-2">
                      <Link href={`/pool/pair/${pair.pairAddress}?tokenA=${pair.pair.token0?.address || ''}&tokenB=${pair.pair.token1?.address || ''}&symbolA=${pair.pair.token0?.symbol || ''}&symbolB=${pair.pair.token1?.symbol || ''}`}>
                        <button className="px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded transition-colors">
                          Claim
                        </button>
                      </Link>
                      {getFarmData(pair.pairAddress) && (
                        <button 
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            openStakeModal(pair.pairAddress);
                          }}
                          className="px-3 py-1 bg-green-500 hover:bg-green-600 text-white text-sm rounded transition-colors"
                        >
                          Stake
                        </button>
                      )}
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
          {filteredPools.map((pair) => (
            <Link
              key={pair.pairAddress}
              href={`/pool/pair/${pair.pairAddress}?tokenA=${pair.pair.token0?.address || ''}&tokenB=${pair.pair.token1?.address || ''}&symbolA=${pair.pair.token0?.symbol || ''}&symbolB=${pair.pair.token1?.symbol || ''}`}
              className="bg-board/80 backdrop-blur-sm rounded-xl border border-borderline/60 p-6 hover:border-borderline/80 transition-all duration-200 block"
            >
              {/* Card Header */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-3">
                  <div className="flex -space-x-2">
                    <TokenIcon
                      size="md"
                      variant="minimal"
                      address={pair.pair.token0?.address || ''}
                      chainId={ABSTRACT_MAINNET_CHAIN_ID}
                      name={pair.pair.token0?.name || ''}
                      symbol={pair.pair.token0?.symbol || ''}
                      decimals={pair.pair.token0?.decimals || 18}
                      verified={pair.pair.token0?.verified || false}
                      logoURI={pair.pair.token0?.logoURI || ''}
                    />
                    <TokenIcon
                      size="md"
                      variant="minimal"
                      address={pair.pair.token1?.address || ''}
                      chainId={ABSTRACT_MAINNET_CHAIN_ID}
                      name={pair.pair.token1?.name || ''}
                      symbol={pair.pair.token1?.symbol || ''}
                      decimals={pair.pair.token1?.decimals || 18}
                      verified={pair.pair.token1?.verified || false}
                      logoURI={pair.pair.token1?.logoURI || ''}
                    />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">
                      {pair.pair.token0?.symbol || 'Unknown'}/{pair.pair.token1?.symbol || 'Unknown'}
        </h3>
                    <div className="flex items-center space-x-2 mt-1">
                      {getFarmData(pair.pairAddress) ? (
                        <>
                          <span className="bg-green-500/20 text-green-400 px-2 py-1 rounded text-xs font-medium">
                            Farm
                          </span>
                          <CheckCircle size={16} className="text-yellow-400" />
                        </>
                      ) : (
                        getPoolLabels(pair.pair).map((label, labelIndex) => (
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
                  <span className="text-gray-400 text-sm">Your Liquidity</span>
                  <span className="text-white font-medium">{pair.lpTokenBalanceFormatted}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400 text-sm">Your Share</span>
                  <span className="text-white font-medium">{pair.shareOfPool}%</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400 text-sm">Unclaimed Fees</span>
                  <span className="text-white font-medium">${pair.unclaimedFees.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400 text-sm">Total Value</span>
                  <span className="text-white font-medium">${pair.totalValue.toFixed(2)}</span>
                </div>
              </div>

              {/* Card Actions */}
              <div className="flex space-x-2">
                <button 
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openLiquidityModal(pair.pair);
                  }}
                  className="w-full px-4 py-2 bg-[#2a2a2a] hover:bg-[#363636] text-white text-sm rounded transition-colors"
                >
                  Manage
                </button>
                {getFarmData(pair.pairAddress) && (
                  <button 
                    onClick={() => openStakeModal(pair.pairAddress)}
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
          initialTab="remove"
        />
      )}

      {/* Stake Modals - Outside table structure for proper positioning */}
      {filteredPools.map((pair) => (
        getFarmData(pair.pairAddress) && (
          <StakeModal
            key={`modal-${pair.pairAddress}`}
            isOpen={stakeModalOpen[pair.pairAddress] || false}
            onClose={() => closeStakeModal(pair.pairAddress)}
            poolAddress={pair.pairAddress}
            pair={{
              token0: {
                symbol: pair.pair.token0?.symbol || 'Unknown',
                name: pair.pair.token0?.name || 'Unknown',
                address: pair.pair.token0?.address || '',
                decimals: pair.pair.token0?.decimals || 18,
                verified: pair.pair.token0?.verified || false,
                logoURI: pair.pair.token0?.logoURI || ''
              },
              token1: {
                symbol: pair.pair.token1?.symbol || 'Unknown',
                name: pair.pair.token1?.name || 'Unknown',
                address: pair.pair.token1?.address || '',
                decimals: pair.pair.token1?.decimals || 18,
                verified: pair.pair.token1?.verified || false,
                logoURI: pair.pair.token1?.logoURI || ''
              }
            }}
            userPosition={{
              stakedBalance: pair.lpTokenBalanceFormatted,
              stakedBalanceFormatted: pair.lpTokenBalanceFormatted,
              pointsEarnedFormatted: "0",
              unclaimedPointsFormatted: "0",
              pointsMultiplier: "1X",
              earnings: pair.unclaimedFees.toString()
            }}
            onStake={() => {}}
            onUnstake={() => {}}
            onClaim={() => {}}
            onHarvest={handleHarvest}
            isHarvesting={isHarvesting[pair.pairAddress] || false}
            farmApr={getFarmData(pair.pairAddress)?.farmApr}
            farmMultiplier={getFarmData(pair.pairAddress)?.farmMultiplier}
            earnedKLD={getFarmData(pair.pairAddress)?.earnedKLD}
            lpSymbol={getFarmData(pair.pairAddress)?.lpSymbol}
          />
        )
      ))}

      {/* APY Disclaimer Modal */}
      {showAPYDisclaimer && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card border border-borderline/20 rounded-lg p-6 max-w-md mx-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">APY Information</h3>
              <button
                onClick={() => setShowAPYDisclaimer(false)}
                className="text-gray-400 hover:text-white"
              >
                <X size={20} />
              </button>
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