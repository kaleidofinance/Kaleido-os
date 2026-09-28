/**
 * Rehearse real user flows against a lending diamond on a LOCAL ANVIL FORK of
 * Arc mainnet — with the real EURC, cirBTC and Chainlink contracts — or of Arc
 * testnet (5042002), with Circle's testnet EURC / cirBTC and our own
 * PushablePriceFeeds (the parity deploy; Chainlink has no Arc testnet feeds).
 *
 *   anvil --fork-url https://rpc.mainnet.arc.io --chain-id 5042
 *   (then the runbook: deploy-oracle → deploy → register-tokens, all --network arcFork)
 *   npx hardhat run scripts/rehearse-lending-fork.js --network arcFork
 *
 *   anvil --fork-url https://rpc.testnet.arc.network        (chain id 5042002)
 *   (deploy-pushable-feeds → the same runbook, all --network fork)
 *   npx hardhat run scripts/rehearse-lending-fork.js --network fork
 *
 * FORK ONLY, and it checks: it writes token balances straight into storage and
 * re-points an oracle feed to a mock, which is meaningless (and impossible) on a
 * real chain. It refuses to run unless the network is `arcFork` or `fork` AND the
 * node answers `anvil_nodeInfo`, which no public RPC does.
 *
 * Flows, each asserted, not just printed:
 *   A. deposit EURC → request 10.5 USDC → a lender services it → repay in full:
 *      the fee is exactly 5% of the interest and reaches the fee vault; the lender
 *      is credited on the ledger and withdraws it in native USDC → the borrower
 *      withdraws their collateral.
 *   B. pause: a new request is refused; a collateral top-up and a repayment of an
 *      open loan still go through; unpause restores requests.
 *   C1. liquidation, normal case: collateral ≈ what the loan locks, BTC/USD −10%
 *      (via a mock feed): the health factor breaks while the locked collateral is
 *      still worth more than the debt, so lender, liquidator and fee vault are all
 *      paid.
 *   C2. liquidation, over-collateralised borrower, BTC/USD −50%: the loan's own
 *      lock falls short, so the rest comes from the borrower's FREE collateral —
 *      the lender is made whole against the full amount owed, and liquidator and
 *      fee vault are paid. (Before the 2026-09-28 fix the lender got ≈ 67% and
 *      the liquidator nothing.)
 *   D. two-step ownership: nominate → nothing changes → accept → hand back.
 *   E. a plain USDC transfer to the diamond and a native-USDC collateral deposit
 *      are both refused.
 */
const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");

const NATIVE = "0x0000000000000000000000000000000000000001";
const BTC_ID = "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";
const FEE_VAULT = "0x0Ce7f8Aeaad60b9E19ACBe9803518182adC351Bc";
/* Per chain. `btcFeed` is the real BTC/USD aggregator to restore after a mock;
   null means "whatever the oracle points at when the rehearsal starts" (our own
   PushablePriceFeed on testnet). Holders are used only to FIND each token's
   balance-mapping slot, so any address with a non-zero balance will do. */
const CHAINS = {
  5042: {
    eurc: "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1",
    cirbtc: "0x171A4217b86A807A64eB94757Db6849fb4bDbAA0",
    btcFeed: "0xa109B535C70C8Be9995be64Bb6751AcDB27e03De",
    eurcHolder: "0x8a02d189B74cC725A632107Ef3A850F3cDd942Ca",
    cirbtcHolder: "0x542E6E2256270215d667ED43e65d4def8295164a",
  },
  5042002: {
    eurc: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
    cirbtc: "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF",
    btcFeed: null,
    eurcHolder: "0x0Ce7f8Aeaad60b9E19ACBe9803518182adC351Bc",
    cirbtcHolder: "0x0Ce7f8Aeaad60b9E19ACBe9803518182adC351Bc",
  },
};
let EURC, CIRBTC, CHAINLINK_BTC, HOLDERS;

const ERC20 = [
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
];

