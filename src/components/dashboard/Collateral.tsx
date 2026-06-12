"use client"

import Image from "next/image"
import { Btn } from "../shared/Btn"
import { tokenData2 } from "@/constants/utils/tokenData2"
import { useEffect, useState } from "react"
import { getEthBalance } from "@/constants/utils/getEthBalance"

import { toast } from "sonner"
import { isSupportedChain } from "@/config/chain"
import { fetchOmniAssetBalance, OmniPortfolioItem } from "@/constants/utils/omniChainBalances"
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react"
import DepositModal from "@/components/shared/DepositModal"
import CreateOrderModal from "@/components/modals/CreateOrderModal"
import { formatWithCommas } from "@/constants/utils/formatNumber"

const Collateral = ({ id }: { id?: string }) => {
  const [updatedTokenData, setUpdatedTokenData] = useState<any[]>(tokenData2)
  const [omniData, setOmniData] = useState<Record<string, OmniPortfolioItem>>({})
  const [showDepositModal, setShowDepositModal] = useState(false)
  const [showLendModal, setShowLendModal] = useState(false)
  const [selectedTokenForLend, setSelectedTokenForLend] = useState("ETH")
  const activeAccount = useActiveAccount()
  const activeChain = useActiveWalletChain()
  const address = activeAccount?.address

  const ENABLED_CHAINS = [2741, 8453, 56, 137, 999] // Abstract, Base, BSC, Polygon, Hyperliquid

  useEffect(() => {
    const fetchAllBalances = async () => {
      if (activeAccount && address) {
        try {
          const tokens = ["ETH", "USDC", "USDR", "kfUSD", "USDT"]
          const results = await Promise.all(
            tokens.map(token => fetchOmniAssetBalance(address, token, ENABLED_CHAINS))
          )

          const newOmniData: Record<string, OmniPortfolioItem> = {}
          results.forEach(res => {
            newOmniData[res.token] = res
          })
          setOmniData(newOmniData)

          const updatedData = tokenData2.map((item) => {
            const omni = newOmniData[item.token]
            if (omni) {
              return { 
                ...item, 
                tokenPrice: omni.totalBalance,
                isMultichain: omni.chains.length > 1,
                chains: omni.chains
              }
            }
            return { ...item, tokenPrice: "0" }
          })

          setUpdatedTokenData(updatedData)
        } catch (error) {
          console.error("Omni-fetch error:", error)
        }
      }
    }
    fetchAllBalances()
  }, [activeAccount, address])

  const handleDepositClick = (token: string) => {
    if (["ETH", "USDC", "USDR", "kfUSD", "USDT"].includes(token)) {
      setShowDepositModal(true)
    } else {
      toast.warning(`${token} support not available on the testnet.`, { duration: 1000 })
    }
  }

  const handleLendClick = (token: string) => {
    if (["ETH", "USDC", "USDR", "kfUSD", "USDT"].includes(token)) {
      setSelectedTokenForLend(token)
      setShowLendModal(true)
    } else {
      toast.warning(`${token} support not available on the testnet.`, { duration: 1000 })
    }
  }

  return (
    <div className="u-class-shadow-2 w-full rounded-xl bg-black/40 backdrop-blur-md border border-[#00ff99]/10 py-6 transition-all hover:border-[#00ff99]/30" {...(id ? { id } : {})}>
      <div className="mb-3 px-6 text-xl">
        <h3>Wallet&apos;s Portfolio</h3>
      </div>
      <div className="px-6 relative overflow-y-auto max-h-[220px] kaleido-scrollbar">
        <table className="min-w-full text-center text-sm">
          <thead>
            <tr className="text-center text-white/70">
              <th className="sticky top-0 py-2 text-start font-medium bg-[#060606] z-20">Asset</th>
              <th className="sticky top-0 py-2 text-center font-medium bg-[#060606] z-20">Wallet Balance</th>
              <th className="sticky top-0 py-2 text-center font-medium bg-[#060606] z-20">Collateral</th>
              <th className="sticky top-0 py-2 text-center font-medium bg-[#060606] z-20">Actions</th>
            </tr>
          </thead>
          <tbody>
            {updatedTokenData.map((item, index) => (
              <tr key={index} className="text-center text-xs sm:text-sm border-t border-white/5">
                <td className="flex flex-col pt-3 text-start">
                  <div className="flex items-center gap-2">
                    <img src={item.icon} alt={item.icon} className="w-4" />
                    <span>{item.token}</span>
                  </div>
                  {item.isMultichain && (
                    <div className="mt-1 flex gap-1">
                      {item.chains?.map((c: any) => (
                        <span key={c.chainId} className="px-1 py-0.5 rounded-[4px] bg-[#00ff99]/10 border border-[#00ff99]/30 text-[8px] text-[#00ff99] uppercase font-bold">
                          {c.chainName}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="pt-2">
                  <div className="flex flex-col items-center">
                    <span>{formatWithCommas(item.tokenPrice, item.token === "ETH" ? 4 : 3)}</span>
                  </div>
                </td>
                <td className="pt-2">
                  <div className="flex flex-col items-center">
                    <Image
                      src={
                        ["ETH", "USDC", "USDR", "kfUSD", "USDT"].includes(item.token)
                          ? "/mark.svg"
                          : "/toggleOff.svg"
                      }
                      alt="tick"
                      width={12}
                      height={10}
                      priority
                      quality={100}
                    />
                  </div>
                </td>
                <td className="pt-2">
                  <div className="flex justify-center gap-2">
                    <div onClick={() => handleDepositClick(item.token)}>
                      <Btn text={item.chains?.some((c: any) => c.chainId !== 2741 && c.chainId !== 11124) && parseFloat(item.tokenPrice) > 0 ? "Bridge" : "Deposit"} css="deposit-collateral-btn w-24 justify-center" />
                    </div>
                    <div onClick={() => handleLendClick(item.token)}>
                      <Btn text="Lend" css="lend-btn w-24 justify-center" />
                    </div>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      {/* Deposit Modal */}
      <DepositModal open={showDepositModal} onOpenChange={setShowDepositModal} action="deposit" />

      {/* Lend Modal (Create Order) */}
      <CreateOrderModal 
        isOpen={showLendModal} 
        onClose={() => setShowLendModal(false)} 
        initialToken={selectedTokenForLend}
      />
    </div>
  )
}

export default Collateral
