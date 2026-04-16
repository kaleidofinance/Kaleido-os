"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Spinner } from "@radix-ui/themes"
import Link from "next/link"
import { toast } from "sonner"
import { useLocalStorage } from "@/hooks/useLocalStorage"
import { useActiveAccount } from "thirdweb/react"
import { upsertUser } from "@/lib/supabase/useUpdateTable"

export default function CallbackPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [username, setUsername] = useLocalStorage<string | null>("xUsername", null)
  const [firstname, setFirstname] = useLocalStorage<string | null>("xfirstname", null)
  const [walletAddress, setWalletAddress] = useState<string | undefined>("")

  const activeAccount = useActiveAccount()
  const address = activeAccount?.address

  useEffect(() => {
    if (!address) {
      toast.error("Please connect your wallet")
      setLoading(false)
      return
    }

    setWalletAddress(address)
  }, [address])

  useEffect(() => {
    if (!walletAddress) return

    const fetchUser = async () => {
      try {
        setLoading(true)

        // If username and firstname already set, redirect
        // if (username && firstname) {
        //   router.push("/")
        //   return
        // }

        const res = await fetch("/api/auth/user")
        if (!res.ok) throw new Error("Failed to authenticate")
        const data = await res.json()

        const { username: resUsername, name: resFirstname } = data
        if (!resUsername || !resFirstname) throw new Error("Incomplete user data")

        setUsername(resUsername)
        setFirstname(resFirstname)

        const { error: upsertError } = await upsertUser(walletAddress, resUsername)
        if (upsertError) throw new Error("Database update failed")

        // router.push("/")
      } catch (err) {
        console.error("User fetch error:", err)
        setError(err instanceof Error ? err.message : "Unknown error occurred")
      } finally {
        setLoading(false)
      }
    }

    fetchUser()
  }, [walletAddress])

  // if (!address) {
  //   toast.error("Please connect your wallet")
  //   return (
  //     <div className="flex h-screen flex-col items-center justify-center">
  //       <p className="text-lg text-red-500">Wallet not connected</p>
  //     </div>
  //   )
  // }

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center">
        <p className="text-lg text-red-500">{error}</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex h-screen flex-col items-center justify-center">
        <p className="flex items-center space-x-2 text-lg">
          <Spinner className="h-5 w-5" />
          <span>Verifying...</span>
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col items-center justify-center">
      <h1 className="mb-4 text-2xl font-bold">
        {firstname ? `Welcome aboard, ${firstname}! Your wallet is now linked.` : ""}
      </h1>

      <p className="text-lg">{firstname ? "You've successfully linked your X account" : "Link your wallet"}</p>
      <Link href="/" className="mt-6">
        <button className="w-80 rounded-md bg-[#FF4D00] py-2 text-white transition hover:bg-[#E54300]">
          Go to Dashboard
        </button>
      </Link>
    </div>
  )
}
