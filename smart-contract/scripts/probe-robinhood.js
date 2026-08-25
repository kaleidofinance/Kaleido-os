/**
 * What Robinhood Chain Testnet (46630) actually holds, measured rather than read
 * off a docs page.
 *
 * Written because two things this repo records about that chain came from a
 * search rather than from the chain, and the docs the team pointed at say
 * something different from both:
 *
 *   1. `scripts/libraries/aggregator-feeds.js` records an API3 dAPI as the only
 *      oracle with a deployment here, needing a bought plan to answer.
 *   2. The deploy plan records "nothing canonical" and budgets a WETH9 of our own.
 *
 * docs.robinhood.com/chain/oracles-and-price-feeds names CHAINLINK and no one
 * else, and docs.robinhood.com/chain/protocol-contracts publishes a canonical
 * `L2 Weth` for testnet. Both of our records may therefore be wrong. Neither the
 * docs nor the old search settles it — only the chain does, so this asks it.
 *
 * Read-only. Sends nothing, needs no funds.
 *
 *   npx hardhat run scripts/probe-robinhood.js --network robinhoodTestnet
 */
const { ethers } = require("hardhat");

/* Published at docs.robinhood.com/chain/protocol-contracts under "L2 (Testnet)".
 * Robinhood Chain is an Arbitrum Orbit L2 — its testnet settles to Sepolia — so
 * this is an aeWETH-style gateway token rather than a stock WETH9, and the two
 * differ in ways that matter to a router: aeWETH is upgradeable and mints via the
 * bridge. Whether deposit()/withdraw() exist is the whole question, because
 * KaleidoSwapRouter calls both. */
const L2_WETH = "0x7943e237c7F95DA44E0301572D358911207852Fa";

/* Mainnet-only per the docs, checked here purely to confirm it is absent — a
 * mainnet address that happens to hold code on testnet is the trap that makes
 * "copied the wrong network's address" hard to see. */
const MAINNET_WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const MAINNET_USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";

/* What we currently believe is the only oracle here. */
const API3_PROXY = "0xe201212b76f0C82FBf5ff17D8Ee009C9d4e9C597";
const API3_MARKET = "0x26B7446a3a7c21495d389055FE9e80C4A71A3552";

/* Arbitrum Orbit precompiles. Present on every Orbit chain at a fixed address, so
 * they are the cheapest positive proof of what kind of chain this is — which in
 * turn decides whether the plan's `evmVersion: "paris"` concern is real here. */
const ARB_SYS = "0x0000000000000000000000000000000000000064";
const ARB_GAS_INFO = "0x000000000000000000000000000000000000006C";

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
];
const WETH_ABI = [
  "function deposit() payable",
  "function withdraw(uint256)",
];
const AGGREGATOR_ABI = [
  "function decimals() view returns (uint8)",
  "function description() view returns (string)",
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
];

async function code(addr) {
  const c = await ethers.provider.getCode(addr);
  return { has: c !== "0x", size: (c.length - 2) / 2 };
}

/** Calls a view and reports the failure instead of throwing — a revert IS data here. */
async function tryCall(label, fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    const reason = e?.shortMessage || e?.reason || e?.message || String(e);
    return { ok: false, error: reason.split("\n")[0].slice(0, 140), label };
  }
}

