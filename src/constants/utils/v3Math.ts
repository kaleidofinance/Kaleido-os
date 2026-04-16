/**
 * Simplified Uniswap V3 Math Helpers
 */

export const TICK_SPACINGS: { [fee: number]: number } = {
  100: 1,
  500: 10,
  3000: 60,
  10000: 200,
};

export const MIN_TICK = -887272;
export const MAX_TICK = 887272;

/**
 * Converts a price to a V3 tick
 * Price is token1/token0
 */
export function priceToTick(price: number, decimals0: number, decimals1: number): number {
  if (price <= 0) return 0;
  
  // Uniswap V3: human_price = (1.0001^tick) * 10^(decimals0 - decimals1)
  // Therefore: 1.0001^tick = human_price * 10^(decimals1 - decimals0)
  const adjustedPrice = price * Math.pow(10, decimals1 - decimals0);
  const tick = Math.floor(Math.log(adjustedPrice) / Math.log(1.0001));
  
  return Math.max(MIN_TICK, Math.min(MAX_TICK, tick));
}

/**
 * Converts a V3 tick to a price
 */
export function tickToPrice(tick: number, decimals0: number, decimals1: number): number {
  const priceBase = Math.pow(1.0001, tick);
  return priceBase * Math.pow(10, decimals0 - decimals1);
}

/**
 * Snaps a tick to the nearest valid tick based on fee tier spacing
 */
export function nearestUsableTick(tick: number, spacing: number): number {
  const rounded = Math.floor((tick + (tick < 0 ? -spacing / 2 : spacing / 2)) / spacing) * spacing;
  if (rounded < MIN_TICK) return rounded + spacing;
  if (rounded > MAX_TICK) return rounded - spacing;
  return rounded;
}

/**
 * Calculates the amount ratio (token1/token0) for a given V3 range.
 * This is used to sync input amounts in the UI.
 */
export function getV3AmountRatio(
  currentPrice: number,
  minPrice: number,
  maxPrice: number,
  decimals0: number,
  decimals1: number
): number {
  if (currentPrice <= 0 || minPrice <= 0 || maxPrice <= 0) return 0;
  
  // Convert human prices to sqrtPrices
  const sqrtP = Math.sqrt(currentPrice * Math.pow(10, decimals1 - decimals0));
  const sqrtL = Math.sqrt(minPrice * Math.pow(10, decimals1 - decimals0));
  const sqrtU = Math.sqrt(maxPrice * Math.pow(10, decimals1 - decimals0));

  if (sqrtP <= sqrtL) return 999999999; // Only token0 needed
  if (sqrtP >= sqrtU) return 0; // Only token1 needed

  // Liquidity math ratio: amount1 / amount0 = (sqrtP * sqrtU * (sqrtP - sqrtL)) / (sqrtU - sqrtP)
  const ratio = (sqrtP * sqrtU * (sqrtP - sqrtL)) / (sqrtU - sqrtP);
  return ratio / Math.pow(10, decimals1 - decimals0);
}
