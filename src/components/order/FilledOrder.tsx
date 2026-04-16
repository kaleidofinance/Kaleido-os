"use client"
import Image from "next/image"
import { useEffect, useRef, useState } from "react"
import { OrderCard } from "./OrderCard"
import { cardGradient } from "@/constants/utils/cardGradient"
import { tokenImageMap } from "@/constants/utils/tokenImageMap"

export const FilledOrder = ({ orderSample }: any) => {
  const [selectedOrder, setSelectedOrder] = useState<number | null>(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef<(HTMLDivElement | null)[]>([])

  const [isDragging, setIsDragging] = useState(false)
  const [startY, setStartY] = useState(0)
  const [scrollTop, setScrollTop] = useState(0)

  // Throttle scroll handler for performance
  let scrollTimeout: NodeJS.Timeout | null = null
  const handleScroll = () => {
    if (scrollTimeout) return
    scrollTimeout = setTimeout(() => {
      scrollTimeout = null
      if (containerRef.current) {
        const containerTop = containerRef.current.getBoundingClientRect().top
        const containerBottom = containerRef.current.getBoundingClientRect().bottom

        // Find the card fully visible in container viewport center
        let visibleIndex = selectedOrder
        cardRefs.current.forEach((card, index) => {
          if (card) {
            const cardRect = card.getBoundingClientRect()
            const cardTop = cardRect.top
            const cardBottom = cardRect.bottom

            if (cardTop >= containerTop && cardBottom <= containerBottom) {
              visibleIndex = index
            }
          }
        })
        setSelectedOrder(visibleIndex)
      }
    }, 100)
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    if (containerRef.current) {
      setIsDragging(true)
      containerRef.current.style.cursor = "grabbing"
      setStartY(e.pageY - containerRef.current.offsetTop)
      setScrollTop(containerRef.current.scrollTop)
    }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !containerRef.current) return
    e.preventDefault()
    const y = e.pageY - containerRef.current.offsetTop
    const walk = (y - startY) * 2
    containerRef.current.scrollTop = scrollTop - walk
  }

  const handleMouseUpOrLeave = () => {
    setIsDragging(false)
    if (containerRef.current) {
      containerRef.current.style.cursor = "grab"
    }
  }

  // Keyboard accessibility for vertical scrolling
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowDown") {
        containerRef.current?.scrollBy({ top: 200, behavior: "smooth" })
      }
      if (event.key === "ArrowUp") {
        containerRef.current?.scrollBy({ top: -200, behavior: "smooth" })
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  return (
    <div className="filled-orders w-full">
      <h3 className="mb-4 text-lg font-normal">Filled Orders</h3>

      {!orderSample || orderSample.length === 0 ? (
        <div className="flex h-[200px] items-center justify-center">
          <p className="text-center text-lg">No filled orders.</p>
        </div>
      ) : (
        <div
          ref={containerRef}
          onScroll={handleScroll}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUpOrLeave}
          onMouseLeave={handleMouseUpOrLeave}
          className="scrollbar-hide max-h-[510px] cursor-grab overflow-y-auto scroll-smooth px-6"
        >
          {orderSample.map((order: any, index: number) => {
            const randomGradient = cardGradient[Math.floor(Math.random() * cardGradient.length)] || "/gradients1.svg"
            return (
              <div
                key={order.requestId || order.listingId || index}
                ref={(el) => {
                  cardRefs.current[index] = el
                }}
                className={`py-4 transition-transform duration-500 ${
                  selectedOrder === index ? "z-10 scale-105" : "z-0 scale-100"
                }`}
              >
                <div className="m-auto h-44 w-32 sm:h-72 sm:w-44">
                  <OrderCard
                    id={order.requestId || order.listingId}
                    type={order.type}
                    amount={order.amountFormatted}
                    token={tokenImageMap[order.tokenAddress]?.image}
                    date={order.returnDateFormatted}
                    icon1={"/Lock.svg"}
                    icon2={"/Lock.svg"}
                    isSelected={selectedOrder === index}
                    cardGradient={randomGradient}
                    style={
                      selectedOrder === index
                        ? { boxShadow: "0 0 15px 10px rgba(25, 75, 255, 0.4)" }
                        : { filter: "blur(3px)" }
                    }
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
