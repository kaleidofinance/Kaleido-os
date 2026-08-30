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
 * Two intents, and an asset declares exactly one:
 *
 *   claims: N   size the drip so the live stock covers N claims.
 *   pause: true set the drip to 0. That is the contract's own retirement state —
 *               `_eligibility` returns _NOT_LISTED so `claim` reverts, `useFaucet`
 *               flags the row `paused`, and /faucet draws it as "Paused" with the
 *               Claim button replaced by a link to whoever does issue the token.
 *               Nothing ever delists (Faucet.sol:96), so 0 is how an asset leaves.
 *
 * **A faucet is for the assets we issue.** Anything we did not deploy, we cannot
 * mint, so a drip against it is a countdown to an empty row — and worse, it implies
 * we are the place to get it when the issuer hands out more, faster, for free. Arc's
 * EURC and cirBTC are Circle's (`source: "literal"` in the record — hardcoded
 * addresses, never deployed by us), and `faucet.circle.com` gives all three of its
 * assets with Arc as the default network, one claim per asset every 2 hours. BSC's
 * WBNB is the canonical BSC testnet wrapper, obtained by wrapping tBNB that BNB
 * Chain's own faucet hands out. So all three are paused rather than stocked.
 *
 * The counts that remain differ by what the asset is FOR. Arc's USDC is gas: a claim
 * only has to cover fees, and at 21 gwei a ~100k-gas transaction costs 0.0021 USDC,
 * so a drip a fraction of a dollar is already ~100 transactions of runway. Depth
 * beats size there. Arc's WUSDC stays too, and is NOT in the paragraph above: we
 * deployed it ourselves (`deployment-dex-arcTestnet.json` records it as
 * `wrappedNative`, because Arc ships no canonical wrapped-native), which is exactly
 * what separates it from BSC's WBNB.
 */