let failures = 0;
function check(label, cond, detail = "") {
  console.log(`   ${cond ? "✅" : "❌"} ${label}${detail ? `  (${detail})` : ""}`);
  if (!cond) failures++;
}

async function main() {
  if (!["arcFork", "fork"].includes(hre.network.name)) throw new Error("Fork only: run with --network arcFork or fork.");
  try {
    await ethers.provider.send("anvil_nodeInfo", []);
  } catch {
    throw new Error("The node is not anvil. This script only runs against a local anvil fork.");
  }

  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const cfg = CHAINS[chainId];
  if (!cfg) throw new Error(`No rehearsal config for chain ${chainId} (have ${Object.keys(CHAINS).join(", ")}).`);
  EURC = cfg.eurc;
  CIRBTC = cfg.cirbtc;
  HOLDERS = { [EURC]: cfg.eurcHolder, [CIRBTC]: cfg.cirbtcHolder };
  const net = hre.network.name;
  const diamond = JSON.parse(fs.readFileSync(`deployment-diamond-${net}.json`, "utf8")).contracts.diamond;
  const oracleAddr = JSON.parse(fs.readFileSync(`deployment-oracle-${net}.json`, "utf8")).contracts.priceOracle;
  const [owner] = await ethers.getSigners();
  const protocol = await ethers.getContractAt("ProtocolFacet", diamond, owner);
  const admin = await ethers.getContractAt("LendingAdminFacet", diamond, owner);
  const ownership = await ethers.getContractAt("OwnershipFacet", diamond, owner);
  const oracle = await ethers.getContractAt("AggregatorPriceOracle", oracleAddr, owner);
  const eurc = new ethers.Contract(EURC, ERC20, ethers.provider);
  const cirbtc = new ethers.Contract(CIRBTC, ERC20, ethers.provider);
  console.log(`Rehearsing on fork: diamond ${diamond}, oracle ${oracleAddr}`);
  /* Never trust leftover fork state: an earlier run that stopped mid-liquidation
     leaves BTC/USD on a mock. Put the real Chainlink proxy back first. */
  CHAINLINK_BTC = cfg.btcFeed ?? (await oracle.feedAggregator(BTC_ID));
  if ((await oracle.feedAggregator(BTC_ID)).toLowerCase() !== CHAINLINK_BTC.toLowerCase()) {
    await (await oracle.setFeed(BTC_ID, CHAINLINK_BTC)).wait();
    console.log("   (reset BTC/USD to the real Chainlink proxy left over from an earlier run)");
  }

  /* Custom errors come back from anvil as bare selectors; decode them against
     every ABI in play so a check can name the error it expects. */
  const libDiamond = new ethers.Interface(["error NotDiamondOwner()"]);
  const ifaces = [protocol.interface, admin.interface, ownership.interface, oracle.interface, libDiamond];
  const errorName = (e) => {
    const text = `${e?.data ?? ""} ${e?.info?.error?.data ?? ""} ${e?.message ?? ""}`;
    for (const data of text.match(/0x[0-9a-fA-F]{8,}/g) || []) {
      for (const i of ifaces) {
        try {
          const parsed = i.parseError(data);
          // A plain `require(…, "msg")` decodes as Error(string): report the message.
          if (parsed) return parsed.name === "Error" ? String(parsed.args[0]) : parsed.name;
        } catch { /* try the next ABI */ }
      }
    }
    return e?.shortMessage || e?.message || "unknown";
  };
  async function reverts(label, fn, expected) {
    try {
      const tx = await fn();
      await tx.wait();
      check(label, false, "did not revert");
    } catch (e) {
      const name = errorName(e);
      check(label, !expected || String(name).includes(expected), `reverted: ${String(name).slice(0, 80)}`);
    }
  }

  /* Write a token balance straight into storage (fork only). The mapping slot is
     found by matching a known holder's balanceOf against keccak(holder, slot) —
     Circle's FiatToken packs a blacklist flag into the top bit, so the low bits
     are the balance for a non-blacklisted holder. */
  const slotCache = {};
  async function balanceSlot(token) {
    if (slotCache[token] !== undefined) return slotCache[token];
    const holder = HOLDERS[token];
    const want = await new ethers.Contract(token, ERC20, ethers.provider).balanceOf(holder);
    for (let slot = 0; slot < 30; slot++) {
      const key = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [holder, slot]));
      const raw = BigInt(await ethers.provider.getStorage(token, key));
      if (raw !== 0n && (raw & ((1n << 255n) - 1n)) === want) return (slotCache[token] = slot);
    }
    throw new Error(`No balance slot found for ${token}`);
  }
  async function setBalance(token, who, amount) {
    const slot = await balanceSlot(token);
    const key = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [who, slot]));
    await ethers.provider.send("anvil_setStorageAt", [token, key, ethers.toBeHex(amount, 32)]);
    const got = await new ethers.Contract(token, ERC20, ethers.provider).balanceOf(who);
    if (got !== amount) throw new Error(`setBalance failed for ${token}: ${got} != ${amount}`);
  }

  const mk = async () => {
    const w = ethers.Wallet.createRandom().connect(ethers.provider);
    await ethers.provider.send("anvil_setBalance", [w.address, "0x3635C9ADC5DEA00000"]); // 1000 USDC
    return w;
  };
  const [alice, bob, carol, erin, dave, next] = [await mk(), await mk(), await mk(), await mk(), await mk(), await mk()];
  await setBalance(EURC, alice.address, 15_000_000n); // 15 EURC
  await setBalance(CIRBTC, carol.address, 20_000n); // 0.0002 cirBTC
  await setBalance(CIRBTC, erin.address, 30_000n); // 0.0003 cirBTC
  check("test users funded with real EURC / cirBTC (fork storage)",
    (await eurc.balanceOf(alice.address)) === 15_000_000n && (await cirbtc.balanceOf(carol.address)) === 20_000n);

  const now = async () => (await ethers.provider.getBlock("latest")).timestamp;
  const P = (s) => protocol.connect(s);
  /* A liquidation's gas is estimated one block before it lands, and its cost drifts
     a few hundred gas with time (interest, seizure amounts); sent unbuffered it dies
     on EIP-2200's SSTORE sentry (Arc testnet parity rehearsal: 351,105 limit,
     351,376 needed). A liquidator bot pads its limit; so does this. */
  const liquidate = async (who, id) => {
    const est = await P(who).liquidateUserRequest.estimateGas(id);
    return P(who).liquidateUserRequest(id, { gasLimit: (est * 12n) / 10n });
  };
  const lastRequestId = async () => {
    const all = await protocol.getAllRequests(0, 10000);
    return all[all.length - 1].requestId;
  };
  const loanAmount = 10_500_000_000_000_000_000n; // 10.5 USDC (18dp native), above the $10 minimum

  // ── A. full loan lifecycle
  console.log("\nA. deposit → borrow → lend → repay → withdraw");
  await (await eurc.connect(alice).approve(diamond, 15_000_000n)).wait();
  await (await P(alice).depositCollateral(EURC, 15_000_000n)).wait();
  check("EURC deposited", (await protocol.gets_addressToCollateralDeposited(alice.address, EURC)) === 15_000_000n);
  const valued = await protocol.getAccountCollateralValue(alice.address);
  check("15 EURC valued by the live Chainlink EURC/USD feed", valued > 16n * 10n ** 18n && valued < 18n * 10n ** 18n,
    `$${ethers.formatUnits(valued, 18)}`);
  await (await P(alice).createLendingRequest(loanAmount, 1000, (await now()) + 3 * 86400, NATIVE)).wait();
  const id1 = await lastRequestId();
  const aliceBefore = await ethers.provider.getBalance(alice.address);
  await (await P(bob).serviceRequest(id1, NATIVE, { value: loanAmount })).wait();
  check("borrower received the 10.5 USDC", (await ethers.provider.getBalance(alice.address)) - aliceBefore === loanAmount);
  const total = (await protocol.getRequest(id1)).totalRepayment;
  const [fee, toLender] = await protocol.getRepaymentFee(id1, total);
  const interest = total - loanAmount;
  check("fee is 5% of the interest, never of principal", fee === (interest * 500n) / 10000n,
    `interest ${ethers.formatUnits(interest, 18)} USDC, fee ${ethers.formatUnits(fee, 18)}`);
  const vaultBefore = await ethers.provider.getBalance(FEE_VAULT);
  await (await P(alice).repayLoan(id1, total, { value: total })).wait();
  check("fee vault received exactly the fee", (await ethers.provider.getBalance(FEE_VAULT)) - vaultBefore === fee);
  const credited = await protocol.gets_addressToAvailableBalance(bob.address, NATIVE);
  check("lender credited exactly total − fee on the ledger", credited === toLender, `${ethers.formatUnits(credited, 18)} USDC`);
  const bobBefore = await ethers.provider.getBalance(bob.address);
  const wrc = await (await P(bob).withdrawCollateral(NATIVE, credited)).wait();
  check("lender withdraws the repayment in native USDC",
    (await ethers.provider.getBalance(bob.address)) - bobBefore + wrc.gasUsed * wrc.gasPrice === credited);
  await (await P(alice).withdrawCollateral(EURC, 15_000_000n)).wait();
  check("collateral withdrawn after repayment", (await eurc.balanceOf(alice.address)) === 15_000_000n);

  // ── B. pause
  console.log("\nB. pause");
  await (await eurc.connect(alice).approve(diamond, 15_000_000n)).wait();
  await (await P(alice).depositCollateral(EURC, 14_000_000n)).wait(); // ≈ $15.9 covers 10.5 at 75%
  await (await P(alice).createLendingRequest(loanAmount, 1000, (await now()) + 3 * 86400, NATIVE)).wait();
  const id2 = await lastRequestId();
  await (await P(bob).serviceRequest(id2, NATIVE, { value: loanAmount })).wait();
  await (await admin.pause()).wait();
  const later = (await now()) + 3 * 86400;
  await reverts("a new request is refused while paused",
    () => P(alice).createLendingRequest(loanAmount, 1000, later, NATIVE), "Protocol__Paused");
  await (await P(alice).depositCollateral(EURC, 1_000_000n)).wait();
  check("a collateral top-up still works while paused",
    (await protocol.gets_addressToCollateralDeposited(alice.address, EURC)) === 15_000_000n);
  const total2 = (await protocol.getRequest(id2)).totalRepayment;
  await (await P(alice).repayLoan(id2, total2, { value: total2 })).wait();
  check("an open loan can still be repaid while paused", (await protocol.getRequest(id2)).totalRepayment === 0n);
  await (await admin.unpause()).wait();
  await (await P(alice).withdrawCollateral(EURC, 15_000_000n)).wait();
  check("unpaused, and the collateral is back", (await eurc.balanceOf(alice.address)) === 15_000_000n);

  const live = (await oracle.getPrice(BTC_ID)).price;
  const Mock = await ethers.getContractFactory("MockAggregatorV3", owner);
  const btcAt = async (fraction) => {
    const mock = await Mock.deploy(8, "BTC / USD", (live * BigInt(Math.round(fraction * 1000))) / 1000n);
    await mock.waitForDeployment();
    await (await oracle.setFeed(BTC_ID, await mock.getAddress())).wait();
  };
  const ledger = async (who) => protocol.gets_addressToCollateralDeposited(who, CIRBTC);
  const btcUsd = Number(live) / 1e8;

  // ── C1. normal liquidation: collateral ≈ what the loan locks, BTC −10%
  console.log("\nC1. liquidation — collateral ≈ locked, BTC/USD −10%");
  const carolUsd = (20_000 / 1e8) * btcUsd; // ≈ $16.9
  const bigLoan = ethers.parseUnits((Math.floor(carolUsd * 0.745 * 100) / 100).toFixed(2), 18); // just under 75%
  await (await cirbtc.connect(carol).approve(diamond, 20_000n)).wait();
  await (await P(carol).depositCollateral(CIRBTC, 20_000n)).wait();
  await (await P(carol).createLendingRequest(bigLoan, 1000, (await now()) + 3 * 86400, NATIVE)).wait();
  const id3 = await lastRequestId();
  await (await P(bob).serviceRequest(id3, NATIVE, { value: bigLoan })).wait();
  const hf3 = await protocol.getHealthFactor(carol.address);
  check("starts healthy", hf3 >= 10n ** 18n, `loan ${ethers.formatUnits(bigLoan, 18)} USDC, HF ${ethers.formatUnits(hf3, 18)}`);
  await reverts("a healthy position cannot be liquidated", () => P(dave).liquidateUserRequest(id3), "Protocol__PositionHealthy");
  await btcAt(0.9);
  const hf3b = await protocol.getHealthFactor(carol.address);
  check("BTC −10% breaks the health factor", hf3b < 10n ** 18n, `HF ${ethers.formatUnits(hf3b, 18)}`);
  const [l0, d0, v0] = [await ledger(bob.address), await ledger(dave.address), await ledger(FEE_VAULT)];
  await (await liquidate(dave, id3)).wait();
  const [l1, d1, v1] = [await ledger(bob.address), await ledger(dave.address), await ledger(FEE_VAULT)];
  check("lender, liquidator and fee vault are all paid in cirBTC",
    l1 > l0 && d1 > d0 && v1 > v0, `lender +${l1 - l0}, liquidator +${d1 - d0}, vault +${v1 - v0} sats`);
  if (d1 > d0) {
    await (await P(dave).withdrawCollateral(CIRBTC, d1 - d0)).wait();
    check("the liquidator withdraws their reward", (await cirbtc.balanceOf(dave.address)) === d1 - d0);
  }
  await (await oracle.setFeed(BTC_ID, CHAINLINK_BTC)).wait();

  // ── C2. over-collateralised borrower, sharp drop — a FINDING, reported
  console.log("\nC2. liquidation — over-collateralised borrower, BTC/USD −50%");
  await (await cirbtc.connect(erin).approve(diamond, 30_000n)).wait();
  await (await P(erin).depositCollateral(CIRBTC, 30_000n)).wait(); // ≈ $25, the loan locks only ≈ $14
  await (await P(erin).createLendingRequest(loanAmount, 1000, (await now()) + 3 * 86400, NATIVE)).wait();
  const id4 = await lastRequestId();
  await (await P(bob).serviceRequest(id4, NATIVE, { value: loanAmount })).wait();
  const locked = await protocol.getRequestToColateral(id4, CIRBTC);
  // The full amount owed (principal + interest), read before liquidation zeroes it.
  const owed = (await protocol.getRequest(id4)).totalRepayment;
  await btcAt(0.5);
  const hf4 = await protocol.getHealthFactor(erin.address);
  const [l2, d2, v2, e2] = [await ledger(bob.address), await ledger(dave.address), await ledger(FEE_VAULT), await ledger(erin.address)];
  await (await liquidate(dave, id4)).wait();
  const [l3, d3, v3, e3] = [await ledger(bob.address), await ledger(dave.address), await ledger(FEE_VAULT), await ledger(erin.address)];
  const debtUsd = Number(ethers.formatUnits(owed, 18));
  const lenderUsd = (Number(l3 - l2) / 1e8) * btcUsd * 0.5;
  console.log(`   HF at liquidation ${ethers.formatUnits(hf4, 18)}; loan ${debtUsd} USDC; locked ${locked} of 30000 sats`);
  console.log(`   lender +${l3 - l2} sats (≈ $${lenderUsd.toFixed(2)}), liquidator +${d3 - d2}, vault +${v3 - v2}; borrower keeps ${e3} of ${e2} sats`);
  /* Before the 2026-09-28 fix this recovered ≈ $7.00 of $10.50 and paid the
     liquidator nothing: seizure only took the loan's LOCKED collateral. Pass 2
     now takes the shortfall from the borrower's free balance. */
  check("the lender is made whole from the borrower's free collateral",
    lenderUsd + 0.01 >= debtUsd, `≈ $${lenderUsd.toFixed(2)} for a $${debtUsd} loan`);
  check("the liquidator and fee vault are paid", d3 > d2 && v3 > v2);
  check("more than the lock was taken, and the borrower keeps the rest",
    e2 - e3 > locked && e3 > 0n, `seized ${e2 - e3} of ${e2}, locked was ${locked}`);
  await (await oracle.setFeed(BTC_ID, CHAINLINK_BTC)).wait();

  // ── D. ownership
  console.log("\nD. two-step ownership");
  await (await ownership.transferOwnership(next.address)).wait();
  check("nominating changes nothing yet",
    (await ownership.owner()) === owner.address && (await ownership.pendingOwner()) === next.address);
  await (await ownership.connect(next).acceptOwnership()).wait();
  check("the nominee accepted and now owns it", (await ownership.owner()) === next.address);
  await reverts("the old owner is locked out", () => admin.pause(), "NotDiamondOwner");
  await (await ownership.connect(next).transferOwnership(owner.address)).wait();
  await (await ownership.acceptOwnership()).wait();
  check("handed back", (await ownership.owner()) === owner.address);

  // ── E. refusals
  console.log("\nE. refusals");
  await reverts("a plain USDC transfer to the diamond bounces",
    () => alice.sendTransaction({ to: diamond, value: 10n ** 18n }), "Function does not exist");
  await reverts("native USDC cannot be deposited as collateral",
    () => P(alice).depositCollateral(NATIVE, 10n ** 18n, { value: 10n ** 18n }), "Protocol__TokenNotAllowed");

  // ── F. repay while the loan currency's price is stale (2026-09-28 audit fix)
  console.log("\nF. repay with USDC/USD past its bound");
  const USDC_ID = "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a";
  const realUsdc = await oracle.feedAggregator(USDC_ID);
  await (await eurc.connect(alice).approve(diamond, 15_000_000n)).wait();
  await (await P(alice).depositCollateral(EURC, 15_000_000n)).wait();
  await (await P(alice).createLendingRequest(loanAmount, 1000, (await now()) + 3 * 86400, NATIVE)).wait();
  const idF = await lastRequestId();
  await (await P(bob).serviceRequest(idF, NATIVE, { value: loanAmount })).wait();
  // A USDC/USD answer 30h old — past the 97,200s bound — on a mock, fork only.
  const staleUsdc = await Mock.deploy(8, "USDC / USD", 99_990_000n);
  await staleUsdc.waitForDeployment();
  await (await staleUsdc.setUpdatedAt((await now()) - 30 * 3600)).wait();
  await (await oracle.setFeed(USDC_ID, await staleUsdc.getAddress())).wait();
  let staleConfirmed = false;
  try { await protocol.getUsdValue(NATIVE, 10n ** 18n, 18); } catch (e) { staleConfirmed = errorName(e).includes("Protocol__StalePrice"); }
  check("control: native USDC is unpriceable right now", staleConfirmed);
  const totalF = (await protocol.getRequest(idF)).totalRepayment;
  await (await P(alice).repayLoan(idF, totalF, { value: totalF })).wait();
  check("the borrower still repays in full", (await protocol.getRequest(idF)).totalRepayment === 0n);
  await (await oracle.setFeed(USDC_ID, realUsdc)).wait();
  check("USDC/USD restored to the real feed", (await oracle.feedAggregator(USDC_ID)) === realUsdc);
  await (await P(alice).withdrawCollateral(EURC, 15_000_000n)).wait();

  console.log(`\n${failures === 0 ? "✅ All rehearsal checks passed." : `❌ ${failures} check(s) failed.`}`);
  if (failures) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
