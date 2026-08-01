import { createThirdwebClient } from "thirdweb"
import { envVars } from "@/constants/envVars"

// createThirdwebClient throws at import when no clientId is set, which crashes
// the whole app on boot. Fall back to a placeholder so the UI still renders;
// wallet connection needs a real NEXT_PUBLIC_THIRDWEB_CLIENT_KEY to work.
const clientId = envVars.thirdwebClientId

if (!clientId && typeof window === "undefined") {
  console.warn(
    "[thirdweb] NEXT_PUBLIC_THIRDWEB_CLIENT_KEY is not set — wallet connection " +
      "will not work. Set it in .env to enable it.",
  )
}

export const client = createThirdwebClient({
  clientId: clientId || "placeholder-client-id",
})
