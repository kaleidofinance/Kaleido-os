import StakeBoard from "@/components/stake/StakeBoard"
import StakeHeader from "@/components/stake/StakeHeader"
import React from "react"

export default function page() {
  return (
    <div className="flex flex-col space-y-10">
      <div className="pt-10">
        <StakeHeader />
      </div>
      <StakeBoard />
    </div>
  )
}
