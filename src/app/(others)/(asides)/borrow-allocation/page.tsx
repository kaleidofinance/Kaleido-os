import BorrowAllocationPage from "@/components/allocation/BorrowAllocation"
import { LoadingScreen } from "@/components/ui/loading"
import { Suspense } from "react"

export default function Page() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <BorrowAllocationPage />
    </Suspense>
  )
}
