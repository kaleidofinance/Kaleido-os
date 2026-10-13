// Read-only survey: every contract named in any testnet deployment record, probed for
// what a given address controls (owner / pendingOwner / feeToSetter / AccessControl
// roles / isPusher) and what it holds (ERC20 balanceOf). No keys, no writes.
//
//   node scripts/survey-leaked-key.mjs [address] [chainId]
//
// Defaults to the leaked testnet deployer. Prints one line per finding, then a
// per-chain summary; the control row (the current deployer's own owner() hits)
// is printed beside it so an empty result can be told apart from a broken probe.
import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WHO = ethers.getAddress(process.env.SURVEY_WHO || process.argv[2] || "0x28b7b3dc96e5b2C6047D7Ad9b05Fd9E2FC7E8955");
const CONTROL = "0x0Ce7f8Aeaad60b9E19ACBe9803518182adC351Bc";
const only = process.argv[3];

export const TESTNETS = {
  sepolia: [11155111, "https://ethereum-sepolia-rpc.publicnode.com"],
  baseTestnet: [84532, "https://sepolia.base.org"],
  bscTestnet: [97, "https://bsc-testnet-rpc.publicnode.com"],
  robinhoodTestnet: [46630, "https://rpc.testnet.chain.robinhood.com"],
  arcTestnet: [5042002, "https://rpc.testnet.arc.network"],
};

const ROLE_NAMES = ["ADMIN_ROLE", "KLD_BRIDGE_ROLE", "KLD_MINTER_ROLE", "MINTER_ROLE", "PAUSER_ROLE",
  "VAULT_ROLE", "YIELD_SOURCE_ROLE", "KEEPER_ROLE", "OPERATOR_ROLE", "PUSHER_ROLE", "UPGRADER_ROLE"];
const ROLES = [["DEFAULT_ADMIN_ROLE", ethers.ZeroHash], ...ROLE_NAMES.map((n) => [n, ethers.id(n)])];
const ADDR_GETTERS = ["owner", "pendingOwner", "feeToSetter", "feeTo", "keeper", "admin", "treasury",
  "feeRecipient", "feeReceiver", "guardian", "operator"];

const iface = new ethers.Interface([
  ...ADDR_GETTERS.map((g) => `function ${g}() view returns (address)`),
  "function hasRole(bytes32,address) view returns (bool)",
  "function isPusher(address) view returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

// Collect every address in every non-fork record for a network, with the JSON path it came from.
export function recordAddresses(network) {
  const out = new Map();
  for (const f of fs.readdirSync(ROOT)) {
    if (!f.startsWith("deployment-") || !f.endsWith(".json") || /fork/i.test(f)) continue;
    if (!f.includes(`-${network}`) || f.includes(`-${network}Fork`)) continue;
    const walk = (v, p) => {
      if (typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v)) {
        const a = ethers.getAddress(v);
        if (!out.has(a)) out.set(a, `${f}:${p}`);
      } else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, p ? `${p}.${k}` : k);
    };
    walk(JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8")), "");
  }
  return out;
}

// A revert means "no such getter" and is expected; a transport error (throttling,
// timeout) is retried and, if it persists, counted so the summary cannot pass silently.
let transportErrors = 0;
const isRevert = (e) => e?.code === "CALL_EXCEPTION" || /revert|execution reverted/i.test(e?.shortMessage || e?.message || "");
async function retry(fn) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      if (isRevert(e)) throw e;
      if (i >= 4) { transportErrors++; throw e; }
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
}
// A revert is only believed when it repeats: an overloaded endpoint has been seen to
// answer a real role check with a revert-shaped error (Arc testnet, 2026-09-28), which
// silently read as "no role". `strict` (hasRole on a contract known to be AccessControl,
// where a revert is impossible) counts any persistent failure as a probe failure.
async function call(p, to, fn, args = [], strict = false) {
  const data = iface.encodeFunctionData(fn, args);
  for (let attempt = 0; attempt < (strict ? 5 : 2); attempt++) {
    try {
      const ret = await retry(() => p.call({ to, data }));
      if (!ret || ret === "0x") return undefined;
      return iface.decodeFunctionResult(fn, ret)[0];
    } catch {
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  if (strict) { transportErrors++; throw new Error(`strict ${fn} failed on ${to}`); }
  return undefined;
}

async function pool(items, n, fn) {
  const res = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; res[k] = await fn(items[k]); } }));
  return res;
}

