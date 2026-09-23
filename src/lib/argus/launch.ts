import { Contract, ZeroAddress, getAddress } from "ethers";
import { providerForChain } from "@/config/provider";
import {
  ARGUS_CHAIN_ID,
  ARGUS_V4,
  ARGUS_V4_11WORD_PORTALS,
  argusEnabled,
} from "./addresses";
import {
  computePoolId,
  priceFromSqrtX96,
  effectiveCostBps,
} from "./poolMath";

/**
 * On-demand reader for a single Argus launch: given a token address, find which
 * Portal launched it, return its normalized launch record, and read live pool
 * state (price, liquidity, current tax) from Uniswap v4 StateView + the launch's
 * hook. This is the foundation the quoter/swap path build on; it does NOT execute
 * swaps (that's UniversalRouter, a later phase).
 *
 * Scope (MVP): the 11-word v4 Portals (#6/#7 — current launches), verified
 * against a live #7 launch on 2026-09-23. Older 9/10-word Portals and legacy v3
 * (#1/#2) decode differently and are added later.
 *
 * Gated: returns null when ARGUS_ENABLED is off, so nothing touches Argus until
 * the integration is armed.
 */

const PORTAL_ABI = [
  "function launches(address) view returns (address creator, int24 tickStart, bool tokenIsToken0, address locker, address hook, address splitter, uint16 buyTaxBps, uint16 sellTaxBps, uint256 positionId, int24 tickBond, address quoteAsset)",
];
const HOOK_ABI = [
  "function currentSnipeTaxBps() view returns (uint256)",
  "function bonded() view returns (bool)",
];
const STATE_VIEW_ABI = [
  "function getSlot0(bytes32) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
  "function getLiquidity(bytes32) view returns (uint128)",
];
const ERC20_ABI = ["function decimals() view returns (uint8)"];

export interface ArgusLaunch {
  token: string;
  portal: string;
  hook: string;
  splitter: string;
  locker: string;
  quoteAsset: string;
  buyTaxBps: number;
  sellTaxBps: number;
  tickStart: number;
  tickBond: number;
  tokenIsToken0: boolean;
  positionId: bigint;
  currency0: string;
  currency1: string;
  poolId: string;
}

export interface ArgusPoolState {
  sqrtPriceX96: bigint;
  tick: number;
  liquidity: bigint;
  /** Live opening surcharge (bps); >0 means we're inside the ~3s snipe window. */
  snipeBps: number;
  bonded: boolean;
  /** Human price of one launch token in the quote asset. */
  pricePerTokenInQuote: number;
  /** Total quote-leg cost in bps for a buy / sell right now (pool fee + tax). */
  buyCostBps: number;
  sellCostBps: number;
}

/** Find + normalize a token's Argus launch, or null if it isn't a (v4 11-word)
 *  Argus launch or the integration is disabled. */
export async function readArgusLaunch(token: string): Promise<ArgusLaunch | null> {
  if (!argusEnabled()) return null;
  let addr: string;
  try {
    addr = getAddress(token);
  } catch {
    return null;
  }
  const provider = providerForChain(ARGUS_CHAIN_ID);
  if (!provider) return null;

  for (const portalAddr of ARGUS_V4_11WORD_PORTALS) {
    try {
      const portal = new Contract(portalAddr, PORTAL_ABI, provider);
      const r = await portal.launches(addr);
      const hook = String(r.hook);
      if (hook === ZeroAddress) continue; // not launched by this Portal
      const quoteAsset = getAddress(String(r.quoteAsset));
      const tokenIsToken0 = Boolean(r.tokenIsToken0);
      // Reconstruct the pool key ordering from the record.
      const currency0 = tokenIsToken0 ? addr : quoteAsset;
      const currency1 = tokenIsToken0 ? quoteAsset : addr;
      const poolId = computePoolId(currency0, currency1, hook);
      return {
        token: addr,
        portal: getAddress(portalAddr),
        hook: getAddress(hook),
        splitter: getAddress(String(r.splitter)),
        locker: getAddress(String(r.locker)),
        quoteAsset,
        buyTaxBps: Number(r.buyTaxBps),
        sellTaxBps: Number(r.sellTaxBps),
        tickStart: Number(r.tickStart),
        tickBond: Number(r.tickBond),
        tokenIsToken0,
        positionId: BigInt(r.positionId),
        currency0,
        currency1,
        poolId,
      };
    } catch {
      // A Portal that doesn't know this token (or a transient RPC error) is not
      // fatal — try the next Portal.
      continue;
    }
  }
  return null;
}

/** Live pool state + current cost schedule for a known launch. Null on read
 *  failure so a hiccup never fabricates a price. */
export async function readArgusPoolState(
  launch: ArgusLaunch,
): Promise<ArgusPoolState | null> {
  if (!argusEnabled()) return null;
  const provider = providerForChain(ARGUS_CHAIN_ID);
  if (!provider) return null;
  try {
    const state = new Contract(ARGUS_V4.stateView, STATE_VIEW_ABI, provider);
    const hook = new Contract(launch.hook, HOOK_ABI, provider);
    const tokenErc = new Contract(launch.token, ERC20_ABI, provider);
    const quoteErc = new Contract(launch.quoteAsset, ERC20_ABI, provider);

    const [slot0, liquidity, snipe, bonded, tokenDec, quoteDec] = await Promise.all([
      state.getSlot0(launch.poolId),
      state.getLiquidity(launch.poolId),
      hook.currentSnipeTaxBps().catch(() => 0n),
      hook.bonded().catch(() => false),
      tokenErc.decimals(),
      quoteErc.decimals(),
    ]);

    const sqrtPriceX96 = BigInt(slot0.sqrtPriceX96 ?? slot0[0]);
    const snipeBps = Number(snipe);
    return {
      sqrtPriceX96,
      tick: Number(slot0.tick ?? slot0[1]),
      liquidity: BigInt(liquidity),
      snipeBps,
      bonded: Boolean(bonded),
      pricePerTokenInQuote: priceFromSqrtX96(
        sqrtPriceX96,
        launch.tokenIsToken0,
        Number(tokenDec),
        Number(quoteDec),
      ),
      buyCostBps: effectiveCostBps(launch.buyTaxBps, snipeBps),
      sellCostBps: effectiveCostBps(launch.sellTaxBps, snipeBps),
    };
  } catch {
    return null;
  }
}
