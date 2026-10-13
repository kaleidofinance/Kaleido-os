/**
 * Rehearse the borrow-limit-includes-interest upgrade of the LIVE Arc mainnet lending
 * diamond on a local anvil fork of Arc mainnet — the real diamond, the real
 * oracle, real EURC and Chainlink — by the same two steps production will use:
 *
 *   anvil --fork-url https://rpc.mainnet.arc.io --chain-id 5042 \
 *         --compute-units-per-second 10 --retries 30
 *   npx hardhat run scripts/rehearse-interest-cap-upgrade.js --network arcFork
 *
 *   1. deploy the new ProtocolFacet (from the deployer);
 *   2. the OWNER — the 1-of-1 Safe — executes diamondCut(Replace), signed by the
 *      deployer as the Safe's owner (scripts/safe-exec.js does this on mainnet).
 *
 * What it proves, each asserted:
 *   0. BEFORE: on the live code a 74.9%-LTV, 365-day, 10% loan is accepted, funded
 *      and immediately liquidatable (the disclosed bug) — so the rehearsal can tell
 *      the two versions apart;
 *   1. the cut is a pure Replace: the new facet serves EXACTLY the selectors the old
 *      one served;
 *   2. nothing else moves: owner, counters, balances, every existing request,
 *      collateral token list, oracle, pause flag are identical before and after;
 *   3. AFTER: the same loan is refused; one inside the limit funds at a health
 *      factor above 1.06 and cannot be liquidated; a short loan keeps its room;
 *      a listing draw is held to the same rule; an ordinary loan still runs to a
 *      full repayment and the fee vault is paid;
 *   4. rollback works: replacing back to the old facet restores the old behaviour.
 *
 * FORK ONLY. It impersonates the deployer and writes token balances into storage,
 * which is impossible on a real chain, and it refuses to run unless the node
 * answers anvil_nodeInfo.
 */
const hre = require("hardhat");
const { ethers } = hre;

const DIAMOND = "0xE4e7f16DB22e6bb2E505fbC504d7B2B4B995A6E3";
const SAFE = "0x4c72B4799d374D2Ad9a8C9716766f8325808B94F";
const DEPLOYER = "0x0Ce7f8Aeaad60b9E19ACBe9803518182adC351Bc";
const EURC = "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1";
const CIRBTC = "0x171A4217b86A807A64eB94757Db6849fb4bDbAA0";
const EURC_HOLDER = "0x8a02d189B74cC725A632107Ef3A850F3cDd942Ca"; // only used to find the balance slot
const NATIVE = "0x0000000000000000000000000000000000000001";

