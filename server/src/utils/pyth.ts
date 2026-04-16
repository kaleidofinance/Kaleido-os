export function normalizePythPrice(priceTuple: [bigint, bigint, number, bigint]): number {
  const price = Number(priceTuple[0])
  const expo = Number(priceTuple[2])
  return price * Math.pow(10, expo)
}

export function getTimestamp(): string {
  return new Date().toISOString()
}

export function extractPrice(priceObj: { price: string; expo: number }): number {
  return Number(priceObj.price) * Math.pow(10, priceObj.expo)
}
