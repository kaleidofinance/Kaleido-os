export function getMinimumInterest(orders: { interest: number }[]): number {
  if (!orders || orders.length === 0) return 0
  return Math.min(...orders.map((order) => order.interest)) / 100
}
