import { Contract, Interface } from "ethers";
import { providerForChain } from "@/config/provider";
import {
  ELYSIUM_CHAIN_ID,
  ELYSIUM_POOL_MANAGERS,
  ELYSIUM_V4_PERIPHERY,
  KALOS_V3,
} from "./addresses";
import { readElysiumQuoteUsdPrices, type ElysiumLaunch } from "./launch";

const V4_QUOTER_IFACE = new Interface([
  "function quoteExactInputSingle((tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 exactAmount, bytes hookData) params) external returns (uint256 amountOut, uint256 gasEstimate)",
]);

const V3_POOL_ABI = [
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)",
  "function liquidity() view returns (uint128)",
];

const OVERRIDE_QUOTER_ADDR = "0x00000000000000000000000000000000004b414c";
const SHARED_PM_HEX = ELYSIUM_POOL_MANAGERS.shared.slice(2).toLowerCase();

let cachedSharedQuoterCode: string | null = null;

async function getSharedQuoterBytecode(): Promise<string | null> {
  if (cachedSharedQuoterCode) return cachedSharedQuoterCode;
  const provider = providerForChain(ELYSIUM_CHAIN_ID);
  if (!provider) return null;
  try {
    const code = await provider.getCode(ELYSIUM_V4_PERIPHERY.quoter);
    if (code && code !== "0x" && code.length > 100) {
      cachedSharedQuoterCode = code.toLowerCase();
      return cachedSharedQuoterCode;
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Pure single-range Uniswap v3/v4 concentrated-liquidity output estimate.
 * Used for Kalos V3 bridge hops (`USDC <-> WHYPE`, `KNTQ <-> WHYPE`) and as a
 * fallback if an RPC endpoint rejects `eth_call` state overrides.
 */
export function quoteSingleRangeRaw(
  sqrtPriceX96: bigint,
  liquidity: bigint,
  zeroForOne: boolean,
  amountInRaw: bigint,
  feePips = 3000,
): bigint {
  if (amountInRaw <= 0n || sqrtPriceX96 <= 0n || liquidity <= 0n) return 0n;
  const effectiveFeePips =
    feePips >= 0x800000 || feePips < 0 || feePips >= 1_000_000 ? 10_000 : feePips;
  const amountInAfterFee =
    (amountInRaw * BigInt(1_000_000 - effectiveFeePips)) / 1_000_000n;
  if (amountInAfterFee <= 0n) return 0n;

  const sqrtP = Number(sqrtPriceX96) / 2 ** 96;
  const L = Number(liquidity);
  const dx = Number(amountInAfterFee);
  let outFloat: number;
  if (zeroForOne) {
    const sqrtPNext = (L * sqrtP) / (L + dx * sqrtP);
    outFloat = L * (sqrtP - sqrtPNext);
  } else {
    const sqrtPNext = sqrtP + dx / L;
    outFloat = L * (1 / sqrtP - 1 / sqrtPNext);
  }
  if (!Number.isFinite(outFloat) || outFloat <= 0) return 0n;
  return BigInt(Math.floor(outFloat));
}

/**
 * Quote an exact-input single hop on any of the 5 Elysium Uniswap v4
 * PoolManager singletons.
 *
 * - For Shared PoolManager (`0xE2e1…23F1`), calls the deployed `V4Quoter`
 *   (`0x379f556c5a748bD7cc9Baf0f7a344094AC1814f5`) directly.
 * - For the 4 dedicated PoolManagers (`BOXA`, `Kleos`, `ElysPump`, `Eleos`),
 *   rewrites the `PoolManager` immutable inside `V4Quoter`'s runtime bytecode
 *   and executes an `eth_call` with state override so hooks and multi-tick
 *   crossings are simulated identically to on-chain execution.
 */
export async function quoteElysiumV4Hop(
  launch: ElysiumLaunch,
  zeroForOne: boolean,
  amountInRaw: bigint,
): Promise<bigint | null> {
  if (amountInRaw <= 0n) return null;
  const provider = providerForChain(ELYSIUM_CHAIN_ID);
  if (!provider) return null;

  const callData = V4_QUOTER_IFACE.encodeFunctionData("quoteExactInputSingle", [
    {
      poolKey: [
        launch.poolKey.currency0,
        launch.poolKey.currency1,
        launch.poolKey.fee,
        launch.poolKey.tickSpacing,
        launch.poolKey.hooks,
      ],
      zeroForOne,
      exactAmount: amountInRaw,
      hookData: "0x",
    },
  ]);

  const isShared =
    launch.poolManager.toLowerCase() ===
    ELYSIUM_POOL_MANAGERS.shared.toLowerCase();

  try {
    if (isShared) {
      const raw = await provider.call({
        to: ELYSIUM_V4_PERIPHERY.quoter,
        data: callData,
      });
      const [amountOut] = V4_QUOTER_IFACE.decodeFunctionResult(
        "quoteExactInputSingle",
        raw,
      );
      const out = BigInt(amountOut);
      if (out > 0n) return out;
    } else {
      const baseCode = await getSharedQuoterBytecode();
      if (baseCode) {
        const targetPmHex = launch.poolManager.slice(2).toLowerCase();
        const patchedCode = baseCode.replaceAll(SHARED_PM_HEX, targetPmHex);
        const raw = (await provider.send("eth_call", [
          { to: OVERRIDE_QUOTER_ADDR, data: callData },
          "latest",
          { [OVERRIDE_QUOTER_ADDR]: { code: patchedCode } },
        ])) as string;
        const [amountOut] = V4_QUOTER_IFACE.decodeFunctionResult(
          "quoteExactInputSingle",
          raw,
        );
        const out = BigInt(amountOut);
        if (out > 0n) return out;
      }
    }
  } catch {
    // Fall back to single-range math if hook reverts on quote or RPC rejects state override
  }

  const fallback = quoteSingleRangeRaw(
    launch.sqrtPriceX96,
    launch.liquidity,
    zeroForOne,
    amountInRaw,
    launch.poolKey.fee,
  );
  return fallback > 0n ? fallback : null;
}

/**
 * Quote a Kalos V3 bridge hop (`USDC <-> WHYPE` or `KNTQ <-> WHYPE`) using the
 * pool's live `slot0()` and `liquidity()`.
 */
export async function quoteKalosV3Hop(
  poolAddress: string,
  feePips: number,
  tokenIn: string,
  tokenOut: string,
  amountInRaw: bigint,
): Promise<bigint | null> {
  if (amountInRaw <= 0n) return null;
  const zeroForOne = BigInt(tokenIn) < BigInt(tokenOut);
  if (poolAddress.toLowerCase() === KALOS_V3.usdcWhypePool.toLowerCase()) {
    const cached = await readElysiumQuoteUsdPrices();
    if (
      cached.usdcWhypeSqrtPriceX96 &&
      cached.usdcWhypeSqrtPriceX96 > 0n &&
      cached.usdcWhypeLiquidity &&
      cached.usdcWhypeLiquidity > 0n
    ) {
      const out = quoteSingleRangeRaw(
        cached.usdcWhypeSqrtPriceX96,
        cached.usdcWhypeLiquidity,
        zeroForOne,
        amountInRaw,
        feePips,
      );
      if (out > 0n) return out;
    }
  }
  const provider = providerForChain(ELYSIUM_CHAIN_ID);
  if (!provider) return null;
  try {
    const pool = new Contract(poolAddress, V3_POOL_ABI, provider);
    const [slot0, liq] = await Promise.all([pool.slot0(), pool.liquidity()]);
    const sqrtPriceX96 = BigInt(slot0[0]);
    const liquidity = BigInt(liq);
    const out = quoteSingleRangeRaw(
      sqrtPriceX96,
      liquidity,
      zeroForOne,
      amountInRaw,
      feePips,
    );
    return out > 0n ? out : null;
  } catch {
    return null;
  }
}
