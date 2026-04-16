"use client"

import { Btn } from "@/components/shared/Btn"
import useAcceptListedAds from "@/hooks/useAcceptListedAds"
import { useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

export default function BorrowAllocationPage() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const listingId = searchParams.get("listingId")
  const maxAmount = parseFloat(searchParams.get("maxAmount") || "0")
  const minAmount = parseFloat(searchParams.get("minAmount") || "0")
  const tokenType = searchParams.get("tokenType")

  const [borrowAmount, setBorrowAmount] = useState("")

  const acceptAds = useAcceptListedAds()

  const handleCancel = () => {
    router.push("/marketplace")
  }

  // Function to handle input change
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value

    // Regex to check if value has more than 3 decimals
    if (value.includes(".")) {
      const [integerPart, decimalPart] = value.split(".")
      if (decimalPart.length > 3) {
        value = `${integerPart}.${decimalPart.slice(0, 9)}`
      }
    }

    setBorrowAmount(value)
  }

  const handleAccept = () => {
    if (!tokenType) return toast.warning("Token type is required")
    if (Number(borrowAmount) < minAmount) return toast.warning(`Can't take less than ${minAmount} ${tokenType}`)
    if (Number(borrowAmount) > maxAmount) return toast.warning(`Can't take more than ${maxAmount} ${tokenType}`)

    acceptAds(Number(listingId), borrowAmount, tokenType)
  }

  return (
    <div className="flex h-screen items-center">
      <div className="u-class-shadow rounded-md bg-black px-4 py-2 text-white">
        <p className="text-base">Borrow</p>

        <div className="my-6 w-72 sm:w-96">
          <p className="text-[14.6px]">Borrow Allocation</p>
          <div className="mt-2 w-full rounded-lg bg-white">
            {/* Input field for borrow amount */}
            <input
              type="number"
              value={borrowAmount}
              onChange={handleChange}
              placeholder={`Enter amount from ${minAmount.toFixed(3)} to ${maxAmount.toFixed(3)}`}
              className="w-full rounded-lg border border-white bg-transparent px-3 py-2 text-black"
            />
          </div>

          <div className="mt-6 flex items-center justify-between text-base">
            <div className="w-[121px]">
              <div className="w-full rounded-lg border border-white py-3">
                <p className="pl-4">
                  {minAmount.toFixed(3) || 0} {tokenType}
                </p>
              </div>
              <p className="mt-1 text-center text-[10px] font-medium">Lower Limit</p>
            </div>

            <div className="text-2xl">-</div>

            <div className="w-[121px]">
              <div className="w-full rounded-lg border border-white py-3">
                <p className="pl-4">
                  {maxAmount.toFixed(3) || 0} {tokenType}
                </p>
              </div>
              <p className="mt-1 text-center text-[10px] font-medium">Upper Limit</p>
            </div>
          </div>
        </div>

        <div className="my-4 cursor-pointer" onClick={handleAccept}>
          <Btn
            text={"Borrow"}
            css="text-black bg-[#FF4D00CC]/80 text-base w-full py-2 rounded flex items-center justify-center"
          />
        </div>

        <div className="mb-4 cursor-pointer" onClick={handleCancel}>
          <Btn
            text={"Cancel"}
            css="text-black bg-[#a2a8b4]/80 text-base w-full py-2 rounded flex items-center justify-center"
          />
        </div>
      </div>
    </div>
  )
}
