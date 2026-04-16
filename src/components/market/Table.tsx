"use client"
import { useState, useEffect } from "react"
import Image from "next/image"
import { Btn } from "../shared/Btn"

import { formatAddress } from "@/constants/utils/formatAddress"

import { Spinner } from "@radix-ui/themes"
import useServiceRequest from "@/hooks/useServiceRequest"
import { useRouter } from "next/navigation"
import useGetValueAndHealth from "@/hooks/useGetValueAndHealth"
import useFetchAllListings from "@/hooks/useFetchAllListings"
import useFetchAllRequests from "@/hooks/useFetchAllRequests"
import { formatWithCommas } from "@/constants/utils/formatNumber"

const tokenImageMap: { [key: string]: { image: string; label: string } } = {
  "0xE4aB69C077896252FAFBD49EFD26B5D171A32410": { image: "/link.svg", label: "LINK" },
  "0x0000000000000000000000000000000000000001": { image: "/eth.svg", label: "ETH" },
  "0x572f4901f03055ffC1D936a60Ccc3CbF13911BE3": { image: "/USDC.svg", label: "USDC" },
  "0x769EBD1dc2470186f0a4911113754DfD13f2CDA3": { image: "/drakov4.png", label: "USDR" },
  "0x913f3354942366809A05e89D288cCE60d87d7348": { image: "/stable/kfUSD.png", label: "kfUSD" },
  "0x717A36E56b33585Bd00260422FfCc3270af34D3E": { image: "/usdt.svg", label: "USDT" },
}

