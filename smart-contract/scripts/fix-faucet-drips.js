/**
 * Re-size drips that have grown larger than the stock behind them.
 *
 *   FAUCET_DRY_RUN=1 npx hardhat run scripts/fix-faucet-drips.js --network arcTestnet
 *   npx hardhat run scripts/fix-faucet-drips.js --network arcTestnet
 *   npx hardhat run scripts/fix-faucet-drips.js --network bscTestnet
 *
 * ── Why this exists, separately from topup-faucet.js ─────────────────────────
 *
 * A faucet row that LISTS an asset is not the same as one that can PAY it. When
 * `drip > balance` the row renders normally, advertises an amount, and reverts
 * `InsufficientContractBalance` on claim — the worst of the three states, because
 * "out of stock" at least tells the truth. Measured on chain 2026-08-30:
 *
 *   Arc  USDC   drip 100      stock 8.694815            0 claims
 *   Arc  WUSDC  drip 100      stock 8.694815257465054   0 claims
 *   Arc  cirBTC drip 0.001    stock 0.0001              0 claims
 *   BSC  WBNB   drip 5        stock 0.281513390235128   0 claims
 *
 * topup-faucet.js is the right tool when the fix is MORE STOCK. It is the wrong
 * tool here: three of those four assets cannot be topped up at all. Arc's USDC is
 * the chain's own gas, so the only source is the deployer's own gas balance;
 * WUSDC is wrapped out of that same balance; cirBTC is a real Circle testnet token
 * with no mint. The stock is what it is, so the drip is the only free variable.
 *
 * Denominated in CLAIMS rather than amounts for that reason — the drip is derived
 * from the live balance, so the plan cannot re-create the condition it is fixing.
 *
 * ── What this deliberately does NOT do ──────────────────────────────────────
 *
 * It does not list `address(1)`. Native support needs the redeployed bytecode:
 * BSC's and Arc's faucets are both the 4560-byte pre-native build (Sepolia's
 * native-capable one is 5343 and is the only one carrying
 * `KaleidoTokenFaucet_NativeTransferFailed`), so `_pay` has no native branch and
 * `setDrip(address(1), x)` would list a row whose claim calls
 * `IERC20(address(1)).safeTransfer` — the ecrecover precompile — and reverts.
 *
 * Arc needs no such redeploy: `0x3600…0000` is a 6-decimal ERC20 alias of the
 * native balance itself (measured ratio exactly 1e12), so paying that row already
 * hands the claimer spendable gas. A redeploy would add an `address(1)` row beside
 * it drawing on the same pot — two rows, one balance, each draining the other.
 */

const hre = require("hardhat");
const { ethers } = hre;

const NATIVE_SENTINEL = "0x0000000000000000000000000000000000000001";

/**
 * Target claim counts, per chain, per asset.
 *
 * The counts differ by what the asset is FOR. Arc's USDC is gas: a claim only has
 * to cover fees, and at 21 gwei a ~100k-gas transaction costs 0.0021 USDC, so a
 * drip a fraction of a dollar is already ~100 transactions of runway — and Circle's
 * own faucet hands out 20 USDC free every 2 hours, which makes our row a top-up
 * rather than the bootstrap. Depth beats size there. cirBTC is capped by a stock of
 * 0.0001 with no way to get more, so 10 is simply all it can do.
 */
const PLANS = {
  5042002: {
    label: "Arc Testnet",
    record: "deployment-faucet-arcTestnet.json",
    assets: [
      { symbol: "USDC", address: "0x3600000000000000000000000000000000000000", claims: 34, note: "the chain's gas, via its 6dp ERC20 alias" },
      { symbol: "WUSDC", address: "0x911b4000D3422F482F4062a913885f7b035382Df", claims: 34, note: "wrapped out of the same native balance" },
      { symbol: "cirBTC", address: "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF", claims: 10, note: "real Circle testnet token, no mint" },
    ],
  },
  97: {
    label: "BSC Testnet",
    record: "deployment-faucet-bscTestnet.json",
    assets: [
      { symbol: "WBNB", address: "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd", claims: 14, note: "wrapped out of the deployer's tBNB, which is nearly empty" },
    ],
  },
};

const ERC20 = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

const FAUCET = [
  "function assetInfo(address user) view returns (address[] tokens,uint256[] amounts,uint256[] balances,uint256[] nextClaimAt)",
  "function setDrips(address[] tokens,uint256[] amounts) external",
  "function owner() view returns (address)",
];

/** Round a drip down to 2 significant figures so the UI shows "0.25", not "0.2557…". */
function tidy(raw, decimals) {
  if (raw <= 0n) return 0n;
  const digits = raw.toString().length;
  const keep = digits > 2 ? 10n ** BigInt(digits - 2) : 1n;
  const rounded = (raw / keep) * keep;
  return rounded > 0n ? rounded : raw;
}

