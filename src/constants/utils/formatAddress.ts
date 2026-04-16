export const formatAddress = (address: string | undefined, slice?: Number) => {
  if (slice && typeof slice === "number") {
    return `${address?.slice(0, slice)}...`
  }
  return `${address?.slice(0, 6)}...${address?.slice(-4)}`
}
