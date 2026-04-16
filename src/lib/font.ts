import { Share_Tech_Mono, Zen_Dots } from "next/font/google"

const shareTechMono = Share_Tech_Mono({ 
  weight: "400", 
  subsets: ["latin"],
  display: "swap",
  fallback: ["monospace"]
})

const zenDots = Zen_Dots({ 
  weight: "400", 
  subsets: ["latin"], 
  variable: "--font-zenDots",
  display: "swap",
  fallback: ["sans-serif"]
})

export { shareTechMono, zenDots }
