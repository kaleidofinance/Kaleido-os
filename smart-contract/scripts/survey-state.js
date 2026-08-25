/**
 * Read-only survey of one testnet's tradable state.
 *
 *   npx hardhat run scripts/survey-state.js --network sepolia
 *
 * Sends nothing. It exists because every seeding decision on these chains
 * depends on a number nobody has measured: which token the deployer can actually
 * fund a pool with, whether a pool already exists at the tier the app offers,
 * and whether the diamond's oracle will price the asset at all. Guessing any of
 * those wastes a deploy and leaves a half-initialised pool behind that the next
 * run has to reason about.
 *
 * Four sections, in the order the answers are needed:
 *
 *  1. BALANCES — native, and every registry token with its real decimals read
 *     off the token rather than assumed. Also whether the deployer owns the
 *     token's mint, because "can I fund this pool" has a different answer for a
 *     mock we deployed than for Circle's USDC or a native precompile.
 *
 *  2. V3 POOLS — factory.getPool for each candidate pair at each tier the /pool
 *     page offers, then slot0 to tell an uninitialised pool from a priced one.
 *     A deployed-but-uninitialised pool is the state that makes a swap revert
 *     with no useful message, so the two are reported separately.
 *
 *  3. ORACLE — getUsdValue for one whole unit of every registered loanable
 *     asset. This is the gate on all of lending: createLendingRequest,
 *     createLoanListing and every health-factor read price through it, and a
 *     stale feed reverts rather than returning a stale number.
 *
 *  4. LENDING BOOK — the request and listing counters, then every listing the
 *     listing counter names. Tells us whether anything is already on the book
 *     before we add to it.
 */

const hre = require("hardhat");
const { ethers } = hre;

const NATIVE_SENTINEL = "0x0000000000000000000000000000000000000001";
const FEE_TIERS = [500, 3000, 10000];

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function owner() view returns (address)",
  "function totalSupply() view returns (uint256)",
];

const FACTORY_ABI = [
  "function getPool(address,address,uint24) view returns (address)",
  "function feeAmountTickSpacing(uint24) view returns (int24)",
];

const POOL_ABI = [
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() view returns (uint128)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)",
];

const PROTOCOL_ABI = [
  "function getUsdValue(address,uint256,uint8) view returns (uint256)",
  "function getRequestId() view returns (uint256)",
  "function getListingId() view returns (uint256)",
  "function getAllCollateralToken() view returns (address[])",
  "function getLoanableAssets() view returns (address[])",
  "function getLoanListing(uint96) view returns (tuple(uint96 listingId, address author, address tokenAddress, uint256 amount, uint256 min_amount, uint256 max_amount, uint256 returnDate, uint16 interest, uint8 listingStatus, bool featured))",
  "function getAccountCollateralValue(address) view returns (uint256)",
  "function getHealthFactor(address) view returns (uint256)",
];

const { registryFor } = require("./libraries/registry.js");

