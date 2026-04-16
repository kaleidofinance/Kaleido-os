export function formatPoints(value: string | number | bigint, decimals = 2): string {
  let num: number;

  if (typeof value === "string") {
    try {
      num = Number(BigInt(value));
    } catch {
      num = Number(value);
    }
  } else if (typeof value === "bigint") {
    num = Number(value);
  } else {
    num = value;
  }

  if (isNaN(num)) return String(value);

  const absNum = Math.abs(num);

  if (absNum < 1_000) {
    return num.toString();
  } else if (absNum < 1_000_000) {
    return (num / 1_000).toFixed(decimals) + "K";
  } else if (absNum < 1_000_000_000) {
    return (num / 1_000_000).toFixed(decimals) + "M";
  } else if (absNum < 1_000_000_000_000) {
    return (num / 1_000_000_000).toFixed(decimals) + "B";
  } else {
    return (num / 1_000_000_000_000).toFixed(decimals) + "T";
  }
}

export function calculatePointsEarned(
  stakedAmount: bigint,
  stakingDuration: number, // in seconds
  pointsPerSecond: bigint,
  multiplier: number = 1
): bigint {
  const durationInSeconds = BigInt(stakingDuration);
  const basePoints = stakedAmount * durationInSeconds * pointsPerSecond;
  const multiplierBN = BigInt(Math.floor(multiplier * 100)); // Convert to basis points
  return (basePoints * multiplierBN) / BigInt(100);
}

export function calculatePointsPerSecond(
  totalStaked: bigint,
  totalPointsPerDay: bigint
): bigint {
  const secondsInDay = BigInt(86400); // 24 * 60 * 60
  return totalPointsPerDay / secondsInDay;
}

export function getMultiplierForPool(
  poolAddress: string,
  stakingDuration: number
): number {
  // Base multiplier logic - can be customized based on pool and duration
  const baseMultiplier = 1.0;
  
  // Duration-based multiplier (longer staking = higher multiplier)
  const durationMultiplier = Math.min(1 + (stakingDuration / (365 * 24 * 60 * 60)) * 0.5, 2.0);
  
  // Pool-specific multiplier (can be based on pool TVL, volume, etc.)
  const poolMultiplier = 1.0; // This could be fetched from a contract or config
  
  return baseMultiplier * durationMultiplier * poolMultiplier;
}

export function formatStakingDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m`;
  } else if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  } else {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    return `${days}d ${hours}h`;
  }
}

export function calculateAPRFromPoints(
  pointsPerSecond: bigint,
  totalStaked: bigint,
  multiplier: number = 1
): number {
  if (totalStaked === BigInt(0)) return 0;
  
  const pointsPerYear = pointsPerSecond * BigInt(365 * 24 * 60 * 60);
  const pointsPerYearWithMultiplier = (pointsPerYear * BigInt(Math.floor(multiplier * 100))) / BigInt(100);
  
  // Assuming 1 point = 1 USD for APR calculation
  const apr = Number(pointsPerYearWithMultiplier) / Number(totalStaked) * 100;
  return Math.min(apr, 10000); // Cap at 10000% APR
}
