"use client"

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { isAddress } from "ethers"
import { useRegisterReferral } from "@/hooks/useRegisterReferral"
import { useActiveAccount } from "thirdweb/react"
import { LoadingScreen } from "./ui/loading"

function ReferralHandler() {
  const searchParams = useSearchParams()
  // const [referralStored, setReferralStored] = useLocalStorage<string | null>("referralUpliner", null)
  const [referralStored, setReferralStored] = useState<string | null>(null)
  const { registerUpliner } = useRegisterReferral()
  const activeAccount = useActiveAccount()
  const address = activeAccount?.address

  // console.log("✅ referralStored initially:", referralStored)
  useEffect(() => {
    const referral = searchParams.get("referral")

    if (!referral || !isAddress(referral) || referral.toLowerCase() === address?.toLowerCase()) return

    if (referral !== referralStored) {
      setReferralStored(referral)
    }
  }, [searchParams, address, referralStored, setReferralStored])

  useEffect(() => {
    if (!referralStored || referralStored.toLowerCase() === address?.toLowerCase()) return
    registerUpliner(referralStored)
  }, [referralStored, registerUpliner, address])

  return null
}

export default function ExposedReferralHandler() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <ReferralHandler />
    </Suspense>
  )
}
