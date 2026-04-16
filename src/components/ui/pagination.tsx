import React, { useMemo } from "react"
import { PaginationProps } from "@/constants/types"
const DOTS = "..."

function range(start: number, end: number): number[] {
  const length = end - start + 1
  return Array.from({ length }, (_, idx) => idx + start)
}

const Pagination: React.FC<PaginationProps> = ({
  currentPage,
  totalItems,
  itemsPerPage,
  onPageChange,
  siblingCount = 1,
  className = "",
}) => {
  const totalPageCount = Math.ceil(totalItems / itemsPerPage)

  const paginationRange = useMemo(() => {
    if (totalPageCount <= 5 + siblingCount * 2) {
      return range(1, totalPageCount)
    }

    const leftSiblingIndex = Math.max(currentPage - siblingCount, 1)
    const rightSiblingIndex = Math.min(currentPage + siblingCount, totalPageCount)

    const shouldShowLeftDots = leftSiblingIndex > 2
    const shouldShowRightDots = rightSiblingIndex < totalPageCount - 1

    const firstPageIndex = 1
    const lastPageIndex = totalPageCount

    let pages: (number | string)[] = []

    if (!shouldShowLeftDots && shouldShowRightDots) {
      const leftItemCount = 3 + 2 * siblingCount
      pages = [...range(1, leftItemCount), DOTS, totalPageCount]
    } else if (shouldShowLeftDots && !shouldShowRightDots) {
      const rightItemCount = 3 + 2 * siblingCount
      pages = [firstPageIndex, DOTS, ...range(totalPageCount - rightItemCount + 1, totalPageCount)]
    } else if (shouldShowLeftDots && shouldShowRightDots) {
      pages = [firstPageIndex, DOTS, ...range(leftSiblingIndex, rightSiblingIndex), DOTS, lastPageIndex]
    }

    return pages
  }, [totalPageCount, currentPage, siblingCount])

  if (totalPageCount === 0) return null

  return (
    <nav
      aria-label="Pagination Navigation"
      className={`mt-6 flex flex-wrap items-center justify-center gap-2 sm:gap-3 ${className}`}
    >
      {/* Previous Button */}
      <button
        onClick={() => onPageChange(Math.max(currentPage - 1, 1))}
        disabled={currentPage === 1}
        aria-disabled={currentPage === 1}
        aria-label="Previous Page"
        className="rounded bg-[#2a2a2a] px-4 py-2 hover:bg-[#2a2a2a] focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-1 disabled:opacity-50"
      >
        Previous
      </button>

      {/* Page Numbers */}
      <ul className="flex list-none gap-1">
        {paginationRange.map((pageNumber, idx) =>
          pageNumber === DOTS ? (
            <li key={`dots-${idx}`} className="select-none px-3 py-2 text-gray-400">
              &#8230;
            </li>
          ) : (
            <li key={pageNumber}>
              <button
                onClick={() => onPageChange(Number(pageNumber))}
                aria-current={pageNumber === currentPage ? "page" : undefined}
                className={`rounded px-4 py-2 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-1 ${
                  pageNumber === currentPage ? "bg-orange-600 text-white" : "bg-[#2a2a2a] text-white hover:bg-[#2a2a2a]"
                }`}
              >
                {pageNumber}
              </button>
            </li>
          ),
        )}
      </ul>

      {/* Next Button */}
      <button
        onClick={() => onPageChange(Math.min(currentPage + 1, totalPageCount))}
        disabled={currentPage === totalPageCount}
        aria-disabled={currentPage === totalPageCount}
        aria-label="Next Page"
        className="rounded bg-[#2a2a2a] px-4 py-2 hover:bg-[#2a2a2a] focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-1 disabled:opacity-50"
      >
        Next
      </button>
    </nav>
  )
}

export default Pagination