async function main() {
  const [signer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);
  const me = await signer.getAddress();
  const reg = registryFor(chainId);

  console.log(`\n=== ${hre.network.name} (chain ${chainId}) ===`);
  console.log(`deployer ${me}`);
  console.log(
    `native   ${ethers.formatEther(await ethers.provider.getBalance(me))}`,
  );

  /* ---- 1. balances ---- */
  console.log("\n-- tokens --");
  const TOKEN_KEYS = ["wrappedNative", "usdc", "usdt", "usde", "kfUSD", "kafUSD"];
  const tokens = {};
  for (const key of TOKEN_KEYS) {
    const address = reg[key];
    if (!address) {
      console.log(`  ${key.padEnd(14)} (not deployed)`);
      continue;
    }
    const c = new ethers.Contract(address, ERC20_ABI, ethers.provider);
    let symbol = "?";
    let decimals = 18;
    let bal = 0n;
    try {
      symbol = await c.symbol();
      decimals = Number(await c.decimals());
      bal = await c.balanceOf(me);
    } catch (e) {
      console.log(`  ${key.padEnd(14)} ${address} UNREADABLE — ${e.shortMessage ?? e.message}`);
      continue;
    }
    /* `owner()` is the mock's mint gate. A revert here means the token has no
       Ownable surface at all, which for our purposes is the same answer as an
       owner that isn't us: we cannot mint it. */
    let mintable = "no";
    try {
      const owner = await c.owner();
      mintable = owner.toLowerCase() === me.toLowerCase() ? "YES (we own mint)" : `no (owner ${owner})`;
    } catch {
      mintable = "no (not Ownable)";
    }
    tokens[key] = { address, symbol, decimals };
    console.log(
      `  ${key.padEnd(14)} ${symbol.padEnd(6)} d=${String(decimals).padEnd(2)} bal=${ethers.formatUnits(bal, decimals).padEnd(22)} ${address} mint:${mintable}`,
    );
  }

  /* ---- 2. V3 pools ---- */
  console.log("\n-- V3 pools --");
  if (!reg.v3Factory) {
    console.log("  no v3Factory on this chain");
  } else {
    const factory = new ethers.Contract(reg.v3Factory, FACTORY_ABI, ethers.provider);
    const spacing = [];
    for (const fee of FEE_TIERS) {
      const s = await factory.feeAmountTickSpacing(fee);
      spacing.push(`${fee}=>${s}`);
    }
    console.log(`  factory ${reg.v3Factory} tickSpacing ${spacing.join(" ")}`);

    const pairs = [
      ["usdt", "usde"],
      ["usdc", "usdt"],
      ["wrappedNative", "usdt"],
      ["kfUSD", "usdt"],
    ];
    for (const [a, b] of pairs) {
      if (!tokens[a] || !tokens[b]) {
        console.log(`  ${a}/${b}: one side missing`);
        continue;
      }
      for (const fee of FEE_TIERS) {
        const addr = await factory.getPool(tokens[a].address, tokens[b].address, fee);
        if (addr === ethers.ZeroAddress) continue;
        const pool = new ethers.Contract(addr, POOL_ABI, ethers.provider);
        let state = "UNINITIALISED (slot0 reverts)";
        try {
          const s0 = await pool.slot0();
          const liq = await pool.liquidity();
          state =
            s0.sqrtPriceX96 === 0n
              ? "deployed, price unset"
              : `priced tick=${s0.tick} liquidity=${liq}`;
        } catch (e) {
          state = `slot0 threw — ${e.shortMessage ?? e.message}`;
        }
        console.log(`  ${a}/${b} @${fee}: ${addr} ${state}`);
      }
    }
    console.log("  (pairs/tiers not listed above have no pool)");
  }

  /* ---- 3. oracle ---- */
  console.log("\n-- oracle (getUsdValue for 1 whole unit) --");
  if (!reg.diamond) {
    console.log("  no diamond on this chain");
    return;
  }
  const p = new ethers.Contract(reg.diamond, PROTOCOL_ABI, ethers.provider);
  let loanable = [];
  let collateral = [];
  try {
    loanable = await p.getLoanableAssets();
    collateral = await p.getAllCollateralToken();
  } catch (e) {
    console.log(`  registration getters threw — ${e.shortMessage ?? e.message}`);
  }
  const byAddress = new Map(
    Object.values(tokens).map((t) => [t.address.toLowerCase(), t]),
  );
  for (const address of collateral) {
    const known = byAddress.get(address.toLowerCase());
    const decimals = address === NATIVE_SENTINEL ? 18 : (known?.decimals ?? 18);
    const label = address === NATIVE_SENTINEL ? "NATIVE" : (known?.symbol ?? address.slice(0, 10));
    const role = loanable.some((l) => l.toLowerCase() === address.toLowerCase())
      ? "collateral+loanable"
      : "collateral only";
    try {
      const usd = await p.getUsdValue(address, 10n ** BigInt(decimals), decimals);
      console.log(`  ${label.padEnd(7)} ${role.padEnd(20)} $${ethers.formatUnits(usd, 18)}`);
    } catch (e) {
      console.log(`  ${label.padEnd(7)} ${role.padEnd(20)} REVERTED — ${e.shortMessage ?? e.message}`);
    }
  }

  /* ---- 4. the book ---- */
  console.log("\n-- lending book --");
  try {
    console.log(`  requests created: ${await p.getRequestId()}`);
  } catch (e) {
    console.log(`  getRequestId threw — ${e.shortMessage ?? e.message}`);
  }
  let found = 0;
  /* Bounded by the counter rather than by a guessed ceiling with a break on the
     first revert. `getLoanListing` reverts Protocol__IdNotExist for an unwritten
     id, so probing-until-revert reports the right answer only when the ids are
     contiguous — and it reports "no listings" identically whether the book is
     empty or the RPC dropped the very first call. */
  let listingCount = 0;
  try {
    listingCount = Number(await p.getListingId());
    console.log(`  listings created:  ${listingCount}`);
  } catch (e) {
    console.log(`  getListingId threw — ${e.shortMessage ?? e.message}`);
  }
  for (let id = 1; id <= listingCount; id += 1) {
    try {
      const l = await p.getLoanListing(id);
      const known = byAddress.get(l.tokenAddress.toLowerCase());
      const d = known?.decimals ?? 18;
      console.log(
        `  listing ${id}: ${ethers.formatUnits(l.amount, d)} ${known?.symbol ?? l.tokenAddress} ` +
          `@${Number(l.interest) / 100}% status=${l.listingStatus} author=${l.author}`,
      );
      found += 1;
    } catch (e) {
      console.log(`  listing ${id}: unreadable — ${e.shortMessage ?? e.message}`);
    }
  }
  if (listingCount > 0 && found === 0) console.log("  no listings");

  try {
    const cv = await p.getAccountCollateralValue(me);
    console.log(`  deployer collateral value: $${ethers.formatUnits(cv, 18)}`);
  } catch (e) {
    console.log(`  getAccountCollateralValue threw — ${e.shortMessage ?? e.message}`);
  }
}

main().catch((e) => {
  console.error("SURVEY FAILED:", e);
  process.exit(1);
});
