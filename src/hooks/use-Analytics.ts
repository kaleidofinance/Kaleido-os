"use client"
import { useEffect } from "react"
import { envVars } from "@/constants/envVars"
import { usePathname } from "next/navigation"
declare global {
  interface Window {
    gtag: (...args: any[]) => void
  }
}

export const useAnalytics = () => {
  const pathname = usePathname()
  useEffect(() => {
    if (typeof window !== "undefined" && window.gtag) {
      window.gtag("config", envVars.measurementId, {
        page_path: pathname,
      })
    }
  }, [])
}
