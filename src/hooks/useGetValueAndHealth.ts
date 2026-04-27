import { getKLDVaultContract, getKaleidoContract, getProtocolContract } from "@/config/contracts"
import { readOnlyProvider } from "@/config/provider"
import { ADDRESS_1, kfUSD_ADDRESS, KLD_ADDRESS, stKLD_ADDRESS, USDC_ADDRESS, USDR, USDT_ADDRESS, KALEIDOSWAP_V3_POSITION_MANAGER } from "@/constants/utils/addresses"
import { supabase } from "@/lib/supabase/supabaseClient"
import { getActivityPoints } from "@/lib/supabase/logProtocolActivity"
import { ethers } from "ethers"
import { useEffect, useState } from "react"
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react"
import { toast } from "sonner"
import { ethers6Adapter } from "thirdweb/adapters/ethers6"
import { client } from "@/config/client"
import {
  dataAtom,
  data2Atom,
  data3Atom,
  data4Atom,
  collateralValAtom,
  etherPriceAtom,
  usdcPriceAtom,
  AVAAtom,
  AVA2Atom,
  availBalAtom,

  totalPooledKLDAtom,
  userKldDepositAtom,
  totalStakersAtom,
  totalSharesAtom,
  userstKldBalanceAtom,
  timeLeftAtom,
  totalReferralsAtom,
  referralPointAtom,
  data5Atom,
  AVA3Atom,
  AVA4Atom,
  AVA5Atom,
} from "@/constants/atom"
import { useAtom } from "jotai"
import { sendHealthFactorWarning } from "@/utils/notificationService"

// Extend Window interface for health factor notification flag
declare global {
  interface Window {
    __kaleido_healthfactor_warned?: boolean
    __kaleido_last_health_warning?: number
  }
}

