"use client"
import Image from "next/image"
import { useEffect, useRef, useState } from "react"
import { OrderCard } from "./OrderCard"
import { cardGradient } from "@/constants/utils/cardGradient"
import { tokenImageMap } from "@/constants/utils/tokenImageMap"

export const OpenOrder = ({ orderSample }: any) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [startX, setStartX] = useState(0)
  const [scrollPosition, setScrollPosition] = useState(0)

  const handleScroll = () => {
    if (containerRef.current) {
      const containerWidth = containerRef.current.offsetWidth
      const scrollLeft = containerRef.current.scrollLeft
      const cardWidth = 176

      const centerIndex = Math.round((scrollLeft + containerWidth / 2) / cardWidth) - 1
      setCurrentIndex(centerIndex)
    }
  }

  // Initial centering of the cards on load
  // useEffect(() => {
  //   if (containerRef.current && orderSample.length > 0) {
  //     const containerWidth = containerRef.current.offsetWidth;
  //     const cardWidth = 176;
  //     const initialScroll = (cardWidth * orderSample.length - containerWidth) / 2;
  //     containerRef.current.scrollLeft = initialScroll;
  //   }
  // }, [orderSample]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (containerRef.current) {
      setIsDragging(true)
      containerRef.current.style.cursor = "grabbing" // Change cursor when dragging starts
      setStartX(e.pageX - containerRef.current.offsetLeft)
      setScrollPosition(containerRef.current.scrollLeft)
    }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !containerRef.current) return
    e.preventDefault()
    const x = e.pageX - containerRef.current.offsetLeft
    const walk = (x - startX) * 2 // Adjust scroll speed by multiplying
    containerRef.current.scrollLeft = scrollPosition - walk
  }

  const handleMouseUpOrLeave = () => {
    setIsDragging(false)
    if (containerRef.current) {
      containerRef.current.style.cursor = "grab" // Reset cursor after dragging ends
    }
  }

  // Add keyboard accessibility for scrolling
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") {
        containerRef.current?.scrollBy({ left: 200, behavior: "smooth" })
      }
      if (event.key === "ArrowLeft") {
        containerRef.current?.scrollBy({ left: -200, behavior: "smooth" })
      }
    }
    window.addEventListener("keydown", handleKeyDown)

    return () => {
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [])

  return (
    <div className="open-orders filledInActive relative w-full py-4">
      {/* Header always visible */}
      <h3 className="mb-4 ml-4 text-lg font-normal">Open Orders</h3>

      {/* Conditional rendering for empty orders */}
      {!orderSample || orderSample.length === 0 ? (
        <div className="flex h-[200px] items-center justify-center">
          {" "}
          {/* Adjust the height to center the message */}
          <p className="text-center text-lg">No open orders available.</p>
        </div>
      ) : (
        <>
          {/* Left Arrow */}
          <button
            onClick={() => containerRef.current?.scrollBy({ left: -200, behavior: "smooth" })}
            className="absolute left-[-5%] top-[55%] z-20 hidden -translate-y-1/2 transform rounded-full p-2 sm:block"
          >
            <Image src="/Arrow-left.svg" alt="Scroll Left" width={40} height={40} />
          </button>

          <div
            ref={containerRef}
            className="scrollbar-hide h-80 cursor-grab overflow-x-auto scroll-smooth"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUpOrLeave}
            onMouseLeave={handleMouseUpOrLeave}
            onScroll={handleScroll}
            style={{ whiteSpace: "nowrap" }} // Ensure the children don't wrap
          >
            <div className="flex gap-6">
              {" "}
              {/* Ensure flex layout for horizontal scroll */}
              {orderSample.map((order: any, index: number) => {
                const randomGradient =
                  cardGradient[Math.floor(Math.random() * cardGradient.length)] || "/gradients2.svg"
                return (
                  <div
                    key={order.requestId || order.listingId || index}
                    className={`z-10 flex-none py-4 transition-all duration-500 ${
                      index === currentIndex
                        ? "scale-110" // Center card is bigger with shadow
                        : "scale-100"
                    }`}
                  >
                    <div className="m-auto ml-4 h-52 w-32 sm:h-72 sm:w-44">
                      <OrderCard
                        id={order.requestId || order.listingId}
                        type={order.type}
                        amount={order.amountFormatted}
                        token={tokenImageMap[order.tokenAddress]?.image}
                        date={order.returnDateFormatted}
                        icon1={"/openOrder.svg"}
                        icon2={"/openOrder.svg"}
                        isSelected={currentIndex === index}
                        cardGradient={randomGradient}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Right Arrow */}
          <button
            onClick={() => containerRef.current?.scrollBy({ left: 200, behavior: "smooth" })}
            className="absolute right-[-6%] top-[55%] z-20 hidden -translate-y-1/2 transform rounded-full p-2 sm:block"
          >
            <Image src="/Arrow-right.svg" alt="Scroll Right" width={40} height={40} />
          </button>
        </>
      )}
    </div>
  )
}
