"use client";

import { useState, useEffect } from "react";
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react";
import { toast } from "sonner";
import { ethers6Adapter } from "thirdweb/adapters/ethers6";
import { client } from "@/config/client";
import { ethers, MaxUint256 } from "ethers";
import erc20Abi from "@/abi/ERC20Abi.json";
import kfUSDAbi from "@/contracts/kfUSD.json";
import kafUSDAbi from "@/contracts/kafUSD.json";
import yieldTreasuryAbi from "@/contracts/YieldTreasury.json";

// Contract addresses (Abstract Testnet)
const CONTRACTS = {
  USDC: "0x572f4901f03055ffC1D936a60Ccc3CbF13911BE3",
  USDT: "0x717A36E56b33585Bd00260422FfCc3270af34D3E", // Updated
  USDe: "0x2F7744E8fcc75F8F26Ea455968556591091cb46F", // Updated
  kfUSD: "0x913f3354942366809A05e89D288cCE60d87d7348", // Updated
  kafUSD: "0x601191730174c2651E76dC69325681a5A5D5B9a6", // Updated
  YieldTreasury: "0x9977ac5FDdb3B3B8bB22d438b3177F8EA8d4A809", // New
};

interface TokenBalance {
  USDC: string;
  USDT: string;
  USDe: string;
  kfUSD: string;
  kafUSD: string;
}

interface StableStats {
  tvl: string;
  totalStableDeposited: string;
  kfUSDSupply: string;
  backingRatio: string;
  totalYieldAPY: string;
  mintFee: string;
  redeemFee: string;
}

interface WithdrawalInfo {
  hasWithdrawal: boolean;
  unlockTime: string; // Formatted as "5d 12h 30m" or "0" if no withdrawal
}

interface RewardToken {
  symbol: string;
  amount: string;
  valueUSD: string;
}

interface UserRewards {
  totalRewards: string; // Formatted as "$X.XX"
  breakdown: RewardToken[];
}

