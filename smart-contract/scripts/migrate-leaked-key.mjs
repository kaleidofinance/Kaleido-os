// Move everything the leaked testnet deployer still controls to the current deployer.
//
// Driven by scripts/survey-leaked-key.mjs output (SURVEY_JSON), not a hand list: every
// finding becomes an action, and every action re-checks the chain right before it runs
// (so a re-run after a partial failure only does what is left). Order:
//
//   1. oracle     lending priceOracle, then self-hosted feeds (pusher revoked, then owner)
//   2. owners     Ownable transferOwnership / V3 setOwner / V2 setFeeToSetter
//   3. roles      per contract: grant every held role to NEW, renounce the rest, admin last
//   4. ledger     withdraw the leaked key's free balance out of the lending diamond
//   5. positions  V3 LP position NFTs
//   6. tokens     every ERC20 balance (re-read at send time)
//   7. native     sweep the gas top-up back
//
// Fails closed: an estimate revert, a reverted receipt or a failed post-check stops the run.
//
//   NETWORK=sepolia SURVEY_DIR=… [FORK=1 RPC_URL=http://127.0.0.1:8545] [DRY_RUN=1] \
//   [LEAK_KEY_FILE=…] node scripts/migrate-leaked-key.mjs
//
// FORK=1 impersonates both keys on an anvil fork. On a real network the leaked key signs
// from LEAK_KEY_FILE (never printed) and the new owner (smart-contract/.env
// DEPLOYER_PRIVATE_KEY) pays the gas top-up and accepts any two-step ownership.
import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { TESTNETS } from "./survey-leaked-key.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LEAK = "0x28b7b3dc96e5b2C6047D7Ad9b05Fd9E2FC7E8955";
const NEW = ethers.getAddress(process.env.NEW_OWNER || "0x0Ce7f8Aeaad60b9E19ACBe9803518182adC351Bc");
const KEEPER = "0xB37d079F6AccE50332043cf20e1f4FFD363799aE"; // must stay a pusher
const NATIVE_ALIAS = { 5042002: ["0x3600000000000000000000000000000000000000"] };

const NETWORK = process.env.NETWORK;
if (!TESTNETS[NETWORK]) throw new Error(`NETWORK must be one of ${Object.keys(TESTNETS).join(", ")}`);
const [CHAIN_ID, DEFAULT_RPC] = TESTNETS[NETWORK];
const FORK = process.env.FORK === "1";
const DRY = process.env.DRY_RUN === "1";
const RPC = process.env.RPC_URL || DEFAULT_RPC;
if (FORK && !/127\.0\.0\.1|localhost/.test(RPC)) throw new Error("FORK=1 needs a local RPC_URL");

const survey = JSON.parse(fs.readFileSync(path.join(process.env.SURVEY_DIR, `survey-${NETWORK}.json`), "utf8"));
if (survey.who !== LEAK) throw new Error("survey is not of the leaked key");
if (survey.transportErrors) throw new Error("survey had transport errors — re-run it before trusting it");
if (survey.findings.some((f) => f.kind.startsWith("PROBE FAILED"))) throw new Error("survey has failed probes");

const diamondRecord = JSON.parse(fs.readFileSync(path.join(ROOT, `deployment-diamond-${NETWORK}.json`), "utf8"));
const DIAMOND = ethers.getAddress(diamondRecord.contracts.Diamond || diamondRecord.contracts.diamond);
const PRICE_ORACLE = ethers.getAddress(diamondRecord.contracts.priceOracle);

const I = new ethers.Interface([
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
  "function transferOwnership(address)",
  "function acceptOwnership()",
  "function setOwner(address)",
  "function feeToSetter() view returns (address)",
  "function setFeeToSetter(address)",
  "function isPusher(address) view returns (bool)",
  "function setPusher(address,bool)",
  "function hasRole(bytes32,address) view returns (bool)",
  "function grantRole(bytes32,address)",
  "function renounceRole(bytes32,address)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
  "function supportsInterface(bytes4) view returns (bool)",
  "function tokenOfOwnerByIndex(address,uint256) view returns (uint256)",
  "function ownerOf(uint256) view returns (address)",
  "function transferFrom(address,address,uint256)",
  "function getAllCollateralToken() view returns (address[])",
  "function getLoanableAssets() view returns (address[])",
  "function gets_addressToAvailableBalance(address,address) view returns (uint256)",
  "function withdrawCollateral(address,uint128)",
]);
const ROLE_HASH = (name) => (name === "DEFAULT_ADMIN_ROLE" ? ethers.ZeroHash : ethers.id(name));

