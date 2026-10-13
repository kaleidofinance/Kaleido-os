import { getAddress, isAddress } from "ethers";
import type { IToken } from "@/constants/types/dex";
import { ARC_USDC, ARGUS_CHAIN_ID } from "./addresses";

/**
 * Turn a bare token ADDRESS into a provisional IToken for the grammar, so an
 * Argus launch named by address ("buy 0x… with 10 USDC") has a swap side to land
 * on. Pure and client-safe (no env, no RPC): the arming switch is the SERVER's
 * `argusEnabled()` inside /api/argus/plan, which refuses when ARGUS_ENABLED is
 * off, and the launch read there supplies the real symbol/decimals. This only
 * decides whether the grammar OFFERS the address to build.ts at all.
 *
 * Returns null for a non-address, for USDC itself (the quote asset is never the
 * buy target) and for the native sentinel — so it can never shadow an ordinary
 * "swap 10 USDC for KLD".
 *
 * Caller gates on chain: wire it only when the connected chain is Arc.
 */
export function argusAddressToken(word: string): IToken | null {
  if (!word || !isAddress(word)) return null;
  let addr: string;
  try {
    addr = getAddress(word);
  } catch {
    return null;
  }
  if (addr.toLowerCase() === ARC_USDC.toLowerCase()) return null;
  const short = `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  return {
    address: addr,
    name: short,
    symbol: short,
    // Provisional — the server's launch read supplies the real decimals. The
    // Argus build branch reads decimals from the server response, not from here.
    decimals: 18,
    chainId: ARGUS_CHAIN_ID,
    verified: false,
    tags: ["argus"],
  };
}
