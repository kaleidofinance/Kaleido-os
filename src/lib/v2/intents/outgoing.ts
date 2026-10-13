import type { Intent } from "./types";

/**
 * The tokens a plan spends OUT of the wallet — what a pre-sign balance check
 * reads to refuse a plan the wallet cannot cover.
 *
 * The builder prices a plan against the pools but never against the wallet, so a
 * "swap 999999 USDC" the wallet cannot cover still built a signable plan and
 * only failed at the wallet. This is the shape that lets that be caught earlier.
 *
 * ONE HARD RULE: it must NEVER over-report a spend. A false "insufficient
 * balance" blocks a plan the chain would have accepted, which is worse than the
 * miss it replaces — the chain is always the final arbiter. So it counts only
 * the kinds whose single outgoing token, amount and decimals are unambiguous,
 * and leaves every other kind unchecked:
 *
 *  - `approve` moves nothing — it authorises an allowance the later step spends.
 *    Counting it would double the amount of every swap.
 *  - withdrawals, redeems, claims, removes and fee collections bring tokens IN.
 *  - the lending-market kinds carry escrow semantics, and the LP kinds spend two
 *    tokens at once — neither reduces to one confident number here.
 *
 * `amount` is human units, matching each intent's own field (see the "Human
 * amount; resolver parses with decimals" convention in types.ts). `token` is the
 * ERC20 address to read `balanceOf` against, ignored when `isNative` — a native
 * sell holds WETH9's address in the intent but leaves the wallet as the chain's
 * own currency, so its balance is `getBalance`, not a token read.
 */
export interface OutgoingLeg {
  symbol: string;
  /** ERC20 contract address. Ignored when `isNative`. */
  token: string;
  /** Human amount, matching the intent's own field. */
  amount: string;
  decimals: number;
  isNative: boolean;
}

export function outgoingLegs(intents: readonly Intent[]): OutgoingLeg[] {
  const legs: OutgoingLeg[] = [];
  for (const i of intents) {
    switch (i.kind) {
      case "swap":
        legs.push({
          symbol: i.symbolIn,
          token: i.tokenIn,
          amount: i.amountIn,
          decimals: i.decimalsIn,
          isNative: !!i.nativeIn,
        });
        break;
      case "swapMultiHop":
        legs.push({
          symbol: i.symbolIn,
          /* The first hop's input is what leaves the wallet; the encoded path is
             for the router, not for a balance read. */
          token: i.hops[0]?.tokenIn ?? "",
          amount: i.amountIn,
          decimals: i.decimalsIn,
          isNative: !!i.nativeIn,
        });
        break;
      case "transfer":
        legs.push({
          symbol: i.symbol,
          token: i.token,
          amount: i.amount,
          decimals: i.decimals,
          isNative: !!i.isNative,
        });
        break;
      case "depositCollateral":
        legs.push({
          symbol: i.symbol,
          token: i.token,
          amount: i.amount,
          decimals: i.decimals,
          isNative: !!i.isNative,
        });
        break;
      case "stake":
        /* KLD only, and KLD is 18 decimals — the vault stakes nothing else, and
           the intent carries no `decimals` of its own to read. */
        legs.push({
          symbol: i.symbol,
          token: i.token,
          amount: i.amount,
          decimals: 18,
          isNative: false,
        });
        break;
    }
  }
  return legs;
}
