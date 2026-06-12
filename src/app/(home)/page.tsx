"use client"

import Image from "next/image"
import Balance from "@/components/dashboard/Balance"
import Collateral from "@/components/dashboard/Collateral"
import DashboardCard from "@/components/dashboard/DashboardCard"
import Usage from "@/components/dashboard/Usage"
import useGetValueAndHealth from "@/hooks/useGetValueAndHealth"
import { formatAddress } from "@/constants/utils/formatAddress"
import { useEffect, useState } from "react"
import useGetActiveRequest from "@/hooks/useGetActiveRequest"
import { capitalizeFirstLetter } from "@/constants/utils/capitaliseFirstUser"
import { Request } from "@/constants/types"
import { batteryCSS } from "@/constants/utils/batteryCSS"
import { useActiveAccount } from "thirdweb/react"
import { formatPoints } from "@/constants/utils/formatpoints"
import { formatPortfolioValue } from "@/constants/utils/portfolioformat"
import { ChatbotLoader } from "@/components/chatbot/ChatbotLoader"
import Joyride, { Step } from "react-joyride"
import { IoMdCompass } from "react-icons/io"
import { shareTechMono, zenDots } from "@/lib/font"

export default function DashboardPage() {
  const [user, setUser] = useState("User")
  const [health, setHealth] = useState<number | string>("0")
  const [fig, setFig] = useState<number | string>(0)
  const [runTour, setRunTour] = useState(false)
  const [runPageTour, setRunPageTour] = useState(false)
  const [showTourDropdown, setShowTourDropdown] = useState(false)
  const [mounted, setMounted] = useState(false)

  // Autonomous Tour States
  const [pageStepIndex, setPageStepIndex] = useState(0)
  const [collateralStepIndex, setCollateralStepIndex] = useState(0)
  const AUTO_ADVANCE_MS = 6000 // 6 seconds per step

  const activeAccount = useActiveAccount()

  const address = activeAccount?.address
  const { data, data2, collateralVal, referralPoint } = useGetValueAndHealth()
  const activeReq = useGetActiveRequest()

  // console.log("DATAAAAA", data2)

  const dashboardTourSteps = [
    {
      target: "#collateral-card",
      content: "Choose a collateral to deposit. This card shows your available assets.",
      placement: "bottom",
      disableBeacon: true,
    },
    {
      target: ".deposit-collateral-btn",
      content: "Click this button to deposit collateral for the selected asset.",
      placement: "left",
      disableBeacon: true,
    },
    {
      target: "#balances-card",
      content:
        "Once deposited, you can view your deposited collateral here. You can also deposit more or withdraw from this card.",
      placement: "bottom",
      disableBeacon: true,
    },
  ]

  const pageTourSteps = [
    {
      target: '[data-tour="total-portfolio"]',
      content:
        "This is where you see the total value of your deposited collateral. Note: you must deposit collateral before it reflects. It is not your wallet balance.",
      placement: "bottom",
      disableBeacon: true,
    },
    {
      target: '[data-tour="point-balance"]',
      content: "This is where you see your reward by interacting with this testnet.",
      placement: "bottom",
      disableBeacon: true,
    },
    {
      target: '[data-tour="health-factor"]',
      content: "Shows you how safe your loans are (Ask Luca for more details).",
      placement: "bottom",
      disableBeacon: true,
    },
    {
      target: "#collateral-card",
      content: "You can deposit any token you currently have in your wallet. This card lets you deposit collateral.",
      placement: "bottom",
      disableBeacon: true,
    },
    {
      target: "#balances-card",
      content: "View and manage all your deposited collaterals.",
      placement: "bottom",
      disableBeacon: true,
    },
    {
      target: "#usage-card",
      content: "View your usage metrics and create an order.",
      placement: "bottom",
      disableBeacon: true,
    },
  ]

  useEffect(() => {
    // console.log("activeReq:", activeReq)
    const fetchData = async () => {
      if (activeAccount && address) {
        try {
          setUser(formatAddress(address))

          const allRepaymentsZero = activeReq?.every((request: Request) => Number(request.totalRepayment) == 0)

          if (allRepaymentsZero && Number(data) > 0) {
            setHealth("∞")
          } else {
            const healthFactor = parseFloat(String(Number(data2) * 1e-18)).toFixed(2)
            setHealth(healthFactor)
          }
          // const portFig = data ? Number(ethers.formatEther(String(data))) : 0;
          const formattedValue = Number(data) / 1e16
          setFig(formattedValue.toFixed(2))
        } catch (error) {
          // console.error("Error fetching data:", error)
          setUser(formatAddress(address))
          setHealth("N/A")
          setFig(0)
        }
      } else {
        setUser("User")
        setHealth("0")
        setFig(0)
      }
    }

    fetchData()
  }, [activeAccount, address, collateralVal, data2, data, activeReq])

  // Listen for dashboard tour trigger from chatbot
  useEffect(() => {
    const startDashboard = () => setRunPageTour(true)
    const startCollateral = () => setRunTour(true)

    window.addEventListener("startDashboardTour", startDashboard)
    window.addEventListener("startCollateralTour", startCollateral)

    return () => {
      window.removeEventListener("startDashboardTour", startDashboard)
      window.removeEventListener("startCollateralTour", startCollateral)
    }
  }, [])

  // Autonomous Tour Timers
  useEffect(() => {
    let timer: any
    if (runPageTour) {
      timer = setInterval(() => {
        setPageStepIndex((prev) => {
          if (prev >= pageTourSteps.length - 1) {
            setRunPageTour(false)
            return 0
          }
          return prev + 1
        })
      }, AUTO_ADVANCE_MS)
    }
    return () => clearInterval(timer)
  }, [runPageTour, pageTourSteps.length])

  useEffect(() => {
    let timer: any
    if (runTour) {
      timer = setInterval(() => {
        setCollateralStepIndex((prev) => {
          if (prev >= dashboardTourSteps.length - 1) {
            setRunTour(false)
            return 0
          }
          return prev + 1
        })
      }, AUTO_ADVANCE_MS)
    }
    return () => clearInterval(timer)
  }, [runTour, dashboardTourSteps.length])

  const handleJoyrideCallback = (data: any, tour: "page" | "collateral") => {
    const { action, index, status, type } = data
    if (status === "finished" || status === "skipped") {
      if (tour === "page") {
        setRunPageTour(false)
        setPageStepIndex(0)
      } else {
        setRunTour(false)
        setCollateralStepIndex(0)
      }
    } else if (type === "step:after") {
      if (tour === "page") {
        setPageStepIndex(index + (action === "prev" ? -1 : 1))
      } else {
        setCollateralStepIndex(index + (action === "prev" ? -1 : 1))
      }
    }
  }

  useEffect(() => {
    setMounted(true)
    // Auto-trigger page tour on first visit, but only after WelcomeDialog is closed
    if (typeof window !== "undefined") {
      const tourShown = localStorage.getItem("kaleido_home_tour_shown")
      if (!tourShown) {
        // Listen for WelcomeDialog close event
        const handleWelcomeClosed = () => {
          setRunPageTour(true)
          localStorage.setItem("kaleido_home_tour_shown", "true")
          window.removeEventListener("kaleido_welcome_closed", handleWelcomeClosed)
        }
        window.addEventListener("kaleido_welcome_closed", handleWelcomeClosed)
      }
    }
  }, [])

  return (
    <div className="w-full p-4">
      <div className="w-full">
        <h3 className="mb-4 text-xl">
          {"Welcome, "}
          <span className="text-[#00dd55]">{capitalizeFirstLetter(user)}</span>
        </h3>
        {mounted && (
          <>
            <Joyride
              steps={pageTourSteps as any}
              run={runPageTour}
              stepIndex={pageStepIndex}
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
                  fontFamily: `var(${zenDots.variable}), ${shareTechMono.style.fontFamily}`,
                },
                buttonBack: {
                  color: "#22c55e",
                  fontFamily: `var(${zenDots.variable}), ${shareTechMono.style.fontFamily}`,
                },
                buttonSkip: {
                  color: "#22c55e",
                  fontFamily: `var(${zenDots.variable}), ${shareTechMono.style.fontFamily}`,
                },
                tooltip: {
                  fontFamily: `var(${zenDots.variable}), ${shareTechMono.style.fontFamily}`,
                  fontSize: "1rem",
                  color: "#222",
                  backgroundColor: "#fff",
                  borderRadius: "10px",
                  boxShadow: "0 2px 16px 0 rgba(34,197,94,0.10)",
                },
                tooltipTitle: {
                  fontWeight: 700,
                  color: "#22c55e",
                  fontFamily: `var(${zenDots.variable}), ${shareTechMono.style.fontFamily}`,
                },
              }}
              locale={{
                last: "Finish",
                next: "Next",
                skip: "Skip",
                back: "Back",
                close: "Close",
              }}
              callback={(data) => handleJoyrideCallback(data, "page")}
            />

            <Joyride
              steps={dashboardTourSteps as any}
              run={runTour}
              stepIndex={collateralStepIndex}
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
                  fontFamily: `var(${zenDots.variable}), ${shareTechMono.style.fontFamily}`,
                },
                buttonBack: {
                  color: "#22c55e",
                  fontFamily: `var(${zenDots.variable}), ${shareTechMono.style.fontFamily}`,
                },
                buttonSkip: {
                  color: "#22c55e",
                  fontFamily: `var(${zenDots.variable}), ${shareTechMono.style.fontFamily}`,
                },
                tooltip: {
                  fontFamily: `var(${zenDots.variable}), ${shareTechMono.style.fontFamily}`,
                  fontSize: "1rem",
                  color: "#222",
                  backgroundColor: "#fff",
                  borderRadius: "10px",
                  boxShadow: "0 2px 16px 0 rgba(34,197,94,0.10)",
                },
                tooltipTitle: {
                  fontFamily: `var(${zenDots.variable}), ${shareTechMono.style.fontFamily}`,
                  fontWeight: 700,
                  color: "#22c55e",
                },
              }}
              locale={{
                last: "Finish",
                next: "Next",
                skip: "Skip",
                back: "Back",
                close: "Close",
              }}
              callback={(data) => handleJoyrideCallback(data, "collateral")}
            />
          </>
        )}

        {/* Top section: Dashboard Cards */}
        <div className="mb-14 flex flex-wrap gap-4">
          <DashboardCard
            text={"Total Portfolio"}
            figure={`$${formatPortfolioValue(fig, { compact: false })}`}
            extraCSS="portfolio-card"
            icon={<Image src="/dollar.png" alt="logo" width={42} height={42} priority quality={100} />}
          />

          <DashboardCard
            text={"Point Balance"}
            figure={formatPoints(String(referralPoint ?? 0))}
            extraCSS="profit-card"
            icon={<Image src="/percentage.png" alt="logo" width={42} height={42} priority quality={100} />}
          />

          <DashboardCard
            text={"Health Factor"}
            figure={health}
            extraCSS="health-card"
            icon={
              <div className="flex h-11 w-[24.6px] place-items-end bg-white/80 px-[0.6px] pt-1 shadow shadow-[#C2C2C21A]">
                <div className={`${batteryCSS(health)} w-full`}></div>
              </div>
            }
          />
        </div>

        {/* Bottom section: Two halves */}
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
          {/* Left half: Balance and Collateral stacked */}
          <div className="flex flex-col gap-5">
            <Balance />
            <Collateral id="collateral-card" />
          </div>

          {/* Right half: Usage alone */}
          <div className="w-full">
            <Usage activeReq={activeReq} collateralVal={collateralVal} />
          </div>
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
                  setRunPageTour(true)
                  setShowTourDropdown(false)
                }}
              >
                Dashboard
              </button>
              <button
                className="w-full rounded-lg px-5 py-3 text-left font-medium text-gray-800 transition-colors duration-150 hover:bg-[#f3f4f6] hover:text-[#22c55e] focus:outline-none"
                onClick={() => {
                  setRunTour(true)
                  setShowTourDropdown(false)
                }}
              >
                Deposit Collateral
              </button>
            </div>
          )}
        </div>
      </div>
      {/* <div className="fixed bottom-36 right-5 z-50 max-w-full">
        <button
          className={`flex h-14 w-14 items-center justify-center rounded-full bg-[#FF4D00] shadow-lg transition-all duration-300`}
          onClick={() => setRunPageTour(true)}
          type="button"
        >
          <FaRegCompass size={24} />
        </button>
      </div> */}
      <ChatbotLoader />
    </div>
  )
}
