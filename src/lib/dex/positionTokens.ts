import { chainTokens } from "@/constants/tokens";
import type { IToken } from "@/constants/types/dex";

/**
 * A V3 position can hold ERC-20 contracts only. Native gas assets have no
 * contract to approve or transferFrom, so offering one in the position picker
 * creates a selection the form must immediately replace with its wrapped form.
 */
export function isPoolPositionToken(token: IToken): boolean {
  return !token.isNative;
}

/** Tokens that can actually be deposited into a V3 position on one chain. */
export function poolPositionTokens(chainId: number | undefined): IToken[] {
  return chainTokens(chainId).filter(isPoolPositionToken);
}
