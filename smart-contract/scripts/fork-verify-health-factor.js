/**
 * Prove the health-factor fix on a fork of live Sepolia, before any diamond is cut.
 *
 * Run against a plain `anvil --fork-url $SEPOLIA_RPC` (NOT `hardhat run`; Hardhat's
 * own forking throws at `hardhat_reset` — edr#911):
 *
 *   ~/.foundry/bin/anvil --fork-url "$SEPOLIA_RPC" --port 8546 --chain-id 11155111
 *   RPC=http://127.0.0.1:8546 node scripts/fork-verify-health-factor.js
 *
 * ── What is being verified, and why a fork rather than a unit test ───────────
 *
 * `getUserActiveRequests` read `_appStorage.userActiveRequests`, a mapping whose
 * only writers were the owner-gated `addUserActiveRequest` / `batchAddUserRequests`
 * — both called from an off-chain keeper (server/src/syncUserActiveRequets.ts). No
 * keeper runs, so on the five live diamonds every borrower's debt reads zero:
 * `getLoanCollectedInUsd` returns 0, `_healthFactor` short-circuits to
 * `type(uint256).max`, and `liquidateUserRequest`'s
 *
 *     _healthFactor(author, 0) >= PRECISION && block.timestamp <= returnDate
 *
 * guard is permanently true on its first conjunct. Under-collateralisation is
 * unliquidatable; only an overdue term can ever close a position.
 *
 * That is a claim about *deployed state*, so a unit test on a fresh diamond cannot
 * check it. The three loans it is measured against are real: requests #1–#3 and
 * listing #1, created by scripts/seed-lending.js on Sepolia at block ~11.56M. A
 * fork keeps them, keeps the Chainlink-backed oracle the diamond points at, and
 * keeps the deployer as owner — so the cut this script performs is the same cut
 * scripts/upgrade-facet.js would send, against the same storage.
 *
 * ── The five things it checks ────────────────────────────────────────────────
 *
 *   1. BEFORE the cut, the bug reproduces on the fork: debt $0, HF unbounded,
 *      `liquidateUserRequest` reverts `Protocol__PositionHealthy`. Without this a
 *      passing "after" proves nothing — it could have been fine all along.
 *   2. The cut itself is a pure Replace, and a cross-section of live storage read
 *      through the diamond is byte-identical either side of it. That is the
 *      smoke alarm for a layout shift, which nothing on chain can detect after
 *      the fact.
 *   3. The pre-fix requests are recoverable via the owner backfill, and the
 *      recovered debt matches hand arithmetic from `getRequest` — not merely
 *      "nonzero".
 *   4. A loan created *after* the cut indexes itself with no backfill, and
 *      `serviceRequest` still succeeds with its status flip moved after the
 *      health check. The reordering is the part that could regress: the old order
 *      counted the marginal loan on both sides of the division.
 *   5. With the debt visible, an under-collateralised position becomes
 *      liquidatable — the behaviour that was unreachable before. Note that this
 *      position's collateral (native ETH) and loans (WETH) resolve to the same
 *      ETH/USD feed, so its health factor is price-invariant: 0.8*(C/k)/(D/k)
 *      does not move. The two legs are separated by registering the loan
 *      currency against a second feed id backed by a PushablePriceFeed we
 *      deploy on the fork — a contract this repo already ships for Robinhood —
 *      rather than by `anvil_setCode` on Chainlink's aggregator, because the
 *      oracle caches `decimals()` per feed at registration and a stub whose
 *      decimals differed would be rescaled, making the number under test not
 *      the number pushed.
 *
 * Nothing here touches a live chain. Every write goes to 127.0.0.1.
 */

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const RPC = process.env.RPC || "http://127.0.0.1:8546";
const ROOT = path.join(__dirname, "..");

