/**
 * Read-only: which assets each deployed product actually accepts, per chain.
 *
 *   npx hardhat run scripts/survey-assets.js --network sepolia
 *
 * Sends nothing, signs nothing. `survey-state.js` answers "can we open a pool
 * here" for one pair; this answers the wider question the exercise plan turns on:
 * for every asset on this chain, which of the seven products will take it.
 *
 * That matrix cannot be read off the deployment records. A record says a token
 * was deployed and a script intended to register it; the registration itself
 * lives in six unrelated places, each with its own gate:
 *
 *   - lending collateral and loanable assets are two separate diamond arrays,
 *     and an asset can be in one without the other;
 *   - the oracle is a third gate on top of those two — a registered asset whose
 *     feed reverts is registered and unusable, which reads identically to
 *     unregistered from the UI;
 *   - kfUSD keeps its own `supportedCollaterals` mapping, set post-deploy;
 *   - kafUSD keeps a separate `supportedAssets` mapping, likewise;
 *   - the staking vault keeps `supportedTokens`, whose setter refuses anything
 *     but stKLD's own KLD — so it is single-asset by construction, and this
 *     proves that on-chain rather than from reading the setter;
 *   - the faucet's asset list is its own array, with a per-asset drip that can
 *     be zero while the asset is still listed.
 *
 * So each product is asked directly, and every answer is a measurement.
 *
 * Six sections:
 *
 *   1. TOKENS      — address, decimals, deployer balance, mint ownership.
 *   2. MATRIX      — one row per asset, one column per product. The output this
 *                    script exists for.
 *   3. V3 POOLS    — every pair at every tier the app trades, with liquidity.
 *                    A pair with no pool has no swap route, whatever else is
 *                    true of its two assets.
 *   4. V2 PAIRS    — the v2 factory is deployed on all five chains and no app
 *                    surface references it. Measured so "unused" is a fact.
 *   5. FAUCET      — the drip per asset, and which are listed but paused.
 *   6. BOOK        — request and listing counters, so "nothing traded yet" is
 *                    checked rather than assumed.
 *
 * Failures are per-cell. A reverting oracle, a missing contract or an asset that
 * is not an ERC20 prints in place and the survey continues, because the point is
 * the shape of the whole matrix and a run that aborts on the first revert never
 * reaches it.
 */

const hre = require("hardhat");
const { ethers } = hre;
const { registryFor } = require("./libraries/registry.js");

const NATIVE_SENTINEL = "0x0000000000000000000000000000000000000001";
const FEE_TIERS = [500, 3000, 10000];

/* The registry keys that name an asset, in the order the matrix reads best:
 * money first, then the protocol's own receipts. */
const ASSET_KEYS = [
  "wrappedNative",
  "usdc",
  "usdt",
  "usde",
  "kld",
  "stKLD",
  "kfUSD",
  "kafUSD",
];

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function owner() view returns (address)",
];

const PROTOCOL_ABI = [
  "function getUsdValue(address,uint256,uint8) view returns (uint256)",
  "function getAllCollateralToken() view returns (address[])",
  "function getLoanableAssets() view returns (address[])",
  "function getRequestId() view returns (uint256)",
  "function getListingId() view returns (uint256)",
];

const KFUSD_ABI = [
  "function getSupportedCollaterals() view returns (address[])",
  "function supportedCollaterals(address) view returns (bool)",
  "function totalSupply() view returns (uint256)",
];

const KAFUSD_ABI = [
  "function getSupportedAssets() view returns (address[])",
  "function supportedAssets(address) view returns (bool)",
  "function totalSupply() view returns (uint256)",
];

const VAULT_ABI = [
  "function supportedTokens(address) view returns (bool)",
  "function stKLD() view returns (address)",
  "function getTotalStakers() view returns (uint256)",
];

const FAUCET_ABI = [
  "function assetInfo(address) view returns (address[] tokens, uint256[] amounts, uint256[] balances, uint256[] nextClaimAt)",
  "function getTotalUsers() view returns (uint256)",
];

const V3_FACTORY_ABI = ["function getPool(address,address,uint24) view returns (address)"];
const V2_FACTORY_ABI = ["function getPair(address,address) view returns (address)"];
const POOL_ABI = [
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() view returns (uint128)",
];
const PAIR_ABI = [
  "function getReserves() view returns (uint112,uint112,uint32)",
];

/** A read whose failure is data, not an abort. */
async function tryRead(fn, onFail = "ERR") {
  try {
    return await fn();
  } catch (e) {
    const m = String(e.shortMessage || e.message || e);
    return typeof onFail === "function" ? onFail(m) : onFail;
  }
}

const lower = (a) => (a || "").toLowerCase();
const pad = (s, n) => String(s).padEnd(n);

