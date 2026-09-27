import { ethers } from "ethers";

import { providerForChain } from "@/config/provider";
import erc20Abi from "@/abi/ERC20Abi.json";

/**
 * One wallet's balance of one ERC-20, in base units, or null when it can't be
 * read.
 *
 * Shared by the server and browser planners — like `readCollateralDeposits` — so a
 * relative swap ("swap half my USDC") resolves to the *same* number in the chat
 * and on the agent page. Chain-scoped through `chainId`, read over the chain's own
 * RPC (not a wallet), so it never disagrees with the balance the rest of the
 * planner sees.
 *
 * A native-sentinel address is not an ERC-20 (`balanceOf` reverts on a non-contract
 * address), so it returns null. That is deliberate: a relative *native* swap then
 * falls back to asking for an amount rather than spending the wallet down to zero
 * gas — "swap all my ETH" leaving nothing to pay for the swap is a footgun this
 * sidesteps instead of arming.
 */
export async function readTokenBalance(
  chainId: number | undefined,
  address: string | undefined,
  token: string,
): Promise<bigint | null> {
  const provider = providerForChain(chainId);
  if (
    !provider ||
    !address ||
    !ethers.isAddress(address) ||
    !ethers.isAddress(token)
  ) {
    return null;
  }
  try {
    const erc20 = new ethers.Contract(token, erc20Abi, provider);
    const bal = await erc20.balanceOf(address);
    return BigInt(bal.toString());
  } catch {
    return null;
  }
}

/**
 * One wallet's balance on ANY chain — the native currency when `isNative`, else
 * an ERC-20 — in base units, or null when it can't be read. Used by send to
 * check the chain it was asked for, and to find where else a token is held.
 */
export async function readBalanceOn(
  chainId: number,
  address: string | undefined,
  token: string,
  isNative: boolean,
): Promise<bigint | null> {
  if (!isNative) return readTokenBalance(chainId, address, token);
  const provider = providerForChain(chainId);
  if (!provider || !address || !ethers.isAddress(address)) return null;
  try {
    return BigInt((await provider.getBalance(address)).toString());
  } catch {
    return null;
  }
}
