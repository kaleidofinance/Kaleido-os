#!/usr/bin/env node
/**
 * Kaleido Zero Auto-Bridge Keeper
 *
 * Polls LayerZero's canonical $ZRO OFT (`quoteSend` -> dstEid 33002) across all
 * configured EVM source chains. The instant any route opens, reads the on-chain
 * `ZeroAutoBridge` queue, filters orders whose allowance, balance, expiry, and
 * fee caps are satisfied, and submits `executeBatch(readyUsers)`.
 *
 * Usage (VPS / PM2 / systemd):
 *   ZERO_KEEPER_PRIVATE_KEY=0x... \
 *   NEXT_PUBLIC_ZERO_AUTOBRIDGE_BASE=0x... \
 *   NEXT_PUBLIC_ZERO_AUTOBRIDGE_ARBITRUM=0x... \
 *   node scripts/zero-bridge-keeper.mjs
 *
 * Add `--once` to run a single probe pass and exit.
 */

import { ethers } from "ethers";

const ZRO_OFT = "0x6985884C4392D348587B19cb9eAAf157F13271cd";
const ZERO_DST_EID = 33002;
const POLL_MS = Number(process.env.ZERO_KEEPER_POLL_MS || "3000");
const BATCH_SIZE = Number(process.env.ZERO_KEEPER_BATCH_SIZE || "25");
const RUN_ONCE = process.argv.includes("--once");

const ZRO_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function quoteSend((uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd) sendParam, bool payInLzToken) view returns ((uint256 nativeFee, uint256 lzTokenFee) msgFee)",
];

const AUTOBRIDGE_ABI = [
  "function queueLength() view returns (uint256)",
  "function getQueue(uint256 offset, uint256 limit) view returns (address[])",
  "function orders(address user) view returns (uint256 amount, uint128 deposit, uint128 maxNativeFee, uint64 maxGasPrice, uint40 validUntil, uint32 queuePos)",
  "function quoteBridge(address user, uint256 grossAmount) view returns (uint256 nativeFee, uint256 netAmount, uint256 feeAmount)",
  "function executeBatch(address[] users)",
];

const CHAINS = [
  {
    name: "Base",
    chainId: 8453,
    rpc: process.env.BASE_RPC_URL || "https://mainnet.base.org",
    contract:
      process.env.NEXT_PUBLIC_ZERO_AUTOBRIDGE_BASE ||
      "0x4b8F2CC0272250Fb8c219a85c10a0FDe71F4b382",
  },
  {
    name: "Arbitrum",
    chainId: 42161,
    rpc: process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc",
    contract:
      process.env.NEXT_PUBLIC_ZERO_AUTOBRIDGE_ARBITRUM ||
      "0xd27eB978D2a018F5E23FA2D2CA4a70122A3a669C",
  },
  {
    name: "Ethereum",
    chainId: 1,
    rpc: process.env.ETHEREUM_RPC_URL || "https://ethereum-rpc.publicnode.com",
    contract: process.env.NEXT_PUBLIC_ZERO_AUTOBRIDGE_ETHEREUM,
  },
  {
    name: "BNB",
    chainId: 56,
    rpc: process.env.BSC_RPC_URL || "https://bsc-rpc.publicnode.com",
    contract:
      process.env.NEXT_PUBLIC_ZERO_AUTOBRIDGE_BSC ||
      "0x36EB9A3D87f9cEd18cBcfBF35836762f840149C9",
  },
  {
    name: "Optimism",
    chainId: 10,
    rpc: process.env.OPTIMISM_RPC_URL || "https://mainnet.optimism.io",
    contract: process.env.NEXT_PUBLIC_ZERO_AUTOBRIDGE_OPTIMISM,
  },
  {
    name: "Polygon",
    chainId: 137,
    rpc: process.env.POLYGON_RPC_URL || "https://polygon-bor-rpc.publicnode.com",
    contract: process.env.NEXT_PUBLIC_ZERO_AUTOBRIDGE_POLYGON,
  },
  {
    name: "Avalanche",
    chainId: 43114,
    rpc: process.env.AVALANCHE_RPC_URL || "https://avalanche-c-chain-rpc.publicnode.com",
    contract: process.env.NEXT_PUBLIC_ZERO_AUTOBRIDGE_AVALANCHE,
  },
];

const PROBE_PARAM = {
  dstEid: ZERO_DST_EID,
  to: ethers.zeroPadValue("0x000000000000000000000000000000000000dEaD", 32),
  amountLD: ethers.parseEther("1"),
  minAmountLD: ethers.parseEther("0.995"),
  extraOptions: "0x",
  composeMsg: "0x",
  oftCmd: "0x",
};