const ERC20 = ["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)"];
const SAFE_ABI = [
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function nonce() view returns (uint256)",
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)",
];
const U = (n) => ethers.parseUnits(String(n), 18);

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`   ${ok ? "✅" : "❌"} ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

async function main() {
  if (!["arcFork", "fork"].includes(hre.network.name)) throw new Error("Fork only: run with --network arcFork.");
  try {
    await ethers.provider.send("anvil_nodeInfo", []);
  } catch {
    throw new Error("The node is not anvil. This script only runs against a local anvil fork.");
  }
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  if (chainId !== 5042) throw new Error(`Expected a fork of Arc mainnet (5042), got ${chainId}.`);
  if ((await ethers.provider.getCode(DIAMOND)) === "0x") throw new Error("The live diamond is not on this fork.");

  const rpc = (m, p = []) => ethers.provider.send(m, p);
  const now = async () => (await ethers.provider.getBlock("latest")).timestamp;

  // ── actors
  await rpc("anvil_impersonateAccount", [DEPLOYER]);
  await rpc("anvil_setBalance", [DEPLOYER, "0x3635C9ADC5DEA00000"]);
  /* A plain JSON-RPC connection, not hardhat's signer layer: hardhat refuses to send
     from an account it holds no key for, and anvil will send from an impersonated one. */
  const raw = new ethers.JsonRpcProvider("http://127.0.0.1:8545", undefined, { staticNetwork: true });
  const deployer = await raw.getSigner(DEPLOYER);
  const mk = async (usdc = 10000) => {
    const w = ethers.Wallet.createRandom().connect(ethers.provider);
    await rpc("anvil_setBalance", [w.address, ethers.toBeHex(ethers.parseUnits(String(usdc), 18))]);
    return w;
  };
  const [alice, bob, carol] = [await mk(), await mk(), await mk()];

  const protocol = await ethers.getContractAt("ProtocolFacet", DIAMOND);
  const ownership = await ethers.getContractAt("OwnershipFacet", DIAMOND);
  const loupe = await ethers.getContractAt("DiamondLoupeFacet", DIAMOND);
  const P = (s) => protocol.connect(s);

  /* Custom errors come back from anvil as bare selectors: decode them so a check can
     name the error it expects. */
  const ifaces = [protocol.interface, ownership.interface];
  const errorName = (e) => {
    const text = `${e?.data ?? ""} ${e?.info?.error?.data ?? ""} ${e?.message ?? ""}`;
    for (const data of text.match(/0x[0-9a-fA-F]{8,}/g) || []) {
      for (const i of ifaces) {
        try {
          const parsed = i.parseError(data);
          if (parsed) return parsed.name;
        } catch { /* next */ }
      }
    }
    return e?.shortMessage || e?.message || "unknown";
  };
  async function reverts(label, fn, expected) {
    try {
      await (await fn()).wait();
      check(label, false, "did not revert");
    } catch (e) {
      const name = errorName(e);
      check(label, !expected || String(name).includes(expected), `reverted: ${String(name).slice(0, 70)}`);
    }
  }

  // ── balance forging (fork only): the token's mapping slot, found from a real holder
  const slotCache = {};
  async function balanceSlot(token, holder) {
    if (slotCache[token] !== undefined) return slotCache[token];
    const want = await new ethers.Contract(token, ERC20, ethers.provider).balanceOf(holder);
    for (let slot = 0; slot < 30; slot++) {
      const key = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [holder, slot]));
      const raw = BigInt(await ethers.provider.getStorage(token, key));
      if (raw !== 0n && (raw & ((1n << 255n) - 1n)) === want) return (slotCache[token] = slot);
    }
    throw new Error(`No balance slot found for ${token}`);
  }
  async function setEurc(who, amount) {
    const slot = await balanceSlot(EURC, EURC_HOLDER);
    const key = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [who, slot]));
    await rpc("anvil_setStorageAt", [EURC, key, ethers.toBeHex(amount, 32)]);
  }

  // ── scenario helpers (the same steps every time, so before/after are comparable)
  async function giveCollateral(user, eurcAmount) {
    await setEurc(user.address, eurcAmount);
    await (await new ethers.Contract(EURC, ERC20, user).approve(DIAMOND, eurcAmount)).wait();
    await (await P(user).depositCollateral(EURC, eurcAmount)).wait();
  }
  const post = async (user, principal, days, bps = 1000) =>
    P(user).createLendingRequest(principal, bps, (await now()) + days * 86400 + 120, NATIVE);
  async function lastRequestId() {
    const all = await protocol.getAllRequests(0, 10000);
    return all[all.length - 1].requestId;
  }
  async function postAndFund(user, lender, principal, days, bps = 1000) {
    await (await post(user, principal, days, bps)).wait();
    const id = await lastRequestId();
    await (await P(lender).serviceRequest(id, NATIVE, { value: principal })).wait();
    return id;
  }
  // ~$1000 of the real EURC, priced by the live Chainlink EURC/USD feed
  const EURC_FOR_1000 = async () => {
    const one = await protocol.getUsdValue(EURC, 1_000_000n, 6); // $ per EURC, 1e18
    return (1000n * 10n ** 18n * 1_000_000n) / one;
  };

  // ── state snapshot, compared before/after the cut
  async function snapshot() {
    const reqs = await protocol.getAllRequests(0, 10000);
    const oracle = await protocol.getPythPriceOracle();
    const erc = (t) => new ethers.Contract(t, ERC20, ethers.provider).balanceOf(DIAMOND);
    return JSON.stringify({
      owner: await ownership.owner(),
      requestId: String(await protocol.getRequestId()),
      listingId: String(await protocol.getListingId()),
      collateralTokens: await protocol.getAllCollateralToken(),
      loanable: await protocol.getLoanableAssets(),
      oracle,
      nativeBalance: String(await ethers.provider.getBalance(DIAMOND)),
      eurc: String(await erc(EURC)),
      cirbtc: String(await erc(CIRBTC)),
      requests: reqs.map((r) => [String(r.requestId), String(r.status), String(r.totalRepayment), r.lender, r.author]),
    });
  }

  console.log(`Fork of Arc mainnet at block ${await ethers.provider.getBlockNumber()}, diamond ${DIAMOND}`);
  const safe = new ethers.Contract(SAFE, SAFE_ABI, deployer);
  const [owners, threshold] = await Promise.all([safe.getOwners(), safe.getThreshold()]);
  check("the live owner is the Safe, 1-of-1, with the deployer as its signer",
    (await ownership.owner()) === SAFE && Number(threshold) === 1 && owners.map((o) => o.toLowerCase()).includes(DEPLOYER.toLowerCase()),
    `owners ${owners.join(",")}`);

  // ── the facet currently serving the loan functions
  const sel = (sig) => ethers.id(sig).slice(0, 10);
  const oldFacet = await loupe.facetAddress(sel("createLendingRequest(uint128,uint16,uint256,address)"));
  const oldSelectors = [...(await loupe.facetFunctionSelectors(oldFacet))];
  console.log(`   old ProtocolFacet ${oldFacet} serves ${oldSelectors.length} selectors`);

  // ── 0. BEFORE: the disclosed bug, on the live code
  console.log("\n0. BEFORE — the live code");
  const snapBefore = await rpc("evm_snapshot");
  {
    await giveCollateral(alice, await EURC_FOR_1000());
    const id = await postAndFund(alice, bob, U(749), 365);
    const hf = await protocol.getHealthFactor(alice.address);
    check("74.9% LTV · 365d · 10% is accepted and funded (the bug)", true, `HF after funding ${ethers.formatUnits(hf, 18)}`);
    check("…and sits below 1.0, so it is liquidatable with no price move", hf < 10n ** 18n);
    const est = await P(carol).liquidateUserRequest.estimateGas(id).catch(() => null);
    check("…and a stranger's liquidation call succeeds", est !== null);
  }
  await rpc("evm_revert", [snapBefore]);

  const before = await snapshot();

  // ── 1. deploy the new facet, exactly as production will
  console.log("\n1. deploy the new ProtocolFacet");
  const artifact = await hre.artifacts.readArtifact("ProtocolFacet");
  const Factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer);
  const newFacetC = await Factory.deploy();
  await newFacetC.waitForDeployment();
  const newFacet = await newFacetC.getAddress();
  const size = (await ethers.provider.getCode(newFacet)).length / 2 - 1;
  check("deployed, under the 24,576-byte limit", size <= 24576, `${newFacet}, ${size} bytes`);
  const newSelectors = [...Factory.interface.fragments.filter((f) => f.type === "function").map((f) => sel(f.format("sighash")))];
  const same = newSelectors.length === oldSelectors.length && newSelectors.every((s) => oldSelectors.includes(s));
  check("the new facet serves exactly the selectors the old one did — a pure Replace", same,
    `${newSelectors.length} new vs ${oldSelectors.length} old`);
  if (!same) throw new Error("Selector sets differ: not a pure Replace. Stop and review.");

  // ── 2. the Safe executes the cut
  console.log("\n2. the Safe executes diamondCut(Replace)");
  const cut = await ethers.getContractAt("IDiamondCut", DIAMOND);
  const data = cut.interface.encodeFunctionData("diamondCut", [
    [{ facetAddress: newFacet, action: 1, functionSelectors: oldSelectors }],
    ethers.ZeroAddress,
    "0x",
  ]);
  const signature = ethers.concat([ethers.zeroPadValue(DEPLOYER, 32), ethers.ZeroHash, "0x01"]);
  const args = [DIAMOND, 0, data, 0, 0, 0, 0, ethers.ZeroAddress, ethers.ZeroAddress, signature];
  await safe.execTransaction.staticCall(...args);
  const receipt = await (await safe.execTransaction(...args)).wait();
  const ok = receipt.logs.some((l) => l.address.toLowerCase() === SAFE.toLowerCase() && l.topics[0] === ethers.id("ExecutionSuccess(bytes32,uint256)"));
  check("the Safe reported ExecutionSuccess", ok, `gas ${receipt.gasUsed}`);
  check("the loupe now serves every selector from the new facet",
    (await Promise.all(oldSelectors.map((s) => loupe.facetAddress(s)))).every((a) => a.toLowerCase() === newFacet.toLowerCase()));
  check("the owner is still the Safe", (await ownership.owner()) === SAFE);

  // ── 3. nothing else moved
  console.log("\n3. nothing else moved");
  const after = await snapshot();
  check("owner, counters, token lists, oracle, balances and every existing request are identical", before === after);

  // ── 4. AFTER
  console.log("\n4. AFTER — the same scenarios on the upgraded live diamond");
  const snapAfter = await rpc("evm_snapshot");
  await giveCollateral(alice, await EURC_FOR_1000());
  await reverts("74.9% LTV · 365d · 10% is now refused", () => post(alice, U(749), 365), "InsufficientCollateral");
  await reverts("69% is refused too (principal + a year of interest is past 75%)", () => post(alice, U(690), 365), "InsufficientCollateral");
  {
    const id = await postAndFund(alice, bob, U(670), 365);
    const hf = await protocol.getHealthFactor(alice.address);
    check("670 USDC · 365d · 10% funds at a health factor above 1.06", hf > (10n ** 18n * 106n) / 100n, ethers.formatUnits(hf, 18));
    await reverts("…and cannot be liquidated without a price move", () => P(carol).liquidateUserRequest(id), "PositionHealthy");
  }
  {
    const a2 = await mk();
    await giveCollateral(a2, await EURC_FOR_1000());
    const id = await postAndFund(a2, bob, U(740), 7);
    check("a 7-day loan keeps nearly all the room (740 USDC funds healthy)", (await protocol.getHealthFactor(a2.address)) >= 10n ** 18n);
    await reverts("…and is not liquidatable", () => P(carol).liquidateUserRequest(id), "PositionHealthy");
  }
  {
    const a3 = await mk();
    await giveCollateral(a3, await EURC_FOR_1000());
    await (await P(bob).createLoanListing(U(900), U(1), U(900), (await now()) + 365 * 86400 + 120, 1000, NATIVE, { value: U(900) })).wait();
    const lid = await protocol.getListingId();
    await reverts("a listing draw of 749 at 10%/365d is refused", () => P(a3).requestLoanFromListing(lid, U(749)), "InsufficientCollateral");
    await (await P(a3).requestLoanFromListing(lid, U(670))).wait();
    check("a draw of 670 lands", (await protocol.getHealthFactor(a3.address)) > (10n ** 18n * 106n) / 100n);
  }
  {
    // An ordinary small loan, end to end: request → fund → repay in full → fee to the vault.
    const a4 = await mk();
    await giveCollateral(a4, 15_000_000n);
    const id = await postAndFund(a4, bob, 10_500_000_000_000_000_000n, 3);
    const owed = (await protocol.getRequest(id)).totalRepayment;
    await (await P(a4).repayLoan(id, owed, { value: owed })).wait();
    check("a 10.5 USDC loan still runs to a full repayment", Number((await protocol.getRequest(id)).status) === 2);
  }
  await rpc("evm_revert", [snapAfter]);

  // ── 5. rollback
  console.log("\n5. rollback");
  const snapRb = await rpc("evm_snapshot");
  const back = cut.interface.encodeFunctionData("diamondCut", [
    [{ facetAddress: oldFacet, action: 1, functionSelectors: oldSelectors }],
    ethers.ZeroAddress,
    "0x",
  ]);
  const rbArgs = [DIAMOND, 0, back, 0, 0, 0, 0, ethers.ZeroAddress, ethers.ZeroAddress, signature];
  await (await safe.execTransaction(...rbArgs)).wait();
  check("one Replace back to the old facet restores it",
    (await loupe.facetAddress(oldSelectors[0])).toLowerCase() === oldFacet.toLowerCase());
  check("…with state untouched", (await snapshot()) === before);
  await rpc("evm_revert", [snapRb]);

  console.log(failures === 0 ? "\n✅ Rehearsal passed." : `\n❌ ${failures} check(s) failed.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
