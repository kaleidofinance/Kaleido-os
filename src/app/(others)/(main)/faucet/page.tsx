"use client"
import PleaseConnect from "@/components/shared/PleaseConnect"
import React, { useEffect, useState } from "react"
import { Spinner } from "@radix-ui/themes"
import { useActiveAccount } from "thirdweb/react"
import useClaimToken from "@/hooks/useClaimToken"

const FaucetPage = () => {
  const [isClient, setIsClient] = useState(false)
  const activeAccount = useActiveAccount()
  const address = activeAccount?.address
  const { claimToken, claimKLDToken } = useClaimToken()

  useEffect(() => {
    setIsClient(true)
  }, [])

  if (!isClient) {
    return (
      <div className="my-64 flex justify-center text-[#00ff6e]">
        <Spinner size={"3"} />
      </div>
    )
  }


  return (
    <div className="relative mt-10 md:mt-20 flex min-h-full items-center justify-center px-4 mb-20">
      <div className="w-full max-w-xl mx-auto rounded-3xl border border-green-500/30 bg-black/80 p-6 md:p-10">
        <h1 className="mb-4 flex items-center gap-2 font-mono text-2xl md:text-4xl font-extrabold text-[#00ff6e] drop-shadow-[0_0_10px_#00ff6e]">
          <span role="img" aria-label="droplet">
            💧
          </span>{" "}
          Kaleido Faucet
        </h1>
        <p className="mb-8 font-mono text-sm md:text-base text-gray-300">
          Claim free testnet USDC to try out Kaleido’s DeFi platform on the Abstract testnet.
        </p>

        <div className="flex flex-col space-y-4">
          <button
            onClick={activeAccount ? claimToken : () => {}}
            className={`w-full rounded-xl bg-gradient-to-r from-[#00ff6e] to-[#00bfff] px-6 py-4 font-mono text-lg font-bold text-black shadow-[0_0_16px_#00ff6e] transition hover:from-[#00bfff] hover:to-[#00ff6e] hover:text-white ${!activeAccount ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {activeAccount ? "Claim 100 USDC" : "Connect Wallet to Claim"}
          </button>
          <button
            onClick={activeAccount ? claimKLDToken : () => {}}
            className={`w-full rounded-xl bg-gradient-to-r from-[#FF4D00] to-[#ff7a33] px-6 py-4 font-mono text-lg font-bold text-black shadow-[0_0_16px_#7c3aed] transition hover:bg-[#FF4D0022] hover:text-white ${!activeAccount ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {activeAccount ? "Claim 10,000 KLD" : "Connect Wallet to Claim"}
          </button>
        </div>

        <div className="mt-8 border-t border-[#00ff6e]/20 pt-6 text-center font-mono text-xs md:text-sm text-gray-400">
          ⏱️ Cooldown: 10 hours per claim
          <br />
          🔗 Network: <span className="text-[#00ff6e]">Abstract Testnet</span>
          <br />
          🛠 Built by <span className="text-[#00ff6e]">Kaleido</span>
        </div>
      </div>
    </div>
  )
}
export default FaucetPage