const provider = new ethers.JsonRpcProvider(RPC, CHAIN_ID, { staticNetwork: true });
async function retry(fn) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      if (e?.code === "CALL_EXCEPTION" || /revert/i.test(e?.shortMessage || e?.message || "") || i >= 5) throw e;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
}
const read = async (to, fn, args = []) =>
  I.decodeFunctionResult(fn, await retry(() => provider.call({ to, data: I.encodeFunctionData(fn, args) })))[0];
const tryRead = async (to, fn, args = []) => { try { return await read(to, fn, args); } catch { return undefined; } };
const simulate = async (from, to, data) => { try { await provider.call({ from, to, data }); return true; } catch { return false; } };

// ---------------------------------------------------------------- signers
let leakWallet, newWallet;
if (FORK) {
  await provider.send("anvil_impersonateAccount", [LEAK]);
  await provider.send("anvil_impersonateAccount", [NEW]);
} else if (!DRY) {
  leakWallet = new ethers.Wallet(fs.readFileSync(process.env.LEAK_KEY_FILE, "utf8").trim(), provider);
  if (leakWallet.address !== LEAK) throw new Error("LEAK_KEY_FILE does not hold the leaked key");
  const env = dotenv.parse(fs.readFileSync(path.join(ROOT, ".env")));
  newWallet = new ethers.Wallet(env.DEPLOYER_PRIVATE_KEY, provider);
  if (newWallet.address !== NEW) throw new Error("DEPLOYER_PRIVATE_KEY is not NEW_OWNER");
}

async function fees() {
  const f = await retry(() => provider.getFeeData());
  return f.maxFeePerGas
    ? { maxFeePerGas: f.maxFeePerGas * 2n, maxPriorityFeePerGas: f.maxPriorityFeePerGas ?? 0n }
    : { gasPrice: f.gasPrice * 2n };
}

async function waitReceipt(hash) {
  for (let i = 0; i < 300; i++) {
    const r = await provider.getTransactionReceipt(hash).catch(() => null);
    if (r) return r;
    await new Promise((res) => setTimeout(res, 2000));
  }
  throw new Error(`no receipt for ${hash} after 10 min`);
}

// Send one tx; fails closed. The hash is derived from the signed bytes before broadcast,
// so a transport error that still landed is found by polling instead of re-sent.
// `fixed` pins gasLimit + fee fields (the native sweep sizes its value from them).
async function send(who, to, data, value = 0n, fixed) {
  const from = who === "leak" ? LEAK : NEW;
  const gasLimit = fixed?.gasLimit ?? ((await provider.estimateGas({ from, to, data, value })) * 13n) / 10n + 10_000n; // estimate throws on revert
  let hash;
  if (FORK) {
    hash = await provider.send("eth_sendTransaction", [{ from, to, data, value: ethers.toQuantity(value), gas: ethers.toQuantity(gasLimit) }]);
  } else {
    const wallet = who === "leak" ? leakWallet : newWallet;
    const nonce = await retry(() => provider.getTransactionCount(from, "pending"));
    const signed = await wallet.signTransaction({ to, data, value, nonce, gasLimit, chainId: CHAIN_ID, ...(fixed?.fees ?? (await fees())) });
    hash = ethers.keccak256(signed);
    try { await provider.send("eth_sendRawTransaction", [signed]); } catch (e) {
      const msg = e?.shortMessage || e?.message || "";
      if (!/already known|nonce too low|timeout|ECONN|fetch|429|network/i.test(msg)) throw e;
      console.log(`    broadcast said "${msg.slice(0, 80)}" — polling ${hash}`);
    }
  }
  const r = await waitReceipt(hash);
  if (r.status !== 1) throw new Error(`reverted: ${hash}`);
  return { hash, gasUsed: r.gasUsed };
}

// ---------------------------------------------------------------- plan
const byAddr = new Map();
for (const f of survey.findings) {
  const a = ethers.getAddress(f.a);
  if (!byAddr.has(a)) byAddr.set(a, []);
  byAddr.get(a).push(f);
}
const kinds = (a) => (byAddr.get(a) || []).map((f) => f.kind);

