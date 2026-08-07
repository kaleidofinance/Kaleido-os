import { envVars } from "@/constants/envVars"
import { ethers } from "ethers"

/**
 * Read-only provider, still pinned to Abstract Testnet (11124).
 *
 * The comment here used to say "pointing to sepolia", which it never was —
 * `abstract-sepolia` is Abstract's testnet, not Ethereum Sepolia, and the two
 * are unrelated chains.
 *
 * BLOCKED ON GATE A. This can't be repointed by guessing: the chain id must
 * match whatever `envVars.httpRPC` actually serves, or every read silently
 * returns data from the wrong chain. Repoint both together when the first
 * priority testnet deploys (Arc, Base, Robinhood, BNB or Ethereum), and prefer
 * deriving them from the connected wallet over a module-level constant.
 *
 * Still correct for reading Abstract balances, which is the only thing Abstract
 * is kept registered for.
 */
export const readOnlyProvider = new ethers.JsonRpcProvider(envVars.httpRPC, {
    chainId: 11124,
    name: "abstract-testnet"
}, { staticNetwork: true })

// read/write provider, that allows you to read data and also sign transaction on whatever chain it's pointing to
export const getProvider = (provider: any) => new ethers.BrowserProvider(provider)

export const wssProvider = new ethers.WebSocketProvider("wss://api.testnet.abs.xyz/ws")
