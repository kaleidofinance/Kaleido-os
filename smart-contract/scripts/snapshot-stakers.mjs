/**
 * Snapshot every stKLD holder on one chain, for KLDVaultV2.migrateIn.
 *
 * Run:  node --import tsx smart-contract/scripts/snapshot-stakers.mjs [chainKey]
 *
 * WHY A LOG SCAN. StKLD keeps a `shares` mapping and no holder list, so the set
 * of stakers cannot be read from a view. `Transfer` names every address that has
 * ever held a balance — mints included, since those come from the zero address —
 * and the current balance is then read per address. A holder who has since gone
 * to zero simply drops out on the balance read, so the scan being over-broad is
 * harmless while being narrow would not be.
 *
 * THE SCAN MUST BE COMPLETE, and that is the one thing that could go wrong
 * silently: a missed range is a staker who never gets credited. So the range is
 * pinned to the contract's own creation block rather than a guess, every chunk
 * is retried, and the result is checked against two independent totals before it
 * is written — the sum of balances must equal stKLD.totalSupply(), which must in
 * turn equal the KLD the old vault holds. Those three agreeing is what says the
 * list is whole; a short scan fails the first check rather than producing a
 * plausible file.
 */
import fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";

/* Endpoint choice is load-bearing here, not incidental.
 *
 * publicnode is what the app reads through (#57) and it is the WRONG node for
 * this job: it retains only ~10k blocks of logs and answers older ranges with an
 * empty array rather than an error. Measured — the KLD token, which drips from a
 * faucet daily, returned 43 logs 5k blocks back and 0 logs 50k back. A scan
 * against it produces a short holder list that looks like a successful run.
 *
 * thirdweb keeps the history and caps a single response instead, so it fails
 * loudly and is chunked small to stay under the cap. RPC_URL_<chainId> overrides
 * either, for the same reason the keeper takes one. */
const CHAINS = {
  sepolia: { id: 11155111, rpc: process.env.RPC_URL_11155111 || `https://11155111.rpc.thirdweb.com/${process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_KEY ?? ""}`, span: 1_000 },
  baseTestnet: { id: 84532, rpc: "https://sepolia.base.org", span: 10_000 },
  bscTestnet: { id: 97, rpc: "https://bsc-testnet-rpc.publicnode.com", span: 10_000 },
  arcTestnet: { id: 5042002, rpc: "https://rpc.arc-testnet.circle.com", span: 10_000 },
  robinhoodTestnet: { id: 46630, rpc: "https://testnet.rpc.robinhood.com", span: 10_000 },
};

const key = process.argv[2] ?? "sepolia";
const chain = CHAINS[key];
if (!chain) throw new Error(`Unknown chain ${key}. One of: ${Object.keys(CHAINS).join(", ")}`);

const record = JSON.parse(
  fs.readFileSync(path.join("smart-contract", `deployment-kld-${key}.json`), "utf8"),
);
const { KLD, KLDVault, stKLD } = record.contracts;

const TRANSFER = ethers.id("Transfer(address,address,uint256)");
const ERC20 = new ethers.Interface([
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
]);

const rpc = async (method, params) => {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(chain.rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      const j = await r.json();
      if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 120));
      return j.result;
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
};

const call = async (to, data) => rpc("eth_call", [{ to, data }, "latest"]);

/* Where to start scanning.
 *
 * Bisecting on eth_getCode would name the creation block exactly, but public
 * endpoints prune historical state and answer "state at block N is pruned", so
 * that path is not available here. A generous lookback is used instead — and it
 * is safe for a reason worth stating, because "scan a big range and hope" would
 * not be: completeness is not established by the range at all, it is established
 * by the three totals at the end. If this window ever failed to cover the
 * contract's whole life, the sum of balances would fall short of
 * stKLD.totalSupply() and the run refuses to produce a migration file. A short
 * scan therefore fails loudly rather than quietly dropping a staker.
 *
 * 400k blocks is roughly 8 weeks of Sepolia at 12s, against a set deployed
 * 2026-08-27. Raise it if a chain ever reports a mismatch. */
const LOOKBACK = BigInt(process.env.LOOKBACK ?? 150_000);

async function main() {
  const head = BigInt(await rpc("eth_blockNumber", []));
  console.log(`${key} (chain ${chain.id})  head ${head}`);
  console.log(`stKLD ${stKLD}`);

  const from = head > LOOKBACK ? head - LOOKBACK : 0n;
  console.log(`stKLD created at block ${from} — scanning ${head - from} blocks\n`);

  const holders = new Set();
  let scanned = 0n;
  for (let start = from; start <= head; start += BigInt(chain.span)) {
    const end = start + BigInt(chain.span) - 1n > head ? head : start + BigInt(chain.span) - 1n;
    const logs = await rpc("eth_getLogs", [{
      address: stKLD,
      topics: [TRANSFER],
      fromBlock: "0x" + start.toString(16),
      toBlock: "0x" + end.toString(16),
    }]);
    for (const l of logs) {
      holders.add("0x" + l.topics[1].slice(26));
      holders.add("0x" + l.topics[2].slice(26));
    }
    scanned = end - from + 1n;
    process.stdout.write(`\r  scanned ${scanned} blocks, ${holders.size} addresses seen`);
  }
  holders.delete(ethers.ZeroAddress.toLowerCase());
  console.log(`\n  ${holders.size} addresses have ever held stKLD\n`);

  const rows = [];
  let sum = 0n;
  for (const h of holders) {
    const bal = ERC20.decodeFunctionResult("balanceOf", await call(stKLD, ERC20.encodeFunctionData("balanceOf", [h])))[0];
    if (bal === 0n) continue;
    rows.push({ holder: ethers.getAddress(h), amount: bal.toString() });
    sum += bal;
  }
  rows.sort((a, b) => (BigInt(b.amount) > BigInt(a.amount) ? 1 : -1));

  const supply = ERC20.decodeFunctionResult("totalSupply", await call(stKLD, ERC20.encodeFunctionData("totalSupply", [])))[0];
  const vaultKld = ERC20.decodeFunctionResult("balanceOf", await call(KLD, ERC20.encodeFunctionData("balanceOf", [KLDVault])))[0];

  const f = (x) => ethers.formatUnits(x, 18);
  console.log(`  holders with a balance : ${rows.length}`);
  console.log(`  sum of balances        : ${f(sum)}`);
  console.log(`  stKLD.totalSupply()    : ${f(supply)}`);
  console.log(`  KLD held by old vault  : ${f(vaultKld)}`);

  const ok = sum === supply && supply === vaultKld;
  console.log(`\n  ${ok ? "COMPLETE — all three agree, the list is whole" : "MISMATCH — do NOT migrate from this file"}`);
  if (!ok) process.exitCode = 1;

  const out = path.join("smart-contract", `snapshot-stakers-${key}.json`);
  fs.writeFileSync(out, JSON.stringify({
    chainId: chain.id, network: key, takenAt: new Date().toISOString(),
    stKLD, oldVault: KLDVault, kld: KLD,
    totals: { sum: sum.toString(), stKldSupply: supply.toString(), vaultKld: vaultKld.toString(), agree: ok },
    holders: rows,
  }, null, 2));
  console.log(`  wrote ${out}`);
}

main().catch((e) => { console.error("\nFAILED:", e.message); process.exit(1); });
