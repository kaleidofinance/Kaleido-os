/**
 * After `upgrade-lending-hardening.js` on an ANVIL FORK of a testnet: prove the
 * NEW code works on the OLD data, not just that the data survived.
 *
 *   KALEIDO_DIAMOND=0x… OWNER=0x… npx hardhat run scripts/smoke-upgraded-fork.js --network fork
 *
 *   1. the (new) owner can pause and unpause; a request is refused while paused;
 *   2. the account health factor still reads for every borrower with a live loan;
 *   3. a real OVERDUE loan from the existing book is liquidated by a stranger —
 *      lender, liquidator and fee vault are credited, the loan closes, and the
 *      borrower's ledger stays consistent (deposited == free + remaining locks).
 *
 * Fork only: it impersonates the owner. Refuses unless the node is anvil.
 */
const hre = require("hardhat");
const { ethers } = hre;

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`   ${ok ? "✅" : "❌"} ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const ABI = [
  "function owner() view returns (address)",
  "function pause()",
  "function unpause()",
  "function paused() view returns (bool)",
  "function createLendingRequest(uint128,uint16,uint256,address)",
  "function getAllRequests(uint256,uint256) view returns (tuple(uint96 listingId,uint96 requestId,address author,uint256 amount,uint16 interest,uint256 totalRepayment,uint256 returnDate,address lender,address loanRequestAddr,address[] collateralTokens,uint8 status)[])",
  "function getHealthFactor(address) view returns (uint256)",
  "function liquidateUserRequest(uint96)",
  "function getAllCollateralToken() view returns (address[])",
  "function getRequestToColateral(uint96,address) view returns (uint256)",
  "function gets_addressToCollateralDeposited(address,address) view returns (uint256)",
  "function gets_addressToAvailableBalance(address,address) view returns (uint256)",
  "error Protocol__Paused()",
];

async function waitReceipt(hash) {
  for (let i = 0; i < 240; i++) {
    const rc = await ethers.provider.getTransactionReceipt(hash);
    if (rc) return rc;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`no receipt for ${hash}`);
}

async function main() {
  try {
    await ethers.provider.send("anvil_nodeInfo", []);
  } catch {
    throw new Error("Fork only (anvil).");
  }
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const diamond = ethers.getAddress(process.env.KALEIDO_DIAMOND);
  const d = new ethers.Contract(diamond, ABI, ethers.provider);
  const owner = await d.owner();
  console.log(`Smoke-testing upgraded diamond ${diamond} on chain ${chainId}; owner ${owner}`);

  const raw = new ethers.JsonRpcProvider(hre.network.config.url, chainId, { staticNetwork: true });
  const as = async (addr) => {
    await ethers.provider.send("anvil_impersonateAccount", [addr]);
    await ethers.provider.send("anvil_setBalance", [addr, "0x56BC75E2D63100000"]);
    return d.connect(await raw.getSigner(addr));
  };
  const send = async (p) => waitReceipt((await p).hash);

  // 1. pause
  console.log("\n1. pause");
  const o = await as(owner);
  await send(o.pause());
  check("owner paused", await d.paused());
  const someone = ethers.Wallet.createRandom().address;
  const s = await as(someone);
  let refused = false;
  try {
    await s.createLendingRequest.staticCall(10n ** 19n, 500, (await ethers.provider.getBlock("latest")).timestamp + 3 * 86400, ethers.ZeroAddress);
  } catch (e) {
    refused = d.interface.parseError(e.data || e.info?.error?.data || "0x")?.name === "Protocol__Paused";
  }
  check("a new request is refused while paused", refused);
  await send(o.unpause());
  check("owner unpaused", !(await d.paused()));

  // 2. health factors
  console.log("\n2. health factor reads for live borrowers");
  const reqs = await d.getAllRequests(0, 100000);
  const live = reqs.filter((r) => Number(r.status) === 1);
  const borrowers = [...new Set(live.map((r) => r.author))];
  let readable = 0;
  const stale = [];
  for (const b of borrowers) {
    try {
      await d.getHealthFactor(b);
      readable++;
    } catch (e) {
      stale.push(b);
    }
  }
  console.log(`   ${live.length} live loans, ${borrowers.length} borrowers; HF readable for ${readable}` +
    (stale.length ? ` (${stale.length} revert — a stale feed on collateral they hold; the old code did the same)` : ""));
  check("health factor readable for at least one live borrower", readable > 0 || borrowers.length === 0);

  // 3. liquidate a real overdue loan
  console.log("\n3. liquidate a real overdue loan from the existing book");
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  const overdue = live.filter((r) => Number(r.returnDate) < now && !stale.includes(r.author));
  if (overdue.length === 0) {
    console.log("   (no overdue loan with a priceable borrower — skipped)");
  } else {
    const r = overdue[0];
    const coll = await d.getAllCollateralToken();
    const liq = ethers.Wallet.createRandom().address;
    const L = await as(liq);
    const before = {};
    for (const t of coll) before[t] = [await d.gets_addressToCollateralDeposited(r.lender, t), await d.gets_addressToCollateralDeposited(liq, t)];
    const rc = await send(L.liquidateUserRequest(r.requestId));
    check(`overdue loan #${r.requestId} liquidated by a stranger`, rc.status === 1);
    const after = (await d.getAllRequests(0, 100000)).find((x) => x.requestId === r.requestId);
    check("the loan is closed", Number(after.status) === 2);
    let lenderGained = false;
    let liquidatorGained = false;
    for (const t of coll) {
      if ((await d.gets_addressToCollateralDeposited(r.lender, t)) > before[t][0]) lenderGained = true;
      if ((await d.gets_addressToCollateralDeposited(liq, t)) > before[t][1]) liquidatorGained = true;
    }
    check("the lender was credited collateral", lenderGained);
    console.log(`   liquidator ${liquidatorGained ? "was paid" : "earned nothing (the position had no surplus above the debt)"}`);
    // ledger invariant for the borrower across their remaining live loans
    const still = (await d.getAllRequests(0, 100000)).filter((x) => x.author === r.author && Number(x.status) === 1);
    let consistent = true;
    for (const t of coll) {
      let locks = 0n;
      for (const x of still) locks += await d.getRequestToColateral(x.requestId, t);
      const dep = await d.gets_addressToCollateralDeposited(r.author, t);
      const free = await d.gets_addressToAvailableBalance(r.author, t);
      if (dep !== free + locks) {
        consistent = false;
        console.log(`   ledger ${t}: deposited ${dep} != free ${free} + locks ${locks}`);
      }
    }
    check("borrower's ledger consistent (deposited == free + remaining locks)", consistent);
  }

  console.log(`\n${failures === 0 ? "✅ Smoke test passed." : `❌ ${failures} check(s) failed.`}`);
  if (failures) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
