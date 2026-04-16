import { IToken } from "@/constants/types/dex";
import { BadgeCheck } from "lucide-react";
import Image from "next/image";
import React, { useMemo, useState } from "react";

interface TokenIconProps extends IToken {
  size: "xs" | "sm" | "md" | "lg" | "xl" | "2xl";
  variant?: "default" | "card" | "minimal" | "detailed";
  onClick?: () => void;
  className?: string;
  chainId?: number;
}

export default function TokenIcon({
  size,
  variant = "default",
  symbol,
  name,
  logoURI,
  address,
  className = "",
  tags,
  verified,
  chainId,
}: TokenIconProps) {
  const [imageError, setImageError] = useState(false);

  const sizeConfig = useMemo(() => {
    const configs = {
      xs: {
        icon: "w-6 h-6",
        text: "text-xs",
        container: "p-1",
        fallback: "text-xs",
        detailed: "gap-1",
      },
      sm: {
        icon: "w-8 h-8",
        text: "text-sm",
        container: "p-2",
        fallback: "text-sm",
        detailed: "gap-2",
      },
      md: {
        icon: "w-12 h-12",
        text: "text-base",
        container: "p-3",
        fallback: "text-base",
        detailed: "gap-2",
      },
      lg: {
        icon: "w-16 h-16",
        text: "text-lg",
        container: "p-4",
        fallback: "text-lg",
        detailed: "gap-3",
      },
      xl: {
        icon: "w-20 h-20",
        text: "text-xl",
        container: "p-5",
        fallback: "text-xl",
        detailed: "gap-3",
      },
      "2xl": {
        icon: "w-24 h-24",
        text: "text-2xl",
        container: "p-6",
        fallback: "text-2xl",
        detailed: "gap-4",
      },
    };
    return configs[size];
  }, [size]);

  const sizeInPixels = useMemo(() => {
    const sizes = {
      xs: 24,
      sm: 32,
      md: 48,
      lg: 64,
      xl: 80,
      "2xl": 96,
    };
    return sizes[size];
  }, [size]);

  // Fallback component when image fails to load
  const TokenFallback = () => (
    <div
      className={`
      ${sizeConfig.icon} 
      bg-gradient-to-br from-blue-500 to-purple-600 
      rounded-full 
      flex items-center justify-center 
      ${sizeConfig.fallback} 
      ${className}
      font-semibold text-white
    `}
    >
      {symbol ? symbol.slice(0, 1).toUpperCase() : "?"}
    </div>
  );

  // Main token image component
  const TokenImage = () => {
    if (!logoURI || imageError) {
      return <TokenFallback />;
    }

    return (
      <div
        className={`${sizeConfig.icon} relative rounded-full overflow-hidden`}
      >
        <Image
          src={logoURI}
          alt={`${name || symbol} token icon`}
          width={sizeInPixels}
          height={sizeInPixels}
          className="object-cover"
          onError={() => setImageError(true)}
          unoptimized={
            logoURI?.startsWith("data:") || logoURI?.includes("ipfs")
          }
        />
      </div>
    );
  };

  // Variant rendering
  const renderVariant = () => {
    switch (variant) {
      case "minimal":
        return (
          <div className={`inline-flex items-center ${className}`}>
            <TokenImage />
          </div>
        );

      case "card":
        return (
          <div
            className={`
            flex items-center ${sizeConfig.detailed} 
            bg-white dark:bg-[#2a2a2a] 
            rounded-lg border border-gray-200 dark:border-gray-700 
            ${sizeConfig.container} 
            shadow-sm hover:shadow-md transition-shadow
            ${className}
          `}
          >
            <TokenImage />
            <div className="flex flex-col">
              <span
                className={`font-medium ${sizeConfig.text} text-gray-900 dark:text-white`}
              >
                {symbol}
              </span>
              {name && (
                <span
                  className={`text-gray-500 dark:text-gray-400 ${
                    size === "xs" ? "text-xs" : "text-sm"
                  }`}
                >
                  {name}
                </span>
              )}
            </div>
          </div>
        );
      case "detailed":
        return (
          <div
            className={`
        flex items-center justify-between w-full
        ${sizeConfig.detailed} 
        ${sizeConfig.container}
        ${className}
      `}
          >
            <div className="flex items-center gap-3">
              <TokenImage />
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <span
                    className={`font-semibold ${sizeConfig.text} text-gray-900 dark:text-white`}
                  >
                    {symbol}
                  </span>
                  {verified && (
                    <BadgeCheck className="w-4 h-4 text-green-500" />
                  )}
                </div>
                {name && (
                  <span
                    className={`text-gray-600 dark:text-gray-300 ${
                      size === "xs" ? "text-xs" : "text-sm"
                    }`}
                  >
                    {name}
                  </span>
                )}
                {address && size !== "xs" && size !== "sm" && (
                  <span className="text-xs text-gray-400 dark:text-gray-500 font-mono">
                    {`${address.slice(0, 6)}...${address.slice(-4)}`}
                  </span>
                )}
              </div>
            </div>

            {/* Tags section */}
            {tags && tags.length > 0 && (
              <div className="flex flex-wrap gap-1 ml-auto">
                {tags.map((tag, index) => (
                  <span
                    key={index}
                    className="px-2 py-1 text-xs font-medium bg-gray-100 dark:bg-[#2a2a2a] text-gray-600 dark:text-gray-300 rounded-full"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      default: // "default" variant
        return (
          <div
            className={`inline-flex items-center ${sizeConfig.detailed} ${className}`}
          >
            <TokenImage />
            {(symbol || name) && (
              <span
                className={`font-medium ${sizeConfig.text} text-gray-900 ml-2 `}
              >
                {symbol || name}
              </span>
            )}
          </div>
        );
    }
  };

  return renderVariant();
}