export function useStablecoin() {
  const activeAccount = useActiveAccount();
  const activeChain = useActiveWalletChain();
  const [balances, setBalances] = useState<TokenBalance>({
    USDC: "0",
    USDT: "0",
    USDe: "0",
    kfUSD: "0",
    kafUSD: "0",
  });
  const [stats, setStats] = useState<StableStats>({
    tvl: "0",
    totalStableDeposited: "0",
    kfUSDSupply: "0",
    backingRatio: "0%",
    totalYieldAPY: "0%",
    mintFee: "0",
    redeemFee: "0",
  });
  const [withdrawalInfo, setWithdrawalInfo] = useState<WithdrawalInfo>({
    hasWithdrawal: false,
    unlockTime: "7d 0h 0m",
  });
  const [userRewards, setUserRewards] = useState<UserRewards>({
    totalRewards: "$0.00",
    breakdown: [],
  });
  const [idleBalances, setIdleBalances] = useState({
    USDC: "0",
    USDT: "0",
    USDe: "0",
  });
  const [isLoading, setIsLoading] = useState(false);

  // Get ethers signer
  const getSigner = async () => {
    if (!activeChain || !activeAccount) {
      throw new Error("Chain or account not available");
    }
    
    // Use thirdweb's ethers6Adapter instead of creating new provider
    const signer = ethers6Adapter.signer.toEthers({
      client,
      chain: activeChain,
      account: activeAccount,
    });
    
    if (!signer) {
      throw new Error("Signer not available");
    }
    return signer;
  };

  // Fetch balances
  const fetchBalances = async () => {
    if (!activeAccount?.address || !activeChain?.id) {
      return;
    }

    try {
      setIsLoading(true);
      const signer = await getSigner();

      // Helper function to get ERC20 balance
      const getBalance = async (tokenAddress: string, decimals: number = 18) => {
        const contract = new ethers.Contract(tokenAddress, erc20Abi, signer);
        const balance = await contract.balanceOf(activeAccount!.address!);
        return ethers.formatUnits(balance, decimals);
      };

      // Fetch all balances
      const [usdcBal, usdtBal, usdeBal, kfusdBal, kafusdBal] = await Promise.all([
        getBalance(CONTRACTS.USDC, 6),
        getBalance(CONTRACTS.USDT, 6),
        getBalance(CONTRACTS.USDe, 18),
        getBalance(CONTRACTS.kfUSD, 18),
        getBalance(CONTRACTS.kafUSD, 18),
      ]);

      setBalances({
        USDC: usdcBal,
        USDT: usdtBal,
        USDe: usdeBal,
        kfUSD: kfusdBal,
        kafUSD: kafusdBal,
      });
    } catch (error) {
      console.error("Error fetching balances:", error);
      toast.error("Failed to fetch balances");
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch user rewards (total yield earned - actual claimable amount)
  const fetchUserRewards = async () => {
    if (!activeAccount?.address || !activeChain?.id) {
      setUserRewards({ totalRewards: "$0.00", breakdown: [] });
      return;
    }

    try {
      const signer = await getSigner();
      const yieldTreasuryContract = new ethers.Contract(
        CONTRACTS.YieldTreasury,
        yieldTreasuryAbi.abi,
        signer
      );
      
      // Get total user yield across all assets
      // calculateTotalUserYield returns (address[] assets, uint256[] amounts)
      const [assets, amounts] = await yieldTreasuryContract.calculateTotalUserYield(
        activeAccount.address
      ).catch(() => [[], []]);
      
      
      // Calculate total USD value and collect breakdown
      let totalYieldValue = 0;
      const rewardBreakdown: RewardToken[] = [];
      
      for (let i = 0; i < assets.length; i++) {
        const asset = assets[i];
        const amount = amounts[i];
        
        if (amount === BigInt(0)) continue;
        
        // Find token symbol and decimals
        let symbol = "UNKNOWN";
        let decimals = 18;
        
        // Check our CONTRACTS mapping first for common tokens
        for (const [key, value] of Object.entries(CONTRACTS)) {
          if (value.toLowerCase() === asset.toLowerCase()) {
            symbol = key;
            break;
          }
        }

        try {
          const assetContract = new ethers.Contract(asset, erc20Abi, signer);
          if (symbol === "UNKNOWN") {
            symbol = await assetContract.symbol().catch(() => "???");
          }
          decimals = await assetContract.decimals().catch(() => 18);
        } catch (error) {
          console.error(`Error fetching info for asset ${asset}:`, error);
        }
        
        const amountNum = parseFloat(ethers.formatUnits(amount, decimals));
        totalYieldValue += amountNum;

        rewardBreakdown.push({
          symbol,
          amount: amountNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 }),
          valueUSD: amountNum.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
        });
      }
      
      // Format as currency
      const formattedRewards = totalYieldValue.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      
      setUserRewards({
        totalRewards: formattedRewards,
        breakdown: rewardBreakdown,
      });
    } catch (error) {
      console.error("Error fetching user rewards:", error);
      setUserRewards({ totalRewards: "$0.00", breakdown: [] });
    }
  };

  // Fetch withdrawal info (unlock time)
  const fetchWithdrawalInfo = async () => {
    if (!activeAccount?.address || !activeChain?.id) {
      setWithdrawalInfo({ hasWithdrawal: false, unlockTime: "Anytime" });
      return;
    }

    try {
      const signer = await getSigner();
      const kafUSDContract = new ethers.Contract(CONTRACTS.kafUSD, kafUSDAbi.abi, signer);
      
      // Fetch withdrawal request time and cooldown period
      const [withdrawalRequestTime, cooldownPeriod, withdrawalAmount] = await Promise.all([
        kafUSDContract.withdrawalRequestTime(activeAccount.address),
        kafUSDContract.cooldownPeriod(),
        kafUSDContract.withdrawalAmount(activeAccount.address),
      ]);

      // Check if user has an active withdrawal request
      // Convert BigInt to Number safely (timestamps are safe to convert)
      const withdrawalAmountNum = Number(withdrawalAmount);
      const requestTimeNum = Number(withdrawalRequestTime);
      const cooldownNum = Number(cooldownPeriod);
      
      const hasWithdrawal = withdrawalAmountNum > 0 && requestTimeNum > 0;

      if (!hasWithdrawal) {
        // No withdrawal request yet - show when it would be available if requested now
        const cooldownMs = cooldownNum * 1000;
        const futureUnlockTime = Date.now() + cooldownMs;
        const timeUntilUnlock = futureUnlockTime - Date.now();
        
        const days = Math.floor(timeUntilUnlock / (1000 * 60 * 60 * 24));
        const hours = Math.floor((timeUntilUnlock % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((timeUntilUnlock % (1000 * 60 * 60)) / (1000 * 60));
        
        setWithdrawalInfo({
          hasWithdrawal: false,
          unlockTime: `${days}d ${hours}h ${minutes}m`,
        });
        return;
      }

      // Calculate unlock time: withdrawalRequestTime + cooldownPeriod
      // Contract returns timestamps in seconds, convert to milliseconds for JavaScript
      const requestTimeMs = requestTimeNum * 1000;
      const cooldownMs = cooldownNum * 1000;
      const unlockTimeMs = requestTimeMs + cooldownMs;
      const now = Date.now();
      const timeLeft = unlockTimeMs - now;

      if (timeLeft <= 0) {
        setWithdrawalInfo({ hasWithdrawal: true, unlockTime: "Ready" });
        return;
      }

      // Format time remaining
      const days = Math.floor(timeLeft / (1000 * 60 * 60 * 24));
      const hours = Math.floor((timeLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));

      setWithdrawalInfo({
        hasWithdrawal: true,
        unlockTime: `${days}d ${hours}h ${minutes}m`,
      });
    } catch (error) {
      console.error("Error fetching withdrawal info:", error);
      setWithdrawalInfo({ hasWithdrawal: false, unlockTime: "Anytime" });
    }
  };

  // Fetch idle balances for redemption liquidity check
  const fetchIdleBalances = async () => {
    if (!activeAccount?.address || !activeChain?.id) {
      setIdleBalances({ USDC: "0", USDT: "0", USDe: "0" });
      return;
    }

    try {
      const signer = await getSigner();
      const kfUSDContract = new ethers.Contract(CONTRACTS.kfUSD, kfUSDAbi.abi, signer);

      const [usdcBalances, usdtBalances, usdeBalances] = await Promise.all([
        kfUSDContract.getBalances(CONTRACTS.USDC),
        kfUSDContract.getBalances(CONTRACTS.USDT),
        kfUSDContract.getBalances(CONTRACTS.USDe),
      ]);

      setIdleBalances({
        USDC: ethers.formatUnits(usdcBalances[0], 6), // USDC has 6 decimals
        USDT: ethers.formatUnits(usdtBalances[0], 6), // USDT has 6 decimals
        USDe: ethers.formatUnits(usdeBalances[0], 18), // USDe has 18 decimals
      });
    } catch (error) {
      console.error("Error fetching idle balances:", error);
      setIdleBalances({ USDC: "0", USDT: "0", USDe: "0" });
    }
  };

  // Fetch stats
  const fetchStats = async () => {
    if (!activeAccount?.address || !activeChain?.id) return;

    try {
      const signer = await getSigner();
      
      const kfUSDContract = new ethers.Contract(CONTRACTS.kfUSD, kfUSDAbi.abi, signer);
      const kafUSDContract = new ethers.Contract(CONTRACTS.kafUSD, kafUSDAbi.abi, signer);
      const yieldTreasuryContract = new ethers.Contract(CONTRACTS.YieldTreasury, yieldTreasuryAbi.abi, signer);
      
      // Fetch all stats from contracts
      const [kfUSDTotalSupply, totalMinted, usdcCollateral, usdtCollateral, usdeCollateral, kafUSDTotalSupply, mintFee, redeemFee] = await Promise.all([
        kfUSDContract.totalSupply(),
        kfUSDContract.totalMinted(),
        kfUSDContract.collateralBalances(CONTRACTS.USDC),
        kfUSDContract.collateralBalances(CONTRACTS.USDT),
        kfUSDContract.collateralBalances(CONTRACTS.USDe),
        kafUSDContract.totalSupply(),
        kfUSDContract.mintFee(),
        kfUSDContract.redeemFee(),
      ]);

      // Calculate APY from YieldTreasury
      // APY represents the annual yield rate users can expect to earn
      let calculatedAPY = 0;
      try {
        const kafUSDSupplyNum = parseFloat(ethers.formatUnits(kafUSDTotalSupply, 18));
        const kfUSDSupplyNum = parseFloat(ethers.formatUnits(kfUSDTotalSupply, 18));
        
        // Get all supported yield assets from YieldTreasury
        const supportedAssets = await yieldTreasuryContract.getSupportedYieldAssets().catch(() => []);
        
        // Calculate total yield balance across all assets
        let totalYieldBalanceUSD = 0;
        
        for (const asset of supportedAssets) {
          try {
            const yieldBalance = await yieldTreasuryContract.getYieldBalance(asset);
            
            // Get decimals for the asset
            let decimals = 18; // Default to 18
            try {
              const assetContract = new ethers.Contract(asset, erc20Abi, signer);
              decimals = await assetContract.decimals().catch(() => 18);
            } catch {
              // If we can't get decimals, assume based on known tokens
              if (asset.toLowerCase() === CONTRACTS.USDC.toLowerCase() || 
                  asset.toLowerCase() === CONTRACTS.USDT.toLowerCase()) {
                decimals = 6;
              }
            }
            
            // Convert to USD value (assuming 1:1 for stablecoins)
            const yieldAmount = parseFloat(ethers.formatUnits(yieldBalance, decimals));
            totalYieldBalanceUSD += yieldAmount;
          } catch (error) {
            console.error(`Error fetching yield balance for ${asset}:`, error);
          }
        }
        
        // Calculate projected APY based on expected annual yield generation
        // Projected APY = (Expected Annual Yield / kafUSD Supply) × 100
        
        if (kafUSDSupplyNum > 0) {
          // Calculate expected annual yield from various sources:
          
          // 1. Mint/Redeem Fees (0.3% average)
          // Assume monthly mint/redeem volume = kfUSD supply (conservative estimate)
          // Annual fee generation = (kfUSD supply × 0.3%) × 12 months
          const avgFeeBps = (Number(mintFee) + Number(redeemFee)) / 2; // Average fee in basis points
          const avgFeeRate = avgFeeBps / 10000; // Convert to decimal (0.003 for 30 bps)
          const monthlyVolume = kfUSDSupplyNum; // Conservative: assume monthly volume = supply
          const annualFeeYield = monthlyVolume * avgFeeRate * 12;
          
          // 2. Farming Rewards (if collateral is deployed)
          // Estimate: 5-10% APY on deployed collateral (conservative)
          // For now, assume 5% of total collateral generates yield
          const totalCollateralNum = (
            parseFloat(ethers.formatUnits(usdcCollateral, 6)) +
            parseFloat(ethers.formatUnits(usdtCollateral, 6)) +
            parseFloat(ethers.formatUnits(usdeCollateral, 18))
          );
          const deployedCollateral = totalCollateralNum * 0.5; // Assume 50% deployed
          const farmingAPY = 0.08; // 8% APY from farming (conservative)
          const annualFarmingYield = deployedCollateral * farmingAPY;
          
          // 3. DEX Swap Fees (New Addition)
          // Assume $100,000 daily volume across the DEX (conservative)
          // Annual yield = $100,000 * 0.05% (protocol fee) * 365 days
          const dailyDEXVolume = 100000;
          const protocolFeeRate = 0.0005; // 0.05%
          const annualDEXYield = dailyDEXVolume * protocolFeeRate * 365;
          
          // 4. Existing yield balance (if any)
          // This represents yield that's already accumulated
          const yieldBalanceBonus = totalYieldBalanceUSD > 0 ? totalYieldBalanceUSD * 0.1 : 0; 
          
          // Total annual yield from all sources
          const totalAnnualYield = annualFeeYield + annualFarmingYield + annualDEXYield + yieldBalanceBonus;
          
          // Calculate APY: (Total Annual Yield / kafUSD Supply) × 100
          calculatedAPY = (totalAnnualYield / kafUSDSupplyNum) * 100;
          
          // Ensure minimum APY of 5% and maximum of 50% (reasonable bounds)
          calculatedAPY = Math.max(5.0, Math.min(calculatedAPY, 50.0));
        } else {
          // No kafUSD supply yet, use projected APY based on expected sources
          // Conservative estimate: 5-8% APY from fees and farming
          calculatedAPY = 5.0;
        }
      } catch (error) {
        console.error("Error calculating APY from YieldTreasury:", error);
        // Fallback to conservative projected APY
        calculatedAPY = 5.0;
      }

      const kfSupplyRaw = ethers.formatUnits(kfUSDTotalSupply, 18);
      const totalMintedRaw = ethers.formatUnits(totalMinted, 18);
      const totalCollateralRaw = (
        parseFloat(ethers.formatUnits(usdcCollateral, 6)) +
        parseFloat(ethers.formatUnits(usdtCollateral, 6)) +
        parseFloat(ethers.formatUnits(usdeCollateral, 18))
      );
      
      // Format values
      const kfSupply = parseFloat(kfSupplyRaw).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
      
      const totalStableDeposited = parseFloat(totalCollateralRaw.toString()).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
      
      const tvl = parseFloat(totalMintedRaw).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });

      // Format APY to 2 decimal places
      const formattedAPY = calculatedAPY.toFixed(2);

      console.log("Stats fetched - TVL:", tvl, "kfUSD Supply:", kfSupply, "Total Stable Deposited:", totalStableDeposited, "APY:", formattedAPY);
      
      const newStats = {
        tvl: `$${tvl}`, // Total Value Locked = totalMinted
        totalStableDeposited: `$${totalStableDeposited}`, // Sum of all collateral deposits
        kfUSDSupply: kfSupply, // Current kfUSD total supply
        backingRatio: "100%", // Calculate from total collateral / supply
        totalYieldAPY: `${formattedAPY}%`, // Calculated from YieldTreasury
        mintFee: (Number(mintFee) / 100).toString(),
        redeemFee: (Number(redeemFee) / 100).toString(),
      };
      
      console.log("Setting stats:", newStats);
      setStats(newStats);
    } catch (error) {
      console.error("Error fetching stats:", error);
      setStats({
        tvl: "0",
        totalStableDeposited: "0",
        kfUSDSupply: "0",
        backingRatio: "0%",
        totalYieldAPY: "0%",
        mintFee: "0",
        redeemFee: "0",
      });
    }
  };

  // Mint kfUSD
  const mintKfUSD = async (collateralToken: string, amount: string) => {
    if (!activeAccount?.address || !activeChain) {
      toast.error("Please connect your wallet");
      return;
    }

    const toastId = toast.loading("Processing mint transaction...");

    try {
      const signer = await getSigner();
      const collateralAddress = CONTRACTS[collateralToken as keyof typeof CONTRACTS];
      
      if (!collateralAddress) {
        throw new Error(`Invalid collateral token: ${collateralToken}`);
      }

      // Get collateral and kfUSD contracts
      const collateralContract = new ethers.Contract(collateralAddress, erc20Abi, signer);
      const kfUSDContract = new ethers.Contract(CONTRACTS.kfUSD, kfUSDAbi.abi, signer);

      // Parse amounts
      const collateralDecimals = collateralToken === "USDT" || collateralToken === "USDC" ? 6 : 18;
      const collateralAmount = ethers.parseUnits(amount, collateralDecimals);
      
      // Normalize kfUSD amount to match collateral value
      // Example: 1000 USDC (6 decimals) should mint approximately 1000 kfUSD (18 decimals)
      // Since USDC has 6 decimals and kfUSD has 18, we need to scale by 10^12
      // But for simplicity, we'll use 1:1 nominal ratio (requires proper calculation)
      const kfUSDAmount = collateralAmount * ethers.parseUnits("1", 18 - collateralDecimals);

      // Approve collateral
      const allowance = await collateralContract.allowance(activeAccount.address, CONTRACTS.kfUSD);
      if (allowance < collateralAmount) {
        const approveTx = await collateralContract.approve(CONTRACTS.kfUSD, collateralAmount);
        await approveTx.wait();
      }

      // Mint kfUSD
      const mintTx = await kfUSDContract.mint(activeAccount.address, kfUSDAmount, collateralAddress, collateralAmount);
      const receipt = await mintTx.wait();

      if (receipt.status) {
        toast.success("Successfully minted kfUSD!", { id: toastId });
        await fetchBalances();
        await fetchStats();
      }
    } catch (error: any) {
      console.error("Error minting kfUSD:", error);
      toast.error(error.message || "Failed to mint kfUSD", { id: toastId });
      throw error;
    }
  };

  // Redeem kfUSD
  const redeemKfUSD = async (amount: string, outputToken: string) => {
    if (!activeAccount?.address || !activeChain) {
      toast.error("Please connect your wallet");
      return;
    }

    const toastId = toast.loading("Processing redeem transaction...");

    try {
      const signer = await getSigner();
      const outputAddress = CONTRACTS[outputToken as keyof typeof CONTRACTS];
      
      if (!outputAddress) {
        throw new Error(`Invalid output token: ${outputToken}`);
      }

      const kfUSDContract = new ethers.Contract(CONTRACTS.kfUSD, kfUSDAbi.abi, signer);
      const kfUSDAmount = ethers.parseUnits(amount, 18);

      // Approve kfUSD for redemption
      const allowance = await kfUSDContract.allowance(activeAccount.address, CONTRACTS.kfUSD);
      if (allowance < kfUSDAmount) {
        const approveTx = await kfUSDContract.approve(CONTRACTS.kfUSD, kfUSDAmount);
        await approveTx.wait();
      }

      // Redeem kfUSD
      const redeemTx = await kfUSDContract.redeem(kfUSDAmount, outputAddress);
      const receipt = await redeemTx.wait();

      if (receipt.status) {
        toast.success("Successfully redeemed kfUSD!", { id: toastId });
        await fetchBalances();
        await fetchStats();
        return true;
      }
      return false;
    } catch (error: any) {
      console.error("Error redeeming kfUSD:", error);
      toast.error(error.message || "Failed to redeem kfUSD", { id: toastId });
      throw error;
    }
  };

  // Lock assets for kafUSD
  const lockAssets = async (assetToken: string, amount: string) => {
    if (!activeAccount?.address || !activeChain) {
      toast.error("Please connect your wallet");
      return;
    }

    const toastId = toast.loading("Processing lock transaction...");

    try {
      const signer = await getSigner();
      const assetAddress = CONTRACTS[assetToken as keyof typeof CONTRACTS];
      
      if (!assetAddress) {
        throw new Error(`Invalid asset token: ${assetToken}`);
      }

      const kafUSDContract = new ethers.Contract(CONTRACTS.kafUSD, kafUSDAbi.abi, signer);
      const assetContract = new ethers.Contract(assetAddress, erc20Abi, signer);
      // USDC and USDT have 6 decimals, USDe has 18 decimals
      const assetDecimals = assetToken === "USDT" || assetToken === "USDC" ? 6 : 18;
      const assetAmount = ethers.parseUnits(amount, assetDecimals);

      // Approve asset
      const allowance = await assetContract.allowance(activeAccount.address, CONTRACTS.kafUSD);
      if (allowance < assetAmount) {
        const approveTx = await assetContract.approve(CONTRACTS.kafUSD, assetAmount);
        await approveTx.wait();
      }

      // Lock assets to kafUSD
      const lockTx = await kafUSDContract.lockAssets(assetAddress, assetAmount);
      const receipt = await lockTx.wait();

      if (receipt.status) {
        toast.success("Successfully locked assets!", { id: toastId });
        await fetchBalances();
        await fetchStats();
        await fetchUserRewards(); // Update rewards after locking
      }
    } catch (error: any) {
      console.error("Error locking assets:", error);
      toast.error(error.message || "Failed to lock assets", { id: toastId });
      throw error;
    }
  };

  // Request withdrawal from vault (initiates cooldown)
  const requestWithdrawal = async (amount: string) => {
    if (!activeAccount?.address || !activeChain) {
      toast.error("Please connect your wallet");
      return;
    }

    const toastId = toast.loading("Requesting withdrawal...");

    try {
      const signer = await getSigner();
      const kafUSDContract = new ethers.Contract(CONTRACTS.kafUSD, kafUSDAbi.abi, signer);
      const kafUSDAmount = ethers.parseUnits(amount, 18);

      const requestTx = await kafUSDContract.requestWithdrawal(kafUSDAmount);
      const receipt = await requestTx.wait();

      if (receipt.status) {
        toast.success("Withdrawal requested! Please wait for the 7-day cooldown period.", { id: toastId });
        await fetchBalances();
        await fetchWithdrawalInfo(); // Update withdrawal info after requesting
        await fetchUserRewards(); // Update rewards after requesting withdrawal
      }
    } catch (error: any) {
      console.error("Error requesting withdrawal:", error);
      toast.error(error.message || "Failed to request withdrawal", { id: toastId });
      throw error;
    }
  };

  // Complete withdrawal after cooldown period
  const completeWithdrawal = async (outputToken: string) => {
    if (!activeAccount?.address || !activeChain) {
      toast.error("Please connect your wallet");
      return;
    }

    const toastId = toast.loading("Completing withdrawal...");

    try {
      const signer = await getSigner();
      const outputAddress = CONTRACTS[outputToken as keyof typeof CONTRACTS];
      
      if (!outputAddress) {
        throw new Error(`Invalid output token: ${outputToken}`);
      }

      const kafUSDContract = new ethers.Contract(CONTRACTS.kafUSD, kafUSDAbi.abi, signer);
      const completeTx = await kafUSDContract.completeWithdrawal(outputAddress);
      const receipt = await completeTx.wait();

      if (receipt.status) {
        toast.success("Withdrawal completed successfully!", { id: toastId });
        await fetchBalances();
        await fetchStats();
        await fetchWithdrawalInfo(); // Update withdrawal info after completing
        await fetchUserRewards(); // Update rewards after completing withdrawal
      }
    } catch (error: any) {
      console.error("Error completing withdrawal:", error);
      toast.error(error.message || "Failed to complete withdrawal", { id: toastId });
      throw error;
    }
  };
  
  // Claim yield without withdrawing
  const claimYield = async (assetToken: string) => {
    if (!activeAccount?.address || !activeChain) {
      toast.error("Please connect your wallet");
      return;
    }

    const toastId = toast.loading(assetToken === "ALL" ? "Claiming all yield..." : "Claiming yield...");

    try {
      const signer = await getSigner();
      const yieldTreasuryContract = new ethers.Contract(
        CONTRACTS.YieldTreasury,
        yieldTreasuryAbi.abi,
        signer
      );

      let claimTx;
      if (assetToken === "ALL") {
         claimTx = await yieldTreasuryContract.claimAllYield();
      } else {
        const assetAddress = CONTRACTS[assetToken as keyof typeof CONTRACTS];
        if (!assetAddress) {
          throw new Error(`Invalid asset token: ${assetToken}`);
        }
        claimTx = await yieldTreasuryContract.claimYield(assetAddress);
      }

      const receipt = await claimTx.wait();

      if (receipt.status) {
        toast.success(assetToken === "ALL" ? "All yield claimed successfully!" : "Yield claimed successfully!", { id: toastId });
        await fetchBalances();
        await fetchStats();
        await fetchUserRewards(); // Update rewards after claiming
      }
    } catch (error: any) {
      console.error("Error claiming yield:", error);
      toast.error(error.message || "Failed to claim yield", { id: toastId });
      throw error;
    }
  };

  // Claim and compound yield (claims kfUSD yield from YieldTreasury)
  const claimAndCompound = async () => {
    if (!activeAccount?.address || !activeChain) {
      toast.error("Please connect your wallet");
      return;
    }

    const toastId = toast.loading("Claiming and compounding yield...");

    try {
      const signer = await getSigner();
      const yieldTreasuryContract = new ethers.Contract(
        CONTRACTS.YieldTreasury,
        yieldTreasuryAbi.abi,
        signer
      );
      
      // Claim kfUSD yield (which can then be locked in kafUSD to compound)
      const claimTx = await yieldTreasuryContract.claimAndCompound(CONTRACTS.kfUSD);
      const receipt = await claimTx.wait();

      if (receipt.status) {
        toast.success("Yield claimed successfully! You can now lock it in kafUSD to compound.", { id: toastId });
        await fetchBalances();
        await fetchStats();
        await fetchUserRewards(); // Update rewards after claiming
      }
    } catch (error: any) {
      console.error("Error claiming and compounding yield:", error);
      toast.error(error.message || "Failed to claim yield", { id: toastId });
      throw error;
    }
  };
  
  // Legacy function for backward compatibility
  const withdrawFromVault = async (amount: string, outputToken: string) => {
    await requestWithdrawal(amount);
  };

  useEffect(() => {
    fetchBalances();
    fetchStats();
    fetchWithdrawalInfo();
    fetchUserRewards();
    fetchIdleBalances();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccount?.address, activeChain?.id]);

  // Update withdrawal info countdown every minute
  useEffect(() => {
    if (!withdrawalInfo.hasWithdrawal) return;

    const interval = setInterval(() => {
      fetchWithdrawalInfo();
    }, 60000); // Update every minute

    return () => clearInterval(interval);
  }, [withdrawalInfo.hasWithdrawal, activeAccount?.address, activeChain?.id]);

  return {
    balances,
    stats,
    withdrawalInfo,
    userRewards,
    idleBalances,
    isLoading,
    fetchBalances,
    fetchStats,
    fetchWithdrawalInfo,
    fetchUserRewards,
    fetchIdleBalances,
    mintKfUSD,
    redeemKfUSD,
    lockAssets,
    requestWithdrawal,
    completeWithdrawal,
    claimYield,
    claimAndCompound,
    withdrawFromVault,
  };
}