const useGetValueAndHealth = () => {
  const [isClient, setIsClient] = useState(false)
  const [data, setData] = useAtom(dataAtom)
  const [data3, setData3] = useAtom(data3Atom)
  const [data4, setData4] = useAtom(data4Atom)
  const [data2, setdata2] = useAtom(data2Atom)
  const [data5, setData5] = useAtom(data5Atom)
  const [collateralVal, setCollateralVal] = useAtom(collateralValAtom)
  const [etherPrice, setEtherPrice] = useAtom(etherPriceAtom)
  const [usdcPrice, setUSDCPrice] = useAtom(usdcPriceAtom)
  const [AVA, setAVA] = useAtom(AVAAtom)
  const [AVA2, setAVA2] = useAtom(AVA2Atom)
  const [AVA3, setAVA3] = useAtom(AVA3Atom)
  const [AVA4, setAVA4] = useAtom(AVA4Atom)
  const [AVA5, setAVA5] = useAtom(AVA5Atom)
  const [availBal, setAvailBal] = useAtom(availBalAtom)

  const [totalPooledKLD, setTotalPooledKLD] = useAtom(totalPooledKLDAtom)
  const [userKldDeposit, setUserKLDdeposit] = useAtom(userKldDepositAtom)
  const [totalStakers, setTotalStakers] = useAtom(totalStakersAtom)
  const [totalShares, setTotalShares] = useAtom(totalSharesAtom)
  const [userstKldBalance, setuserstKldBalance] = useAtom(userstKldBalanceAtom)
  const [timeLeft, setTimeLeft] = useAtom(timeLeftAtom)
  const [totalReferrals, setTotalReferrals] = useAtom(totalReferralsAtom)
  const [referralPoint, setReferralPoint] = useAtom(referralPointAtom)

  const activeAccount = useActiveAccount()
  const address = activeAccount?.address

  const activeChain = useActiveWalletChain()
  const chainId = activeChain?.id

  // Set client-side mounting state
  useEffect(() => {
    setIsClient(true)
  }, [])

  useEffect(() => {
    const fetchUserStatus = async () => {
      // Only fetch data on client side to prevent hydration issues
      if (!isClient) return
      if (!address) return
      if (!activeChain) {
        toast.error("Chain not connected")
        return
      }
      if (!activeAccount) {
        toast.error("invalid account")
        return
      }
      const signer = ethers6Adapter.signer.toEthers({
        client,
        chain: activeChain,
        account: activeAccount,
      })

      try {
        const contract = getKaleidoContract(readOnlyProvider)
        const vaultContract = getKLDVaultContract(readOnlyProvider)
        // console.log("vaultContract Active:", vaultContract)
        const protocolContract = getProtocolContract(readOnlyProvider)

        const collateralTokens = await contract.getAllCollateralToken()

        try {
          const totalPooledKLD = await vaultContract.getTotalPooledKld(KLD_ADDRESS)
          const formattedTotalPooledKLD = ethers.formatUnits(totalPooledKLD, 18)
          if (Number(formattedTotalPooledKLD) > 0) {
            setTotalPooledKLD(formattedTotalPooledKLD)
          } else {
            setTotalPooledKLD("0")
          }

          // console.log("totalPooledKLD:", formattedTotalPooledKLD)
        } catch (error) {
          // console.error("error fething totalPooledKLD:", error)
        }

        try {
          const totalShares = await vaultContract.getTotalShares(stKLD_ADDRESS)
          const formattedtotalShares = ethers.formatUnits(totalShares, 18)
          if (Number(formattedtotalShares) > 0) {
            setTotalShares(formattedtotalShares)
          } else {
            setTotalShares("0")
          }

          // console.log("formattedtotalShares:", formattedtotalShares)
        } catch (error) {
          // console.error("error fething formattedtotalShares:", error)
        }

        try {
          const userKldDeposit = await vaultContract.getUserDeposit(address, stKLD_ADDRESS)
          const formatteduserKldDeposit = ethers.formatUnits(userKldDeposit, 18)
          if (Number(formatteduserKldDeposit) > 0) {
            setUserKLDdeposit(formatteduserKldDeposit)
          } else {
            setUserKLDdeposit("0")
          }

          // console.log("userKldDeposit:", userKldDeposit)
        } catch (error) {
          // console.error("error fething userKldDeposit:", error)
        }

        try {
          const timeleftforwithdrawal = await vaultContract.getWithdrawalTimeLeft(address)
          setTimeLeft(timeleftforwithdrawal)
          // console.log("userKldDeposit:", userstKldBalance)
        } catch (error) {
          // console.error("error fething userKldDeposit:", error)
        }

        try {
          const totalStakers = await vaultContract.getTotalStakers()
          // const formatteduserKldDeposit = ethers.formatUnits(userKldDeposit, 18)
          if (totalStakers > 0) {
            setTotalStakers(totalStakers)
          } else {
            setTotalStakers(0)
          }
          // console.log("totalStakers:", totalStakers)
        } catch (error) {
          // console.error("error fething totalStakers:", error)
        }

        try {
          const res5 = await contract.getUserCollateralTokens(address)
          // console.log("Collateral tokens fetched:", res5)
        } catch (error) {
          // console.error("Error fetching user collateral tokens:", error)
        }
        // Fetch account collateral values
        try {
          const res = await contract.getAccountCollateralValue(address)
          // console.log("Account collateral value:", res)
          setData(res)
        } catch (error) {
          // console.error("Error fetching account collateral value:", error)
          setData(null)
        }

        // Fetch ETH collateral
        try {
          const res3 = await contract.gets_addressToCollateralDeposited(address, ADDRESS_1)
          const ethCollateral = ethers.formatEther(res3)
          // console.log("ETH collateral:", ethCollateral)
          setData3(Number(ethCollateral))
          setAVA(Number(ethCollateral))
        } catch (error) {
          // console.error("Error fetching ETH collateral:", error)
          setData3(0)
        }

        try {
          const availBalance = await contract.getAccountCollateralValue(address)
          setAvailBal(availBalance)
        } catch (error) {
          setAvailBal(0)
        }
        try {
          const healthFactor = await contract.getHealthFactor(address)
          // console.log("Health Factor:", healthFactor)
          setdata2(Number(healthFactor.toString()))
          // Notify if health factor is close to 1 (e.g., <= 1.05) and not already notified recently
          const hf = Number(healthFactor.toString())
          const now = Date.now()
          const lastWarning = window.__kaleido_last_health_warning || 0
          const warningCooldown = 5 * 60 * 1000 // 5 minutes cooldown

          if (hf > 0 && hf <= 1.05 && now - lastWarning > warningCooldown) {
            // Send health factor warning through our notification service
            if (address) {
              sendHealthFactorWarning(hf, address)
            }
            window.__kaleido_healthfactor_warned = true
            window.__kaleido_last_health_warning = now
          }

          // Reset warning flag if health factor improves significantly
          if (hf > 1.2) {
            window.__kaleido_healthfactor_warned = false
          }
        } catch (error) {
          // console.error("Error fetching health factor:", error)
          setdata2(0)
        }

        // Fetch USDC collateral
        try {
          const res4 = await contract.gets_addressToCollateralDeposited(address, USDC_ADDRESS)
          const usdcCollateral = ethers.formatUnits(res4, 6)
          // console.log("USDC collateral:", usdcCollateral)
          setData4(Number(usdcCollateral))
          setAVA2(Number(usdcCollateral))
        } catch (error) {
          // console.error("Error fetching USDC collateral:", error)
          setData4(0)
        }

        try {
          const res5 = await contract.gets_addressToCollateralDeposited(address, USDR)
          const usdRCollateral = ethers.formatUnits(res5, 6)
          // console.log("USDC collateral:", usdcCollateral)
          setData5(Number(usdRCollateral))
          setAVA3(Number(usdRCollateral))
        } catch (error) {
          // console.error("Error fetching USDC collateral:", error)
          setData5(0)
        }

        // Fetch kfUSD collateral
        try {
          const res6 = await contract.gets_addressToCollateralDeposited(address, kfUSD_ADDRESS)
          const kfUSDCollateral = ethers.formatUnits(res6, 18)
          setAVA4(Number(kfUSDCollateral))
        } catch (error) {
          setAVA4(0)
        }

        // Fetch USDT collateral
        try {
          const res7 = await contract.gets_addressToCollateralDeposited(address, USDT_ADDRESS)
          const usdtCollateral = ethers.formatUnits(res7, 6)
          setAVA5(Number(usdtCollateral))
        } catch (error) {
          setAVA5(0)
        }

        try {
          const UserRequest = await contract.getUserActiveRequests(address)
          // const usdcCollateral = ethers.formatUnits(res4, 6);
          // console.log("User Active Request:", UserRequest)
          // setAVA(ethers.formatEther(ava));
        } catch (error) {
          // console.error("Error fetching User Active Request:", error)
          // setData4(0);
        }

        // Fetch prices for ETH and USDC
        try {
          const res6 = await contract.getUsdValue(ADDRESS_1, 1, 0)
          const ethPrice = Number(res6.toString()) / 1e16
          // console.log("ETH price:", ethPrice)
          setEtherPrice(ethPrice)
        } catch (error) {
          // console.error("Error fetching ETH price:", error)
          setEtherPrice(0)
        }

        try {
          const res7 = await contract.getUsdValue(USDC_ADDRESS, 1, 0)
          const usdcPrice = Number(res7.toString()) / 1e16
          // console.log("USDC price:", usdcPrice)
          setUSDCPrice(usdcPrice)
        } catch (error) {
          // console.error("Error fetching USDC price:", error)
          setUSDCPrice(0)
        }

        try {
          const contract = getKaleidoContract(readOnlyProvider)
          const refCount = await contract.getDownlinersCount(address)
          // console.log("Downliners count:", refCount)
          setTotalReferrals(Number(refCount))
        } catch (error) {
          // console.error("Error fetching downliners count:", error)
        }

        // --- Hardened Point System (Anti-Bot & Capital Gated) ---
        try {
          // Capital Gate: require minimum 0.1 KLD staked
          const MIN_KLD_STAKE = 0.1;
          const depositVal = Number(userKldDeposit) || 0;
          const isVerified = depositVal >= MIN_KLD_STAKE;

          // Referral Points (always awarded)
          const refContract = getKaleidoContract(readOnlyProvider)
          const refRaw = await refContract.getReferralPoints(address)
          const refPts = Number(ethers.formatUnits(refRaw, 18))

          // Marketplace Points (capital gated, capped at 5 per type)
          let marketPts = 0;
          if (isVerified) {
            const { count: listings } = await supabase.from("kaleido_listings").select("*", { count: 'exact', head: true }).eq("sender", address);
            const { count: requests } = await supabase.from("kaleido_requests").select("*", { count: 'exact', head: true }).eq("author", address);
            marketPts = (Math.min(Number(listings || 0), 5) * 100) + (Math.min(Number(requests || 0), 5) * 50);
          }

          // DEX LP Points (on-chain, hard to farm)
          const posManager = new ethers.Contract(KALEIDOSWAP_V3_POSITION_MANAGER, ["function balanceOf(address) view returns (uint256)"], readOnlyProvider);
          const lpBal = await posManager.balanceOf(address);
          const lpPts = Number(lpBal) * 250;

          // AI Agent Points (capital gated, capped at 50)
          let aiPts = 0;
          if (isVerified && typeof window !== "undefined") {
            let msgCount = 0;
            for (let i = 0; i < localStorage.length; i++) {
              const k = localStorage.key(i);
              if (k && k.startsWith('kaleido_conversation_')) {
                try {
                  const d = JSON.parse(localStorage.getItem(k) || "{}");
                  msgCount += (d.messages || []).length;
                } catch (e) {}
              }
            }
            aiPts = Math.min(msgCount * 10, 50);
          }

          // Staking Weight
          const stakePts = Math.floor(depositVal * 10);

          // Volume-Weighted DEX & AI Swap Points (from Local Indexer)
          const dexSwapPts = await getActivityPoints(address);

          // Total
          const total = Math.floor(refPts + marketPts + stakePts + lpPts + aiPts + dexSwapPts);
          setReferralPoint(total);
          console.log(`🛡️ Point Guard: Total=${total} (Ref=${refPts}, Market=${marketPts}, LP=${lpPts}, AI=${aiPts}, Stake=${stakePts}, Swaps=${dexSwapPts})`);
        } catch (error) {
          // console.error("Error fetching point system:", error)
        }

        const res3 = await contract.gets_addressToCollateralDeposited(address, ADDRESS_1)
        const res4 = await contract.gets_addressToCollateralDeposited(address, USDC_ADDRESS)
        const res5 = await contract.gets_addressToCollateralDeposited(address, USDR)
        const res6 = await contract.getUsdValue(ADDRESS_1, 1, 0)
        const res7 = await contract.getUsdValue(USDC_ADDRESS, 1, 0)
        const usdcprice = Number(res7.toString()) / 1e16
        const ethPrice = Number(res6.toString()) / 1e16

        const ethCollateral = ethers.formatEther(res3)
        const usdcCollateral = ethers.formatUnits(res4, 6)
        const usdrCollateral = ethers.formatUnits(res5, 6)
        const ethValue = Number(ethCollateral) * ethPrice
        const usdcValue = Number(usdcCollateral) * usdcprice
        const usdrValue = Number(usdrCollateral) * usdcprice
        const totalCollateralValue = ethValue + usdcValue + usdrValue
        // console.log("ethValue:", ethValue)
        // console.log("usdcValue:", usdcValue)
        // console.log("totalCollateralValue:", totalCollateralValue)
        setCollateralVal(totalCollateralValue.toFixed(2))
      } catch (err) {
        // console.error("Error in fetchUserStatus:", err)
        setTotalPooledKLD("0")
        setuserstKldBalance("0")
        setUserKLDdeposit("0")
        setTotalStakers(0)
        setdata2(0)
        setData(null)
        setData3(0)
        setData4(0)
        setCollateralVal(0)
        setEtherPrice(0)
        setUSDCPrice(0)
        setAVA(0)
        setAVA2(0)
        setAVA3(0)
        setData5(0)

        setTimeLeft(0)
        setReferralPoint(0)
        setTotalReferrals(0)
      }
    }

    if (activeAccount && address && isClient) {
      fetchUserStatus()
    }
  }, [address, activeAccount, isClient])

  return {
    AVA3,
    AVA4,
    AVA5,
    data5,
    timeLeft,
    userstKldBalance,
    totalShares,
    totalPooledKLD,
    userKldDeposit,
    totalStakers,

    data,
    data2,
    data3,
    data4,
    collateralVal,
    etherPrice,
    usdcPrice,
    AVA,
    AVA2,
    availBal,
    totalReferrals,
    referralPoint,
  }
}

export default useGetValueAndHealth