async function main() {
  const dryRun = process.env.FAUCET_DRY_RUN === "1";
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);
  const plan = PLANS[chainId];

  if (!plan) {
    throw new Error(
      `No drip plan for chain ${chainId}. This script only covers ${Object.keys(PLANS).join(", ")}.`,
    );
  }

  const record = JSON.parse(require("fs").readFileSync(plan.record, "utf8"));
  const faucetAddress = record.contracts.faucet;
  const [signer] = await ethers.getSigners();

  console.log(`\n${plan.label} (${chainId})${dryRun ? "  — DRY RUN, nothing is sent" : ""}`);
  console.log(`  faucet   ${faucetAddress}`);
  console.log(`  signer   ${signer.address}`);

  const faucet = new ethers.Contract(faucetAddress, FAUCET, signer);

  const owner = await faucet.owner();
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(`setDrips is onlyOwner; faucet owner is ${owner}, signer is ${signer.address}`);
  }

  const live = await faucet.assetInfo(signer.address);
  const dripOf = new Map();
  for (let i = 0; i < live.tokens.length; i++) {
    dripOf.set(live.tokens[i].toLowerCase(), live.amounts[i]);
  }

  const tokens = [];
  const amounts = [];

  for (const asset of plan.assets) {
    const key = asset.address.toLowerCase();
    if (key === NATIVE_SENTINEL) {
      throw new Error("This script must not list address(1) — see the header.");
    }
    if (!dripOf.has(key)) {
      console.log(`  SKIP  ${asset.symbol} is not listed on this faucet`);
      continue;
    }

    const erc20 = new ethers.Contract(asset.address, ERC20, ethers.provider);
    const [decimals, stock] = await Promise.all([
      erc20.decimals(),
      erc20.balanceOf(faucetAddress),
    ]);
    const d = Number(decimals);
    const was = dripOf.get(key);

    if (stock === 0n) {
      console.log(`  SKIP  ${asset.symbol} holds nothing — a smaller drip cannot fix an empty row`);
      continue;
    }

    const now = tidy(stock / BigInt(asset.claims), d);
    if (now === 0n) {
      console.log(`  SKIP  ${asset.symbol} stock ${ethers.formatUnits(stock, d)} is too small to split ${asset.claims} ways`);
      continue;
    }

    const claimsBefore = was > 0n ? stock / was : 0n;
    const claimsAfter = stock / now;

    if (was === now) {
      console.log(`  OK    ${asset.symbol} drip already ${ethers.formatUnits(now, d)} (${claimsAfter} claims)`);
      continue;
    }

    console.log(
      `  SET   ${asset.symbol.padEnd(7)} drip ${ethers.formatUnits(was, d)} -> ${ethers.formatUnits(now, d)}` +
        `   stock ${ethers.formatUnits(stock, d)}   claims ${claimsBefore} -> ${claimsAfter}`,
    );
    console.log(`          ${asset.note}`);
    tokens.push(asset.address);
    amounts.push(now);
  }

  if (tokens.length === 0) {
    console.log("\n  Nothing to change.\n");
    return;
  }

  if (dryRun) {
    console.log(`\n  DRY RUN: would send one setDrips for ${tokens.length} asset(s).\n`);
    return;
  }

  /* One transaction for all of them, and no retry on timeout. A ConnectTimeout is
     a client-side event: the transaction may well have landed, so a blind resend
     is how you set a drip twice. If this throws, re-read assetInfo before acting. */
  console.log(`\n  sending setDrips for ${tokens.length} asset(s)…`);
  const tx = await faucet.setDrips(tokens, amounts);
  console.log(`  tx ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`  mined in block ${receipt.blockNumber}, gas ${receipt.gasUsed}`);

  const after = await faucet.assetInfo(signer.address);
  console.log("\n  verified on chain:");
  for (let i = 0; i < after.tokens.length; i++) {
    const token = after.tokens[i];
    if (!tokens.some((t) => t.toLowerCase() === token.toLowerCase())) continue;
    const erc20 = new ethers.Contract(token, ERC20, ethers.provider);
    const [symbol, decimals] = await Promise.all([erc20.symbol(), erc20.decimals()]);
    const d = Number(decimals);
    const drip = after.amounts[i];
    const stock = after.balances[i];
    console.log(
      `    ${symbol.padEnd(7)} drip ${ethers.formatUnits(drip, d)}  stock ${ethers.formatUnits(stock, d)}  claims ${drip > 0n ? stock / drip : 0n}`,
    );
  }
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
