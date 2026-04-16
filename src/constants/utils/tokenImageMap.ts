export const tokenImageMap: { [key: string]: { image: string; label: string } } = {
  "0x572f4901f03055ffC1D936a60Ccc3CbF13911BE3": { image: "/USDC.svg", label: "USDC" },
  "0x0000000000000000000000000000000000000001": { image: "/eth.svg", label: "ETH" },
  "0x769EBD1dc2470186f0a4911113754DfD13f2CDA3": { image: "/drakov4.png", label: "USDR" },
  "0x913f3354942366809A05e89D288cCE60d87d7348": { image: "/stable/kfUSD.png", label: "kfUSD" },
  "0x717A36E56b33585Bd00260422FfCc3270af34D3E": { image: "/usdt.svg", label: "USDT" },
}

export const Ordertype: Record<number, string> = {
  1: "OPEN",
  2: "CLOSE",
  3: "SERVICED",
}
