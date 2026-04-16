"use client"
import Image from "next/image"
import { useEffect, useRef, useState } from "react"
import { OrderCard } from "./OrderCard"
import { cardGradient } from "@/constants/utils/cardGradient"
import { tokenImageMap } from "@/constants/utils/tokenImageMap"

export const ClosedOrder = ({ orderSample }: any) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [startX, setStartX] = useState(0)
  const [scrollPosition, setScrollPosition] = useState(0)

  const handleScroll = () => {
    if (containerRef.current) {
      const containerWidth = containerRef.current.offsetWidth
      const scrollLeft = containerRef.current.scrollLeft
      const cardWidth = 176 // match your card width

      // Calculate centered card index
      const centerIndex = Math.round((scrollLeft + containerWidth / 2) / cardWidth) - 1
      setCurrentIndex(centerIndex)
    }
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    if (containerRef.current) {
      setIsDragging(true)
      containerRef.current.style.cursor = "grabbing"
      setStartX(e.pageX - containerRef.current.offsetLeft)
      setScrollPosition(containerRef.current.scrollLeft)
    }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !containerRef.current) return
    e.preventDefault()
    const x = e.pageX - containerRef.current.offsetLeft
    const walk = (x - startX) * 2
    containerRef.current.scrollLeft = scrollPosition - walk
  }

  const handleMouseUpOrLeave = () => {
    setIsDragging(false)
    if (containerRef.current) {
      containerRef.current.style.cursor = "grab"
    }
  }

  // Keyboard accessibility for scrolling
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
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  return (
    <div className="closed-orders relative w-full py-4">
      <h3 className="mb-4 ml-4 text-lg font-normal">Closed Orders</h3>

      {!orderSample || orderSample.length === 0 ? (
        <div className="flex h-[200px] items-center justify-center">
          <p className="text-center text-lg">No closed orders.</p>
        </div>
      ) : (
        <>
          {/* Left Arrow */}
          <button
            onClick={() => containerRef.current?.scrollBy({ left: -200, behavior: "smooth" })}
            className="absolute left-[-5%] top-[50%] z-20 hidden -translate-y-1/2 transform rounded-full p-2 sm:block"
            aria-label="Scroll Left"
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
            style={{ whiteSpace: "nowrap" }}
          >
            <div className="flex gap-6 px-4">
              {orderSample.map((order: any, index: number) => {
                const randomGradient =
                  cardGradient[Math.floor(Math.random() * cardGradient.length)] || "/gradients1.svg"
                return (
                  <div
                    key={order.requestId || order.listingId || index}
                    className={`flex-none py-4 transition-transform duration-500 ${
                      index === currentIndex ? "z-10 scale-110" : "z-0 scale-100"
                    }`}
                  >
                    <div className="m-auto h-52 w-32 sm:h-72 sm:w-44">
                      <OrderCard
                        id={order.requestId || order.listingId}
                        type={order.type}
                        amount={order.amountFormatted}
                        token={tokenImageMap[order.tokenAddress]?.image}
                        date={order.returnDateFormatted}
                        icon1={"/Closed.svg"}
                        icon2={"/Closed.svg"}
                        isSelected={currentIndex === index}
                        cardGradient={randomGradient}
                        // style={
                        //   index === currentIndex
                        //     ? { boxShadow: "0 0 15px 10px rgba(255, 25, 75, 0.4)" }
                        //     : { filter: "blur(3px)" }
                        // }
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
            className="absolute right-[-6%] top-[50%] z-20 hidden -translate-y-1/2 transform rounded-full p-2 sm:block"
            aria-label="Scroll Right"
          >
            <Image src="/Arrow-right.svg" alt="Scroll Right" width={40} height={40} />
          </button>
        </>
      )}
    </div>
  )
}
