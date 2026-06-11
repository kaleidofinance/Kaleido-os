"use client"

import { formatAddress } from "@/constants/utils/formatAddress"
import { Spinner } from "@radix-ui/themes"
import { useConnectModal } from "@rainbow-me/rainbowkit"
import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import React, { useState, useEffect } from "react"
import ConnectWallet from "@/context/thirdwebConnect"
import { Link2Icon } from "@radix-ui/react-icons"
import Dropdown from "../ui/dropDown"
import UserProfile from "../user/UserProfile"
import useGetValueAndHealth from "@/hooks/useGetValueAndHealth"
import { BellIcon } from '@radix-ui/react-icons'
import { useNotifications } from "@/context/NotificationsContext"
import { useActiveAccount } from "thirdweb/react"

export const Header = () => {
  const pathname = usePathname()
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isOpen, setIsOpen] = useState<boolean>(false)
  const [mounted, setMounted] = useState(false)
  const [showNotifications, setShowNotifications] = useState(false)
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications()
  const activeAccount = useActiveAccount()
  
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20)
    }
    window.addEventListener("scroll", handleScroll)
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  const { totalReferrals, referralPoint } = useGetValueAndHealth()

  useEffect(() => {
    setMounted(true)
  }, [])

  // Track current user address for notification filtering - separate effect for immediate update
  useEffect(() => {
    if (activeAccount?.address) {
      // Store the current user address in window object for notification filtering
      (window as any).kaleido_current_user_address = activeAccount.address;
      console.log('🔑 Updated current user address for notifications:', activeAccount.address);
    } else {
      // Clear user address when wallet is disconnected
      (window as any).kaleido_current_user_address = null;
      console.log('🔑 Cleared user address (wallet disconnected)');
    }
  }, [activeAccount?.address])

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'success': return 'bg-green-500'
      case 'warning': return 'bg-yellow-500'
      case 'error': return 'bg-red-500'
      default: return 'bg-blue-500'
    }
  }

  const formatTimestamp = (timestamp: number) => {
    const now = Date.now()
    const diff = now - timestamp
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)
    
    if (days > 0) return `${days}d ago`
    if (hours > 0) return `${hours}h ago`
    if (minutes > 0) return `${minutes}m ago`
    return 'Just now'
  }

  const isActive = (path: string) => {
    return pathname === path ? "active-link active" : "active-link"
  }

  const toggleMenu = () => {
    setIsMenuOpen(!isMenuOpen)
  }

  return (
    <header
      className={`sticky left-0 top-0 z-[100] w-full transition-all duration-300 ${
        scrolled
          ? "bg-black/80 backdrop-blur-xl py-3 md:py-4 border-b border-[#00ff99]/30 shadow-[0_4px_30px_rgba(0,255,153,0.1)]"
          : "bg-black/40 backdrop-blur-md p-4 md:p-6 border-b border-[#00ff99]/10"
      }`}
    >
      {/* Corner Borders */}
      <span className="absolute left-0 top-0 h-[10px] w-[10px] border-l border-t border-[#00ff99]"></span>
      <span className="absolute right-0 top-0 h-[10px] w-[10px] border-r border-t border-[#00ff99]"></span>
      <span className="absolute bottom-0 left-0 h-[10px] w-[10px] border-b border-l border-[#00ff99]"></span>
      <span className="absolute bottom-0 right-0 h-[10px] w-[10px] border-b border-r border-[#00ff99]"></span>

      <div className="flex w-full flex-wrap items-center justify-between gap-4 lg:flex-nowrap">
        {/* Logo Section */}
        <Link href="/" className="block shrink-0">
          <Image
            src="/newkal.png"
            alt="Orange Logo"
            priority
            quality={100}
            height={100}
            width={100}
            className=""
          />
        </Link>

        {/* Mobile Menu Button */}
        <button className="ml-auto block text-white focus:outline-none lg:hidden" onClick={toggleMenu}>
          {isMenuOpen ? (
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>

        {/* Desktop Navigation */}
        <nav className="fixedText hidden flex-1 items-center justify-center space-x-6 font-[family-name:var(--font-zenDots)] text-sm font-medium lg:flex">
          <Link href="/" className={isActive("/dashboard")}>Dashboard</Link>
          <Link href="/marketplace" className={isActive("/marketplace")}>Marketplace</Link>
          <Link href="/swap" className={isActive("/swap")}>Trade</Link>
          <Link href="/pool" className={isActive("/pool")}>Liquidity</Link>
          <Link href="/stable" className={isActive("/stable")}>Stable</Link>
          <Link href="/faucet" className={isActive("/faucet")}>Faucet</Link>
          <Link href="/stake" className={isActive("/stake")}>Stake</Link>
          <Link href="/leaderboard" className={`${isActive("/leaderboard")} flex items-center gap-1`}>
            <span>🏆</span> Leaderboard
          </Link>
        </nav>

        {/* User Actions Section */}
        <div className="flex shrink-0 items-center gap-2">
          {/* Notifications Icon (Keep visible) */}
          <div className="relative">
            <button
              className="relative flex items-center justify-center p-2 text-white hover:text-[#36b169] focus:outline-none"
              aria-label="Notifications"
              onClick={() => setShowNotifications((prev) => !prev)}
            >
              <BellIcon width={22} height={22} />
              {/* Red dot for unread notifications */}
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs text-white">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
            
            {/* Notifications Panel */}
            {showNotifications && (
              <>
                {/* Backdrop to close modal when clicking outside */}
                <div 
                  className="fixed inset-0 z-40" 
                  onClick={() => setShowNotifications(false)}
                ></div>
                <div className="absolute right-0 top-12 z-50 w-80 sm:w-96 rounded-2xl bg-[#0f0f1a]/95 backdrop-blur-2xl p-5 shadow-[0_0_50px_rgba(0,0,0,0.5),0_0_20px_rgba(0,255,153,0.1)] border border-[#00ff99]/30 text-white max-h-[500px] overflow-y-auto">
                  {/* Neon Corners */}
                  <span className="absolute left-0 top-0 h-[8px] w-[8px] border-l border-t border-[#00ff99]"></span>
                  <span className="absolute right-0 top-0 h-[8px] w-[8px] border-r border-t border-[#00ff99]"></span>
                  <span className="absolute bottom-0 left-0 h-[8px] w-[8px] border-b border-l border-[#00ff99]"></span>
                  <span className="absolute bottom-0 right-0 h-[8px] w-[8px] border-b border-r border-[#00ff99]"></span>

                  <div className="flex items-center justify-between mb-5">
                    <h3 className="text-lg font-bold text-[#00ff99] tracking-tight uppercase">System Logs</h3>
                    {unreadCount > 0 && (
                      <button
                        onClick={markAllAsRead}
                        className="text-xs text-gray-400 hover:text-[#00ff99] transition-colors uppercase font-medium"
                      >
                        Purge Unread
                      </button>
                    )}
                  </div>
                
                {notifications.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 space-y-3 opacity-60">
                    <BellIcon width={32} height={32} className="text-[#00ff99]/30" />
                    <div className="text-sm font-medium text-gray-400 uppercase tracking-widest">
                      Zero Anomalies Detected
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Show only the first 3 notifications in the dropdown for better density */}
                    {notifications.slice(0, 3).map((notification) => (
                      <div
                        key={notification.id}
                        className={`p-4 rounded-xl border transition-all duration-200 cursor-pointer ${
                          notification.read 
                            ? 'bg-white/5 border-white/10 opacity-70' 
                            : 'bg-[#00ff99]/5 border-[#00ff99]/20 shadow-[0_0_15px_rgba(0,255,153,0.05)]'
                        }`}
                        onClick={() => markAsRead(notification.id)}
                      >
                        <div className="flex items-start gap-4">
                          <div className={`mt-1.5 w-2 h-2 shrink-0 rounded-full ${
                            notification.read ? 'bg-gray-600' : 'bg-[#00ff99] shadow-[0_0_8px_#00ff99] animate-pulse'
                          }`}></div>
                          
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-start mb-1">
                              <div className={`font-bold text-sm ${notification.read ? 'text-gray-300' : 'text-white'}`}>
                                {notification.title}
                              </div>
                              <div className="text-[10px] text-gray-500 font-mono">
                                {formatTimestamp(notification.timestamp)}
                              </div>
                            </div>
                            <div className="text-xs text-gray-400 leading-relaxed line-clamp-2">{notification.body}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                    
                    {/* Footnote & Actions */}
                    <div className="pt-4 border-t border-white/10 flex flex-col gap-3">
                      {notifications.length > 3 && (
                        <div className="text-center text-[10px] text-gray-500 uppercase tracking-tighter">
                          + {notifications.length - 3} additional signal{notifications.length - 3 > 1 ? 's' : ''} in buffer
                        </div>
                      )}
                      
                      <Link 
                        href="/notifications" 
                        onClick={() => setShowNotifications(false)}
                        className="w-full py-2.5 rounded-lg bg-[#00ff99]/10 hover:bg-[#00ff99]/20 border border-[#00ff99]/30 text-[#00ff99] transition-all text-center text-xs font-bold uppercase tracking-widest shadow-[0_0_15px_rgba(0,255,153,0.1)]"
                      >
                        Access Archives
                      </Link>
                    </div>
                  </div>
                )}
              </div>
              </>
            )}
          </div>

          <Dropdown
            trigger={<Image src="/User.svg" alt="User icon" width={20} height={20} priority quality={100} />}
            side="top"
            align="center"
          >
            <div className="text-white">
              <UserProfile referralPoint={referralPoint} totalReferrals={totalReferrals} />
            </div>
          </Dropdown>
          
          <div className="flex cursor-pointer items-center gap-2">
            {!mounted ? (
              <div className="ml-2 rounded-md bg-[#2a2a2a] px-5 py-2 text-sm text-[#2fa05e]">
                <Spinner />
              </div>
            ) : (
              <div className="hidden lg:flex cursor-pointer items-center gap-2">
                <Link
                  href="https://native-bridge.abs.xyz/bridge/?network=abstract-testnet"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <button className="flex items-center gap-3 rounded-md bg-[#2a2a2a] px-3 py-2 text-xs text-[#36b169] md:p-3 md:text-sm">
                    <Link2Icon className="h-4 w-4 sm:hidden md:h-5 md:w-5" />
                    <span className="hidden sm:inline">Bridge to Abstract</span>
                  </button>
                </Link>
                <ConnectWallet />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile Navigation Overlay */}
      {isMenuOpen && (
        <div className="absolute left-0 top-full h-screen w-full bg-black/95 backdrop-blur-xl lg:hidden flex flex-col items-center pt-10 gap-6 z-[999]">
          <nav className="flex flex-col items-center space-y-6 font-[family-name:var(--font-zenDots)] text-lg">
            <Link 
              href="/" 
              className={`${isActive("/dashboard")} hover:text-[#00ff99] transition-colors`}
              onClick={() => setIsMenuOpen(false)}
            >
              Dashboard
            </Link>
            <Link 
              href="/marketplace" 
              className={`${isActive("/marketplace")} hover:text-[#00ff99] transition-colors`}
              onClick={() => setIsMenuOpen(false)}
            >
              Marketplace
            </Link>
            <Link 
              href="/swap" 
              className={`${isActive("/swap")} hover:text-[#00ff99] transition-colors`}
              onClick={() => setIsMenuOpen(false)}
            >
              Trade
            </Link>
            <Link 
              href="/pool" 
              className={`${isActive("/pool")} hover:text-[#00ff99] transition-colors`}
              onClick={() => setIsMenuOpen(false)}
            >
              Liquidity
            </Link>
            <Link 
              href="/stable" 
              className={`${isActive("/stable")} hover:text-[#00ff99] transition-colors`}
              onClick={() => setIsMenuOpen(false)}
            >
              Stable
            </Link>
            <Link 
              href="/faucet" 
              className={`${isActive("/faucet")} hover:text-[#00ff99] transition-colors`}
              onClick={() => setIsMenuOpen(false)}
            >
              Faucet
            </Link>
            <Link 
              href="/stake" 
              className={`${isActive("/stake")} hover:text-[#00ff99] transition-colors`}
              onClick={() => setIsMenuOpen(false)}
            >
              Stake
            </Link>
            <Link 
              href="/leaderboard" 
              className={`${isActive("/leaderboard")} hover:text-[#00ff99] transition-colors flex items-center gap-2`}
              onClick={() => setIsMenuOpen(false)}
            >
              🏆 Leaderboard
            </Link>

            {/* Mobile Menu Actions */}
            <div className="mt-4 flex flex-col items-center gap-4">
              <Link
                href="https://native-bridge.abs.xyz/bridge/?network=abstract-testnet"
                target="_blank"
                rel="noopener noreferrer"
              >
                <button className="flex items-center gap-2 rounded-md bg-[#2a2a2a] px-4 py-3 text-sm text-[#36b169]">
                   <Link2Icon className="h-5 w-5" />
                   <span>Bridge to Abstract</span>
                </button>
              </Link>
              <ConnectWallet />
            </div>
          </nav>
        </div>
      )}
    </header>
  )
}
