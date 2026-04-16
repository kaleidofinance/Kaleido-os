import { createThirdwebClient } from "thirdweb"
import { envVars } from "@/constants/envVars"

export const client = createThirdwebClient({
  clientId: `${envVars.thirdwebClientId}`,
})