const steps = []; // { phase, label, who, to, data(), needed(), check() }
const report = []; // things the script cannot move, reported instead
const phaseOf = { oracle: 1, owners: 2, roles: 3, ledger: 4, positions: 5, tokens: 6 };

async function ownershipSteps(a, phase, src) {
  const viaTransfer = await simulate(LEAK, a, I.encodeFunctionData("transferOwnership", [NEW]));
  const viaSetOwner = !viaTransfer && (await simulate(LEAK, a, I.encodeFunctionData("setOwner", [NEW])));
  if (!viaTransfer && !viaSetOwner) { report.push(`${a} (${src}): owner is the leaked key but neither transferOwnership nor setOwner succeeds in simulation`); return; }
  const fn = viaTransfer ? "transferOwnership" : "setOwner";
  steps.push({
    phase, label: `${fn}(NEW) on ${a} [${src}]`, who: "leak", to: a,
    data: () => I.encodeFunctionData(fn, [NEW]),
    needed: async () => (await read(a, "owner")) === LEAK && (await tryRead(a, "pendingOwner")) !== NEW,
    check: async () => (await read(a, "owner")) === NEW || (await tryRead(a, "pendingOwner")) === NEW,
  });
  // Two-step contracts only nominate; NEW accepts.
  steps.push({
    phase, label: `acceptOwnership() on ${a} (only if two-step)`, who: "new", to: a,
    data: () => I.encodeFunctionData("acceptOwnership"),
    needed: async () => (await read(a, "owner")) !== NEW && (await tryRead(a, "pendingOwner")) === NEW,
    check: async () => (await read(a, "owner")) === NEW,
  });
}

// 1. oracle: the lending priceOracle first, then the self-hosted feeds.
const oracleTargets = [...byAddr.keys()].filter((a) => a === PRICE_ORACLE || kinds(a).includes("isPusher"));
oracleTargets.sort((x, y) => (x === PRICE_ORACLE ? -1 : y === PRICE_ORACLE ? 1 : 0));
for (const a of oracleTargets) {
  const src = byAddr.get(a)[0].src;
  if (kinds(a).includes("isPusher")) {
    if (!(await tryRead(a, "isPusher", [KEEPER]))) report.push(`${a}: keeper ${KEEPER} is NOT a pusher — revoking the leaked key leaves only the owner able to push`);
    steps.push({
      phase: 1, label: `setPusher(LEAK,false) on feed ${a}`, who: "leak", to: a,
      data: () => I.encodeFunctionData("setPusher", [LEAK, false]),
      needed: async () => (await read(a, "isPusher", [LEAK])) && (await read(a, "owner")) === LEAK,
      check: async () => !(await read(a, "isPusher", [LEAK])),
    });
  }
  if (kinds(a).includes("owner")) await ownershipSteps(a, 1, src);
}

// 2. owners and the V2 fee setter.
for (const [a, fs_] of byAddr) {
  if (oracleTargets.includes(a)) continue;
  const src = fs_[0].src;
  // Fee sinks first: their setters are owner-gated, so they must run while LEAK still owns.
  for (const k of kinds(a).filter((x) => ["feeTo", "feeRecipient", "feeReceiver", "treasury"].includes(x))) {
    const setter = `set${k[0].toUpperCase()}${k.slice(1)}`;
    const si = new ethers.Interface([`function ${setter}(address)`, `function ${k}() view returns (address)`]);
    if (!(await simulate(LEAK, a, si.encodeFunctionData(setter, [NEW])))) { report.push(`${a} (${src}): leaked key is ${k} and ${setter}(NEW) does not simulate`); continue; }
    const cur = async () => si.decodeFunctionResult(k, await retry(() => provider.call({ to: a, data: si.encodeFunctionData(k) })))[0];
    steps.push({
      phase: 2, label: `${setter}(NEW) on ${a} [${src}]`, who: "leak", to: a,
      data: () => si.encodeFunctionData(setter, [NEW]),
      needed: async () => (await cur()) === LEAK,
      check: async () => (await cur()) === NEW,
    });
  }
  if (kinds(a).includes("owner")) await ownershipSteps(a, 2, src);
  if (kinds(a).includes("feeToSetter")) steps.push({
    phase: 2, label: `setFeeToSetter(NEW) on V2 factory ${a}`, who: "leak", to: a,
    data: () => I.encodeFunctionData("setFeeToSetter", [NEW]),
    needed: async () => (await read(a, "feeToSetter")) === LEAK,
    check: async () => (await read(a, "feeToSetter")) === NEW,
  });
  for (const k of kinds(a)) {
    if (["pendingOwner", "keeper", "admin", "guardian", "operator"].includes(k))
      report.push(`${a} (${src}): leaked key is ${k} — no generic handover, handle by hand`);
  }
}

