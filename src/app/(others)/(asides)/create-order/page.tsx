"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export default function CreateOrderPage() {
  const router = useRouter()

  useEffect(() => {
    // Redirect to dashboard since create order functionality is now integrated there
    router.push("/")
  }, [router])

  return (
    <div className="my-12">
      <div className="u-class-shadow mt-4 rounded-md bg-black p-2">
        <div className="flex h-32 items-center justify-center gap-3 text-center">
          <p className="text-gray-500">Redirecting to dashboard...</p>
        </div>
      </div>
    </div>
  )
}
