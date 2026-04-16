import React from "react"

// Slightly darker skeleton color
const skeletonColor = "bg-[#2a2a2a]"

const SkeletonCard = () => {
  return (
    <div className="w-full animate-pulse space-y-4 rounded-2xl border border-[#00ff99]/30 bg-[#2a2a2a] p-6 shadow-md">
      {/* Header Row: Token Image & Status Badge */}
      <div className="flex items-center justify-between">
        {/* Token Image Placeholder */}
        <div className={`h-12 w-12 rounded-full ${skeletonColor}`}></div>

        {/* Status Badge */}
        <div className={`h-7 w-24 rounded-full ${skeletonColor}`}></div>
      </div>

      {/* Token Label */}
      <div className={`h-8 w-20 rounded-lg ${skeletonColor}`}></div>

      {/* Origin Address */}
      <div>
        <div className={`mb-1 h-4 w-20 rounded ${skeletonColor}`}></div>
        <div className={`h-4 w-40 rounded ${skeletonColor}`}></div>
      </div>

      {/* Volume */}
      <div>
        <div className={`mb-1 h-4 w-24 rounded ${skeletonColor}`}></div>
        <div className={`h-4 w-48 rounded ${skeletonColor}`}></div>
      </div>

      {/* Rate */}
      <div>
        <div className={`mb-1 h-4 w-16 rounded ${skeletonColor}`}></div>
        <div className={`h-4 w-12 rounded ${skeletonColor}`}></div>
      </div>

      {/* Min */}
      <div>
        <div className={`mb-1 h-4 w-16 rounded ${skeletonColor}`}></div>
        <div className={`h-4 w-40 rounded ${skeletonColor}`}></div>
      </div>

      {/* Max */}
      <div>
        <div className={`mb-1 h-4 w-16 rounded ${skeletonColor}`}></div>
        <div className={`h-4 w-40 rounded ${skeletonColor}`}></div>
      </div>

      {/* Duration */}
      <div>
        <div className={`mb-1 h-4 w-20 rounded ${skeletonColor}`}></div>
        <div className={`h-4 w-32 rounded ${skeletonColor}`}></div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-center gap-4 pt-3">
        <div className={`h-10 w-full rounded-md ${skeletonColor}`}></div>
        {/* <div className={`h-10 w-28 rounded-lg ${skeletonColor}`}></div> */}
      </div>
    </div>
  )
}

export const SkeletonCardGrid = ({ count = 6 }: { count?: number }) => {
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, index) => (
        <SkeletonCard key={index} />
      ))}
    </div>
  )
}

export default SkeletonCard
