/**
 * Scale an already-deployed faucet up for a larger cohort — in place.
 *
 *   npx hardhat run scripts/topup-faucet.js --network sepolia
 *   npx hardhat run scripts/topup-faucet.js --network baseTestnet
 *
 * Rehearse first — prints every drip change, every top-up and the native budget,
 * and moves nothing:
 *
 *   FAUCET_DRY_RUN=1 npx hardhat run scripts/topup-faucet.js --network sepolia
 *
 * ── Why a separate script from deploy-faucet.js ──────────────────────────────
 *
 * deploy-faucet.js sizes a COLD deploy: a handful of claims' worth, funded by
 * splitting the spendable native balance EVENLY across the assets that draw on it
 * (native + the wrapped native). That even split is order-independent and right
 * when every drawer wants a similar amount, but it cannot express "put 39 ETH into
 * gas and 5 into WETH" — it would hand each ~22 and waste half the budget on WETH
 * the beta does not need. Scaling for ~1000 testers is exactly that asymmetric
 * ask, so this script funds each drawer to its OWN explicit target and only falls
 * back to proportional scaling if the targets together exceed what is spendable.
 *
 * It is a TOP-UP, not a redeploy: the faucet's address, its listed assets and its
 * existing stock are left alone. That is the whole point — a redeploy would change
 * the address (forcing `gen:registry` and a frontend cutover) and strand the stock
 * the current faucet already holds. A faucet's stock is just its balance, so adding
 * to it is a mint / a value send / a wrap-and-transfer, and none of those need the
 * contract to be redeployed. Drip sizes change with setDrips, which is why the
 * targets below can be denominated in CLAIMS: the script sets the new drip, then
 * stocks `drip × claims`.
 *
 * ── The three funding means, unchanged from the deploy script ────────────────
 *
 *   mint    USDT.sol / USDe.sol are onlyOwner and the deployer is the owner, so
 *           these cost only gas — they are the cheap lever and carry the large
 *           per-asset claim counts. Probed with a static call, never assumed: an
 *           asset we cannot mint (Circle's real USDC) falls through to a transfer
 *           of whatever the deployer holds, which for USDC is nothing, so USDC is
 *           simply left out of the plan below rather than listed and funded to 0.
 *   native  A plain value send the faucet's receive() accepts. This is the gas the
 *           whole cohort needs first — a wallet with zero native cannot pay for the
 *           transaction that claims anything else — so it carries the largest
 *           native draw, and the drip is trimmed (0.05→0.02 on Sepolia) so a finite
 *           treasury stretches across the cohort. Testers re-claim hourly.
 *   wrap    WETH9 has no mint and the deployer holds none, so the only WETH is
 *           deposit()ed out of the gas balance. It shares the native reserve with
 *           the gas send for that reason, and its drip is trimmed hardest (1→0.02)
 *           because a whole ether per claim does not scale to a thousand wallets.
 *
 * native + wrap both come out of the ONE native balance, so their combined draw is
 * bounded by `balance − reserve`; if the two targets exceed that, both are scaled
 * down proportionally and the shortfall is reported (send more later, no redeploy).
 * The reserve is the greater of the plan's operational float and this run's own
 * live-priced gas cost, exactly as deploy-faucet.js computes it, so a gas spike
 * cannot push the deployer to empty.
 */

const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");

/**
 * Per-chain beta cohort targets, keyed by the asset `key` in the deployment
 * record. `drip` is human units per claim; `claims` is how many claims' worth to
 * stock, so the target stock is `drip × claims`. Only the assets listed here are
 * touched — USDC is deliberately absent on both chains (Circle's real token, which
 * we cannot mint; testers obtain it by swapping USDT→USDC on the DEX).
 *
 * `nativeReserve` is human native the run will not spend on gas stock or wrapping:
 * an operational float left in the deployer for later top-ups, floored by this
 * run's live gas cost.
 *
 * Sized for a ~1000-wallet private beta with re-claim headroom (cooldown is 1h, so
 * a heavy tester re-claims each asset hourly). Sepolia deployer held ~64 ETH and
 * Base ~79 ETH when this was written; the native + WETH draws below (~44 ETH on
 * Sepolia, ~40 on Base) sit well inside `balance − 8` on each.
 */
