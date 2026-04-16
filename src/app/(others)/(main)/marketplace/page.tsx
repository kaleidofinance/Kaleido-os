"use client"

import { useState, useEffect } from "react"
import MktHeader from "@/components/market/MktHeader"
import CardLayout from "@/components/market/CardLayout"
import PleaseConnect from "@/components/shared/PleaseConnect"
import { Spinner } from "@radix-ui/themes"
import { useActiveAccount } from "thirdweb/react"
import { DataFiltersPanel } from "@/components/filter/DataFiltersPanel"
import Joyride from "react-joyride"
import { IoMdCompass } from "react-icons/io"

export default function MarketPlacePage() {
  const activeAccount = useActiveAccount()
  const address = activeAccount?.address
  const [isClient, setIsClient] = useState(false)
  const [runTour, setRunTour] = useState(false)
  const [showTourDropdown, setShowTourDropdown] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setIsClient(true)
    setMounted(true)
  }, [])

  const marketplaceTourSteps = [
    {
      target: '[data-tour="filter-card"]',
      content: "Here you can control the display of available lend and borrow offers.",
      placement: "bottom",
      disableBeacon: true,
    },
    {
      target: '[data-tour="token-type-section"]',
      content: "Select your preferred token type here.",
      placement: "bottom",
      disableBeacon: true,
    },
    {
      target: '[data-tour="loan-status-section"]',
      content: "Select the current status of the loan to filter offers.",
      placement: "bottom",
      disableBeacon: true,
    },
    {
      target: '[data-tour="interest-section"]',
      content: "Adjust your preferred interest rate.",
      placement: "bottom",
      disableBeacon: true,
    },
    {
      target: '[data-tour="volume-section"]',
      content: "Select the volume of the lend or borrow offer.",
      placement: "bottom",
      disableBeacon: true,
    },
  ]

  if (!isClient) {
    return (
      <div className="my-64 flex justify-center text-[#00ff6e]">
        <Spinner size={"3"} />
      </div>
    )
  }


  return (
    <div className="w-full mt-4 md:mt-10 px-4">
      <div className="w-full px-1">
        <div className="mb-8">
          <MktHeader />
        </div>
        <div className="flex flex-col space-y-4">
          <div className="flex flex-col space-y-2">
            {/* <h2 className="text-lg font-semibold">Filter By</h2> */}
            <DataFiltersPanel />
          </div>
          <div>
            <CardLayout />
          </div>
        </div>
        {/* Floating Tour Button */}
        <div className="fixed bottom-28 right-5 z-50 flex flex-col items-end">
          <div className="group relative">
            <button
              className="mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-xl text-white shadow-lg hover:bg-blue-700"
              onClick={() => setShowTourDropdown((prev) => !prev)}
              aria-label="Open Tour Menu"
              type="button"
            >
              <IoMdCompass />
            </button>
            {/* Tooltip on hover */}
            {!showTourDropdown && (
              <div className="absolute bottom-20 right-0 z-50 mb-2 hidden flex-col items-end group-hover:flex">
                <div className="mr-2 whitespace-nowrap rounded-lg bg-[#2a2a2a] px-3 py-2 text-xs font-medium text-white shadow-lg">
                  Available page tours
                </div>
                <div className="mr-6 mt-[-6px] h-3 w-3 rotate-45 bg-[#2a2a2a]"></div>
              </div>
            )}
            {showTourDropdown && (
              <div className="absolute bottom-16 right-0 w-60 rounded-xl border border-gray-200 bg-white px-0.5 py-2 shadow-2xl">
                <div className="select-none border-b border-gray-100 px-5 py-2 text-lg font-semibold tracking-wide text-gray-700">
                  Tours
                </div>
                <button
                  className="w-full rounded-lg px-5 py-3 text-left font-medium text-gray-800 transition-colors duration-150 hover:bg-[#f3f4f6] hover:text-[#22c55e] focus:outline-none"
                  onClick={() => {
                    setRunTour(true)
                    setShowTourDropdown(false)
                  }}
                >
                  Marketplace Tutorial
                </button>
              </div>
            )}
          </div>
        </div>
        {/* Joyride */}
        {mounted && (
          <Joyride
            steps={marketplaceTourSteps as any}
            run={runTour}
            continuous
            showSkipButton
            showProgress
            spotlightClicks={true}
            styles={{
              options: {
                zIndex: 10000,
                primaryColor: "#22c55e",
                textColor: "#222",
                arrowColor: "#fff",
                backgroundColor: "#fff",
                overlayColor: "rgba(0,0,0,0.4)",
              },
              buttonNext: {
                backgroundColor: "#22c55e",
                color: "#fff",
                fontWeight: 600,
                borderRadius: "6px",
                fontFamily: "Arial, Helvetica, sans-serif",
              },
              buttonBack: {
                color: "#22c55e",
                fontFamily: "Arial, Helvetica, sans-serif",
              },
              buttonSkip: {
                color: "#22c55e",
                fontFamily: "Arial, Helvetica, sans-serif",
              },
              tooltip: {
                fontFamily: "Arial, Helvetica, sans-serif",
                fontSize: "1rem",
                color: "#222",
                backgroundColor: "#fff",
                borderRadius: "10px",
                boxShadow: "0 2px 16px 0 rgba(34,197,94,0.10)",
              },
              tooltipTitle: {
                fontFamily: "Arial, Helvetica, sans-serif",
                fontWeight: 700,
                color: "#22c55e",
              },
            }}
            locale={{
              last: "Finish",
            }}
            callback={(data) => {
              if (data.status === "finished" || data.status === "skipped") setRunTour(false)
            }}
          />
        )}
      </div>
    </div>
  )
}