async function main() {
  const [signer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);
  const me = await signer.getAddress();
  const reg = registryFor(chainId);

  console.log(`\n=== ${hre.network.name} (chain ${chainId}) ===`);
  console.log(`deployer ${me}`);

  /* ------------------------------------------------------ 1. the asset set -- */
  /* Registry keys first, then anything the diamond has registered that the
   * registry does not name — that is how the retired Circle USDC surfaces, and
   * an asset the protocol knows about but the app cannot name is exactly the
   * kind of thing this survey is for. */
  const assets = [];
  const seen = new Set();
  const push = (key, address) => {
    if (!address || seen.has(lower(address))) return;
    seen.add(lower(address));
    assets.push({ key, address });
  };
  push("NATIVE", NATIVE_SENTINEL);
  for (const k of ASSET_KEYS) push(k, reg[k]);

  const diamond = reg.diamond
    ? new ethers.Contract(reg.diamond, PROTOCOL_ABI, ethers.provider)
    : null;

  const collateralList = diamond
    ? await tryRead(() => diamond.getAllCollateralToken(), () => [])
    : [];
  const loanableList = diamond
    ? await tryRead(() => diamond.getLoanableAssets(), () => [])
    : [];
  for (const a of [...collateralList, ...loanableList]) push("unnamed", a);

  const kfusd = reg.kfUSD
    ? new ethers.Contract(reg.kfUSD, KFUSD_ABI, ethers.provider)
    : null;
  const kafusd = reg.kafUSD
    ? new ethers.Contract(reg.kafUSD, KAFUSD_ABI, ethers.provider)
    : null;
  const vault = reg.kldVault
    ? new ethers.Contract(reg.kldVault, VAULT_ABI, ethers.provider)
    : null;
  const faucet = reg.faucet
    ? new ethers.Contract(reg.faucet, FAUCET_ABI, ethers.provider)
    : null;

  const kfCollat = kfusd
    ? await tryRead(() => kfusd.getSupportedCollaterals(), () => [])
    : [];
  const kafAssets = kafusd
    ? await tryRead(() => kafusd.getSupportedAssets(), () => [])
    : [];
  for (const a of [...kfCollat, ...kafAssets]) push("unnamed", a);

  const faucetInfo = faucet
    ? await tryRead(() => faucet.assetInfo(me), () => null)
    : null;
  if (faucetInfo) for (const a of faucetInfo[0]) push("unnamed", a);

  /* -------------------------------------------------------- 2. token facts -- */
  console.log("\n-- tokens --");
  for (const a of assets) {
    if (a.address === NATIVE_SENTINEL) {
      a.symbol = "NATIVE";
      a.decimals = 18;
      a.bal = await tryRead(
        async () => ethers.formatEther(await ethers.provider.getBalance(me)),
        "?",
      );
      a.owner = "-";
      console.log(`  ${pad(a.symbol, 8)} ${a.address}  18dp  bal ${a.bal}  (sentinel)`);
      continue;
    }
    const t = new ethers.Contract(a.address, ERC20_ABI, ethers.provider);
    a.symbol = await tryRead(() => t.symbol(), "?");
    a.decimals = Number(await tryRead(async () => Number(await t.decimals()), 18));
    a.bal = await tryRead(
      async () => ethers.formatUnits(await t.balanceOf(me), a.decimals),
      "?",
    );
    a.supply = await tryRead(
      async () => ethers.formatUnits(await t.totalSupply(), a.decimals),
      "?",
    );
    a.owner = await tryRead(() => t.owner(), "none");
    const mine = lower(a.owner) === lower(me) ? "OURS" : a.owner === "none" ? "no-owner" : "foreign";
    console.log(
      `  ${pad(a.symbol, 8)} ${a.address}  ${pad(a.decimals + "dp", 5)} bal ${pad(a.bal, 16)} supply ${pad(a.supply, 16)} mint ${mine}  [${a.key}]`,
    );
  }

  /* ------------------------------------------------- 3. the product matrix -- */
  const inList = (list, addr) => list.some((x) => lower(x) === lower(addr));

  console.log("\n-- matrix: asset x product --");
  console.log(
    "  asset    lend-collat lend-loanable oracle          kfUSD-collat kafUSD-lock vault-stake faucet-drip",
  );
  for (const a of assets) {
    const price = diamond
      ? await tryRead(
          async () => {
            const v = await diamond.getUsdValue(
              a.address,
              ethers.parseUnits("1", a.decimals),
              a.decimals,
            );
            return "$" + Number(ethers.formatUnits(v, 18)).toFixed(6);
          },
          (m) => (m.includes("revert") ? "REVERTS" : "ERR"),
        )
      : "no-diamond";

    const vaultOk = vault
      ? await tryRead(async () => ((await vault.supportedTokens(a.address)) ? "YES" : "no"), "ERR")
      : "no-vault";

    let drip = "not-listed";
    if (faucetInfo) {
      const i = faucetInfo[0].findIndex((x) => lower(x) === lower(a.address));
      if (i >= 0) {
        const amt = faucetInfo[1][i];
        drip =
          amt === 0n
            ? "LISTED-0"
            : ethers.formatUnits(amt, a.decimals) +
              " (stock " +
              Number(ethers.formatUnits(faucetInfo[2][i], a.decimals)).toFixed(2) +
              ")";
      }
    }

    console.log(
      `  ${pad(a.symbol, 8)} ${pad(inList(collateralList, a.address) ? "YES" : "no", 11)} ${pad(
        inList(loanableList, a.address) ? "YES" : "no",
        13,
      )} ${pad(price, 15)} ${pad(inList(kfCollat, a.address) ? "YES" : "no", 12)} ${pad(
        inList(kafAssets, a.address) ? "YES" : "no",
        11,
      )} ${pad(vaultOk, 11)} ${drip}`,
    );
  }

  if (vault) {
    const st = await tryRead(() => vault.stKLD(), "ERR");
    const stakers = await tryRead(async () => String(await vault.getTotalStakers()), "ERR");
    console.log(`  vault stKLD=${st} stakers=${stakers}`);
  }
  if (kfusd)
    console.log(
      `  kfUSD supply=${await tryRead(async () => ethers.formatUnits(await kfusd.totalSupply(), 18), "ERR")}`,
    );
  if (kafusd)
    console.log(
      `  kafUSD supply=${await tryRead(async () => ethers.formatUnits(await kafusd.totalSupply(), 18), "ERR")}`,
    );

  /* -------------------------------------------------------- 4. v3 pools ---- */
  /* Only ERC20s: the sentinel is not a pool token, and a pool against it cannot
   * exist however the pair is written. */
  const tradable = assets.filter((a) => a.address !== NATIVE_SENTINEL);
  console.log("\n-- v3 pools (every pair, every traded tier) --");
  if (!reg.v3Factory) {
    console.log("  no v3Factory in registry");
  } else {
    const f = new ethers.Contract(reg.v3Factory, V3_FACTORY_ABI, ethers.provider);
    let found = 0;
    for (let i = 0; i < tradable.length; i++) {
      for (let j = i + 1; j < tradable.length; j++) {
        for (const fee of FEE_TIERS) {
          const addr = await tryRead(
            () => f.getPool(tradable[i].address, tradable[j].address, fee),
            ethers.ZeroAddress,
          );
          if (!addr || addr === ethers.ZeroAddress) continue;
          found++;
          const p = new ethers.Contract(addr, POOL_ABI, ethers.provider);
          const s0 = await tryRead(async () => (await p.slot0()).sqrtPriceX96, 0n);
          const liq = await tryRead(async () => await p.liquidity(), 0n);
          console.log(
            `  ${pad(tradable[i].symbol + "/" + tradable[j].symbol, 16)} fee ${pad(fee, 6)} ${addr}  ${
              s0 === 0n ? "UNINITIALISED" : "priced"
            }  liq ${liq}`,
          );
        }
      }
    }
    console.log(`  pools found: ${found} of ${(tradable.length * (tradable.length - 1)) / 2} pairs x ${FEE_TIERS.length} tiers`);
  }

  /* -------------------------------------------------------- 5. v2 pairs ---- */
  console.log("\n-- v2 pairs --");
  if (!reg.v2Factory) {
    console.log("  no v2Factory in registry");
  } else {
    const f2 = new ethers.Contract(reg.v2Factory, V2_FACTORY_ABI, ethers.provider);
    let found = 0;
    for (let i = 0; i < tradable.length; i++) {
      for (let j = i + 1; j < tradable.length; j++) {
        const addr = await tryRead(
          () => f2.getPair(tradable[i].address, tradable[j].address),
          ethers.ZeroAddress,
        );
        if (!addr || addr === ethers.ZeroAddress) continue;
        found++;
        const r = await tryRead(
          async () => {
            const [r0, r1] = await new ethers.Contract(addr, PAIR_ABI, ethers.provider).getReserves();
            return `${r0}/${r1}`;
          },
          "ERR",
        );
        console.log(`  ${pad(tradable[i].symbol + "/" + tradable[j].symbol, 16)} ${addr} reserves ${r}`);
      }
    }
    console.log(`  v2 pairs found: ${found}`);
  }

  /* ------------------------------------------------------------- 6. book --- */
  console.log("\n-- book --");
  if (diamond) {
    console.log(
      `  requests=${await tryRead(async () => String(await diamond.getRequestId()), "ERR")} listings=${await tryRead(
        async () => String(await diamond.getListingId()),
        "ERR",
      )}`,
    );
  }
  if (faucet)
    console.log(`  faucet users=${await tryRead(async () => String(await faucet.getTotalUsers()), "ERR")}`);
}

main().catch((e) => {
  console.error("SURVEY FAILED:", e.shortMessage || e.message || e);
  process.exit(1);
});
