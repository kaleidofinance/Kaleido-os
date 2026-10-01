/**
 * Replace a facet on a diamond that is OWNED BY A SAFE (threshold 1) — the mainnet
 * path, since upgrade-facet.js signs as the owner and the owner is now the Safe.
 *
 *   # read-only: checks everything, prints the plan, sends nothing
 *   DRY_RUN=1 SAFE_ADDRESS=0x… npx hardhat run scripts/upgrade-facet-via-safe.js --network arcMainnet
 *
 *   # the real thing (deploys the facet, then the Safe executes diamondCut Replace)
 *   CONFIRM_MAINNET=5042 SAFE_ADDRESS=0x… npx hardhat run scripts/upgrade-facet-via-safe.js --network arcMainnet
 *
 *   # roll back / re-run the cut without redeploying: point at an existing facet
 *   FACET_ADDRESS=0x<old facet> CONFIRM_MAINNET=5042 SAFE_ADDRESS=0x… npx hardhat run … --network arcMainnet
 *
 * The same two steps scripts/rehearse-interest-cap-upgrade.js ran on a fork:
 *   1. deploy the new facet (the hardhat signer — the deployer);
 *   2. the Safe executes diamondCut(Replace), signed by that signer as the Safe's
 *      owner ("approved by the sender" signature, nothing signed off-chain).
 *
 * Refuses unless: the diamond's owner IS the Safe, the Safe's threshold is 1 and the
 * signer is one of its owners, and the cut is a PURE Replace — the new facet serves
 * exactly the selectors the live facet does (anything else is a different review).
 * Checks the deployed code equals the compiled artifact before it is wired in, and
 * after the cut that every selector resolves to the new facet and the protocol's
 * state is unchanged. The old facet stays on chain, untouched: rollback is the same
 * command with FACET_ADDRESS set to it.
 */
const hre = require("hardhat");
const { ethers } = hre;
const { confirmMainnet } = require("./libraries/mainnet-guard.js");

const FACET = process.env.FACET || "ProtocolFacet";
const DRY_RUN = process.env.DRY_RUN === "1";
const DIAMOND = process.env.DIAMOND || "0xE4e7f16DB22e6bb2E505fbC504d7B2B4B995A6E3";
/* A facet whose EXISTING selector it already serves — used to find the live facet. */
const PROBE = process.env.PROBE_SIGNATURE || "createLendingRequest(uint128,uint16,uint256,address)";

const SAFE_ABI = [
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function isOwner(address) view returns (bool)",
  "function nonce() view returns (uint256)",
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)",
];
const PROTOCOL_VIEWS = [
  "function getRequestId() view returns (uint256)",
  "function getListingId() view returns (uint256)",
  "function getAllCollateralToken() view returns (address[])",
  "function getLoanableAssets() view returns (address[])",
  "function getPythPriceOracle() view returns (address)",
  "function getAllRequests(uint256,uint256) view returns (tuple(uint96 listingId,uint96 requestId,address author,uint256 amount,uint16 interest,uint256 totalRepayment,uint256 returnDate,address lender,address loanRequestAddr,address[] collateralTokens,uint8 status,uint256 interestAccrued)[])",
  "function paused() view returns (bool)",
];
const ERC20 = ["function balanceOf(address) view returns (uint256)"];

/* Public RPCs drop calls under no load; a failed READ must not abort an upgrade that
   is otherwise fine. Writes are never retried blindly. */
