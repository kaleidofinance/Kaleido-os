import { getAddress, isAddress } from "ethers";
import { getToken } from "@/constants/registry";
import type { IToken } from "@/constants/types/dex";
import { ELYSIUM_CHAIN_ID } from "./addresses";

const HEX_40 = /^0x[0-9a-fA-F]{40}$/;

/**
 * Turn a bare `0x…` word typed in a command on Elysium Mainnet (99901) into a
 * provisional `IToken` when it is not already in the static Elysium registry —
 * the entry point that lets `"buy 0x732d… with 10 USDC"` or `"sell 50% of 0x732d… for USDC"`
 * parse as a SwapCommand and reach the Elysium launchpad swap route.
 */
export function elysiumAddressToken(word: string): IToken | null {
  if (!HEX_40.test(word) || !isAddress(word.toLowerCase())) return null;
  const addr = getAddress(word.toLowerCase());
  // Already in the Elysium registry (WHYPE, USDC, KNTQ, etc.) → let the normal symbol/address table win.
  if (getToken(ELYSIUM_CHAIN_ID, addr)) return null;
  const short = `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  return {
    name: short,
    symbol: short,
    address: addr,
    decimals: 18,
    chainId: ELYSIUM_CHAIN_ID,
    logoURI: "",
    tags: ["elysium"],
  };
}