const TOPUP_PLANS = {
  11155111: {
    label: "Sepolia",
    nativeReserve: 8,
    assets: {
      NATIVE: { drip: 0.02, claims: 2000 }, // 40 ETH — was 0.05 drip / 1 ETH
      USDT: { drip: 10_000, claims: 3000 }, // 30M — mint, was 1M
      USDe: { drip: 10_000, claims: 3000 }, // 30M — mint, was 1M
      WETH: { drip: 0.02, claims: 750 }, //  15 WETH — was 1 drip / 10 WETH
    },
  },

  84532: {
    label: "Base Sepolia",
    nativeReserve: 8,
    assets: {
      NATIVE: { drip: 0.01, claims: 3000 }, // 30 ETH — was 0.02 drip / 0.4 ETH
      USDT: { drip: 10_000, claims: 3000 }, // 30M — mint, was 1M
      USDe: { drip: 10_000, claims: 3000 }, // 30M — mint, was 1M
      WETH: { drip: 0.02, claims: 1000 }, //  20 WETH — was 1 drip / 10 WETH
    },
  },
};

const NATIVE_SENTINEL = "0x0000000000000000000000000000000000000001";

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
  "function mint(address to, uint256 amount)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function deposit() payable",
];

/* Same live-priced floor deploy-faucet.js uses: 40 transactions at 200k gas each,
 * priced at the fee the node would accept, is ~2.5x this run's real cost and rises
 * with the gas price so the reserve never has to be guessed upward. */
const RESERVE_TX_COUNT = 40n;
const RESERVE_GAS_PER_TX = 200_000n;

function gasFloor(feeData) {
  const price = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;
  return price * RESERVE_GAS_PER_TX * RESERVE_TX_COUNT;
}

