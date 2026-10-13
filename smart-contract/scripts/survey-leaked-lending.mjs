// Read-only: what a given address has INSIDE each testnet lending diamond — ledger
// balances (deposited / available) per registered token, requests it borrowed, requests
// it funded, and open listings it authored. Those balances can only be withdrawn by
// that address, so a role/ownership migration does not move them.
//
//   node scripts/survey-leaked-lending.mjs [address]
import { ethers } from "ethers";
import fs from "fs";

const WHO = ethers.getAddress(process.argv[2] || "0x28b7b3dc96e5b2C6047D7Ad9b05Fd9E2FC7E8955");
const DIAMONDS = [
  ["sepolia", 11155111, "https://ethereum-sepolia-rpc.publicnode.com", "0x32a9971381C969d15205AC9e509C204D31341080"],
  ["baseTestnet", 84532, "https://sepolia.base.org", "0x1e2BeA8a1958088b50eC9410F7870a2C254e43E4"],
  ["bscTestnet", 97, "https://bsc-testnet-rpc.publicnode.com", "0x2E7dd52073d6653F610607dA9B947ba59B585bf8"],
  ["robinhoodTestnet", 46630, "https://rpc.testnet.chain.robinhood.com", "0x3565904975AE169c0a48af085b9f786660875874"],
  ["arcTestnet", 5042002, "https://rpc.testnet.arc.network", "0x90a1620578CE419242F806e7387Db7e70c8cfa96"],
];
// The compiled facet ABI, so struct layouts cannot drift from a hand-written copy.
const abi = JSON.parse(fs.readFileSync(new URL("../artifacts/contracts/facets/ProtocolFacet.sol/ProtocolFacet.json", import.meta.url), "utf8")).abi;

async function retry(fn) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      if (e?.code === "CALL_EXCEPTION" || i >= 4) throw e;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
}

for (const [net, id, url, addr] of DIAMONDS) {
  const p = new ethers.JsonRpcProvider(url, id, { staticNetwork: true });
  const d = new ethers.Contract(addr, abi, p);
  const out = [];
  const tokens = [...new Set([...(await retry(() => d.getAllCollateralToken())), ...(await retry(() => d.getLoanableAssets()))])];
  for (const t of tokens) {
    const dep = await retry(() => d.gets_addressToCollateralDeposited(WHO, t));
    const av = await retry(() => d.gets_addressToAvailableBalance(WHO, t));
    if (dep > 0n || av > 0n) out.push(`ledger ${t}: deposited ${dep} available ${av}`);
  }
  const nL = Number(await retry(() => d.getListingId()));
  for (let i = 1; i <= nL; i++) {
    try {
      const l = await retry(() => d.getLoanListing(i));
      if (l.author === WHO) out.push(`listing #${i} token ${l.tokenAddress} amount ${l.amount} status ${l.listingStatus}`);
    } catch { /* gap */ }
  }
  const nR = Number(await retry(() => d.getRequestId()));
  for (let i = 1; i <= nR; i++) {
    try {
      const r = await retry(() => d.getRequest(i));
      if (r.author === WHO) out.push(`request #${i} BORROWER amount ${r.amount} status ${r.status}`);
      if (r.lender === WHO) out.push(`request #${i} LENDER amount ${r.amount} status ${r.status}`);
    } catch { /* gap */ }
  }
  console.log(`== ${net}: ${tokens.length} tokens, ${nL} listings, ${nR} requests scanned`);
  for (const o of out) console.log("  " + o);
  if (!out.length) console.log("  (nothing)");
  p.destroy();
}
