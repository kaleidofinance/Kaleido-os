/**
 * Scale an already-deployed faucet up for a larger cohort — in place.
 *
 *   npx hardhat run scripts/topup-faucet.js --network sepolia
 *   npx hardhat run scripts/topup-faucet.js --network baseTestnet
 *   npx hardhat run scripts/topup-faucet.js --network robinhoodTestnet
 *   npx hardhat run scripts/topup-faucet.js --network bscTestnet
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
 * touched — USDC is deliberately absent on Sepolia and Base, where it is Circle's
 * real token and unmintable (testers obtain it by swapping USDT→USDC on the DEX),
 * but present on Robinhood and BSC, where it is our own mock.
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

  /*
   * Robinhood joined the native-gas chains on 2026-08-29. Its original faucet
   * (deployed 2026-08-24) predates receive() — a 1 wei value send to it reverts,
   * while the same probe against Sepolia's faucet succeeds — so it could never
   * hold gas and had to be replaced rather than extended. The deployer was funded
   * by an Orbit deposit from Sepolia, see the bridge notes.
   *
   * Two things differ from the chains above, both for reasons specific to this
   * chain rather than by preference:
   *
   *   nativeReserve is 1, not 8. Orbit gas here is so cheap that
   *   deploy-faucet.js floats on 0.002 — 25x its measured 0.00008 full-run floor
   *   — so 1 native is already ~12,500x a run's cost. Holding back 8 would be
   *   cargo-culting Sepolia's number onto a chain where it means nothing.
   *
   *   USDC IS listed. It is absent above because there it is Circle's real token
   *   and unmintable; on Robinhood it is our own mock and mint() staticcalls
   *   clean, so leaving it out would strand a third of the stable surface at its
   *   20-claim deploy stock for no reason.
   */
  46630: {
    label: "Robinhood Chain Testnet",
    nativeReserve: 1,
    assets: {
      NATIVE: { drip: 0.005, claims: 2000 }, // 10 ETH — was 0.01 drip / 0.2 ETH
      USDC: { drip: 10_000, claims: 3000 }, // 30M — mint (our mock, not Circle's)
      USDT: { drip: 10_000, claims: 3000 }, // 30M — mint, was 1M
      USDe: { drip: 10_000, claims: 3000 }, // 30M — mint, was 1M
      WETH: { drip: 0.02, claims: 750 }, //  15 WETH — was 1 drip / 0.5 WETH
    },
  },

  /*
   * BSC testnet is the one chain whose gas we do NOT try to provision, and the
   * only plan here with no NATIVE line. That is deliberate on both counts.
   *
   * Its faucet runs the 4560-byte pre-native bytecode (the native-capable build is
   * 5343 and is the only one carrying `KaleidoTokenFaucet_NativeTransferFailed`),
   * so `claim(address(1))` reverts `AssetNotListed` — 0x3ea1becf, measured. Adding
   * the row with `setDrip` is not a shortcut: `_pay` has no native branch there and
   * would call `IERC20(address(1)).safeTransfer`, i.e. the ecrecover precompile.
   * Only a redeploy could list it, and the deployer holds 0.00144843797 tBNB
   * against a 0.4 BNB stock target, so a fresh faucet would list gas and stock
   * zero. **tBNB comes from BNB Chain's own faucet instead** — /faucet promotes
   * `https://www.bnbchain.org/en/testnet-faucet` onto the gas row's Claim button,
   * which is the answer for this chain rather than a stopgap.
   *
   * So what is left is exactly the assets we deployed ourselves, stocked for the
   * people who already have gas. Three of the five can be raised, and the other
   * two are settled rather than pending:
   *
   *   USDC/USDT/USDe  mint() staticcalls clean, and mints are never scaled by the
   *                   native reserve, so the tBNB shortage does not touch them.
   *                   USDC is listed for the same reason it is on Robinhood and
   *                   not on Sepolia/Base: here it is our own mock, not Circle's.
   *   WBNB            PAUSED at drip 0, deliberately — not merely unfunded. A
   *                   faucet is worth running for something a visitor cannot get
   *                   any other way, and WBNB is not that: anyone holding tBNB
   *                   wraps it in one call, and the tBNB itself comes from BNB
   *                   Chain's faucet. Stocking it would spend the scarcest thing
   *                   we have on this chain (0.00144843797 tBNB) to save a step
   *                   nobody is stuck on. Drip 0 is the contract's own retirement
   *                   state — `_eligibility` returns _NOT_LISTED, so `claim`
   *                   reverts and `useFaucet` flags the row `paused`, which the
   *                   page draws as "Paused" with the Claim button off. The
   *                   0.281513390235128218 already in the faucet stays there,
   *                   withdrawable by the owner if that gas is ever wanted back.
   *   KLD             omitted. mint() reverts 0xf480e285 and it already holds 5M,
   *                   which is 5000 claims at the current drip.
   *
   * nativeReserve is the live gas floor rather than deploy-faucet.js's 0.005 float,
   * because nothing in this plan spends native and 0.005 already exceeds the whole
   * balance — `max(stated, gasFloor)` makes it self-correcting either way.
   */
  97: {
    label: "BSC Testnet",
    nativeReserve: 0.0008,
    assets: {
      USDC: { drip: 10_000, claims: 3000 }, // 30M — mint (our mock, not Circle's)
      USDT: { drip: 10_000, claims: 3000 }, // 30M — mint, was 1M
      USDe: { drip: 10_000, claims: 3000 }, // 30M — mint, was 1M
      WBNB: { drip: 0, claims: 0 }, // paused — wrap your own tBNB, see above
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
      `Chain ${chainId} (${net}) has no top-up plan. Sepolia (11155111), Base ` +
        "Sepolia (84532), Robinhood (46630) and BSC (97) are provisioned here. " +
        "Arc (5042002) deliberately is not: every asset it lists draws on the " +
        "one native USDC balance and none of them can be minted, so the fix " +
        "there is always a drip resize — use scripts/fix-faucet-drips.js."
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