const retry = async (label, fn, n = 6) => {
  let last;
  for (let i = 0; i < n; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw new Error(`${label}: ${last?.shortMessage || last?.message}`);
};

async function main() {
  const [signer] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const safeAddress = ethers.getAddress(process.env.SAFE_ADDRESS || "");
  const diamond = ethers.getAddress(DIAMOND);

  const loupe = await ethers.getContractAt("DiamondLoupeFacet", diamond);
  const ownership = await ethers.getContractAt("OwnershipFacet", diamond);
  const cut = await ethers.getContractAt("IDiamondCut", diamond);
  const views = new ethers.Contract(diamond, PROTOCOL_VIEWS, ethers.provider);
  const safe = new ethers.Contract(safeAddress, SAFE_ABI, signer);

  // ── who owns what
  const [owner, owners, threshold, nonce, isOwner] = await retry("safe state", () =>
    Promise.all([ownership.owner(), safe.getOwners(), safe.getThreshold(), safe.nonce(), safe.isOwner(signer.address)]),
  );
  if (owner.toLowerCase() !== safeAddress.toLowerCase())
    throw new Error(`The diamond is owned by ${owner}, not the Safe ${safeAddress}. Use upgrade-facet.js (owner signs) or fix SAFE_ADDRESS.`);
  if (Number(threshold) !== 1) throw new Error(`Safe threshold is ${threshold}; collect the other signatures in app.safe.global instead.`);
  if (!isOwner) throw new Error(`${signer.address} is not an owner of the Safe (owners: ${owners.join(", ")}).`);

  // ── the compiled facet and the live one
  const artifact = await hre.artifacts.readArtifact(FACET);
  const compiledSize = (artifact.deployedBytecode.length - 2) / 2;
  if (compiledSize > 24576) throw new Error(`${FACET} is ${compiledSize} bytes, over the 24,576 limit.`);
  const iface = new ethers.Interface(artifact.abi);
  const sel = (f) => iface.getFunction(f.name).selector;
  const newSelectors = artifact.abi.filter((f) => f.type === "function").map((f) => ethers.id(ethers.FunctionFragment.from(f).format("sighash")).slice(0, 10));
  const oldFacet = await retry("facetAddress", () => loupe.facetAddress(ethers.id(PROBE).slice(0, 10)));
  if (oldFacet === ethers.ZeroAddress) throw new Error(`No facet serves ${PROBE} on ${diamond}.`);
  const oldSelectors = [...(await retry("facetFunctionSelectors", () => loupe.facetFunctionSelectors(oldFacet)))];
  const samesetup = newSelectors.length === oldSelectors.length && newSelectors.every((s) => oldSelectors.includes(s));
  if (!samesetup)
    throw new Error(
      `Not a pure Replace: the new ${FACET} serves ${newSelectors.length} selectors, the live facet ${oldSelectors.length} ` +
        `(${newSelectors.filter((s) => !oldSelectors.includes(s)).length} new, ${oldSelectors.filter((s) => !newSelectors.includes(s)).length} dropped). Stop and review.`,
    );

  const reuse = process.env.FACET_ADDRESS ? ethers.getAddress(process.env.FACET_ADDRESS) : null;
  const balance = await ethers.provider.getBalance(signer.address);

  // ── state snapshot (compared after the cut)
  async function snapshot() {
    const erc = (t) => new ethers.Contract(t, ERC20, ethers.provider).balanceOf(diamond);
    const collateral = await retry("collateral tokens", () => views.getAllCollateralToken());
    const reqs = await retry("requests", () => views.getAllRequests(0, 10000));
    const tokenBalances = {};
    for (const t of collateral) tokenBalances[t] = String(await retry("balanceOf", () => erc(t)));
    return {
      owner: await ownership.owner(),
      requestId: String(await retry("requestId", () => views.getRequestId())),
      listingId: String(await retry("listingId", () => views.getListingId())),
      collateralTokens: collateral,
      loanable: await retry("loanable", () => views.getLoanableAssets()),
      oracle: await retry("oracle", () => views.getPythPriceOracle()),
      paused: await retry("paused", () => views.paused().catch(() => "n/a")),
      tokenBalances,
      requests: reqs.map((r) => [String(r.requestId), String(r.status), String(r.totalRepayment), r.lender, r.author]),
    };
  }
  const before = await snapshot();

  confirmMainnet({
    chainId,
    script: "upgrade-facet-via-safe.js",
    plan: [
      ["diamond", diamond],
      ["Safe (owner)", `${safeAddress}  nonce ${nonce}, ${threshold}-of-${owners.length}`],
      ["signer", `${signer.address}  balance ${ethers.formatEther(balance)} (native)`],
      ["facet", FACET],
      ["compiled size", `${compiledSize} bytes`],
      ["live facet (replaced)", `${oldFacet}  serving ${oldSelectors.length} selectors`],
      ["new facet", reuse ? `${reuse}  (existing — no deploy)` : "will be deployed by the signer"],
      ["cut", `Replace × ${oldSelectors.length} selectors (pure Replace verified)`],
      ["rollback", `same command with FACET_ADDRESS=${oldFacet}`],
      ["mode", DRY_RUN ? "DRY RUN — sends nothing" : "BROADCAST"],
    ],
    explicit: ["SAFE_ADDRESS"],
  });
  if (DRY_RUN) {
    console.log("DRY RUN complete — nothing sent. State snapshot taken:", {
      requests: before.requests.length,
      requestId: before.requestId,
      listingId: before.listingId,
    });
    return;
  }

  // ── 1. the facet
  let newFacet = reuse;
  if (!newFacet) {
    console.log("1. deploying the new facet …");
    const Factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
    const c = await Factory.deploy({ gasLimit: 7_500_000 });
    await c.waitForDeployment();
    newFacet = await c.getAddress();
    console.log(`   deployed ${newFacet} (tx ${c.deploymentTransaction().hash})`);
  }
  const deployed = await retry("getCode", () => ethers.provider.getCode(newFacet));
  if (deployed.toLowerCase() !== artifact.deployedBytecode.toLowerCase())
    throw new Error(`The code at ${newFacet} does not equal the compiled ${FACET} artifact. NOT wiring it in.`);
  console.log("   ✅ on-chain code equals the compiled artifact");

  // ── 2. the Safe executes the cut
  console.log("2. the Safe executes diamondCut(Replace) …");
  const data = cut.interface.encodeFunctionData("diamondCut", [
    [{ facetAddress: newFacet, action: 1, functionSelectors: oldSelectors }],
    ethers.ZeroAddress,
    "0x",
  ]);
  const signature = ethers.concat([ethers.zeroPadValue(signer.address, 32), ethers.ZeroHash, "0x01"]);
  const args = [diamond, 0, data, 0, 0, 0, 0, ethers.ZeroAddress, ethers.ZeroAddress, signature];
  await safe.execTransaction.staticCall(...args); // throws with the Safe/inner revert reason
  const tx = await safe.execTransaction(...args, { gasLimit: 3_000_000 });
  console.log(`   sent ${tx.hash}`);
  const receipt = await tx.wait();
  const ok = receipt.logs.some((l) => l.address.toLowerCase() === safeAddress.toLowerCase() && l.topics[0] === ethers.id("ExecutionSuccess(bytes32,uint256)"));
  if (!ok) throw new Error(`The Safe reported no ExecutionSuccess — tx ${tx.hash}`);
  console.log(`   ✅ ExecutionSuccess (gas ${receipt.gasUsed})`);

  // ── 3. verify. A lagging public RPC can briefly show the old facet: re-read for ~30s.
  console.log("3. verifying …");
  let allNew = false;
  for (let i = 0; i < 10 && !allNew; i++) {
    const now = await Promise.all(oldSelectors.map((s) => retry("facetAddress", () => loupe.facetAddress(s))));
    allNew = now.every((a) => a.toLowerCase() === newFacet.toLowerCase());
    if (!allNew) await new Promise((r) => setTimeout(r, 3000));
  }
  if (!allNew) throw new Error("Not every selector resolves to the new facet yet — re-check the loupe before doing anything else.");
  console.log(`   ✅ all ${oldSelectors.length} selectors resolve to ${newFacet}`);
  const after = await snapshot();
  const diffs = Object.keys(before).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  if (diffs.length === 0) console.log("   ✅ owner, counters, token lists, oracle, balances and every request are unchanged");
  else console.log(`   ⚠️  these fields differ from the pre-cut snapshot: ${diffs.join(", ")} — inspect (live activity between reads is possible; the cut itself writes no state)`);
  console.log(`\nDone. Old facet (rollback target): ${oldFacet}\nNew facet: ${newFacet}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
