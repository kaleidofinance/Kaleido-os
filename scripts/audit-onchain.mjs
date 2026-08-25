/**
 * Which of the hardcoded addresses the UI reads actually have code on chain?
 *
 * `DEPLOYMENTS` in registry.ts is empty, so `isDeployed()` is false everywhere —
 * but only `trade/agent/page.tsx` consults it. Every other page reads a
 * hardcoded constant from `constants/utils/addresses.ts` and calls it directly.
 * So "nothing is deployed" is true of the registry and not necessarily true of
 * the chain, and the difference decides whether a page renders real figures,
 * renders `—`, or throws.
 *
 * eth_getCode is the only answer that isn't a guess. Read-only, public endpoint.
 * Run: node scripts/audit-onchain.mjs
 */
const RPC = process.env.NEXT_PUBLIC_HTTP_RPC || "https://api.testnet.abs.xyz";

const ADDRESSES = {
  USDC: "0x572f4901f03055ffC1D936a60Ccc3CbF13911BE3",
  USDT: "0x717A36E56b33585Bd00260422FfCc3270af34D3E",
  USDR: "0x769EBD1dc2470186f0a4911113754DfD13f2CDA3",
  LINK: "0xE4aB69C077896252FAFBD49EFD26B5D171A32410",
  WETH: "0x618B1561b189972482168fd31f5B5a3B5A10Ce33",
  KLD: "0x0c61dbCF1e8DdFF0E237a256257260fDF6934505",
  stKLD: "0x4BC3d728c466bF0e919b57d6B3a6f7594858187B",
  kfUSD: "0x913f3354942366809A05e89D288cCE60d87d7348",
  "KLD Vault": "0xf77AA35D04F36372cA7af18532A23eaB7e68380E",
  "Yield Treasury": "0xcB3D0069Cf6d6dfBB8E7Dee564DbE39eFa9c582d",
  "V2 Factory": "0x0960d0CFE3AaB7Bb7d0718d41A9d949Ab37F4063",
  "V2 Router": "0x3032eE3C14caed0E58e91A92CaBffba7AC89A0e9",
  MasterChef: "0x6E5dA192512E58eb13dEF6815f4E46Ac58172eFE",
  "V3 Factory": "0xC75161E02E4599f1E68c4E9ea5bab001186D512B",
  "V3 Router": "0x4b0c483064e1cE959CFCBb151B5043454D3cb2AC",
  "V3 PositionManager": "0xB236a5D157993129a2516Caff967b95bec3B74D5",
  "V3 Quoter": "0x1D3419ca1cf81Be19Bd5C04fdBB504E6ED931F7c",
};

const rpc = async (method, params) => {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
};

const main = async () => {
  console.log(`RPC: ${RPC}`);
  const chainId = await rpc("eth_chainId", []);
  const block = await rpc("eth_blockNumber", []);
  console.log(
    `chainId: ${parseInt(chainId, 16)}   head block: ${parseInt(block, 16)}\n`,
  );

  const rows = [];
  for (const [name, addr] of Object.entries(ADDRESSES)) {
    let code, status;
    try {
      code = await rpc("eth_getCode", [addr, "latest"]);
      // "0x" (or "0x0") means the address holds no contract. Anything longer is
      // deployed bytecode; its length is a rough sanity check that it is a real
      // contract and not a stub.
      const bytes = code && code !== "0x" && code !== "0x0" ? (code.length - 2) / 2 : 0;
      status = bytes > 0 ? `LIVE  (${bytes} bytes)` : "NO CODE";
    } catch (e) {
      status = `RPC ERROR: ${e.message}`;
    }
    rows.push([name, addr, status]);
  }

  const w = Math.max(...rows.map((r) => r[0].length));
  for (const [name, addr, status] of rows) {
    console.log(`${name.padEnd(w)}  ${addr}  ${status}`);
  }

  const live = rows.filter((r) => r[2].startsWith("LIVE")).length;
  console.log(`\n${live}/${rows.length} addresses have code.`);
};

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