const art = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, "artifacts", p), "utf8"));
const PROTOCOL = art("contracts/facets/ProtocolFacet.sol/ProtocolFacet.json");
const LOUPE = art("contracts/facets/DiamondLoupeFacet.sol/DiamondLoupeFacet.json");
const OWNERSHIP = art("contracts/facets/OwnershipFacet.sol/OwnershipFacet.json");
const CUT = art("contracts/interfaces/IDiamondCut.sol/IDiamondCut.json");
const ORACLE = art("contracts/utils/oracle/AggregatorPriceOracle.sol/AggregatorPriceOracle.json");
const PUSHABLE = art("contracts/utils/oracle/PushablePriceFeed.sol/PushablePriceFeed.json");

const WETH_ABI = [
  "function deposit() payable",
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

const NATIVE = "0x0000000000000000000000000000000000000001";
const PRECISION = 10n ** 18n;
const FacetCutAction = { Add: 0, Replace: 1, Remove: 2 };

const usd = (v) => `$${Number(ethers.formatUnits(v, 18)).toFixed(2)}`;
const hf = (v) =>
  v === ethers.MaxUint256 ? "unbounded" : Number(ethers.formatUnits(v, 18)).toFixed(4);

/**
 * A `Request` from `getRequest` as a plain array, for passing back in.
 *
 * ethers returns a frozen `Result` and refuses to re-encode it as a struct
 * argument. Rebuilding it by field name rather than by spreading the Result is
 * also the safer of the two: `interestAccrued` is deliberately appended after
 * `status` (see model/Protocol.sol), so a positional copy that drifted would
 * encode a plausible wrong struct rather than fail.
 */
const asStruct = (r) => [
  r.listingId,
  r.requestId,
  r.author,
  r.amount,
  r.interest,
  r.totalRepayment,
  r.returnDate,
  r.lender,
  r.loanRequestAddr,
  [...r.collateralTokens],
  r.status,
  r.interestAccrued,
];

let failures = 0;
function check(label, ok, detail) {
  console.log(`   ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}
function section(n, title) {
  console.log(`\n${"─".repeat(78)}\n${n}. ${title}\n${"─".repeat(78)}`);
}

/** Decode a custom-error revert into its name, so a check can assert on the cause. */
function revertName(e) {
  const data = e?.data ?? e?.info?.error?.data ?? e?.error?.data;
  if (typeof data === "string" && data.length >= 10) {
    for (const a of [PROTOCOL.abi, ORACLE.abi, PUSHABLE.abi]) {
      try {
        const d = new ethers.Interface(a).parseError(data);
        if (d) return d.name;
      } catch {
        /* not this ABI's error */
      }
    }
    return `unknown(${data.slice(0, 10)})`;
  }
  return e?.shortMessage ?? e?.message ?? "no revert data";
}

/**
 * Every zero-argument view the facet exposes, read through the diamond.
 *
 * Coverage of the STRUCT, not of the API: scalars, both dynamic arrays, the
 * fields appended last, and — via the explicit reads the caller adds — mappings,
 * whose slot base derives from their own slot number and therefore moves if
 * anything above them shifts.
 */
async function crossSection(protocol) {
  const out = {};
  for (const f of PROTOCOL.abi) {
    if (f.type !== "function" || f.inputs.length !== 0) continue;
    if (f.stateMutability !== "view" && f.stateMutability !== "pure") continue;
    try {
      const v = await protocol[f.name]();
      out[f.name] = Array.isArray(v) ? [...v].map(String).join(",") : String(v);
    } catch (e) {
      out[f.name] = `REVERT(${revertName(e)})`;
    }
  }
  return out;
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const net = await provider.getNetwork();
  const head = await provider.getBlockNumber();
  if (Number(net.chainId) !== 11155111)
    throw new Error(`chain ${net.chainId} — this expects a Sepolia fork (11155111)`);
  /* A fork of live Sepolia has ~11.5M blocks behind it. A fresh chain has a
     handful, and every read below would answer zero rather than fail, which is
     the one way this script could report success against nothing. */
  if (head < 11_000_000)
    throw new Error(`head is block ${head} — that is not a fork of Sepolia, it is an empty chain`);

  const dRec = JSON.parse(fs.readFileSync(path.join(ROOT, "deployment-diamond-sepolia.json"), "utf8"));
  const lRec = JSON.parse(fs.readFileSync(path.join(ROOT, "deployment-lending-sepolia.json"), "utf8"));
  const oRec = JSON.parse(fs.readFileSync(path.join(ROOT, "deployment-oracle-sepolia.json"), "utf8"));
  const diamond = dRec.contracts.diamond;
  const oldFacet = dRec.facets.ProtocolFacet;

  require("dotenv").config({ path: path.join(ROOT, ".env") });
  const key = process.env.DEPLOYER_PRIVATE_KEY;
  if (!key) throw new Error("no DEPLOYER_PRIVATE_KEY in .env");
  const lender = new ethers.Wallet(key.startsWith("0x") ? key : `0x${key}`, provider);
  const borrower = new ethers.Wallet(
    ethers.keccak256(ethers.toUtf8Bytes(`kaleido-testnet-counterparty-v1:${key}`)),
    provider,
  );

  console.log(`\n${"═".repeat(78)}`);
  console.log(`  Sepolia fork @ block ${head}   diamond ${diamond}`);
  console.log(`  lender/owner ${lender.address}`);
  console.log(`  borrower     ${borrower.address}`);
  console.log(`${"═".repeat(78)}`);

  /* Fork-only gas. Both wallets hold real balances on Sepolia and neither is
     large enough to run this end to end; topping up locally is not part of the
     behaviour under test. */
  for (const a of [lender.address, borrower.address])
    await provider.send("anvil_setBalance", [a, "0x" + (100n * 10n ** 18n).toString(16)]);

  const asOld = (signer) => new ethers.Contract(diamond, PROTOCOL.abi, signer);
  const before = asOld(provider);
  const weth = new ethers.Contract(lRec.currency.address, WETH_ABI, lender);

  // ───────────────────────────────────────────────────────────────────────────
  section(1, "The bug, reproduced on the fork against the three real loans");

  const reqs = {};
  for (const id of [1, 2, 3]) reqs[id] = await before.getRequest(id);
  for (const id of [1, 2, 3])
    console.log(
      `   request #${id}  author ${reqs[id].author.slice(0, 10)}…  ` +
        `amount ${ethers.formatUnits(reqs[id].amount, 18)}  ` +
        `repay ${ethers.formatUnits(reqs[id].totalRepayment, 18)}  status ${reqs[id].status}`,
    );

  const collateralUsd0 = await before.getAccountCollateralValue(borrower.address);
  const debt0 = await before.getLoanCollectedInUsd(borrower.address);
  const hf0 = await before.getHealthFactor(borrower.address);
  const active0 = await before.getUserActiveRequests(borrower.address);
  console.log(
    `\n   collateral ${usd(collateralUsd0)}   debt ${usd(debt0)}   ` +
      `HF ${hf(hf0)}   getUserActiveRequests → ${active0.length} entries`,
  );

  check("collateral is priced (the oracle works on this fork)", collateralUsd0 > 0n, usd(collateralUsd0));
  check("debt reads zero despite two SERVICED loans", debt0 === 0n, usd(debt0));
  check("health factor reads unbounded", hf0 === ethers.MaxUint256, hf(hf0));
  check("the debt index is empty", active0.length === 0, `${active0.length} entries`);

  let liqBefore = "did not revert";
  try {
    await before.liquidateUserRequest.staticCall(1, { from: lender.address });
  } catch (e) {
    liqBefore = revertName(e);
  }
  check(
    "liquidating a SERVICED loan reverts Protocol__PositionHealthy",
    liqBefore === "Protocol__PositionHealthy",
    liqBefore,
  );

  const snapshot = await provider.send("evm_snapshot", []);

  // ───────────────────────────────────────────────────────────────────────────
  section(2, "The cut: pure Replace, and live storage unmoved across it");

  const ownership = new ethers.Contract(diamond, OWNERSHIP.abi, provider);
  const owner = await ownership.owner();
  check(
    "signer owns the diamond (diamondCut is onlyOwner)",
    ethers.getAddress(owner) === ethers.getAddress(lender.address),
    owner,
  );

  const loupe = new ethers.Contract(diamond, LOUPE.abi, provider);
  const live = new Map();
  for (const f of await loupe.facets())
    for (const s of f.functionSelectors) live.set(s, ethers.getAddress(f.facetAddress));

  const iface = new ethers.Interface(PROTOCOL.abi);
  const fresh = new Map();
  iface.forEachFunction((f) => fresh.set(f.selector, f.format("sighash")));
  const replace = [...fresh.keys()].filter((s) => live.has(s));
  const added = [...fresh.entries()].filter(([s]) => !live.has(s));
  const orphaned = [...live.entries()]
    .filter(([, a]) => a === ethers.getAddress(oldFacet))
    .map(([s]) => s)
    .filter((s) => !fresh.has(s));

  console.log(
    `   ${fresh.size} selectors in the new ABI: REPLACE ${replace.length}  ADD ${added.length}  ORPHANED ${orphaned.length}`,
  );
  added.forEach(([s, sig]) => console.log(`     + ${s} ${sig}`));
  orphaned.forEach((s) => console.log(`     - ${s}`));
  check("selector set unchanged — an implementation swap, not a shape change", added.length === 0 && orphaned.length === 0);

  const csBefore = await crossSection(before);
  /* Mappings too. Their slot base is keccak(key . slot), so a mapping's data
     moves if any field above it in the struct shifts — which zero-arg views over
     scalars and arrays would not catch. */
  const mappingProbe = async (c) => ({
    "feedMaxAge(ETH/USD)": String(await c.getFeedMaxAge(oRec.feeds[0].feedId)),
    "collateralValue(borrower)": String(await c.getAccountCollateralValue(borrower.address)),
    "availableValue(borrower)": String(await c.getAccountAvailableValue(borrower.address)),
    "request(1).totalRepayment": String((await c.getRequest(1)).totalRepayment),
    "request(2).author": String((await c.getRequest(2)).author),
    "listing(1).amount": String((await c.getLoanListing(1)).amount),
  });
  Object.assign(csBefore, await mappingProbe(before));

  console.log(`\n   deploying the recompiled ProtocolFacet on the fork …`);
  const newFacet = await (
    await new ethers.ContractFactory(PROTOCOL.abi, PROTOCOL.bytecode, lender).deploy()
  ).waitForDeployment();
  const newAddr = await newFacet.getAddress();
  console.log(`   old ${oldFacet}\n   new ${newAddr}`);

  const cutter = new ethers.Contract(diamond, CUT.abi, lender);
  const cutTx = await cutter.diamondCut(
    [{ facetAddress: newAddr, action: FacetCutAction.Replace, functionSelectors: replace }],
    ethers.ZeroAddress,
    "0x",
  );
  const cutRcpt = await cutTx.wait();
  console.log(`   diamondCut mined, gas ${cutRcpt.gasUsed}`);

  let misrouted = 0;
  for (const s of replace)
    if (ethers.getAddress(await loupe.facetAddress(s)) !== ethers.getAddress(newAddr)) misrouted += 1;
  check(`all ${replace.length} selectors now served by the new facet`, misrouted === 0, `${misrouted} misrouted`);

  const protocol = asOld(lender);
  const csAfter = await crossSection(protocol);
  Object.assign(csAfter, await mappingProbe(protocol));
  const moved = Object.keys(csBefore).filter((k) => csBefore[k] !== csAfter[k]);
  moved.forEach((k) => console.log(`     !! ${k}\n        before ${csBefore[k]}\n        after  ${csAfter[k]}`));
  check(
    `${Object.keys(csBefore).length} live values identical across the cut (no layout shift)`,
    moved.length === 0,
    `${moved.length} moved`,
  );

  // ───────────────────────────────────────────────────────────────────────────
  section(3, "Pre-fix loans recovered by the owner backfill, to hand arithmetic");

  check(
    "still zero immediately after the cut (the index is genuinely empty, not cached)",
    (await protocol.getLoanCollectedInUsd(borrower.address)) === 0n,
  );

  for (const id of [1, 2]) {
    const tx = await protocol.addUserActiveRequest(borrower.address, asStruct(reqs[id]));
    await tx.wait();
  }
  const active2 = await protocol.getUserActiveRequests(borrower.address);
  const debt2 = await protocol.getLoanCollectedInUsd(borrower.address);
  const hf2 = await protocol.getHealthFactor(borrower.address);

  /* Hand arithmetic, from getRequest and getUsdValue rather than from the number
     under test: sum(totalRepayment priced in USD), and 0.8 * collateral / debt. */
  let expect = 0n;
  for (const id of [1, 2])
    expect += await protocol.getUsdValue(reqs[id].loanRequestAddr, reqs[id].totalRepayment, 18);
  const collateralUsd = await protocol.getAccountCollateralValue(borrower.address);
  const expectHf = (((collateralUsd * 80n) / 100n) * PRECISION) / expect;

  console.log(
    `   ${active2.length} active   debt ${usd(debt2)} (expected ${usd(expect)})   ` +
      `HF ${hf(hf2)} (expected ${hf(expectHf)})`,
  );
  check("both SERVICED loans now in the index", active2.length === 2, `${active2.length}`);
  check("debt equals the sum of their totalRepayment in USD", debt2 === expect);
  check("health factor equals 0.8 x collateral / debt", hf2 === expectHf);
  check("health factor is finite and above 1", hf2 !== ethers.MaxUint256 && hf2 > PRECISION, hf(hf2));

  /* The backfill's author check: the one input that decides whose solvency a
     request affects is read from storage, never from calldata. */
  let wrongUser = "did not revert";
  try {
    await protocol.addUserActiveRequest.staticCall(lender.address, asStruct(reqs[1]));
  } catch (e) {
    wrongUser = revertName(e);
  }
  check(
    "backfilling someone else's request onto a user reverts Protocol__NotOwner",
    wrongUser === "Protocol__NotOwner",
    wrongUser,
  );

  /* And a struct describing a request that does not exist is refused rather than
     indexed as a zero-valued phantom whose totalRepayment nothing can repay. */
  let phantom = "did not revert";
  try {
    const fake = asStruct(reqs[1]);
    fake[1] = 9999n;
    await protocol.addUserActiveRequest.staticCall(borrower.address, fake);
  } catch (e) {
    phantom = revertName(e);
  }
  check(
    "backfilling a nonexistent request reverts Protocol__IdNotExist",
    phantom === "Protocol__IdNotExist",
    phantom,
  );

  const dup = await protocol.addUserActiveRequest(borrower.address, asStruct(reqs[1]));
  await dup.wait();
  check(
    "re-backfilling an already-indexed request is a no-op, not a double count",
    (await protocol.getLoanCollectedInUsd(borrower.address)) === debt2,
  );

  /* An OPEN request is indexed but does not count as debt — and servicing it
     later must make it count with no second backfill. That is the only way to
     show membership of an index with no getter. */
  await (await protocol.addUserActiveRequest(borrower.address, asStruct(reqs[3]))).wait();
  check(
    "an OPEN request in the index adds no debt",
    (await protocol.getLoanCollectedInUsd(borrower.address)) === debt2,
  );

  const need3 = reqs[3].amount;
  if ((await weth.balanceOf(lender.address)) < need3) await (await weth.deposit({ value: need3 * 2n })).wait();
  await (await weth.approve(diamond, ethers.MaxUint256)).wait();
  await (await protocol.serviceRequest(3, lRec.currency.address)).wait();
  const debt3 = await protocol.getLoanCollectedInUsd(borrower.address);
  const active3 = await protocol.getUserActiveRequests(borrower.address);
  const expect3 = expect + (await protocol.getUsdValue(reqs[3].loanRequestAddr, reqs[3].totalRepayment, 18));
  console.log(`   after servicing #3: ${active3.length} active, debt ${usd(debt3)} (expected ${usd(expect3)})`);
  check("servicing it counts it, with no further backfill", active3.length === 3 && debt3 === expect3);

  // ───────────────────────────────────────────────────────────────────────────
  section(4, "A loan created after the cut indexes itself, and the reordered flip holds");

  /* Sized at half the collateral on purpose. The correct check is
     0.8*C / L >= 1, so L = 0.5C passes at HF 1.6. The pre-fix ordering flipped
     the status to SERVICED *before* the check, which would put this loan's own
     totalRepayment into the debt sum as well: 0.8C / (1.01L + L) = 0.796 < 1,
     a revert. So this size distinguishes the two orderings rather than merely
     exercising the path. */
  const fresh2 = ethers.Wallet.createRandom().connect(provider);
  await provider.send("anvil_setBalance", [fresh2.address, "0x" + (100n * 10n ** 18n).toString(16)]);
  const asFresh = new ethers.Contract(diamond, PROTOCOL.abi, fresh2);

  const collDeposit = ethers.parseEther("0.16");
  await (await asFresh.depositCollateral(NATIVE, collDeposit, { value: collDeposit })).wait();
  const freshColl = await asFresh.getAccountCollateralValue(fresh2.address);
  const halfUsd = freshColl / 2n;
  const perWhole = await protocol.getUsdValue(lRec.currency.address, 10n ** 18n, 18);
  const loanRaw = (halfUsd * 10n ** 18n) / perWhole;
  console.log(
    `   fresh borrower ${fresh2.address.slice(0, 10)}…  collateral ${usd(freshColl)}  ` +
      `loan ${ethers.formatUnits(loanRaw, 18)} WETH (${usd(halfUsd)}, half of collateral)`,
  );

  const returnDate = (await provider.getBlock("latest")).timestamp + 30 * 86400;
  await (await asFresh.createLendingRequest(loanRaw, 500, returnDate, lRec.currency.address)).wait();
  const newId = Number(await protocol.getRequestId());
  const newReq = await protocol.getRequest(newId);
  check(
    "the new request is the borrower's and is OPEN",
    ethers.getAddress(newReq.author) === ethers.getAddress(fresh2.address) && Number(newReq.status) === 0,
    `#${newId} status ${newReq.status}`,
  );
  check(
    "creating it indexed nothing as debt yet (OPEN)",
    (await protocol.getLoanCollectedInUsd(fresh2.address)) === 0n,
  );

  if ((await weth.balanceOf(lender.address)) < loanRaw) await (await weth.deposit({ value: loanRaw * 2n })).wait();
  let serviced = "reverted";
  try {
    await (await protocol.serviceRequest(newId, lRec.currency.address)).wait();
    serviced = "ok";
  } catch (e) {
    serviced = revertName(e);
  }
  check(
    "serviceRequest succeeds at loan = 0.5 x collateral (the old ordering would revert here)",
    serviced === "ok",
    serviced,
  );

  if (serviced === "ok") {
    const fDebt = await protocol.getLoanCollectedInUsd(fresh2.address);
    const fHf = await protocol.getHealthFactor(fresh2.address);
    const fActive = await protocol.getUserActiveRequests(fresh2.address);
    const fExpect = await protocol.getUsdValue(newReq.loanRequestAddr, newReq.totalRepayment, 18);
    const fColl = await protocol.getAccountCollateralValue(fresh2.address);
    console.log(
      `   auto-indexed: ${fActive.length} active   debt ${usd(fDebt)} (expected ${usd(fExpect)})   HF ${hf(fHf)}`,
    );
    check("indexed with no backfill anywhere in this stage", fActive.length === 1 && fDebt === fExpect);
    check("health factor finite and > 1", fHf !== ethers.MaxUint256 && fHf > PRECISION, hf(fHf));
    check(
      "and equals 0.8 x collateral / debt",
      fHf === (((fColl * 80n) / 100n) * PRECISION) / fExpect,
    );
    /* Not counted twice: HF from the marginal-loan formula the service check
       used would be ~0.796 if the flip still preceded the check. */
    check("debt is the loan once, not twice", fDebt < (fExpect * 3n) / 2n, usd(fDebt));
  }

  // ───────────────────────────────────────────────────────────────────────────
  section(5, "With debt visible, an under-collateralised position becomes liquidatable");

  const liqTarget = borrower.address;
  const targetReq = 1;

  const hfPre = await protocol.getHealthFactor(liqTarget);
  let liqPre = "did not revert";
  try {
    await protocol.liquidateUserRequest.staticCall(targetReq, { from: lender.address });
  } catch (e) {
    liqPre = revertName(e);
  }
  console.log(`   request #${targetReq}, HF ${hf(hfPre)}, in term → liquidate ${liqPre}`);
  check(
    "a healthy in-term position still refuses liquidation",
    liqPre === "Protocol__PositionHealthy",
    liqPre,
  );

  /* ── Why the LOAN leg is repriced and not the collateral leg ────────────────
   *
   * The collateral is the native sentinel address(1) and the loans are WETH.
   * Both resolve to the one ETH/USD feed, so a fall in that price scales
   * collateral and debt together and 0.8*(C/k) / (D/k) is exactly unchanged —
   * a position whose collateral and debt are the same asset has a
   * price-invariant health factor. To move one leg the two must sit on
   * different feed ids, and only the loanable side has a setter that will
   * overwrite an existing entry: `addLoanableToken` writes `s_priceFeeds`
   * unconditionally, while `addCollateralToken` refuses with
   * Protocol__TokenAlreadyExists — correctly, since silently repricing live
   * collateral is exactly what an owner should not be able to do by accident.
   *
   * So the scenario synthesised here is "the borrowed asset appreciated against
   * the collateral", which is how a real position dies when the loan currency
   * is the volatile one. The arithmetic under test is the same either way:
   * 0.8 * collateral / debt crossing 1.
   */
  const feedId = oRec.feeds[0].feedId;
  const oracle = new ethers.Contract(oRec.contracts.priceOracle, ORACLE.abi, lender);
  const oOwner = await oracle.owner();
  check(
    "signer owns the price oracle (setFeed is onlyOwner)",
    ethers.getAddress(oOwner) === ethers.getAddress(lender.address),
    oOwner,
  );

  const livePrice = (await oracle.getPrice(feedId)).price;
  /* 8 decimals, matching the Chainlink aggregator this stands beside. The oracle
     caches decimals per feed at registration and rescales to 8, so a stub
     reporting 18 would be silently divided and the number under test would not
     be the number pushed. */
  const stub = await (
    await new ethers.ContractFactory(PUSHABLE.abi, PUSHABLE.bytecode, lender).deploy(
      8,
      "WETH / USD (fork stub)",
      0,
    )
  ).waitForDeployment();
  const stubAddr = await stub.getAddress();

  /* 4x, because the position needs debt above 0.8 x collateral to be
     liquidatable and it currently sits at roughly 45% of that. */
  const pumped = livePrice * 4n;
  await (await stub.pushAnswer(pumped, (await provider.getBlock("latest")).timestamp)).wait();

  const loanFeed = ethers.id("fork:WETH/USD");
  await (await oracle.setFeed(loanFeed, stubAddr)).wait();
  /* The stub's answer is seconds old, but each anvil transaction advances the
     block clock; a day of slack keeps a stale-price revert from being mistaken
     for a health-factor result. */
  await (await protocol.setFeedMaxAge(loanFeed, 86400)).wait();
  await (await protocol.addLoanableToken(lRec.currency.address, loanFeed)).wait();
  console.log(
    `   WETH/USD ${Number(livePrice) / 1e8} → ${Number(pumped) / 1e8} via ${stubAddr} ` +
      `(collateral stays on Chainlink ${oRec.feeds[0].aggregator})`,
  );

  const collLiq = await protocol.getAccountCollateralValue(liqTarget);
  const debtLiq = await protocol.getLoanCollectedInUsd(liqTarget);
  const hfLiq = await protocol.getHealthFactor(liqTarget);
  /* Recomputed at the new price rather than as `debt3 * 4`: getUsdValue truncates
     once per request, so scaling the old total and summing the new per-request
     values differ by a few wei and an equality on the former would fail for a
     reason that is not a defect. */
  let expectLiq = 0n;
  for (const id of [1, 2, 3]) {
    const r = await protocol.getRequest(id);
    expectLiq += await protocol.getUsdValue(r.loanRequestAddr, r.totalRepayment, 18);
  }
  console.log(`   collateral ${usd(collLiq)}   debt ${usd(debtLiq)}   HF ${hf(hfPre)} → ${hf(hfLiq)}`);
  check("collateral is unchanged (it is not on the repriced feed)", collLiq === collateralUsd, usd(collLiq));
  check("debt rose with the loan currency", debtLiq === expectLiq && debtLiq > debt3, `${usd(debt3)} → ${usd(debtLiq)}`);
  check("the position is now under-collateralised", hfLiq < PRECISION, hf(hfLiq));
  check("and the ratio still equals 0.8 x collateral / debt", hfLiq === (((collLiq * 80n) / 100n) * PRECISION) / debtLiq);

  const liquidator = new ethers.Contract(diamond, PROTOCOL.abi, lender);
  let liqPost = "did not revert";
  try {
    await liquidator.liquidateUserRequest.staticCall(targetReq);
    liqPost = "would succeed";
  } catch (e) {
    liqPost = revertName(e);
  }
  /* An unset fee vault or a zero penalty bps reverts here for reasons that have
     nothing to do with the health factor. Report it and configure it rather than
     letting it read as the fix not working — an unset vault on a live deployment
     is its own finding. */
  if (liqPost === "Protocol__InvalidFeeVault" || liqPost === "Protocol__InvalidFeeBps") {
    console.log(`   NOTE: liquidation settlement is unconfigured on this deployment (${liqPost})`);
    if (liqPost === "Protocol__InvalidFeeVault") await (await protocol.setFeeVault(lender.address)).wait();
    if (liqPost === "Protocol__InvalidFeeBps") await (await protocol.setLiquidityBps(1000)).wait();
    try {
      await liquidator.liquidateUserRequest.staticCall(targetReq);
      liqPost = "would succeed";
    } catch (e) {
      liqPost = revertName(e);
    }
  }
  check(
    "liquidateUserRequest now goes through — the behaviour that was unreachable",
    liqPost === "would succeed",
    liqPost,
  );

  if (liqPost === "would succeed") {
    const rcpt = await (await liquidator.liquidateUserRequest(targetReq)).wait();
    const closed = await protocol.getRequest(targetReq);
    const debtEnd = await protocol.getLoanCollectedInUsd(liqTarget);
    console.log(
      `   liquidated, gas ${rcpt.gasUsed}, request status ${closed.status}, ` +
        `remaining debt ${usd(debtEnd)}`,
    );
    check("the request is no longer SERVICED", Number(closed.status) !== 1, `status ${closed.status}`);
    check("its repayment left the debt sum", debtEnd < debtLiq, `${usd(debtLiq)} → ${usd(debtEnd)}`);
  }

  await provider.send("evm_revert", [snapshot]);
  console.log(`\n   fork reverted to the pre-cut snapshot`);

  console.log(`\n${"═".repeat(78)}`);
  console.log(failures === 0 ? "  ALL CHECKS PASSED" : `  ${failures} CHECK(S) FAILED`);
  console.log(`${"═".repeat(78)}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\nFORK VERIFY FAILED:", e);
  process.exit(1);
});