async function main() {
  const net = await ethers.provider.getNetwork();
  const [signer] = await ethers.getSigners();
  const block = await ethers.provider.getBlock("latest");

  console.log(`\n🔍 Probing chain ${net.chainId} (${network.name})`);
  console.log(`   signer ${signer.address}`);
  console.log(`   head   block ${block.number}, timestamp ${block.timestamp}`);

  if (Number(net.chainId) !== 46630) {
    throw new Error(
      `This probe hardcodes Robinhood TESTNET addresses and is on chain ${net.chainId}. ` +
        "Run it with --network robinhoodTestnet or the results describe nothing.",
    );
  }

  console.log("\n1. Is this really an Arbitrum Orbit L2?");
  for (const [label, addr] of [
    ["ArbSys", ARB_SYS],
    ["ArbGasInfo", ARB_GAS_INFO],
  ]) {
    const c = await code(addr);
    console.log(
      `   ${c.has ? "✅" : "❌"} ${label.padEnd(11)} ${addr}  ${
        c.has ? `${c.size} bytes` : "NO CODE"
      }`,
    );
  }

  console.log("\n2. Canonical L2 WETH from the docs");
  {
    const c = await code(L2_WETH);
    console.log(`   ${c.has ? "✅" : "❌"} ${L2_WETH}  ${c.has ? `${c.size} bytes` : "NO CODE"}`);
    if (c.has) {
      const t = new ethers.Contract(L2_WETH, ERC20_ABI, ethers.provider);
      for (const f of ["symbol", "name", "decimals", "totalSupply"]) {
        const r = await tryCall(f, () => t[f]());
        console.log(
          `      ${f.padEnd(12)} ${r.ok ? String(r.value) : `REVERTED — ${r.error}`}`,
        );
      }
      /* The router calls these. staticCall proves the function EXISTS and would
       * succeed without spending anything: a missing deposit() reverts here with
       * an unknown-selector failure, which is exactly the distinction between a
       * WETH9-compatible wrapper and a bridge token that only the gateway mints. */
      const dep = await tryCall("deposit", () =>
        new ethers.Contract(L2_WETH, WETH_ABI, signer).deposit.staticCall({ value: 1n }),
      );
      console.log(
        `      deposit()    ${dep.ok ? "✅ callable (staticCall, nothing spent)" : `❌ ${dep.error}`}`,
      );
      const wd = await tryCall("withdraw", () =>
        new ethers.Contract(L2_WETH, WETH_ABI, signer).withdraw.staticCall(0n),
      );
      console.log(`      withdraw()   ${wd.ok ? "✅ callable" : `❌ ${wd.error}`}`);
    }
  }

  console.log("\n3. Mainnet addresses — expected ABSENT here");
  for (const [label, addr] of [
    ["WETH (mainnet)", MAINNET_WETH],
    ["USDG (mainnet)", MAINNET_USDG],
  ]) {
    const c = await code(addr);
    console.log(
      `   ${c.has ? "⚠️ " : "✅"} ${label.padEnd(16)} ${addr}  ${
        c.has ? `${c.size} bytes — PRESENT, do not assume it is the same token` : "no code, as expected"
      }`,
    );
  }

  console.log("\n4. The API3 proxy this repo currently records as the only oracle");
  {
    const c = await code(API3_PROXY);
    console.log(`   ${c.has ? "✅" : "❌"} proxy  ${API3_PROXY}  ${c.has ? `${c.size} bytes` : "NO CODE"}`);
    if (c.has) {
      const a = new ethers.Contract(API3_PROXY, AGGREGATOR_ABI, ethers.provider);
      const d = await tryCall("decimals", () => a.decimals());
      console.log(`      decimals()        ${d.ok ? d.value : `REVERTED — ${d.error}`}`);
      const desc = await tryCall("description", () => a.description());
      console.log(
        `      description()     ${desc.ok ? `"${desc.value}"` : `REVERTED — ${desc.error}`}`,
      );
      const lrd = await tryCall("latestRoundData", () => a.latestRoundData());
      if (lrd.ok) {
        const [roundId, answer, , updatedAt] = lrd.value;
        const age = block.timestamp - Number(updatedAt);
        console.log(
          `      latestRoundData() ✅ ANSWERS — round ${roundId}, answer ${answer}, ` +
            `updatedAt ${updatedAt} (${age}s old)`,
        );
      } else {
        console.log(`      latestRoundData() ❌ REVERTED — ${lrd.error}`);
      }
    }
    const m = await code(API3_MARKET);
    console.log(
      `   ${m.has ? "✅" : "❌"} market ${API3_MARKET}  ${m.has ? `${m.size} bytes` : "NO CODE"}`,
    );
  }

  console.log("\n" + "=".repeat(60));
  console.log("Read this against two records that may be wrong:");
  console.log("  aggregator-feeds.js 46630  — 'API3 is the only oracle here'");
  console.log("  the deploy plan            — 'nothing canonical, deploy WETH9'");
  console.log("Robinhood's own docs name Chainlink and publish an L2 Weth, and");
  console.log("Chainlink's docs list ONLY a Robinhood mainnet network. If the");
  console.log("WETH above answers and no Chainlink feed is published for 46630,");
  console.log("then the WETH record is wrong and the oracle record is right for");
  console.log("the wrong reason: Chainlink is the chain's oracle on MAINNET, and");
  console.log("testnet has no Chainlink feed to read at all.");
  console.log("=".repeat(60) + "\n");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