// Everything WHO ever deployed with plain CREATE sits at getCreateAddress(WHO, nonce),
// so walking its nonces finds contracts no deployment record mentions.
async function createdAddresses(p) {
  const n = await retry(() => p.getTransactionCount(WHO));
  const out = new Map();
  for (let i = 0; i < n; i++) out.set(ethers.getCreateAddress({ from: WHO, nonce: i }), `create#${i}`);
  return out;
}

export async function surveyChain(network, [chainId, url]) {
  const p = new ethers.JsonRpcProvider(url, chainId, { staticNetwork: true, batchMaxCount: 1 });
  const merged = new Map(recordAddresses(network));
  for (const [a, src] of await createdAddresses(p)) if (!merged.has(a)) merged.set(a, src);
  const addrs = [...merged].filter(([a]) => a !== WHO && a !== CONTROL);
  const findings = []; let controlHits = 0; let withCode = 0; transportErrors = 0;
  await pool(addrs, Number(process.env.CONCURRENCY || 3), async ([a, src]) => {
    const code = await retry(() => p.getCode(a)).catch(() => undefined);
    if (code === undefined) { findings.push({ a, src, kind: "PROBE FAILED (getCode)" }); return; }
    if (code === "0x") return;
    withCode++;
    for (const g of ADDR_GETTERS) {
      const v = await call(p, a, g);
      if (v === undefined) continue;
      if (g === "owner" && v === CONTROL) controlHits++;
      if (v === WHO) findings.push({ a, src, kind: g });
    }
    // Only AccessControl contracts answer hasRole at all; probe every role on those.
    const isAdmin = await call(p, a, "hasRole", [ethers.ZeroHash, WHO]);
    if (isAdmin !== undefined) {
      for (const [name, h] of ROLES) {
        try {
          if (await call(p, a, "hasRole", [h, WHO], true)) findings.push({ a, src, kind: `role:${name}` });
        } catch { findings.push({ a, src, kind: `PROBE FAILED (hasRole ${name})` }); }
      }
    }
    if (await call(p, a, "isPusher", [WHO])) findings.push({ a, src, kind: "isPusher" });
    const bal = await call(p, a, "balanceOf", [WHO]);
    if (bal && bal > 0n) {
      const dec = (await call(p, a, "decimals")) ?? 0n;
      const sym = (await call(p, a, "symbol")) ?? "?";
      findings.push({ a, src, kind: `balance ${ethers.formatUnits(bal, dec)} ${sym}`, balance: bal, symbol: sym, decimals: Number(dec) });
    }
  });
  const native = await retry(() => p.getBalance(WHO)).catch(() => undefined);
  p.destroy();
  return { network, chainId, scanned: addrs.length, withCode, controlHits, findings, native, transportErrors };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  console.log(`survey of ${WHO} (control: owner()==${CONTROL} hits)`);
  for (const [net, cfg] of Object.entries(TESTNETS)) {
    if (only && String(cfg[0]) !== only) continue;
    const r = await surveyChain(net, cfg);
    console.log(`\n== ${net} (${r.chainId}): ${r.scanned} addresses, ${r.withCode} with code; control owner hits ${r.controlHits}; transport errors ${r.transportErrors}; native ${r.native === undefined ? "?" : ethers.formatEther(r.native)}`);
    for (const f of r.findings.sort((x, y) => x.src.localeCompare(y.src))) console.log(`  ${f.a}  ${f.kind.padEnd(28)} ${f.src}`);
    if (!r.findings.length) console.log("  (nothing)");
    // SURVEY_JSON=dir writes one machine-readable file per chain for migrate-leaked-key.
    if (process.env.SURVEY_JSON) {
      fs.mkdirSync(process.env.SURVEY_JSON, { recursive: true });
      fs.writeFileSync(path.join(process.env.SURVEY_JSON, `survey-${net}.json`),
        JSON.stringify({ ...r, who: WHO, at: new Date().toISOString() }, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
    }
  }
}
