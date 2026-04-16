"use client"

import React, { useState, useEffect, useCallback } from "react"
import { formatAddress } from "@/constants/utils/formatAddress"
import { shareTechMono, zenDots } from "@/lib/font"
import { useActiveAccount } from "thirdweb/react"
import Link from "next/link"
import { useLocalStorage } from "@/hooks/useLocalStorage"
import { toast } from "sonner"

interface UserProfileProps {
  referralPoint: number | null
  totalReferrals: number | null
}

export const UserProfile = ({ referralPoint, totalReferrals }: UserProfileProps) => {
  const activeAccount = useActiveAccount()
  const [clicked, setClick] = useState(false)
  const address = activeAccount?.address
  const [username, setUsername] = useLocalStorage<string | null>("xUsername", null)

  const REFERRAL_LINK = `https://app.kaleidofinance.xyz/?referral=${address}`

  const [copied, setCopied] = useState<"address" | "link" | null>(null)

  const handleCopy = useCallback(async (text: string, type: "address" | "link") => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(type)
      setTimeout(() => setCopied(null), 1500)
    } catch (error) {
      console.error("Failed to copy:", error)
    }
  }, [])

  const linkX = () => {
    setClick(true)
    if (!address) {
      return toast.warning("Connect wallet before Linking your X account")
    }

    window.location.href = "https://app.kaleidofinance.xyz/api/auth/twitter"
  }
  return (
    <div className={`relative p-5 bg-[#0f0f1a]/40 backdrop-blur-xl rounded-xl border border-[#00ff99]/20 shadow-[0_0_40px_rgba(0,0,0,0.3)] ${shareTechMono.className}`}>
      {/* Neon Corners */}
      <span className="absolute left-0 top-0 h-[10px] w-[10px] border-l border-t border-[#00ff99]"></span>
      <span className="absolute right-0 top-0 h-[10px] w-[10px] border-r border-t border-[#00ff99]"></span>
      <span className="absolute bottom-0 left-0 h-[10px] w-[10px] border-b border-l border-[#00ff99]"></span>
      <span className="absolute bottom-0 right-0 h-[10px] w-[10px] border-b border-r border-[#00ff99]"></span>

      <div id="user-profile-dropdown" className="space-y-6">
        {/* Wallet Address Section */}
        <div className="group">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-widest text-[#00ff99] font-bold">Encrypted Address</p>
            <button
              onClick={() => handleCopy(address as string, "address")}
              className="rounded-md border border-[#00ff99]/30 bg-[#00ff99]/5 px-3 py-1 text-[10px] uppercase font-bold text-[#00ff99] transition-all hover:bg-[#00ff99] hover:text-[#0f0f1a] shadow-[0_0_10px_rgba(0,255,153,0.1)]"
              type="button"
            >
              {copied === "address" ? "Success" : "Copy"}
            </button>
          </div>
          <div className="select-all break-all text-sm font-mono text-gray-400 bg-white/5 p-2 rounded-lg border border-white/5 transition-colors group-hover:border-[#00ff99]/10">
            {address ? address : "Address hidden"}
          </div>
        </div>

        {/* Referral Link Section */}
        <div className="group">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-widest text-[#00ff99] font-bold">Network Invite</p>
            <button
              onClick={() => handleCopy(REFERRAL_LINK, "link")}
              className="rounded-md border border-[#00ff99]/30 bg-[#00ff99]/5 px-3 py-1 text-[10px] uppercase font-bold text-[#00ff99] transition-all hover:bg-[#00ff99] hover:text-[#0f0f1a] shadow-[0_0_10px_rgba(0,255,153,0.1)]"
              type="button"
            >
              {copied === "link" ? "Success" : "Copy"}
            </button>
          </div>
          <div className="select-all break-all text-xs font-mono text-gray-500 bg-white/5 p-2 rounded-lg border border-white/5 transition-colors group-hover:border-[#00ff99]/10 truncate">
            {REFERRAL_LINK}
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-4 pt-2 border-t border-white/10">
          <div className="space-y-1">
            <p className="text-[10px] uppercase text-gray-500 font-bold">Total Nodes</p>
            <p className="text-xl font-bold text-white tracking-tighter">
              {totalReferrals !== null ? totalReferrals : "--"}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-[10px] uppercase text-gray-500 font-bold">Point System</p>
            <p className="text-xl font-bold text-[#00ff99] tracking-tighter shadow-green-glow">
              {referralPoint !== null ? referralPoint.toLocaleString() : "--"}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-8 flex flex-col items-center space-y-3">
        {username ? (
          <button
            disabled
            className="w-full flex items-center justify-center gap-2 rounded-lg border border-[#00ff99]/50 bg-[#00ff99]/20 py-3 text-sm font-bold text-[#00ff99] shadow-[0_0_20px_rgba(0,255,153,0.1)]"
          >
            <span className="w-2 h-2 rounded-full bg-[#00ff99] shadow-[0_0_8px_#00ff99]"></span>
            SIGNAL LINKED
          </button>
        ) : (
          <button
            onClick={linkX}
            disabled={clicked}
            className={`w-full py-3 rounded-lg text-sm font-bold uppercase tracking-widest transition-all duration-300 ${
              clicked 
                ? "bg-white/5 text-gray-600 cursor-not-allowed" 
                : "bg-[#00ff99] text-[#0f0f1a] hover:shadow-[0_0_25px_rgba(0,255,153,0.4)] hover:scale-[1.02]"
            }`}
          >
            {clicked ? "SYNCHRONIZING..." : "Link Signal (X)"}
          </button>
        )}

        <Link href="https://x.com/kaleido_finance" target="_blank" rel="noopener noreferrer" className="w-full">
          <button className="w-full py-3 rounded-lg border border-white/10 text-white text-sm font-bold uppercase tracking-widest transition-all hover:bg-white/5 hover:border-[#00ff99]/30">
            Follow Pulse
          </button>
        </Link>
      </div>
    </div>
  )
}

export default UserProfile
