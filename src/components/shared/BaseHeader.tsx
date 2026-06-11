"use client"
import { useState, useEffect } from "react"
import MktIcons from "../market/MktIcons"
import Image from "next/image"

interface BaseHeaderProps {
  title: string
  description: string
  showStats?: boolean
  type?: 'stake' | 'pool' | 'market'
  backgroundImage?: string
  backgroundOverlay?: boolean
  statsData?: {
    totalStakers?: number
    totalPooledKLD?: string
    userKldDeposit?: string
    fees24h?: string
    farms?: number
  }
  loading?: boolean
  children?: React.ReactNode
}

const BaseHeader = ({ 
  title, 
  description, 
  showStats = false, 
  type = 'stake',
  backgroundImage,
  backgroundOverlay = true,
  statsData,
  loading = false,
  children
}: BaseHeaderProps) => {
  const [isClient, setIsClient] = useState(false)

  useEffect(() => {
    setIsClient(true)
  }, [])

  if (!isClient) {
    return (
      <header className="w-full rounded-lg border border-[#1a9443]/20 bg-black sm:px-10 relative overflow-hidden">
        {backgroundImage && (
          <div className="absolute inset-0 z-0">
            <Image
              src={backgroundImage}
              alt="Header background"
              fill
              className="object-cover"
              priority
            />
            {backgroundOverlay && (
              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            )}
          </div>
        )}
        <div className="relative z-10 flex w-full flex-col items-start justify-between p-4 lg:flex-row lg:items-center lg:p-0">
          <div className="w-full text-start lg:w-2/3">
            <h3 className="text-2xl font-bold sm:text-3xl lg:text-[40px]">{title}</h3>
            <p className="mt-2 text-sm sm:text-base lg:text-[15px]">
              {description}
            </p>
          </div>
          <div className="relative mt-6 hidden lg:ml-6 lg:mt-0 lg:block">
            {children || <MktIcons />}
          </div>
        </div>
      </header>
    )
  }

  return (
    <header className="w-full rounded-lg border border-[#1a9443]/30 bg-black sm:px-10 relative overflow-hidden">
      {backgroundImage && (
        <div className="absolute inset-0 z-0">
          <Image
            src={backgroundImage}
            alt="Header background"
            fill
            className="object-cover"
            priority
          />
          {backgroundOverlay && (
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          )}
        </div>
      )}
      
      <div className="relative z-10 flex w-full flex-col items-start justify-between p-4 lg:flex-row lg:items-center lg:p-0">
        <div className="w-full text-start lg:w-2/3">
          <h3 className="text-2xl font-bold sm:text-3xl lg:text-[40px]">{title}</h3>
          <p className="mt-2 text-sm sm:text-base lg:text-[15px]">
            {description}
          </p>
        </div>
        
        <div className="relative mt-6 lg:mt-0 lg:ml-6 flex items-center justify-center w-full">
          {/* Analytics positioned in center area */}
          {showStats && (
            <div className="grid grid-cols-2 gap-4 lg:flex lg:items-center lg:gap-12 z-10 relative lg:absolute lg:left-1/2 lg:transform lg:-translate-x-1/2 bg-gradient-to-r from-black/20 via-black/30 to-black/20 backdrop-blur-md border border-[#00ff99]/60 rounded-2xl p-4 lg:px-10 lg:py-8 shadow-2xl transition-all duration-300 hover:bg-gradient-to-r hover:from-black/30 hover:via-black/40 hover:to-black/30 hover:border-[#00ff99]/80 hover:shadow-3xl hover:scale-105 hover:shadow-[#00ff99]/20 justify-items-center w-full lg:w-auto">
              {/* First stat - TVL / Total Staked (KLD) */}
              <div className="flex flex-col items-center text-center w-full lg:min-w-[80px] group cursor-pointer transition-all duration-300 hover:scale-110 hover:transform relative">
                <div className="absolute inset-0 bg-gradient-to-br from-[#00ff99]/10 to-transparent rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                <div className="text-white/80 text-[10px] sm:text-xs font-semibold uppercase tracking-wider mb-1 sm:mb-2 font-mono transition-all duration-300 group-hover:text-[#00ff99] group-hover:scale-105 relative z-10 whitespace-nowrap">
                  {type === 'market' ? "TVL" : type === 'pool' ? "TVL" : "TOTAL STAKED"}
                </div>
                <div className="text-white text-lg sm:text-2xl font-extrabold font-mono leading-tight transition-all duration-300 group-hover:text-[#00ff99] group-hover:scale-110 group-hover:drop-shadow-lg group-hover:drop-shadow-[#00ff99]/50 relative z-10">
                  {type === 'market' || type === 'pool' ? 
                    "$" + new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(statsData?.totalPooledKLD || 0)) : 
                    `${statsData?.totalPooledKLD ? Number(statsData.totalPooledKLD).toLocaleString('en-US', {minimumFractionDigits: 3, maximumFractionDigits: 3}) : "0.000"}`
                  }
                </div>
              </div>

              {/* Second stat - Stakers */}
              <div className="flex flex-col items-center text-center w-full lg:min-w-[80px] group cursor-pointer transition-all duration-300 hover:scale-110 hover:transform relative">
                <div className="absolute inset-0 bg-gradient-to-br from-[#00ff99]/10 to-transparent rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                <div className="text-white/80 text-[10px] sm:text-xs font-semibold uppercase tracking-wider mb-1 sm:mb-2 font-mono transition-all duration-300 group-hover:text-[#00ff99] group-hover:scale-105 relative z-10 whitespace-nowrap">
                  {type === 'market' ? "SERVICE REQUEST" : type === 'pool' ? "POOLS" : "STAKERS"}
                </div>
                <div className="text-white text-lg sm:text-2xl font-extrabold font-mono leading-tight transition-all duration-300 group-hover:text-[#00ff99] group-hover:scale-110 group-hover:drop-shadow-lg group-hover:drop-shadow-[#00ff99]/50 relative z-10">
                  {statsData?.totalStakers ? Number(statsData.totalStakers).toLocaleString('en-US') : "0"}
                </div>
              </div>

              {/* Third stat - Volume / Current APY */}
              <div className="flex flex-col items-center text-center w-full lg:min-w-[100px] group cursor-pointer transition-all duration-300 hover:scale-110 hover:transform relative">
                <div className="absolute inset-0 bg-gradient-to-br from-[#00ff99]/10 to-transparent rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                <div className="text-white/80 text-[10px] sm:text-xs font-semibold uppercase tracking-wider mb-1 sm:mb-2 font-mono transition-all duration-300 group-hover:text-[#00ff99] group-hover:scale-105 relative z-10 whitespace-nowrap">
                  {type === 'market' ? "TOTAL VOLUME" : type === 'pool' ? "VOLUME" : "CURRENT APY"}
                </div>
                <div className="text-white text-lg sm:text-2xl font-extrabold font-mono leading-tight transition-all duration-300 group-hover:text-[#00ff99] group-hover:scale-110 group-hover:drop-shadow-lg group-hover:drop-shadow-[#00ff99]/50 relative z-10">
                  {type === 'market' || type === 'pool' ? 
                    "$" + new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(statsData?.userKldDeposit || 0)) : 
                    `${statsData?.farms ? statsData.farms + "%" : "2%"}`
                  }
                </div>
              </div>

              {/* Fourth stat - Fees / Your Stake (KLD) */}
              <div className="flex flex-col items-center text-center w-full lg:min-w-[100px] group cursor-pointer transition-all duration-300 hover:scale-110 hover:transform relative">
                <div className="absolute inset-0 bg-gradient-to-br from-[#00ff99]/10 to-transparent rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                <div className="text-white/80 text-[10px] sm:text-xs font-semibold uppercase tracking-wider mb-1 sm:mb-2 font-mono transition-all duration-300 group-hover:text-[#00ff99] group-hover:scale-105 relative z-10 whitespace-nowrap">
                  {type === 'market' ? "REVENUE" : type === 'pool' ? "FEES" : "YOUR STAKE (KLD)"}
                </div>
                <div className="text-white text-lg sm:text-2xl font-extrabold font-mono leading-tight transition-all duration-300 group-hover:text-[#00ff99] group-hover:scale-110 group-hover:drop-shadow-lg group-hover:drop-shadow-[#00ff99]/50 relative z-10">
                  {type === 'market' || type === 'pool' ? 
                    "$" + new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(statsData?.fees24h || 0)) : 
                    `${statsData?.userKldDeposit ? Number(statsData.userKldDeposit).toLocaleString('en-US', {minimumFractionDigits: 3, maximumFractionDigits: 3}) : "0.000"}`
                  }
                </div>
              </div>
            </div>
          )}
          
          {/* Keep the original MktIcons (floating crypto assets) on the right */}
          <div className="relative hidden lg:block ml-auto">
            {children || <MktIcons />}
          </div>
        </div>
      </div>
    </header>
  )
}

export default BaseHeader
