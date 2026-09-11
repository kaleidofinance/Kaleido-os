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
/* Every chain honours RPC_URL_<chainId>, not just one of them. The default
   here is whatever answered when the chain was added, and defaults go stale in
   two different ways: BSC's publicnode prunes the history this scan needs, and
   thirdweb caps Base at a tenth of the span base.org serves. The override is
   how a run picks the endpoint that can actually answer it, and it was silently
   ignored on four of the five chains until 2026-09-10. */
const CHAINS = {
  sepolia: { id: 11155111, rpc: process.env.RPC_URL_11155111 || `https://11155111.rpc.thirdweb.com/${process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_KEY ?? ""}`, span: 1_000 },
  baseTestnet: { id: 84532, rpc: process.env.RPC_URL_84532 || "https://sepolia.base.org", span: 10_000 },
  bscTestnet: { id: 97, rpc: process.env.RPC_URL_97 || "https://bsc-testnet-rpc.publicnode.com", span: 10_000 },
  arcTestnet: { id: 5042002, rpc: process.env.RPC_URL_5042002 || "https://rpc.arc-testnet.circle.com", span: 10_000 },
  robinhoodTestnet: { id: 46630, rpc: process.env.RPC_URL_46630 || "https://testnet.rpc.robinhood.com", span: 10_000 },
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
/* Both are per-chain and both are overridable, because neither is a property
   of this script. LOOKBACK is measured in BLOCKS while the thing being covered
   is a number of DAYS, so a window that reaches back a fortnight on Sepolia
   (12s blocks) covers three days on Base (2s) - the first Base scan came up
   594,203 KLD short for exactly that reason, and the totals check caught it.
   SPAN is what one endpoint will answer in a single getLogs; thirdweb caps
   Base at 1,000 while base.org and publicnode serve 10,000, which is 70
   requests instead of 700. */
/* Where a partial scan parks itself.
 *
 * BSC needs 2,597,896 blocks at the 1,000-block span its endpoints will serve -
 * about 2,600 requests - and the first attempt died on a transient `fetch
 * failed` at block 1,483,000 having learnt 2 addresses. Without this the retry
 * starts from zero, which on a chain this size means it may never finish at all.
 *
 * The file holds the addresses seen so far and the next block to read. It is
 * progress, not a result: nothing downstream reads it, and the totals check
 * still decides whether the finished list is usable. Deleted on success so a
 * later run cannot resume into a stale range. */
const PROGRESS = (k) => `smart-contract/.scan-progress-${k}.json`;
const SPAN_OVERRIDE = process.env.SPAN ? Number(process.env.SPAN) : null;
const LOOKBACK = BigInt(process.env.LOOKBACK ?? 150_000);

/**
 * The block the contract was created in, found by bisection on eth_getCode.
 *
 * A LOOKBACK is a guess, and the guess has been wrong twice: 150k blocks
 * reaches back a fortnight on Sepolia's 12s blocks, three days on Base's 2s,
 * and about nineteen hours on BSC's 0.45s. The first Base scan came up 594,203
 * KLD short because of it. The creation block is not a guess - it is the
 * earliest block that could possibly carry a log for this contract, so it is
 * both correct and the smallest range that can be.
 *
 * Falls back to LOOKBACK when an endpoint has pruned the state it needs to
 * answer (publicnode does; thirdweb does not), because a slower correct scan
 * still beats no scan - and the totals check downstream is what actually
 * decides whether the result is usable either way.
 */
async function creationBlock(address, head) {
  const has = async (b) => {
    const code = await rpc("eth_getCode", [address, "0x" + b.toString(16)]);
    return code !== "0x";
  };
  try {
    if (await has(0n)) return 0n;
    let lo = 0n;
    let hi = head;
    if (!(await has(hi))) throw new Error("no code at head");
    while (lo < hi) {
      const mid = (lo + hi) / 2n;
      if (await has(mid)) hi = mid;
      else lo = mid + 1n;
    }
    return lo;
  } catch {
    return null;
  }
}

async function main() {
  const head = BigInt(await rpc("eth_blockNumber", []));
  console.log(`${key} (chain ${chain.id})  head ${head}`);
  console.log(`stKLD ${stKLD}`);

  /* Exact where the endpoint allows it, a window only as a fallback. */
  const created = await creationBlock(stKLD, head);
  const from =
    created !== null ? created : head > LOOKBACK ? head - LOOKBACK : 0n;
  console.log(
    created !== null
      ? `created at block ${created} - scanning ${head - created} blocks (exact)`
      : `state pruned, falling back to a ${LOOKBACK}-block window`,
  );

  const progressPath = PROGRESS(key);
  let holders = new Set();
  let resumeFrom = from;
  if (fs.existsSync(progressPath)) {
    const prev = JSON.parse(fs.readFileSync(progressPath, "utf8"));
    if (prev.token?.toLowerCase() === stKLD.toLowerCase() && BigInt(prev.next) > from) {
      holders = new Set(prev.seen);
      resumeFrom = BigInt(prev.next);
      console.log(`  resuming at ${resumeFrom} with ${holders.size} addresses already seen`);
    }
  }

  try {
    for (let start = resumeFrom; start <= head; start += BigInt(SPAN_OVERRIDE ?? chain.span)) {
      const end =
        start + BigInt(SPAN_OVERRIDE ?? chain.span) - 1n > head
          ? head
          : start + BigInt(SPAN_OVERRIDE ?? chain.span) - 1n;
      const logs = await rpc("eth_getLogs", [
        {
          address: stKLD,
          topics: [TRANSFER],
          fromBlock: "0x" + start.toString(16),
          toBlock: "0x" + end.toString(16),
        },
      ]);
      for (const l of logs) {
        holders.add("0x" + l.topics[1].slice(26));
        holders.add("0x" + l.topics[2].slice(26));
      }
      resumeFrom = end + 1n;
      if (end % 50_000n < BigInt(SPAN_OVERRIDE ?? chain.span)) {
        fs.writeFileSync(
          progressPath,
          JSON.stringify({ token: stKLD, next: resumeFrom.toString(), seen: [...holders] }),
        );
      }
      process.stdout.write(`  ${end - from + 1n} blocks, ${holders.size} addresses seen`);
    }
  } catch (e) {
    /* Park what was learnt before rethrowing. A scan that dies having thrown its
       progress away is a scan that has to be lucky rather than persistent. */
    fs.writeFileSync(
      progressPath,
      JSON.stringify({ token: stKLD, next: resumeFrom.toString(), seen: [...holders] }),
    );
    console.log(`
  parked at ${resumeFrom} with ${holders.size} addresses - re-run to continue`);
    throw e;
  }
  if (fs.existsSync(progressPath)) fs.unlinkSync(progressPath);

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