const inFlightChains = new Set();

async function checkChain(cfg, privateKey) {
  if (inFlightChains.has(cfg.chainId)) return;
  inFlightChains.add(cfg.chainId);

  try {
    const provider = new ethers.JsonRpcProvider(cfg.rpc, cfg.chainId, {
      staticNetwork: true,
    });
    const zro = new ethers.Contract(ZRO_OFT, ZRO_ABI, provider);

    // 1. Cheap route-open probe
    let routeFee;
    try {
      const fee = await zro.quoteSend(PROBE_PARAM, false);
      routeFee = BigInt(fee.nativeFee ?? fee[0]);
    } catch {
      // Route closed (reverted) — normal state
      return;
    }

    console.log(
      `[${new Date().toISOString()}] ROUTE OPEN on ${cfg.name}! nativeFee=${ethers.formatEther(routeFee)}`,
    );

    if (!cfg.contract || !ethers.isAddress(cfg.contract)) return;

    const abRead = new ethers.Contract(cfg.contract, AUTOBRIDGE_ABI, provider);
    const qLen = Number(await abRead.queueLength());
    if (qLen === 0) {
      console.log(`  [${cfg.name}] Queue empty.`);
      return;
    }

    const candidates = await abRead.getQueue(0, Math.min(qLen, BATCH_SIZE));
    const nowSec = Math.floor(Date.now() / 1000);
    const feeData = await provider.getFeeData();
    const curGasPrice = feeData.gasPrice ?? 0n;

    const ready = [];
    for (const user of candidates) {
      try {
        const o = await abRead.orders(user);
        const amount = BigInt(o.amount ?? o[0]);
        const deposit = BigInt(o.deposit ?? o[1]);
        const maxNativeFee = BigInt(o.maxNativeFee ?? o[2]);
        const maxGasPrice = BigInt(o.maxGasPrice ?? o[3]);
        const validUntil = Number(o.validUntil ?? o[4]);
        const queuePos = Number(o.queuePos ?? o[5]);

        if (queuePos === 0 || validUntil <= nowSec) continue;
        if (maxGasPrice > 0n && curGasPrice > maxGasPrice) continue;
        if (maxNativeFee > 0n && routeFee > maxNativeFee) continue;
        if (deposit < routeFee) continue;

        const [bal, allow] = await Promise.all([
          zro.balanceOf(user),
          zro.allowance(user, cfg.contract),
        ]);
        if (BigInt(bal) < amount || BigInt(allow) < amount) continue;

        ready.push(user);
      } catch {
        // skip single broken read
      }
    }

    if (ready.length === 0) {
      console.log(`  [${cfg.name}] ${qLen} queued, 0 executable right now.`);
      return;
    }

    if (!privateKey) {
      console.log(`  [${cfg.name}] DRY-RUN: ${ready.length} users ready (no ZERO_KEEPER_PRIVATE_KEY set).`);
      return;
    }

    const signer = new ethers.Wallet(privateKey, provider);
    const abWrite = new ethers.Contract(cfg.contract, AUTOBRIDGE_ABI, signer);
    console.log(`  [${cfg.name}] Executing batch for ${ready.length} users...`);
    const tx = await abWrite.executeBatch(ready);
    console.log(`  [${cfg.name}] Tx submitted: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(
      `  [${cfg.name}] Batch confirmed in block ${receipt.blockNumber} (gasUsed=${receipt.gasUsed})`,
    );
  } catch (err) {
    console.error(`[${cfg.name}] Keeper error:`, err?.message || err);
  } finally {
    inFlightChains.delete(cfg.chainId);
  }
}

async function main() {
  const privateKey =
    (process.env.ZERO_KEEPER_PRIVATE_KEY || process.env.KEEPER_PRIVATE_KEY || "").trim();
  const activeChains = CHAINS.filter(
    (c) => c.contract && ethers.isAddress(c.contract),
  );
  const targets = activeChains.length > 0 ? activeChains : CHAINS;

  console.log(
    `Kaleido Zero Auto-Bridge Keeper starting (${targets.length} chains, poll=${POLL_MS}ms, mode=${
      privateKey ? "LIVE" : "DRY-RUN"
    })`,
  );

  const tick = async () => {
    await Promise.all(targets.map((c) => checkChain(c, privateKey)));
  };

  await tick();
  if (RUN_ONCE) return;
  setInterval(tick, POLL_MS);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