const Table = () => {
  const [activeTable, setActiveTable] = useState<"borrow" | "lend">("borrow")
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [selectedToken, setSelectedToken] = useState<string>("All Tokens")
  const [borrowTableData, setBorrowTableData] = useState<any[]>([])
  const [lendTableData, setLendTableData] = useState<any[]>([])
  const [filteredBorrowData, setFilteredBorrowData] = useState<any[]>([])
  const [filteredLendData, setFilteredLendData] = useState<any[]>([])
  const [loadingBorrow, setLoadingBorrow] = useState(true)
  const [loadingLend, setLoadingLend] = useState(true)
  const router = useRouter()

  const { collateralVal, etherPrice, usdcPrice } = useGetValueAndHealth()

  const { myLendOrder, listings: listingData2, loading: borrowLoading } = useFetchAllListings()
  const { myRequests, loading: lendLoading, activeRequests: filteredRequests } = useFetchAllRequests()
  const service = useServiceRequest()
  // console.log("This is the listingData", listingData2)

  useEffect(() => {
    if (listingData2) {
      setBorrowTableData(listingData2)
      setLoadingBorrow(borrowLoading)
    }
  }, [listingData2])

  useEffect(() => {
    if (filteredRequests) {
      setLendTableData(filteredRequests)
      setLoadingLend(lendLoading)
    }
  }, [filteredRequests])

  // Filter borrow data based on selected token and sort featured first
  useEffect(() => {
    const filtered = selectedToken === "All Tokens"
      ? borrowTableData
      : borrowTableData.filter((data) => data.tokenAddress === selectedToken);
    
    // Sort: featured listings first, then by listing ID (newest first)
    const sorted = filtered.sort((a, b) => {
      // Featured listings always on top
      if (a.isFeatured && !b.isFeatured) return -1;
      if (!a.isFeatured && b.isFeatured) return 1;
      // Then by listing ID (newest first)
      return Number(b.listingId) - Number(a.listingId);
    });
    
    setFilteredBorrowData(sorted);
  }, [selectedToken, borrowTableData])

  // Filter lend data based on selected token
  useEffect(() => {
    setFilteredLendData(
      selectedToken === "All Tokens"
        ? lendTableData
        : lendTableData.filter((data) => data.loanRequestAddr === selectedToken),
    )
  }, [selectedToken, lendTableData])

  const handleTableChange = (table: "borrow" | "lend") => {
    setActiveTable(table)
  }

  const handleToggleDropdown = () => {
    setIsDropdownOpen((prev) => !prev)
  }

  const handleTokenSelect = (token: string) => {
    setSelectedToken(token)
    setIsDropdownOpen(false)
  }

  const handleBorrowAllocation = (data: any) => {
    const queryString = `?listingId=${data.listingId}&maxAmount=${data.max_amount}&minAmount=${data.min_amount}`
    router.push(`/borrow-allocation${queryString}`)
  }

  return (
    <div className="w-full">
      {/* Toggle Borrow/Lend */}
      <div className="mb-6 flex flex-col items-center justify-between px-4 sm:flex-row sm:px-12">
        <div className="space-x-4 text-xl sm:space-x-6">
          <button
            className={`rounded-lg bg-black px-4 py-2 sm:px-8 ${activeTable === "borrow" ? "border border-[#21bf50]" : ""}`}
            onClick={() => handleTableChange("borrow")}
          >
            Borrow
          </button>
          <button
            className={`rounded-lg bg-black px-4 py-2 sm:px-12 ${activeTable === "lend" ? "border border-[#1fb659]" : ""}`}
            onClick={() => handleTableChange("lend")}
          >
            Lend
          </button>
        </div>

        {/* Token Dropdown and Filter */}
        <div className="relative mt-4 flex justify-end gap-4 sm:mt-0">
          <div
            className="flex cursor-pointer items-center rounded-lg bg-black px-4 py-2 text-lg"
            onClick={handleToggleDropdown}
          >
            {selectedToken !== "All Tokens" && (
              <Image src={tokenImageMap[selectedToken]?.image} alt={selectedToken} width={30} height={30} />
            )}
            <div className="pl-2">{tokenImageMap[selectedToken]?.label || "All Tokens"}</div>
            <div className="pl-4">
              <Image src={"/chevronDown.svg"} alt="dropdown indicator" width={15} height={15} priority quality={100} />
            </div>
          </div>

          {isDropdownOpen && (
            <div className="absolute top-full z-10 mt-2 w-48 rounded-lg bg-black p-4">
              <div className="cursor-pointer p-2 hover:bg-[#2a2a2a]" onClick={() => handleTokenSelect("All Tokens")}>
                All Tokens
              </div>
              {Object.keys(tokenImageMap).map((tokenAddress, index) => (
                <div
                  key={index}
                  className="flex cursor-pointer items-center gap-4 p-2 hover:bg-[#2a2a2a]"
                  onClick={() => handleTokenSelect(tokenAddress)}
                >
                  <Image src={tokenImageMap[tokenAddress].image} alt={tokenAddress} width={30} height={30} />
                  <p>{tokenImageMap[tokenAddress].label}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="px-4 sm:px-12">
        {activeTable === "borrow" ? (
          <>
            {/* Borrow Table Headers */}
            <div className="mb-2 grid grid-cols-2 gap-4 sm:grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
              <p>Asset</p>
              <p>Origin</p>
              <p>Volume</p>
              <p>Rate</p>
              <p>Min</p>
              <p>Max</p>
              <p>Duration</p>
              <p>Action</p>
            </div>
            {loadingBorrow ? (
              <div className="flex h-32 items-center justify-center gap-3">
                <Spinner size={"3"} />
                <p className="mt-2 text-2xl text-white">Fetching Borrow Data...</p>
              </div>
            ) : (
              filteredBorrowData
                .slice()
                .reverse()
                .map((data, index) => (
                  <div
                    key={index}
                    className={`mb-4 grid w-full grid-cols-2 items-center gap-y-2 rounded-lg p-4 sm:grid-cols-[repeat(auto-fit,minmax(150px,1fr))] sm:p-6 ${
                      data.isFeatured 
                        ? "bg-green-900/10 border border-[#21bf50]/40 shadow-lg shadow-green-500/10" 
                        : "bg-black"
                    }`}
                  >
                    <div className="col-span-2 flex items-center gap-2 sm:col-span-1">
                      <Image
                        src={tokenImageMap[data.tokenAddress]?.image}
                        alt={data.loanRequestAddr}
                        width={37}
                        height={36}
                        priority
                        quality={100}
                      />
                      <p>{tokenImageMap[data.tokenAddress]?.label}</p>
                      {data.isFeatured && (
                        <span className="rounded-full bg-[#21bf50]/20 px-2 py-0.5 text-xs font-bold text-[#21bf50] border border-[#21bf50]/40">
                          FEATURED
                        </span>
                      )}
                    </div>
                    <div className="col-span-2 flex items-center gap-2 sm:col-span-1">
                      <Image src={"/avatar.svg"} alt="avatar" width={17} height={16} priority quality={100} />
                      <p>{formatAddress(data.author)}</p>
                    </div>
                    <div className="col-span-2 text-right sm:col-span-1 sm:text-center">
                      {formatWithCommas(data.amount, 2)} {tokenImageMap[data.tokenAddress]?.label} (~$
                      {formatWithCommas(
                        Number(data.amount) *
                          (tokenImageMap[data.tokenAddress]?.label === "ETH" ? Number(etherPrice) : Number(usdcPrice)),
                        2,
                      )}
                      )
                    </div>

                    <div className="col-span-2 text-right sm:col-span-1 sm:text-center">{data.interest}%</div>
                    <div className="col-span-2 text-right sm:col-span-1 sm:text-center">
                      {formatWithCommas(data.min_amount, 3)} {tokenImageMap[data.tokenAddress]?.label} (~$
                      {formatWithCommas(
                        Number(data.min_amount) *
                          (tokenImageMap[data.tokenAddress]?.label === "ETH" ? Number(etherPrice) : Number(usdcPrice)),
                        2,
                      )}
                      )
                    </div>
                    <div className="col-span-2 text-right sm:col-span-1 sm:text-center">
                      {formatWithCommas(data.max_amount, 3)} {tokenImageMap[data.tokenAddress]?.label} (~$
                      {formatWithCommas(
                        Number(data.max_amount) *
                          (tokenImageMap[data.tokenAddress]?.label === "ETH" ? Number(etherPrice) : Number(usdcPrice)),
                        2,
                      )}
                      )
                    </div>
                    <div className="col-span-2 text-right sm:col-span-1 sm:text-center">
                      {Math.floor((data.returnDate - Date.now()) / (1000 * 60 * 60 * 24))} days
                    </div>
                    <div className="col-span-2 text-right sm:col-span-1" onClick={() => handleBorrowAllocation(data)}>
                      <Btn text={"Borrow"} css="text-black bg-[#FF4D00] text-sm sm:text-base px-3 py-1 rounded-md" />
                    </div>
                  </div>
                ))
            )}
          </>
        ) : (
          <>
            {/* Lend Table Headers */}
            <div className="mb-2 grid grid-cols-2 gap-4 sm:grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
              <p>Asset</p>
              <p>Origin</p>
              <p>Loan Amount</p>
              <p>Rate</p>
              <p>Repayment Amount</p>
              <p>Duration</p>
              <p>Action</p>
            </div>
            {loadingLend ? (
              <div className="flex h-32 items-center justify-center gap-3">
                <Spinner size={"3"} />
                <p className="mt-2 text-2xl text-white">Fetching Lend Data...</p>
              </div>
            ) : (
              filteredLendData
                .slice()
                .reverse()
                .map((data, index) => (
                  <div
                    key={index}
                    className="mb-4 grid w-full grid-cols-2 items-center gap-y-2 rounded-lg bg-black p-4 sm:grid-cols-[repeat(auto-fit,minmax(150px,1fr))] sm:p-6"
                  >
                    <div className="col-span-2 flex items-center gap-2 sm:col-span-1">
                      <Image
                        src={tokenImageMap[data.loanRequestAddr]?.image}
                        alt={data.loanRequestAddr}
                        width={37}
                        height={36}
                        priority
                        quality={100}
                      />
                      <p>{tokenImageMap[data.loanRequestAddr]?.label}</p>
                    </div>
                    <div className="col-span-2 flex items-center gap-2 sm:col-span-1">
                      <Image src={"/avatar.svg"} alt="avatar" width={17} height={16} priority quality={100} />
                      <p>{formatAddress(data.author)}</p>
                    </div>
                    <div className="col-span-2 text-right sm:col-span-1 sm:text-center">
                      {formatWithCommas(data.amount, 2)} {tokenImageMap[data.loanRequestAddr]?.label} (~$
                      {formatWithCommas(
                        Number(data.amount) *
                          (tokenImageMap[data.loanRequestAddr]?.label === "ETH" ? Number(etherPrice) : Number(usdcPrice)),
                        2,
                      )}
                      )
                    </div>

                    <div className="col-span-2 text-right sm:col-span-1 sm:text-center">{data.interest}%</div>
                    <div className="col-span-2 text-right sm:col-span-1 sm:text-center">
                      {formatWithCommas(data.totalRepayment, 3)} {tokenImageMap[data.loanRequestAddr]?.label} (~$
                      {formatWithCommas(
                        Number(data.totalRepayment) *
                          (tokenImageMap[data.loanRequestAddr]?.label === "ETH" ? Number(etherPrice) : Number(usdcPrice)),
                        2,
                      )}
                      )
                    </div>
                    <div className="col-span-2 text-right sm:col-span-1 sm:text-center">
                      {Math.floor((data.returnDate - Date.now()) / (1000 * 60 * 60 * 24))} days
                    </div>
                    <div
                      className="col-span-2 text-right sm:col-span-1"
                      onClick={() => service(data.requestId, data.loanRequestAddr, data.amount)}
                    >
                      <Btn text={"Lend"} css="text-black bg-[#FF4D00] text-sm sm:text-base px-3 py-1 rounded-md" />
                    </div>
                  </div>
                ))
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default Table