const PLANS = {
  5042002: {
    label: "Arc Testnet",
    record: "deployment-faucet-arcTestnet.json",
    assets: [
      { symbol: "USDC", address: "0x3600000000000000000000000000000000000000", claims: 34, note: "the chain's gas, via its 6dp ERC20 alias" },
      { symbol: "WUSDC", address: "0x911b4000D3422F482F4062a913885f7b035382Df", claims: 34, note: "our own wrapper, wrapped out of the same native balance" },
      { symbol: "cirBTC", address: "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF", pause: true, note: "Circle's, not ours — faucet.circle.com issues it" },
      { symbol: "EURC", address: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a", pause: true, note: "Circle's, not ours — faucet.circle.com issues it" },
    ],
  },
  97: {
    label: "BSC Testnet",
    record: "deployment-faucet-bscTestnet.json",
    assets: [
      { symbol: "WBNB", address: "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd", pause: true, note: "the canonical BSC wrapper, not ours — wrap tBNB from bnbchain.org's faucet" },
    ],
  },
};

const ERC20 = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
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
    if (Boolean(asset.pause) === (asset.claims !== undefined)) {
      throw new Error(
        `${asset.symbol} must declare exactly one of claims / pause, not both or neither.`,
      );
    }

    /* A pause takes the short path and skips the stock guards below. Those exist to
       stop a *payable* drip being set against nothing; 0 is meant to pay nothing, so
       an empty or unsplittable stock is not a reason to leave it advertised. It also
       needs no decimals(), which is one fewer read on a throttled chain. */
    if (asset.pause) {
      if (dripOf.get(key) === 0n) {
        console.log(`  OK    ${asset.symbol} already paused`);
        continue;
      }
      console.log(`  PAUSE ${asset.symbol.padEnd(7)} drip -> 0`);
      console.log(`          ${asset.note}`);
      tokens.push(asset.address);
      amounts.push(0n);
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

  if (dryRun) {
    console.log(
      tokens.length === 0
        ? `\n  DRY RUN: no drip change needed. A real run would still re-read` +
            ` assetInfo and sync ${plan.record}.\n`
        : `\n  DRY RUN: would send one setDrips for ${tokens.length} asset(s),` +
            ` then sync ${plan.record}.\n`,
    );
    return;
  }

  if (tokens.length > 0) {
    /* One transaction for all of them, and no retry on timeout. A ConnectTimeout is
       a client-side event: the transaction may well have landed, so a blind resend
       is how you set a drip twice. If this throws, re-read assetInfo before acting. */
    console.log(`\n  sending setDrips for ${tokens.length} asset(s)…`);
    const tx = await faucet.setDrips(tokens, amounts);
    console.log(`  tx ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`  mined in block ${receipt.blockNumber}, gas ${receipt.gasUsed}`);
  } else {
    console.log("\n  No drip change needed — syncing the record to the chain anyway.");
  }

  /* ── Sync the deployment record to what the chain now says ─────────────────
   *
   * Unconditional, not just after a transaction. The record is supposed to describe
   * the live faucet — it is what the next extend or redeploy carries forward and
   * what a human reads to see what the faucet hands out — and this script used to
   * change drips without touching it, which left Arc's record advertising the
   * deploy-time 100.0 USDC drip long after the chain had moved to 0.25. A stale
   * record is worse than an absent one: it reads as a measurement.
   *
   * Narrowly scoped on purpose. This script sets drips; it never moves a token. So
   * it rewrites `drip`/`dripHuman`, and inside `funding` only `claimsLeft` — which
   * is stock÷drip and therefore the one funding field a drip change invalidates.
   * `method`, `amount`, `target` and `short` are left exactly as they were: they
   * record how the stock got there ("alias", "wrap", "transfer", "topup") and by how
   * much that came up short, and all of that is still true after a resize. Writing
   * `method: "drip-resize"` would be this script claiming credit for funding an
   * asset it did not fund, and would erase the only note of how Arc's USDC and
   * WUSDC balances were actually obtained.
   *
   * Only entries the record already carries are updated. An asset listed on chain
   * but missing from the record (Arc's KLD, added by FAUCET_EXTEND without a
   * refresh) is reported rather than invented, because a record entry carries `key`,
   * `source` and `decimals` that `assetInfo` cannot supply.
   */
  const after = await faucet.assetInfo(signer.address);
  const liveByAddr = new Map();
  for (let i = 0; i < after.tokens.length; i++) {
    liveByAddr.set(after.tokens[i].toLowerCase(), {
      drip: after.amounts[i],
      stock: after.balances[i],
    });
  }

  console.log("\n  verified on chain:");
  const recorded = new Set();
  for (const rec of record.config?.assets ?? []) {
    const l = liveByAddr.get(rec.address.toLowerCase());
    if (!l) continue;
    recorded.add(rec.address.toLowerCase());
    const d = Number(rec.decimals);
    const claims = l.drip > 0n ? l.stock / l.drip : 0n;
    console.log(
      `    ${rec.symbol.padEnd(7)} drip ${ethers.formatUnits(l.drip, d)}  ` +
        `stock ${ethers.formatUnits(l.stock, d)}  claims ${claims}` +
        (l.drip === 0n ? "  [PAUSED]" : ""),
    );
    rec.drip = l.drip.toString();
    rec.dripHuman = ethers.formatUnits(l.drip, d);
    if (rec.funding) rec.funding.claimsLeft = Number(claims);
  }

  const unrecorded = [...liveByAddr.keys()].filter((a) => !recorded.has(a));
  if (unrecorded.length > 0) {
    console.log(
      `\n  NOTE  ${unrecorded.length} asset(s) are listed on chain but absent from ` +
        `${plan.record}, so they were left out of the sync:`,
    );
    for (const a of unrecorded) {
      const l = liveByAddr.get(a);
      console.log(`    ${a}  drip(raw) ${l.drip}  stock(raw) ${l.stock}`);
    }
    console.log(
      "  Add them with deploy-faucet.js FAUCET_EXTEND, which writes the record.",
    );
  }

  record.lastDripFix = new Date().toISOString();
  /* No trailing newline: deploy-faucet.js, topup-faucet.js and switch-usdc-to-mock.js
     all write these records without one, and this script alternates with them on the
     same file. Adding one here would show up as a diff every other run. */
  require("fs").writeFileSync(plan.record, JSON.stringify(record, null, 2));
  console.log(
    `\n  Saved ${plan.record}. The faucet address is unchanged, so no gen:registry.\n`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
