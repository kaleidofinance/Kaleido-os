/**
 * Turn the KaleidoSwap protocol fee on (or off) for one chain.
 *
 * Two switches, both shipped in the deployed contracts and both left off:
 *
 *  - V2: KaleidoSwapFactory.feeTo. While it is the zero address the pair's
 *    `_mintFee` does nothing; set it and every pair mints ~1/6 of the growth in
 *    sqrt(k) since the last liquidity event to feeTo as LP tokens — Uniswap V2's
 *    "1/6 of the 0.3%", i.e. about 0.05% of volume. One call per factory,
 *    `setFeeTo(sink)`, callable only by `feeToSetter`.
 *
 *  - V3: KaleidoSwapV3Pool.slot0.feeProtocol, set per pool by the factory owner
 *    via `setFeeProtocol(n, n)`. `n` is 0 (off) or 4..10, and the pool then keeps
 *    1/n of the LP fee as a protocol fee — 4 is a 25% cut, 10 is 10%. It accrues
 *    inside the pool and is swept later with `collectProtocol(recipient, …)`, so
 *    turning it on chooses only the rate here, never a sink.
 *
 * ── Why this defaults to a dry run ──────────────────────────────────────────
 *
 * Unlike upgrade-facet.js, this script does NOT broadcast unless EXECUTE=1.
 * Flipping a fee on is an economics change, not a bug fix: it starts diverting
 * value to `sink` on the next trade, and `deploy-dex.js` is explicit that
 * `feeToSetter` "must be handed to the multisig alongside Diamond ownership".
 * The fee is meant to come on at that cutover, deliberately, not by an accidental
 * `hardhat run`. So the safe thing happens by default — a plan is printed and
 * nothing is signed — and broadcasting is the thing you opt into.
 *
 * Both switches are reversible from the same authority: FEE_SINK=<zero> turns V2
 * back off (setFeeTo(0)), V3_FEE_PROTOCOL=0 turns a V3 pool back off.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *
 *   # See the plan (reads only, signs nothing):
 *   npx hardhat run scripts/set-dex-fees.js --network sepolia
 *
 *   # Broadcast it. FEE_SINK defaults to the signer; on mainnet pass the multisig.
 *   EXECUTE=1 FEE_SINK=0x… V3_FEE_PROTOCOL=10 \
 *     npx hardhat run scripts/set-dex-fees.js --network sepolia
 *
 * Env:
 *   EXECUTE=1           broadcast (default: dry run)
 *   FEE_SINK=0x…        V2 feeTo recipient (default: the signer; must be the
 *                       multisig on mainnet). Pass the zero address to turn off.
 *   V3_FEE_PROTOCOL=n   0 (off) or 4..10 (protocol keeps 1/n of the LP fee).
 *                       Default 10 — the mildest on-setting.
 *   SKIP_V2=1 / SKIP_V3=1   run only one leg.
 *
 * Pools are read from the deployment-pool-<network>-*.json records this repo
 * writes; a pool created outside those records is not touched (there is exactly
 * one recorded pool across all five testnets today — Sepolia USDT/USDe @ 500).
 */

const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

const { registryFor } = require("./libraries/registry.js");

const EXECUTE = process.env.EXECUTE === "1";
const SKIP_V2 = process.env.SKIP_V2 === "1";
const SKIP_V3 = process.env.SKIP_V3 === "1";
const ZERO = ethers.ZeroAddress;

const V2_FACTORY_ABI = [
  "function feeTo() view returns (address)",
  "function feeToSetter() view returns (address)",
  "function setFeeTo(address)",
];
const V3_FACTORY_ABI = ["function owner() view returns (address)"];
const V3_POOL_ABI = [
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function factory() view returns (address)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)",
  "function setFeeProtocol(uint8 feeProtocol0, uint8 feeProtocol1)",
];

/* Reads on the newer testnets' public RPCs drop under no load at all — the same
 * note upgrade-facet.js carries. Reads are retried; writes never are, so a
 * timed-out-but-mined fee change can't be sent twice. */
const retry = async (label, fn, n = 6) => {
  let last;
  for (let i = 1; i <= n; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i < n) await new Promise((r) => setTimeout(r, 4000));
    }
  }
  throw new Error(`${label} failed after ${n} attempts: ${last.shortMessage || last.message}`);
};

const eq = (a, b) => a.toLowerCase() === b.toLowerCase();

/** Parse and validate V3_FEE_PROTOCOL: 0 (off) or an integer 4..10. */
function parseFeeProtocol() {
  const raw = process.env.V3_FEE_PROTOCOL ?? "10";
  const n = Number(raw);
  if (!Number.isInteger(n) || !(n === 0 || (n >= 4 && n <= 10))) {
    throw new Error(
      `V3_FEE_PROTOCOL must be 0 (off) or an integer 4..10 — got "${raw}". ` +
        "The pool keeps 1/n of the LP fee, so 4 is a 25% cut and 10 is 10%.",
    );
  }
  return n;
}

/** The V3 pools this repo has a deployment record for on the current network. */
function recordedPools(network) {
  const dir = path.join(__dirname, "..");
  const prefix = `deployment-pool-${network}-`;
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".json"))
    .map((f) => {
      const rec = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      return { file: f, pool: rec.pool, fee: rec.fee, token0: rec.token0, token1: rec.token1 };
    })
    .filter((r) => r.pool && ethers.isAddress(r.pool));
}

