/**
 * Snapshot every holder of one ERC20 on one chain, to a file.
 *
 * Run:  node --import tsx --env-file=.env smart-contract/scripts/snapshot-holders.mjs <chainKey> <tokenAddress> <label>
 *
 * WHY THIS IS ITS OWN STEP. The treasury migration first tried to build this
 * list inline, and that was the wrong shape twice over. It is ~150 sequential
 * `eth_getLogs` calls through hardhat's provider, which is slow enough to look
 * hung and slow enough to time out; and it re-ran the whole scan on every
 * attempt, so a retry paid the cost again before it could send a transaction.
 * A live migration that has spent fifteen minutes without writing anything is
 * one nobody can tell apart from a stuck one.
 *
 * Split out, the scan runs once against a raw endpoint with its own retries, the
 * result is reviewable before anything is signed, and the migration starts by
 * reading a file.
 *
 * COMPLETENESS IS THE ONLY THING THAT MATTERS HERE, and it is not established by
 * the block range — it is established by the balances summing to totalSupply().
 * A short scan therefore fails loudly instead of quietly producing a list that
 * is missing people. publicnode is the wrong endpoint for this and the reason is
 * worth repeating: it retains ~10k blocks of logs and answers older ranges with
 * an EMPTY ARRAY rather than an error, so a scan against it looks successful.
 */
import fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";

const CHAINS = {
  sepolia: { id: 11155111, span: 1_000 },
  baseTestnet: { id: 84532, span: 1_000 },
  bscTestnet: { id: 97, span: 1_000 },
  arcTestnet: { id: 5042002, span: 1_000 },
  robinhoodTestnet: { id: 46630, span: 1_000 },
};

const [, , key = "sepolia", token, label = "holders"] = process.argv;
const chain = CHAINS[key];
if (!chain) throw new Error(`Unknown chain ${key}`);
if (!ethers.isAddress(token ?? "")) throw new Error("Pass a token address");

const RPC =
  process.env[`RPC_URL_${chain.id}`] ||
  `https://${chain.id}.rpc.thirdweb.com/${process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_KEY ?? ""}`;
/* Both are per-chain and both are overridable, because neither is a property
   of this script. LOOKBACK is measured in BLOCKS while the thing being covered
   is a number of DAYS, so a window that reaches back a fortnight on Sepolia
   (12s blocks) covers three days on Base (2s) - the first Base scan came up
   594,203 KLD short for exactly that reason, and the totals check caught it.
   SPAN is what one endpoint will answer in a single getLogs; thirdweb caps
   Base at 1,000 while base.org and publicnode serve 10,000, which is 70
   requests instead of 700. */
const SPAN_OVERRIDE = process.env.SPAN ? Number(process.env.SPAN) : null;
const LOOKBACK = BigInt(process.env.LOOKBACK ?? 150_000);

const TRANSFER = ethers.id("Transfer(address,address,uint256)");
const ERC20 = new ethers.Interface([
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
]);

async function rpc(method, params) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const r = await fetch(RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      const j = await r.json();
      if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 120));
      return j.result;
    } catch (e) {
      if (attempt === 4) throw e;
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }
}

const call = (to, data) => rpc("eth_call", [{ to, data }, "latest"]);

async function main() {
  const head = BigInt(await rpc("eth_blockNumber", []));
  const from = head > LOOKBACK ? head - LOOKBACK : 0n;
  console.log(`${key} (chain ${chain.id})  token ${token}`);
  console.log(`scanning ${head - from} blocks from ${from}\n`);

  const seen = new Set();
  for (let start = from; start <= head; start += BigInt((SPAN_OVERRIDE ?? chain.span))) {
    const end = start + BigInt((SPAN_OVERRIDE ?? chain.span)) - 1n > head ? head : start + BigInt((SPAN_OVERRIDE ?? chain.span)) - 1n;
    const logs = await rpc("eth_getLogs", [
      {
        address: token,
        topics: [TRANSFER],
        fromBlock: "0x" + start.toString(16),
        toBlock: "0x" + end.toString(16),
      },
    ]);
    for (const l of logs) {
      seen.add("0x" + l.topics[1].slice(26));
      seen.add("0x" + l.topics[2].slice(26));
    }
    process.stdout.write(`\r  ${end - from + 1n} blocks, ${seen.size} addresses seen`);
  }
  seen.delete(ethers.ZeroAddress.toLowerCase());
  console.log("");

  const rows = [];
  let sum = 0n;
  for (const h of seen) {
    const bal = ERC20.decodeFunctionResult(
      "balanceOf",
      await call(token, ERC20.encodeFunctionData("balanceOf", [h])),
    )[0];
    if (bal === 0n) continue;
    rows.push({ holder: ethers.getAddress(h), amount: bal.toString() });
    sum += bal;
  }
  rows.sort((a, b) => (BigInt(b.amount) > BigInt(a.amount) ? 1 : -1));

  const supply = ERC20.decodeFunctionResult(
    "totalSupply",
    await call(token, ERC20.encodeFunctionData("totalSupply", [])),
  )[0];

  const f = (x) => ethers.formatUnits(x, 18);
  console.log(`\n  holders with a balance : ${rows.length}`);
  console.log(`  sum of balances        : ${f(sum)}`);
  console.log(`  totalSupply()          : ${f(supply)}`);
  const ok = sum === supply;
  console.log(`\n  ${ok ? "COMPLETE - the list is whole" : "MISMATCH - do NOT act on this file"}`);
  if (!ok) process.exitCode = 1;

  const out = path.join("smart-contract", `snapshot-${label}-${key}.json`);
  fs.writeFileSync(
    out,
    JSON.stringify(
      {
        chainId: chain.id,
        network: key,
        token,
        takenAt: new Date().toISOString(),
        totals: { sum: sum.toString(), totalSupply: supply.toString(), agree: ok },
        holders: rows,
      },
      null,
      2,
    ),
  );
  console.log(`  wrote ${out}`);
}

main().catch((e) => {
  console.error("\nFAILED:", e.message);
  process.exit(1);
});
