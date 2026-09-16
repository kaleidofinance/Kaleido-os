/**
 * Seed a small on-chain USDC -> WUSDC test wrap on Arc mainnet.
 *
 * Signs with the deployer configured for the `arcMainnet` network in
 * hardhat.config.js — the key is read from the environment by Hardhat and never
 * printed here. Wraps WRAP_AMOUNT of native USDC into the wrapped-native
 * (WRAPPED_NATIVE, our WETH9 at 0x8c6c…, which reports "WETH" but wraps USDC),
 * then reads the resulting WUSDC balance to confirm the 1:1 credit.
 *
 *   npx hardhat run scripts/seed-wrap.js --network arcMainnet
 *
 * Leaves WRAP_AMOUNT of WUSDC in the deployer wallet as the seed. To send it
 * back to native, call withdraw(amount) on the same contract (or use the swap
 * card's Unwrap). Set WRAP_AMOUNT below to change the size; 0.1 is deliberately
 * tiny — this is a liveness check, not a position.
 */
const hre = require("hardhat");
const { ethers } = hre;

const WRAP_AMOUNT = "0.1"; // native USDC (18 decimals on Arc)

const WETH9_ABI = [
  "function deposit() payable",
  "function withdraw(uint256 wad)",
  "function balanceOf(address) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
];

async function main() {
  const net = await ethers.provider.getNetwork();
  if (net.chainId !== 5042n) {
    throw new Error(
      `Wrong network: chainId ${net.chainId}. Run with --network arcMainnet (5042).`,
    );
  }

  const wrapped = process.env.WRAPPED_NATIVE;
  if (!wrapped || !ethers.isAddress(wrapped)) {
    throw new Error("WRAPPED_NATIVE is missing or not an address in .env");
  }

  const [signer] = await ethers.getSigners();
  const me = signer.address;
  console.log("Signer:      ", me);
  console.log("Wrapped USDC:", wrapped);

  const w = new ethers.Contract(wrapped, WETH9_ABI, signer);
  const [sym, dec] = await Promise.all([w.symbol(), w.decimals()]);
  console.log(`Contract:     symbol=${sym} decimals=${dec} (WETH9 wrapping native USDC)`);

  const amount = ethers.parseUnits(WRAP_AMOUNT, 18);
  const nativeBefore = await ethers.provider.getBalance(me);
  const wusdcBefore = await w.balanceOf(me);
  console.log(
    `\nBefore:  native ${ethers.formatUnits(nativeBefore, 18)} USDC | WUSDC ${ethers.formatUnits(wusdcBefore, dec)}`,
  );

  // Guard: enough native to wrap AND pay gas.
  if (nativeBefore < amount * 2n) {
    throw new Error(
      `Not enough native USDC to wrap ${WRAP_AMOUNT} and cover gas. Hold at least ${ethers.formatUnits(amount * 2n, 18)}.`,
    );
  }

  console.log(`\nWrapping ${WRAP_AMOUNT} USDC -> WUSDC via deposit()…`);
  const tx = await w.deposit({ value: amount });
  console.log("  tx:", tx.hash);
  const rcpt = await tx.wait();
  console.log(
    `  mined in block ${rcpt.blockNumber}, gas used ${rcpt.gasUsed.toString()}, status ${rcpt.status === 1 ? "success" : "FAILED"}`,
  );
  if (rcpt.status !== 1) throw new Error("deposit() reverted on-chain");

  const nativeAfter = await ethers.provider.getBalance(me);
  const wusdcAfter = await w.balanceOf(me);
  const credited = wusdcAfter - wusdcBefore;
  console.log(
    `\nAfter:   native ${ethers.formatUnits(nativeAfter, 18)} USDC | WUSDC ${ethers.formatUnits(wusdcAfter, dec)}`,
  );
  console.log(
    `Credited: ${ethers.formatUnits(credited, dec)} WUSDC (expected ${WRAP_AMOUNT}) ${
      credited === amount ? "— exact 1:1 ✓" : "— MISMATCH"
    }`,
  );

  const supply = await w.totalSupply();
  console.log(`WUSDC totalSupply now: ${ethers.formatUnits(supply, dec)}`);
  console.log(
    `\nSeed complete. ${WRAP_AMOUNT} WUSDC now held by ${me}. Unwrap any time with withdraw(), or on the swap card.`,
  );
}

main().catch((e) => {
  console.error("\nFAILED:", e.message || e);
  process.exit(1);
});
