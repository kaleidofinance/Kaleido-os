import { useEffect, useState } from "react"
import { ethers } from "ethers"
import { getKaleidoContract } from "@/config/contracts"
import { readOnlyProvider } from "@/config/provider"
import useCollateralEvent from "@/hooks/events/useCollateralEvent"
import { ADDRESS_1, USDC_ADDRESS, USDR } from "@/constants/utils/addresses"
import { LABEL_MAP } from "@/constants/utils/mapEvents"
import useGetValueAndHealth from "@/hooks/useGetValueAndHealth"
import Image from "next/image"
import { useActiveAccount } from "thirdweb/react"
import { formatWithCommas } from "@/constants/utils/formatNumber"

const ITEMS_PER_PAGE = 5
interface HistoryItem {
  id: string
  eventName: string
  date: string
  details: Record<string, any>
}

const TransactionHistory = () => {
  const blockNumber = useCollateralEvent()
  const [historyData, setHistoryData] = useState<HistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { etherPrice, usdcPrice } = useGetValueAndHealth()
  const [currentPage, setCurrentPage] = useState(1)
  const activeAccount = useActiveAccount()
  const address = activeAccount?.address

  // Pagination calculations
  const indexOfLast = currentPage * ITEMS_PER_PAGE
  const indexOfFirst = indexOfLast - ITEMS_PER_PAGE
  const currentItems = historyData.slice(indexOfFirst, indexOfLast)
  const totalPages = Math.ceil(historyData.length / ITEMS_PER_PAGE)

  // Pagination handlers
  const handlePrev = () => setCurrentPage((prev) => Math.max(prev - 1, 1))
  const handleNext = () => setCurrentPage((prev) => Math.min(prev + 1, totalPages))

  const TOKEN_INFO: Record<string, { symbol: string; logo: string }> = {
    [ADDRESS_1.toLowerCase()]: {
      symbol: "ETH",
      logo: "/eth.svg", // Update to your actual path or URL
    },
    [USDC_ADDRESS.toLowerCase()]: {
      symbol: "USDC",
      logo: "/usdc.svg",
    },
  }

  useEffect(() => {
    async function fetchHistory() {
      setLoading(true)
      setError(null)

      try {
        const contract = getKaleidoContract(readOnlyProvider)
        const latestBlock = await readOnlyProvider.getBlockNumber()

        const filters = [
          contract.filters.CollateralDeposited(address, null, null),
          contract.filters.RequestCreated(address, null, null, null, null),
          contract.filters.LoanRepayment(address, null, null),
          contract.filters.CollateralWithdrawn(address, null, null),
          contract.filters.RequestLiquidated(null, null, address, null),
          contract.filters.RequestServiced(null, address, null),
          contract.filters.LoanListingCreated(null, address, null),
        ]

        // console.log("Filtered history:", filters)

        const events = await Promise.all(filters.map((filter) => contract.queryFilter(filter, 0, latestBlock)))
        // console.log("Events:", events)

        const formatEvent = async (event: any, eventName: string) => {
          const block = await event.getBlock()
          const details: Record<string, any> = {}

          for (const [key, value] of Object.entries(event.args)) {
            details[key] = value?.toString() || ""
          }

          return {
            id: `${event.transactionHash}-${event.logIndex}`,
            eventName,
            date: new Date(block.timestamp * 1000).toLocaleString(),
            details,
          }
        }

        const formattedEvents = await Promise.all(
          events.flatMap((eventGroup, index) =>
            eventGroup.map((e) =>
              formatEvent(
                e,
                [
                  "CollateralDeposited",
                  "RequestCreated",
                  "LoanRepayment",
                  "CollateralWithdrawn",
                  "RequestLiquidated",
                  "RequestServiced",
                  "LoanListingCreated",
                ][index],
              ),
            ),
          ),
        )

        const sortedHistory = formattedEvents.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

        setHistoryData(sortedHistory)
      } catch (err) {
        // console.error(err)
        setError("Failed to fetch transaction history.")
      } finally {
        setLoading(false)
      }
    }

    fetchHistory()
  }, [blockNumber])

  if (loading) return <p className="text-center text-gray-400">Loading transactions...</p>
  if (error) return <p className="text-center text-red-500">{error}</p>

  return (
    <div className="u-class-shadow-2 h-full w-full bg-black px-4 py-6 font-[family-name:var(--font-outfit)] sm:px-6">
      <p className="text-center text-[20px] text-gray-400">Transaction History.</p>

      {historyData.length === 0 ? (
        <p className="text-center text-gray-400">No transactions found.</p>
      ) : (
        <>
          <div className="scrollbar-thin scrollbar-thumb-purple-600 scrollbar-track-gray-800 max-h-[600px] space-y-6 overflow-y-auto rounded-lg pr-3">
            {currentItems.map(({ id, eventName, date, details }) => {
              const labels = LABEL_MAP[eventName] || {}

              // Badge color logic for vibrancy
              const badgeColor = eventName.includes("Created")
                ? "bg-indigo-700 text-indigo-300"
                : eventName.includes("Deposited")
                  ? "bg-green-700 text-green-300"
                  : eventName.includes("Withdrawn")
                    ? "bg-yellow-700 text-yellow-300"
                    : eventName.includes("Liquidated")
                      ? "bg-red-700 text-red-300"
                      : eventName.includes("Serviced")
                        ? "bg-purple-700 text-purple-300"
                        : "bg-[#2a2a2a] text-gray-300"

              return (
                <div
                  key={id}
                  className="rounded-2xl border border-[#3E3E47] bg-gradient-to-br from-[#1a1a1a] to-[#121212] p-4 shadow-md transition hover:shadow-lg"
                >
                  <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                    <span className={`inline-block rounded-full px-5 py-1 text-sm font-semibold ${badgeColor}`}>
                      {eventName}
                    </span>
                    <span className="text-sm text-gray-400">{date}</span>
                  </div>
                  <div className="fixedcardText grid grid-cols-1 gap-4 text-sm text-gray-300 sm:grid-cols-2">
                    {Object.entries(details)
                      .filter(([key]) => labels.hasOwnProperty(key))
                      .map(([key, value]) => {
                        let displayValue = value?.toString() || ""
                        let tokenLabel = null
                        let usdValue = ""

                        const labelText = labels[key].toLowerCase()
                        const valLower = typeof value === "string" ? value.toLowerCase() : ""

                        if (ethers.isAddress(value)) {
                          // Abbreviate address by default
                          displayValue = value.slice(0, 6) + "..." + value.slice(-4)

                          // Show ETH or USDC logo + label only if this is the "Collateral Token:" field
                          if (labelText === "collateral token:") {
                            if (valLower === ADDRESS_1.toLowerCase()) {
                              tokenLabel = (
                                <span className="flex items-center gap-1">
                                  <Image src="/eth.svg" height={16} width={16} alt="eth-logo" />
                                  ETH
                                </span>
                              )
                              displayValue = "" // optionally hide the address text when showing logo+label
                            } else if (valLower === USDC_ADDRESS.toLowerCase()) {
                              tokenLabel = (
                                <span className="flex items-center gap-1">
                                  <Image src="/USDC.svg" height={16} width={16} alt="usdc-logo" />
                                  USDC
                                </span>
                              )
                              displayValue = ""
                            } else if (valLower === USDR.toLowerCase()) {
                              tokenLabel = (
                                <span className="flex items-center gap-1">
                                  <Image src="/drakov4.png" height={16} width={16} alt="usdr-logo" />
                                  USDR
                                </span>
                              )
                              displayValue = ""
                            }
                          }

                          if (labelText === "token:") {
                            if (valLower === ADDRESS_1.toLowerCase()) {
                              tokenLabel = (
                                <span className="flex items-center gap-1">
                                  <Image src="/eth.svg" height={16} width={16} alt="eth-logo" />
                                  ETH
                                </span>
                              )
                              displayValue = "" // optionally hide the address text when showing logo+label
                            } else if (valLower === USDC_ADDRESS.toLowerCase()) {
                              tokenLabel = (
                                <span className="flex items-center gap-1">
                                  <Image src="/USDC.svg" height={16} width={16} alt="usdc-logo" />
                                  USDC
                                </span>
                              )
                              displayValue = ""
                            } else if (valLower === USDR.toLowerCase()) {
                              tokenLabel = (
                                <span className="flex items-center gap-1">
                                  <Image src="/drakov4.png" height={16} width={16} alt="usdr-logo" />
                                  USDR
                                </span>
                              )
                              displayValue = ""
                            }
                          }
                        } else if (typeof value === "string" && /^\d+$/.test(value)) {
                          // Your existing formatting logic for numbers, request IDs, amounts, etc.
                          if (labelText.includes("request id") || labelText.includes("listing id")) {
                            try {
                              displayValue = ethers.formatUnits(value, 0)
                            } catch {
                              displayValue = value
                            }
                          } else {
                            const currentLabelMap = LABEL_MAP[eventName] || {}
                            const tokenKey = Object.entries(currentLabelMap).find(
                              ([, label]) =>
                                label.toLowerCase() === "token:" || label.toLowerCase() === "collateral token:",
                            )?.[0]

                            const possibleTokenAddress = tokenKey ? details[tokenKey]?.toLowerCase() : undefined

                            console.log("Event:", eventName)
                            console.log("Token Address (Resolved):", possibleTokenAddress)
                            // console.log("Event:", currentLabelMap)
                            // console.log("Token Address (Resolved):", possibleTokenAddress)

                            // console.log("Token Addresses:", possibleTokenAddress)
                            const decimals =
                              possibleTokenAddress === ADDRESS_1.toLowerCase()
                                ? 18
                                : possibleTokenAddress === USDC_ADDRESS.toLowerCase()
                                  ? 6
                                  : 6

                            try {
                              displayValue = formatWithCommas(ethers.formatUnits(value, decimals), 3)
                            } catch {
                              displayValue = value
                            }

                            if (possibleTokenAddress === ADDRESS_1.toLowerCase() && etherPrice) {
                              usdValue = `$${formatWithCommas(parseFloat(displayValue.replace(/,/g, "")) * etherPrice, 2)}`
                            } else if (possibleTokenAddress === USDC_ADDRESS.toLowerCase() && usdcPrice) {
                              usdValue = `$${formatWithCommas(parseFloat(displayValue.replace(/,/g, "")) * usdcPrice, 2)}`
                            }
                          }
                        }

                        return (
                          <div key={key} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                            <span className="text-gray-400">{labels[key]}</span>
                            <div className="flex items-center gap-2 font-mono text-white">
                              {displayValue && <span>{displayValue}</span>}
                              {tokenLabel}
                              {usdValue && <span className="text-gray-400">({usdValue})</span>}
                            </div>
                          </div>
                        )
                      })}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Pagination controls */}
          <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center sm:gap-6">
            <button
              onClick={handlePrev}
              disabled={currentPage === 1}
              className="rounded-lg bg-[#2a2a2a] px-4 py-2 text-sm text-white disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-sm text-gray-400">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={handleNext}
              disabled={currentPage === totalPages}
              className="rounded-lg bg-[#2a2a2a] px-4 py-2 text-sm text-white disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export default TransactionHistory