async function main() {
  const [signer] = await ethers.getSigners();
  const me = await signer.getAddress();
  const network = hre.network.name;
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const reg = registryFor(chainId);

  const sink = process.env.FEE_SINK || me;
  if (!ethers.isAddress(sink)) throw new Error(`FEE_SINK is not a valid address: ${sink}`);
  const feeProtocol = parseFeeProtocol();

  console.log("KaleidoSwap protocol fee");
  console.log("  network:  ", network, `(chainId ${chainId})`);
  console.log("  signer:   ", me);
  console.log("  mode:     ", EXECUTE ? "EXECUTE (will broadcast)" : "DRY RUN (nothing signed)");
  console.log("  V2 feeTo sink:", sink, sink === ZERO ? "(OFF)" : process.env.FEE_SINK ? "" : "(defaulted to signer)");
  console.log(
    "  V3 feeProtocol:",
    feeProtocol,
    feeProtocol === 0 ? "(OFF)" : `(protocol keeps 1/${feeProtocol} of the LP fee ≈ ${(100 / feeProtocol).toFixed(0)}%)`,
  );

  /** [{ kind, label, send: () => tx }] */
  const plan = [];

  /* ── V2: one setFeeTo per factory ── */
  if (!SKIP_V2 && reg.v2Factory) {
    const f = new ethers.Contract(reg.v2Factory, V2_FACTORY_ABI, signer);
    const [setter, current] = await Promise.all([
      retry("v2 feeToSetter", () => f.feeToSetter()),
      retry("v2 feeTo", () => f.feeTo()),
    ]);
    console.log(`\nV2 factory ${reg.v2Factory}`);
    console.log(`  feeToSetter ${setter}`);
    console.log(`  feeTo       ${current}${current === ZERO ? " (fee off)" : ""}`);
    if (!eq(setter, me)) {
      console.log(`  ! signer is not feeToSetter — cannot change V2 feeTo from this key. Skipping.`);
    } else if (eq(current, sink)) {
      console.log(`  = feeTo is already ${sink}. Nothing to do.`);
    } else {
      console.log(`  → setFeeTo(${sink})`);
      plan.push({ kind: "v2", label: `setFeeTo ${sink}`, send: () => f.setFeeTo(sink) });
    }
  } else if (!SKIP_V2) {
    console.log("\nV2: no v2Factory in the registry for this chain. Skipping.");
  }

  /* ── V3: setFeeProtocol per recorded pool ── */
  if (!SKIP_V3 && reg.v3Factory) {
    const owner = await retry("v3 owner", () =>
      new ethers.Contract(reg.v3Factory, V3_FACTORY_ABI, ethers.provider).owner(),
    );
    const pools = recordedPools(network);
    console.log(`\nV3 factory ${reg.v3Factory}`);
    console.log(`  owner ${owner}`);
    console.log(`  recorded pools: ${pools.length}`);
    if (!eq(owner, me)) {
      console.log(`  ! signer is not the factory owner — cannot set feeProtocol from this key. Skipping.`);
    } else {
      for (const p of pools) {
        const pool = new ethers.Contract(p.pool, V3_POOL_ABI, signer);
        const [slot0, poolFactory] = await Promise.all([
          retry(`slot0 ${p.pool}`, () => pool.slot0()),
          retry(`factory ${p.pool}`, () => pool.factory()),
        ]);
        const cur = Number(slot0.feeProtocol);
        const cur0 = cur % 16;
        const cur1 = cur >> 4;
        const label = `${p.token0?.symbol}/${p.token1?.symbol} @ ${p.fee}`;
        console.log(`\n  pool ${p.pool}  ${label}`);
        if (!eq(poolFactory, reg.v3Factory)) {
          console.log(`    ! pool.factory ${poolFactory} != registry v3Factory — record is stale. Skipping.`);
          continue;
        }
        console.log(`    feeProtocol now: ${cur0}/${cur1}${cur === 0 ? " (off)" : ""}`);
        if (cur0 === feeProtocol && cur1 === feeProtocol) {
          console.log(`    = already ${feeProtocol}/${feeProtocol}. Nothing to do.`);
          continue;
        }
        console.log(`    → setFeeProtocol(${feeProtocol}, ${feeProtocol})`);
        plan.push({
          kind: "v3",
          label: `setFeeProtocol ${feeProtocol}/${feeProtocol} on ${label}`,
          send: () => pool.setFeeProtocol(feeProtocol, feeProtocol),
        });
      }
    }
  } else if (!SKIP_V3) {
    console.log("\nV3: no v3Factory in the registry for this chain. Skipping.");
  }

  console.log(`\n${"=".repeat(60)}`);
  if (plan.length === 0) {
    console.log("Nothing to do — every switch is already in the requested state.");
    return;
  }
  console.log(`Planned transactions (${plan.length}):`);
  plan.forEach((p, i) => console.log(`  ${i + 1}. ${p.label}`));

  if (!EXECUTE) {
    console.log(`\nDRY RUN — nothing signed. Re-run with EXECUTE=1 to broadcast.`);
    return;
  }

  console.log(`\nBroadcasting…`);
  for (const p of plan) {
    const tx = await p.send();
    console.log(`  ${p.label}\n    tx ${tx.hash} — waiting…`);
    await tx.wait();
    console.log(`    mined.`);
  }
  console.log(`\nDone. ${plan.length} transaction(s) mined.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
