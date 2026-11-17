import { ethers } from "ethers";

export interface SynthraPoolLeg {
  pool: string;
  fee: number;
  tokenIn: { address: string; chainId: number };
  tokenOut: { address: string; chainId: number };
}

const V3_FEES = new Set([100, 500, 3_000, 10_000]);

/** Route evidence for internal Synthra pools. Unknown, stale, or blocked
 * data is rejected; low TVL is allowed only after the caller proves that
 * Synthra selected this internal route as best execution. */
export async function verifySynthraPoolRoute(
  raw: unknown,
  chainId: number,
  getPool: (tokenIn: string, tokenOut: string, fee: number) => Promise<string>,
  options: { allowLowTvl?: boolean } = {},
): Promise<SynthraPoolLeg[] | null> {
  if (!raw || typeof raw !== "object") return null;
  const result = raw as Record<string, any>;
  if (
    result.state !== "Success" ||
    result.chainId !== chainId ||
    !Array.isArray(result.route) ||
    result.route.length !== 1 ||
    result.route[0]?.percentage !== 100
  )
    return null;
  const risk = result.debug?.risk;
  const warnings = [
    ...(Array.isArray(result.warnings) ? result.warnings : []),
    ...(Array.isArray(risk?.warnings) ? risk.warnings : []),
  ];
  const onlyLowTvlWarning =
    warnings.length > 0 &&
    warnings.every((warning) => warning === "low_tvl_pool");
  if (
    (warnings.length > 0 && (!onlyLowTvlWarning || !options.allowLowTvl)) ||
    risk?.blocked !== false ||
    !Number.isFinite(risk?.minPoolTvlUsd) ||
    !Number.isFinite(risk?.lowTvlThresholdUsd) ||
    risk.minPoolTvlUsd <= 0
  )
    return null;
  const legs = result.route[0].legs;
  if (!Array.isArray(legs) || legs.length < 1 || legs.length > 3) return null;
  const accepted: SynthraPoolLeg[] = [];
  for (const leg of legs) {
    if (
      leg?.protocol !== "v3" ||
      !ethers.isAddress(leg.pool) ||
      leg.pool.toLowerCase() === ethers.ZeroAddress ||
      !ethers.isAddress(leg.tokenIn?.address) ||
      !ethers.isAddress(leg.tokenOut?.address) ||
      leg.tokenIn.address.toLowerCase() ===
        leg.tokenOut.address.toLowerCase() ||
      leg.tokenIn.chainId !== chainId ||
      leg.tokenOut.chainId !== chainId ||
      !Number.isInteger(leg.fee) ||
      !V3_FEES.has(leg.fee)
    )
      return null;
    if (
      accepted.length &&
      accepted[accepted.length - 1].tokenOut.address.toLowerCase() !==
        leg.tokenIn.address.toLowerCase()
    )
      return null;
    let actual: string;
    try {
      actual = await getPool(
        leg.tokenIn.address,
        leg.tokenOut.address,
        leg.fee,
      );
    } catch {
      return null;
    }
    if (
      !ethers.isAddress(actual) ||
      actual.toLowerCase() !== leg.pool.toLowerCase()
    )
      return null;
    accepted.push({
      pool: leg.pool,
      fee: leg.fee,
      tokenIn: leg.tokenIn,
      tokenOut: leg.tokenOut,
    });
  }
  return accepted;
}