function readRecord(name, chainId) {
  if (!fs.existsSync(name)) {
    throw new Error(
      `${name} not found — there is no faucet on this chain to top up. ` +
        "Deploy one with deploy-faucet.js first."
    );
  }
  const record = JSON.parse(fs.readFileSync(name, "utf8"));
  if (Number(record.chainId) !== chainId) {
    throw new Error(
      `${name} records chainId ${record.chainId}, but this run is on ${chainId}. ` +
        "Refusing to top up another chain's faucet."
    );
  }
  return record;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = hre.network.name;
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const dryRun = process.env.FAUCET_DRY_RUN === "1";

  const plan = TOPUP_PLANS[chainId];
  if (!plan) {
    throw new Error(
      `Chain ${chainId} (${net}) has no top-up plan. Only the two chains with a ` +
        "native-gas faucet (Sepolia 11155111, Base Sepolia 84532) are provisioned " +
        "for the beta; the other three need their deployers funded first."
    );
  }

  const outName = `deployment-faucet-${net}.json`;
  const record = readRecord(outName, chainId);
  const faucetAddress = record.contracts?.faucet;
  if (!faucetAddress) {
    throw new Error(`${outName} carries no contracts.faucet address.`);
  }

  console.log(`Topping up the faucet on ${plan.label}`);
  console.log("  network:  ", net, `(chainId ${chainId})`);
  console.log("  deployer: ", deployer.address);
  console.log("  faucet:   ", faucetAddress);
  const nativeBalance = await ethers.provider.getBalance(deployer.address);
  console.log("  balance:  ", ethers.formatEther(nativeBalance), "\n");

  const faucet = await ethers.getContractAt(
    "KaleidoTokenFaucet",
    faucetAddress,
    deployer
  );

  /* Owner-gate the run early: setDrips and the onlyOwner mints both need it, and
   * failing here with a clear message beats a revert three transactions in. */
  const owner = await faucet.owner();
  if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error(
      `The faucet owner is ${owner}, not the deployer ${deployer.address}. ` +
        "setDrips and the onlyOwner mints would revert."
    );
  }

  /* ── 1. Read the live state — drips and stock straight off the chain ─────── */

  /* assetInfo(user) returns (tokens, drips, stock, nextClaimAt) in one call, and
   * reads native stock as the faucet's own balance, so this is authoritative for
   * both the current drip and the current stock of every asset including native.
   * The record is a deploy-time snapshot and is used only to map address→key. */
  const [tokens, drips, stocks] = await faucet.assetInfo(deployer.address);
  const live = new Map();
  for (let i = 0; i < tokens.length; i++) {
    live.set(tokens[i].toLowerCase(), { drip: drips[i], stock: stocks[i] });
  }

  const byKey = new Map(
    (record.config?.assets ?? []).map((a) => [a.key, a])
  );

  /* ── 2. Build the per-asset decisions (moves nothing) ────────────────────── */

  const feeData = await ethers.provider.getFeeData();
  const floor = gasFloor(feeData);
  const stated = ethers.parseEther(String(plan.nativeReserve ?? 0));
  const reserve = stated > floor ? stated : floor;
  const spendable = nativeBalance > reserve ? nativeBalance - reserve : 0n;

  const decisions = [];
  for (const [key, want] of Object.entries(plan.assets)) {
    const rec = byKey.get(key);
    if (!rec) {
      throw new Error(
        `${key} is in the top-up plan but not listed on the faucet ` +
          `(${outName}). Add it with deploy-faucet.js FAUCET_EXTEND first.`
      );
    }
    const address = rec.address;
    const decimals = Number(rec.decimals);
    const source = rec.source;
    const l = live.get(address.toLowerCase()) ?? { drip: 0n, stock: 0n };

    const newDrip = ethers.parseUnits(String(want.drip), decimals);
    const target = newDrip * BigInt(want.claims);
    const topup = target > l.stock ? target - l.stock : 0n;

    /* How this asset is funded, derived from its source rather than hardcoded.
     * native → a value send; the wrapped native (source "dex") → deposit()+transfer;
     * everything else → mint if we can (probed), else it is a transfer we cannot
     * cover and is reported as such. */
    let fund;
    if (address.toLowerCase() === NATIVE_SENTINEL) {
      fund = "native";
    } else if (source === "dex") {
      if (decimals !== 18) {
        /* The wrap budget is native wei (18dp); a 6-decimal wrapper would be off
         * by 1e12. Every wrapped native in the wave is 18dp, but assert it. */
        throw new Error(
          `${key} is a wrapped native with ${decimals} decimals — the wrap ` +
            "budget is in native wei and needs an explicit conversion first."
        );
      }
      fund = "wrap";
    } else {
      const token = new ethers.Contract(address, ERC20_ABI, deployer);
      const mintable =
        topup === 0n
          ? true // nothing to fund; treat as the cheap path, it will no-op below
          : await token.mint
              .staticCall(faucetAddress, topup)
              .then(() => true)
              .catch(() => false);
      fund = mintable ? "mint" : "transfer";
    }

    decisions.push({
      key,
      address,
      symbol: rec.symbol,
      decimals,
      fund,
      currentDrip: l.drip,
      newDrip,
      currentStock: l.stock,
      target,
      topup, // desired; native/wrap draws may be scaled below
    });
  }

  /* Bound the native draw. native + wrap both spend the one balance, so their
   * combined desired top-up cannot exceed `spendable`; if it does, scale both down
   * proportionally (integer math) so the run never dips into the reserve. Mints are
   * free and never scaled. */
  const drawers = decisions.filter(
    (d) => d.fund === "native" || d.fund === "wrap"
  );
  let sumDraw = 0n;
  for (const d of drawers) sumDraw += d.topup;
  const scaled = sumDraw > spendable && sumDraw > 0n;
  for (const d of decisions) {
    if (d.fund === "native" || d.fund === "wrap") {
      d.funded = scaled ? (d.topup * spendable) / sumDraw : d.topup;
    } else if (d.fund === "mint") {
      d.funded = d.topup;
    } else {
      d.funded = 0n; // transfer we cannot cover
    }
    d.short = d.target > d.currentStock + d.funded
      ? d.target - d.currentStock - d.funded
      : 0n;
  }

  /* ── 3. Report ───────────────────────────────────────────────────────────── */

  const human = (v, dp) => ethers.formatUnits(v, dp);
  console.log(
    `Reserve ${ethers.formatEther(reserve)} native ` +
      `(${stated >= floor ? "plan float" : "live gas floor"}: float ` +
      `${plan.nativeReserve}, floor ${ethers.formatEther(floor)}); ` +
      `${ethers.formatEther(spendable)} spendable.`
  );
  if (scaled) {
    console.log(
      `  native + WETH want ${ethers.formatEther(sumDraw)} together but only ` +
        `${ethers.formatEther(spendable)} is spendable — both scaled down.`
    );
  }
  console.log("");
  console.log(
    "  asset    drip (now → new)         + top up            → stock (claims)"
  );
  for (const d of decisions) {
    const dripChange =
      d.currentDrip === d.newDrip
        ? `${human(d.newDrip, d.decimals)} (unchanged)`
        : `${human(d.currentDrip, d.decimals)} → ${human(d.newDrip, d.decimals)}`;
    const endStock = d.currentStock + d.funded;
    const claimsLeft = d.newDrip > 0n ? endStock / d.newDrip : 0n;
    console.log(
      `  ${d.symbol.padEnd(7)} ${dripChange.padEnd(24)} ` +
        `+${human(d.funded, d.decimals).padEnd(18)} ` +
        `${human(endStock, d.decimals)} (${claimsLeft} claims) [${d.fund}]` +
        (d.short > 0n ? `  — ${human(d.short, d.decimals)} short` : "")
    );
  }

  if (dryRun) {
    console.log(
      "\nDRY RUN — nothing moved. Re-run without FAUCET_DRY_RUN to apply."
    );
    return;
  }

  /* ── 4. Apply: drips first, then stock ───────────────────────────────────── */

  const dripChanges = decisions.filter((d) => d.currentDrip !== d.newDrip);
  if (dripChanges.length > 0) {
    console.log(
      `\nResizing ${dripChanges.length} drip(s): ` +
        dripChanges.map((d) => d.symbol).join(", ")
    );
    await (
      await faucet.setDrips(
        dripChanges.map((d) => d.address),
        dripChanges.map((d) => d.newDrip)
      )
    ).wait();
  }

  console.log("\nStocking:");
  for (const d of decisions) {
    if (d.funded === 0n) {
      console.log(`  ${d.symbol.padEnd(7)} nothing to add`);
      continue;
    }
    if (d.fund === "native") {
      await (
        await deployer.sendTransaction({ to: faucetAddress, value: d.funded })
      ).wait();
    } else if (d.fund === "wrap") {
      const token = new ethers.Contract(d.address, ERC20_ABI, deployer);
      await (await token.deposit({ value: d.funded })).wait();
      await (await token.transfer(faucetAddress, d.funded)).wait();
    } else if (d.fund === "mint") {
      const token = new ethers.Contract(d.address, ERC20_ABI, deployer);
      await (await token.mint(faucetAddress, d.funded)).wait();
    }
    console.log(
      `  ${d.symbol.padEnd(7)} ${d.fund} +${human(d.funded, d.decimals)}`
    );
  }

  /* ── 5. Read back and record ─────────────────────────────────────────────── */

  const [t2, d2, s2] = await faucet.assetInfo(deployer.address);
  const liveAfter = new Map();
  for (let i = 0; i < t2.length; i++) {
    liveAfter.set(t2[i].toLowerCase(), { drip: d2[i], stock: s2[i] });
  }

  console.log(
    "\n============================================================"
  );
  console.log(`FAUCET TOP-UP SUMMARY — ${plan.label}`);
  console.log("============================================================");
  console.log(`  address  ${faucetAddress}`);
  for (const rec of record.config?.assets ?? []) {
    const l = liveAfter.get(rec.address.toLowerCase());
    if (!l) continue;
    const dec = Number(rec.decimals);
    const claims = l.drip > 0n ? l.stock / l.drip : 0n;
    console.log(
      `  ${rec.symbol.padEnd(7)} drip ${human(l.drip, dec)}  ` +
        `stock ${human(l.stock, dec)}  (${claims} claims left)`
    );
    /* Keep the record a true description of the live faucet: the frontend reads
     * drips/stock live, but the record is what the next extend/redeploy carries
     * forward and what a human reads to see what the faucet holds. */
    rec.drip = l.drip.toString();
    rec.dripHuman = human(l.drip, dec);
    rec.funding = {
      method: "topup",
      stocked: human(l.stock, dec),
      claimsLeft: Number(claims),
    };
  }
  record.lastTopup = new Date().toISOString();
  fs.writeFileSync(outName, JSON.stringify(record, null, 2));
  console.log(`\nSaved ${outName}. The faucet address is unchanged, so no`);
  console.log("gen:registry and no frontend change are needed.");
  console.log("============================================================");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