// 3. roles: grant all to NEW, then renounce non-admin, admin last — per contract.
for (const [a, fs_] of byAddr) {
  const roles = kinds(a).filter((k) => k.startsWith("role:")).map((k) => k.slice(5));
  if (!roles.length) continue;
  const src = fs_[0].src;
  const ordered = [...roles.filter((r) => r !== "DEFAULT_ADMIN_ROLE"), ...roles.filter((r) => r === "DEFAULT_ADMIN_ROLE")];
  for (const r of ordered) {
    const h = ROLE_HASH(r);
    // KLD refuses KLD_MINTER_ROLE off its home chain; that grant is skipped, not faked.
    if (!(await simulate(LEAK, a, I.encodeFunctionData("grantRole", [h, NEW]))) && !(await tryRead(a, "hasRole", [h, NEW]))) {
      report.push(`${a} (${src}): grantRole(${r}, NEW) does not simulate — the role is renounced without a replacement`);
      continue;
    }
    steps.push({
      phase: 3, label: `grantRole(${r}, NEW) on ${a} [${src}]`, who: "leak", to: a,
      data: () => I.encodeFunctionData("grantRole", [h, NEW]),
      needed: async () => !(await read(a, "hasRole", [h, NEW])),
      check: async () => read(a, "hasRole", [h, NEW]),
    });
  }
  for (const r of ordered) {
    const h = ROLE_HASH(r);
    steps.push({
      phase: 3, label: `renounceRole(${r}) by LEAK on ${a}`, who: "leak", to: a,
      data: () => I.encodeFunctionData("renounceRole", [h, LEAK]),
      // Never drop the admin before NEW holds it.
      needed: async () => (await read(a, "hasRole", [h, LEAK])) &&
        (r !== "DEFAULT_ADMIN_ROLE" || (await read(a, "hasRole", [ethers.ZeroHash, NEW]))),
      check: async () => !(await read(a, "hasRole", [h, LEAK])),
    });
  }
}

// 4. lending ledger: free balance the leaked key could still withdraw.
const ledgerTokens = [...new Set([...(await read(DIAMOND, "getAllCollateralToken")), ...(await read(DIAMOND, "getLoanableAssets"))])];
for (const t of ledgerTokens) {
  const avail = await read(DIAMOND, "gets_addressToAvailableBalance", [LEAK, t]);
  if (avail === 0n) continue;
  steps.push({
    phase: 4, label: `withdrawCollateral(${t}, ${avail}) from diamond ${DIAMOND}`, who: "leak", to: DIAMOND,
    data: async () => I.encodeFunctionData("withdrawCollateral", [t, await read(DIAMOND, "gets_addressToAvailableBalance", [LEAK, t])]),
    needed: async () => (await read(DIAMOND, "gets_addressToAvailableBalance", [LEAK, t])) > 0n,
    check: async () => (await read(DIAMOND, "gets_addressToAvailableBalance", [LEAK, t])) === 0n,
  });
  if (t !== "0x0000000000000000000000000000000000000001" && !byAddr.has(ethers.getAddress(t))) byAddr.set(ethers.getAddress(t), [{ a: t, src: "diamond ledger", kind: "balance (from ledger)" }]);
}

// 5 + 6. positions and tokens.
const isBalance = (a) => kinds(a).some((k) => k.startsWith("balance"));
for (const a of byAddr.keys()) {
  if (!isBalance(a)) continue;
  if ((NATIVE_ALIAS[CHAIN_ID] || []).includes(a)) continue; // mirrors native; swept as native
  const src = byAddr.get(a)[0].src;
  if (await tryRead(a, "supportsInterface", ["0x80ac58cd"])) {
    const n = Number(await read(a, "balanceOf", [LEAK]));
    const ids = [];
    for (let i = 0; i < n; i++) ids.push(await read(a, "tokenOfOwnerByIndex", [LEAK, i]));
    for (const id of ids) steps.push({
      phase: 5, label: `transferFrom(LEAK, NEW, #${id}) on ${a} [${src}]`, who: "leak", to: a,
      data: () => I.encodeFunctionData("transferFrom", [LEAK, NEW, id]),
      needed: async () => (await read(a, "ownerOf", [id])) === LEAK,
      check: async () => (await read(a, "ownerOf", [id])) === NEW,
    });
    continue;
  }
  steps.push({
    phase: 6, label: `transfer(NEW, all) of ${a} [${src}]`, who: "leak", to: a,
    data: async () => I.encodeFunctionData("transfer", [NEW, await read(a, "balanceOf", [LEAK])]),
    needed: async () => (await read(a, "balanceOf", [LEAK])) > 0n,
    check: async () => (await read(a, "balanceOf", [LEAK])) === 0n,
  });
}
steps.sort((x, y) => x.phase - y.phase); // stable: keeps grant-before-renounce order

