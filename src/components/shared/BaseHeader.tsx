"use client";
import { useState, useEffect } from "react";
import MktIcons from "../market/MktIcons";
import Image from "next/image";

interface BaseHeaderProps {
  title: string;
  description: string;
  showStats?: boolean;
  type?: "stake" | "pool" | "market" | "swap";
  backgroundImage?: string;
  backgroundOverlay?: boolean;
  statsData?: {
    totalStakers?: number;
    totalPooledKLD?: string;
    userKldDeposit?: string;
    fees24h?: string;
    farms?: number;
  };
  loading?: boolean;
  statsMobileOnly?: boolean;
  children?: React.ReactNode;
}

const BaseHeader = ({
  title,
  description,
  showStats = false,
  type = "stake",
  backgroundImage,
  backgroundOverlay = true,
  statsData,
  loading = false,
  statsMobileOnly = false,
  children,
}: BaseHeaderProps) => {
  const [isClient, setIsClient] = useState(false);
  const hasCompactMobileStats = type === "pool" || type === "swap";
  const formatCompactCurrency = (value?: string) =>
    "$" +
    new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(Number(value || 0));

  const compactMobileStats = [
    { label: "TVL", value: formatCompactCurrency(statsData?.totalPooledKLD) },
    {
      label: "LIQUIDITY",
      value: statsData?.totalStakers
        ? Number(statsData.totalStakers).toLocaleString("en-US")
        : "0",
    },
    {
      label: "TOTAL VOLUME",
      value: formatCompactCurrency(statsData?.userKldDeposit),
    },
  ];

  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!isClient) {
    return (
      <header
        className={`w-full rounded-lg border border-[#1a9443]/20 bg-black relative overflow-hidden ${type === "market" ? "px-3 py-7 sm:px-10 sm:py-8 lg:py-0" : "sm:px-10"}`}
      >
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
        <div
          className={`relative z-10 flex w-full flex-col items-start justify-between lg:flex-row lg:items-center ${type === "market" ? "gap-5 p-0" : "p-4 lg:p-0"}`}
        >
          <div className="w-full text-start lg:w-2/3">
            <h3
              className={
                type === "market"
                  ? "max-w-[11ch] text-balance text-[2rem] font-bold leading-[1.12] sm:max-w-none sm:text-3xl lg:text-[40px]"
                  : "text-2xl font-bold sm:text-3xl lg:text-[40px]"
              }
            >
              {title}
            </h3>
            <p
              className={
                type === "market"
                  ? "mt-3 max-w-[31ch] text-[15px] leading-7 text-white sm:max-w-[48ch] sm:text-base lg:text-[15px]"
                  : "mt-2 text-sm sm:text-base lg:text-[15px]"
              }
            >
              {description}
            </p>
          </div>
          <div className="relative mt-6 hidden lg:ml-6 lg:mt-0 lg:block">
            {children || <MktIcons />}
          </div>
        </div>
      </header>
    );
  }

  return (
    <header
      className={`w-full rounded-lg border border-[#1a9443]/30 bg-black relative overflow-hidden ${type === "market" ? "px-3 py-7 sm:px-10 sm:py-8 lg:py-0" : "sm:px-10"}`}
    >
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

      <div
        className={`relative z-10 flex w-full flex-col items-start justify-between lg:flex-row lg:items-center ${type === "market" ? "gap-5 p-0" : "p-4 lg:p-0"}`}
      >
        <div className="w-full text-start lg:w-2/3">
          <h3
            className={
              type === "market"
                ? "max-w-[11ch] text-balance text-[2rem] font-bold leading-[1.12] sm:max-w-none sm:text-3xl lg:text-[40px]"
                : "text-2xl font-bold sm:text-3xl lg:text-[40px]"
            }
          >
            {title}
          </h3>
          <p
            className={
              type === "market"
                ? "mt-3 max-w-[31ch] text-[15px] leading-7 text-white sm:max-w-[48ch] sm:text-base lg:text-[15px]"
                : "mt-2 text-sm sm:text-base lg:text-[15px]"
            }
          >
            {description}
          </p>
        </div>

        <div className="relative mt-6 lg:mt-0 lg:ml-6 flex items-center justify-center w-full">
          {/* Analytics positioned in center area */}
          {showStats && hasCompactMobileStats && (
            <div className="grid w-full max-w-[22rem] grid-cols-3 gap-2 rounded-2xl border border-[#00ff99]/60 bg-gradient-to-r from-black/20 via-black/30 to-black/20 p-3 shadow-2xl backdrop-blur-md sm:max-w-[24rem] sm:p-4 lg:hidden">
              {compactMobileStats.map((stat) => (
                <div
                  key={stat.label}
                  className="flex min-w-0 flex-col items-center justify-center rounded-xl bg-black/20 px-1.5 py-3 text-center"
                >
                  <div className="min-h-[1.9rem] max-w-[5.8rem] font-mono text-[8px] font-semibold uppercase leading-[0.95rem] tracking-[0.14em] text-white/80 sm:max-w-none sm:text-[10px]">
                    {stat.label}
                  </div>
                  <div className="mt-1 max-w-full truncate font-mono text-base font-extrabold leading-tight text-white sm:text-lg">
                    {stat.value}
                  </div>
                </div>
              ))}
            </div>
          )}

          {showStats && !statsMobileOnly && (
            <div
              className={`${hasCompactMobileStats ? "hidden" : "grid"} w-full max-w-[21.5rem] grid-cols-2 justify-items-center gap-x-2 gap-y-5 rounded-2xl border border-[#00ff99]/60 bg-gradient-to-r from-black/20 via-black/30 to-black/20 p-4 shadow-2xl backdrop-blur-md transition-all duration-300 hover:border-[#00ff99]/80 hover:bg-gradient-to-r hover:from-black/30 hover:via-black/40 hover:to-black/30 hover:shadow-3xl hover:shadow-[#00ff99]/20 sm:max-w-[24rem] sm:gap-4 lg:absolute lg:left-1/2 lg:z-10 lg:flex lg:w-auto lg:max-w-none lg:-translate-x-1/2 lg:transform lg:items-center lg:gap-12 lg:px-10 lg:py-8 lg:hover:scale-105`}
            >
              {/* First stat - TVL / Total Staked (KLD) */}
              <div className="group relative flex w-full min-w-0 cursor-pointer flex-col items-center text-center transition-all duration-300 hover:scale-110 hover:transform lg:min-w-[80px]">
                <div className="absolute inset-0 bg-gradient-to-br from-[#00ff99]/10 to-transparent rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                <div className="relative z-10 mb-1 max-w-[8.5rem] text-center font-mono text-[10px] font-semibold uppercase leading-tight tracking-[0.18em] text-white/80 transition-all duration-300 group-hover:scale-105 group-hover:text-[#00ff99] sm:mb-2 sm:text-xs lg:whitespace-nowrap">
                  {type === "market"
                    ? "TVL"
                    : type === "pool"
                      ? "TVL"
                      : "TOTAL STAKED"}
                </div>
                <div className="relative z-10 font-mono text-2xl font-extrabold leading-tight text-white transition-all duration-300 group-hover:scale-110 group-hover:text-[#00ff99] group-hover:drop-shadow-lg group-hover:drop-shadow-[#00ff99]/50 sm:text-2xl">
                  {type === "market" || type === "pool"
                    ? "$" +
                      new Intl.NumberFormat("en-US", {
                        notation: "compact",
                        maximumFractionDigits: 1,
                      }).format(Number(statsData?.totalPooledKLD || 0))
                    : `${statsData?.totalPooledKLD ? Number(statsData.totalPooledKLD).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 }) : "0.000"}`}
                </div>
              </div>

              {/* Second stat - Stakers */}
              <div className="group relative flex w-full min-w-0 cursor-pointer flex-col items-center text-center transition-all duration-300 hover:scale-110 hover:transform lg:min-w-[80px]">
                <div className="absolute inset-0 bg-gradient-to-br from-[#00ff99]/10 to-transparent rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                <div className="relative z-10 mb-1 max-w-[8.5rem] text-center font-mono text-[10px] font-semibold uppercase leading-tight tracking-[0.18em] text-white/80 transition-all duration-300 group-hover:scale-105 group-hover:text-[#00ff99] sm:mb-2 sm:text-xs lg:whitespace-nowrap">
                  {type === "market"
                    ? "SERVICE REQUEST"
                    : type === "pool"
                      ? "POOLS"
                      : "STAKERS"}
                </div>
                <div className="relative z-10 font-mono text-2xl font-extrabold leading-tight text-white transition-all duration-300 group-hover:scale-110 group-hover:text-[#00ff99] group-hover:drop-shadow-lg group-hover:drop-shadow-[#00ff99]/50 sm:text-2xl">
                  {statsData?.totalStakers
                    ? Number(statsData.totalStakers).toLocaleString("en-US")
                    : "0"}
                </div>
              </div>

              {/* Third stat - Volume / Current APY */}
              <div className="group relative flex w-full min-w-0 cursor-pointer flex-col items-center text-center transition-all duration-300 hover:scale-110 hover:transform lg:min-w-[100px]">
                <div className="absolute inset-0 bg-gradient-to-br from-[#00ff99]/10 to-transparent rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                <div className="relative z-10 mb-1 max-w-[8.5rem] text-center font-mono text-[10px] font-semibold uppercase leading-tight tracking-[0.18em] text-white/80 transition-all duration-300 group-hover:scale-105 group-hover:text-[#00ff99] sm:mb-2 sm:text-xs lg:whitespace-nowrap">
                  {type === "market"
                    ? "TOTAL VOLUME"
                    : type === "pool"
                      ? "VOLUME"
                      : "CURRENT APY"}
                </div>
                <div className="relative z-10 font-mono text-2xl font-extrabold leading-tight text-white transition-all duration-300 group-hover:scale-110 group-hover:text-[#00ff99] group-hover:drop-shadow-lg group-hover:drop-shadow-[#00ff99]/50 sm:text-2xl">
                  {type === "market" || type === "pool"
                    ? "$" +
                      new Intl.NumberFormat("en-US", {
                        notation: "compact",
                        maximumFractionDigits: 1,
                      }).format(Number(statsData?.userKldDeposit || 0))
                    : `${statsData?.farms ? statsData.farms + "%" : "2%"}`}
                </div>
              </div>

              {/* Fourth stat - Fees / Your Stake (KLD) */}
              <div className="group relative flex w-full min-w-0 cursor-pointer flex-col items-center text-center transition-all duration-300 hover:scale-110 hover:transform lg:min-w-[100px]">
                <div className="absolute inset-0 bg-gradient-to-br from-[#00ff99]/10 to-transparent rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                <div className="relative z-10 mb-1 max-w-[8.5rem] text-center font-mono text-[10px] font-semibold uppercase leading-tight tracking-[0.18em] text-white/80 transition-all duration-300 group-hover:scale-105 group-hover:text-[#00ff99] sm:mb-2 sm:text-xs lg:whitespace-nowrap">
                  {type === "market"
                    ? "REVENUE"
                    : type === "pool"
                      ? "FEES"
                      : "YOUR STAKE (KLD)"}
                </div>
                <div className="relative z-10 font-mono text-2xl font-extrabold leading-tight text-white transition-all duration-300 group-hover:scale-110 group-hover:text-[#00ff99] group-hover:drop-shadow-lg group-hover:drop-shadow-[#00ff99]/50 sm:text-2xl">
                  {type === "market" || type === "pool"
                    ? "$" +
                      new Intl.NumberFormat("en-US", {
                        notation: "compact",
                        maximumFractionDigits: 1,
                      }).format(Number(statsData?.fees24h || 0))
                    : `${statsData?.userKldDeposit ? Number(statsData.userKldDeposit).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 }) : "0.000"}`}
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
  );
};

export default BaseHeader;
