"use client"

import {
  useConnectModal,
  useActiveAccount,
  useActiveWallet,
  useDisconnect,
  useActiveWalletChain,
  useSwitchActiveWalletChain,
  useWalletBalance,
} from "thirdweb/react"
import { abstractTestnet } from "thirdweb/chains"
import { client } from "@/config/client"
import { createWallet } from "thirdweb/wallets"
import { abstractWallet } from "@abstract-foundation/agw-react/thirdweb"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import * as DropdownMenu from "@radix-ui/react-dropdown-menu"
import { formatAddress } from "@/constants/utils/formatAddress"
import { useLocalStorage } from "@/hooks/useLocalStorage"
import { shareTechMono, zenDots } from "@/lib/font"

export default function ConnectWallet() {
  const { connect, isConnecting } = useConnectModal()
  const account = useActiveAccount()
  const wallet = useActiveWallet()
  const { disconnect } = useDisconnect()
  const activeChain = useActiveWalletChain()
  const switchActiveWalletChain = useSwitchActiveWalletChain()
  const { data, isLoading, isError } = useWalletBalance({
    chain: abstractTestnet,
    address: account?.address,
    client,
  })
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)

  // Check if user is on wrong chain
  const isWrongChain = account && activeChain?.id !== abstractTestnet.id

  function useUserStoreAddress(account?: { address?: string }) {
    return useLocalStorage("kaleidoAddress", account?.address || "")
  }

  const [userAddress, setUserAddress] = useUserStoreAddress(account)

  useEffect(() => {
    if (account?.address) {
      setUserAddress(account.address)
    }
  }, [account?.address, setUserAddress])

  const formatBalance = (balance: string | undefined) => {
    if (!balance) return "-"
    return parseFloat(balance).toFixed(4)
  }

  const handleSwitchChain = async () => {
    try {
      toast.info("Switching to Abstract Testnet...")
      await switchActiveWalletChain?.(abstractTestnet)
      toast.success("Successfully switched to Abstract Testnet")
    } catch (error) {
      toast.error("Failed to switch network. Please switch manually in your wallet.")
    }
  }

  const handleConnect = async () => {
    try {
      if (!account) {
        await connect({
          client,
          wallets: [
            abstractWallet(),
            createWallet("io.metamask"),
            createWallet("com.coinbase.wallet"),
            createWallet("me.rainbow"),
          ],
        })
      }
    } catch (err) {
      // console.error("Connection error", err)
    }
  }

  const handleDisconnect = () => {
    if (wallet) disconnect(wallet)
    setIsDropdownOpen(false)
  }

  return (
    <div className="relative">
      {!account ? (
        <button
          onClick={handleConnect}
          disabled={isConnecting}
          className="flex items-center gap-3 rounded-md bg-[#2a2a2a] px-3 py-2 text-xs text-[#36b169] md:p-3 md:text-sm"
        >
          {isConnecting ? "Connecting..." : "Connect Wallet"}
        </button>
      ) : (
        <DropdownMenu.Root open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
          <DropdownMenu.Trigger asChild>
            <button className="flex items-center gap-3 rounded-md bg-[#2a2a2a] px-3 py-2 text-xs text-[#36b169] md:p-3 md:text-sm">
              {isWrongChain ? (
                <>
                  <p className="text-red-600">Wrong network detected</p>
                </>
              ) : (
                formatAddress(account.address)
              )}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </DropdownMenu.Trigger>

          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className={`${shareTechMono.className} ${zenDots.variable} w-full rounded-lg border border-[#404040] bg-[#2a2a2a] shadow-xl`}
            >
              <div className="w-64 space-y-4 p-4">
                {/* Network status in dropdown */}
                {isWrongChain && (
                  <div className="border-b border-[#404040] pb-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="mb-1 text-xs text-[#9ca3af]">⚠️ Network</p>
                        <p className="text-sm text-yellow-400">Wrong Network</p>
                      </div>
                      <button
                        onClick={handleSwitchChain}
                        className="rounded bg-yellow-600 px-2 py-1 text-xs text-white transition-colors hover:bg-yellow-700"
                      >
                        Switch
                      </button>
                    </div>
                  </div>
                )}

                <div className="border-b border-[#404040] pb-4">
                  <p className="mb-1 text-xs text-[#9ca3af]">💰 Wallet Balance</p>
                  {isLoading ? (
                    <p className="animate-pulse text-sm text-[#9ca3af]">Loading...</p>
                  ) : isError ? (
                    <p className="text-sm text-red-400">Error loading balance</p>
                  ) : (
                    <p className="text-sm font-medium text-white">
                      {formatBalance(data?.displayValue)} <span className="text-[#36b169]">{data?.symbol}</span>
                    </p>
                  )}
                </div>

                <button
                  onClick={handleDisconnect}
                  className="w-full rounded-lg px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#2d9256]"
                  aria-label="Disconnect wallet"
                  type="button"
                >
                  Disconnect Wallet
                </button>
              </div>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
    </div>
  )
}