// ---------------------------------------------------------------- run
console.log(`${NETWORK} (${CHAIN_ID}) ${FORK ? "FORK" : DRY ? "DRY RUN" : "LIVE"} — diamond ${DIAMOND}, oracle ${PRICE_ORACLE}`);
console.log(`plan: ${steps.length} steps (${Object.entries(phaseOf).map(([k, v]) => `${k} ${steps.filter((s) => s.phase === v).length}`).join(", ")})`);
for (const r of report) console.log(`  REPORT: ${r}`);

if (DRY) {
  for (const s of steps) console.log(`  [${s.phase}] ${s.label}`);
  process.exit(0);
}

// Gas: top up the leaked key for the whole plan, sweep the rest back at the end.
const leakSteps = steps.filter((s) => s.who === "leak").length;
const f = await fees();
const perGas = f.maxFeePerGas ?? f.gasPrice;
const budget = BigInt(leakSteps) * 250_000n * perGas + ethers.parseEther(CHAIN_ID === 84532 ? "0.001" : "0");
const have = await provider.getBalance(LEAK);
if (have < budget) {
  if (FORK) await provider.send("anvil_setBalance", [LEAK, ethers.toQuantity(budget)]);
  else {
    const r = await send("new", LEAK, "0x", budget - have);
    console.log(`  gas top-up ${ethers.formatEther(budget - have)} → LEAK (${r.hash})`);
  }
}
if (FORK) await provider.send("anvil_setBalance", [NEW, ethers.toQuantity(ethers.parseEther("10"))]);

let done = 0, skipped = 0;
for (const s of steps) {
  if (!(await s.needed())) { skipped++; continue; }
  const data = await s.data();
  try {
    const r = await send(s.who, s.to, data);
    done++;
    console.log(`  [${s.phase}] ok  ${s.label}  (${r.hash})`);
  } catch (e) {
    console.log(`  [${s.phase}] FAILED ${s.label}: ${e.shortMessage || e.message}`);
    process.exit(1);
  }
  // Public endpoints lag the receipt (Base Sepolia read the old owner right after a
  // landed transfer), so a post-check re-reads for ~30s before it fails the run.
  let ok = false;
  for (let i = 0; i < 10 && !(ok = await s.check()); i++) await new Promise((r) => setTimeout(r, 3000));
  if (!ok) { console.log(`  [${s.phase}] POST-CHECK FAILED ${s.label}`); process.exit(1); }
}

// 7. native sweep back.
const left = await provider.getBalance(LEAK);
// Estimated, not 21,000: Orbit chains (Robinhood) charge L1 calldata inside gas.
const gasLimit = ((await provider.estimateGas({ from: LEAK, to: NEW, value: 1n })) * 12n) / 10n;
const g = await fees();
const reserve = gasLimit * (g.maxFeePerGas ?? g.gasPrice) + (CHAIN_ID === 84532 ? ethers.parseEther("0.0005") : 0n);
if (left > reserve) {
  const r = await send("leak", NEW, "0x", left - reserve, { gasLimit, fees: g });
  console.log(`  [7] ok  swept ${ethers.formatEther(left - reserve)} native → NEW (${r.hash})`);
}

// Final: every planned target re-checked.
let bad = 0;
for (const s of steps) if (!(await s.check())) { bad++; console.log(`  FINAL CHECK FAILED ${s.label}`); }
console.log(`done ${done}, already-done ${skipped}, final checks failed ${bad}, reported ${report.length}; LEAK native left ${ethers.formatEther(await provider.getBalance(LEAK))}`);
process.exit(bad ? 1 : 0);
