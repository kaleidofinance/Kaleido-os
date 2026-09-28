/**
 * Upgrade an EXISTING lending diamond to the Arc-mainnet-hardened facets
 * (Phase A + B, PRs #461/#462) in ONE diamondCut, keeping every position.
 *
 *   ProtocolFacet     Replace (+ Add new selectors, Remove the dead pyth()/pythPriceOracle())
 *   OwnershipFacet    Replace (+ Add acceptOwnership / pendingOwner) → two-step ownership
 *   LendingAdminFacet Add (pause / unpause / paused / setTokenFeed)
 *
 * `upgrade-facet.js` can only Replace, and this needs Add + Replace + Remove, so
 * this is its own script. Storage is compatible by construction (reviewed): the
 * `paused` flag lands in the slot the never-written `IPyth pyth` variable held,
 * `pendingOwner` is appended to the diamond's keccak-slot struct, and the vendored
 * reentrancy guard has OpenZeppelin's exact layout. The script still PROVES it:
 * it reads a cross-section of live state (every request, every lock, every
 * participant's balances, the config) before and after the cut and refuses to
 * call the upgrade good if one value moved.
 *
 * Usage (fork first — always):
 *   anvil --fork-url <testnet rpc> --port 8545
 *   KALEIDO_DIAMOND=0x… FORK=1 npx hardhat run scripts/upgrade-lending-hardening.js --network fork
 *     FORK=1       anvil only: act as the diamond owner by impersonation (no key)
 *     DRY_RUN=1    print the cut and the state snapshot, send nothing
 *     NEW_OWNER=0x… after the upgrade, nominate a new owner (two-step)
 *     ACCEPT=1     (FORK only) also accept as NEW_OWNER by impersonation
 * Real run (testnets): the cut must be signed by the current owner; pass its key
 * as OWNER_PRIVATE_KEY (never printed). Facets are deployed by the hardhat signer.
 */
const hre = require("hardhat");
const { ethers } = hre;
const { getSelectors } = require("./libraries/diamond.js");
const { confirmMainnet } = require("./libraries/mainnet-guard.js");

const DRY_RUN = process.env.DRY_RUN === "1";
const FORK = process.env.FORK === "1";
const FacetCutAction = { Add: 0, Replace: 1, Remove: 2 };
const TARGETS = ["ProtocolFacet", "OwnershipFacet", "LendingAdminFacet"];
/* Selectors the new code dropped on purpose. Anything else an old facet serves
 * that the new one does not is refused until a human looks at it. */
const EXPECTED_REMOVALS = new Map(
  ["pyth()", "pythPriceOracle()"].map((sig) => [ethers.id(sig).slice(0, 10), sig]),
);

// Minimal ABI: only fields every facet version since the rebuild shares.
const READ = new ethers.Interface([
  "function owner() view returns (address)",
  "function getAllCollateralToken() view returns (address[])",
  "function getLoanableAssets() view returns (address[])",
  "function getBPS() view returns (uint256)",
  "function getLiquidityBPS() view returns (uint256)",
  "function getPythPriceOracle() view returns (address)",
  "function getAllRequests(uint256,uint256) view returns (tuple(uint96 listingId,uint96 requestId,address author,uint256 amount,uint16 interest,uint256 totalRepayment,uint256 returnDate,address lender,address loanRequestAddr,address[] collateralTokens,uint8 status)[])",
  "function getRequestToColateral(uint96,address) view returns (uint256)",
  "function gets_addressToCollateralDeposited(address,address) view returns (uint256)",
  "function gets_addressToAvailableBalance(address,address) view returns (uint256)",
  "function paused() view returns (bool)",
  "function pendingOwner() view returns (address)",
]);

async function call(diamond, fn, args = []) {
  const data = READ.encodeFunctionData(fn, args);
  for (let i = 0; i < 4; i++) {
    try {
      return READ.decodeFunctionResult(fn, await ethers.provider.call({ to: diamond, data }))[0];
    } catch (e) {
      if (e.code === "CALL_EXCEPTION" || e.code === "BAD_DATA") throw e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw new Error(`read ${fn} failed after retries`);
}
const safe = async (diamond, fn, args) => {
  try {
    const v = await call(diamond, fn, args);
    return typeof v === "bigint" ? v.toString() : v;
  } catch {
    return "UNREADABLE";
  }
};

/** Every value a storage mistake would move, as a flat key → string map. */
async function crossSection(diamond) {
  const s = {};
  s.owner = await safe(diamond, "owner");
  const coll = await call(diamond, "getAllCollateralToken").catch(() => []);
  const loan = await call(diamond, "getLoanableAssets").catch(() => []);
  s.collateral = [...coll].join(",");
  s.loanable = [...loan].join(",");
  s.bps = await safe(diamond, "getBPS");
  s.liqBps = await safe(diamond, "getLiquidityBPS");
  s.oracle = await safe(diamond, "getPythPriceOracle");
  const reqs = await call(diamond, "getAllRequests", [0, 100000]).catch(() => []);
  const users = new Set();
  const tokens = [...new Set([...coll, ...loan])];
  for (const r of reqs) {
    const id = r.requestId;
    s[`req${id}`] = [r.author, r.lender, r.amount, r.totalRepayment, r.returnDate, r.status, [...r.collateralTokens].join("|")].join(" ");
    users.add(r.author);
    if (r.lender !== ethers.ZeroAddress) users.add(r.lender);
    for (const t of r.collateralTokens) s[`lock${id}:${t}`] = await safe(diamond, "getRequestToColateral", [id, t]);
  }
  for (const u of users) {
    for (const t of tokens) {
      s[`dep:${u}:${t}`] = await safe(diamond, "gets_addressToCollateralDeposited", [u, t]);
      s[`free:${u}:${t}`] = await safe(diamond, "gets_addressToAvailableBalance", [u, t]);
    }
  }
  return { s, requests: reqs.length, users: users.size, tokens: tokens.length };
}

async function waitReceipt(hash) {
  for (let i = 0; i < 240; i++) {
    const rc = await ethers.provider.getTransactionReceipt(hash);
    if (rc) {
      if (rc.status !== 1) throw new Error(`transaction reverted: ${hash}`);
      return rc;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`no receipt for ${hash}`);
}

async function main() {
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);
  const diamond = ethers.getAddress((process.env.KALEIDO_DIAMOND || "").trim());
  if ((await ethers.provider.getCode(diamond)) === "0x") throw new Error(`No contract at ${diamond}.`);

  if (FORK) {
    try {
      await ethers.provider.send("anvil_nodeInfo", []);
    } catch {
      throw new Error("FORK=1 needs a local anvil node (impersonation is fork-only).");
    }
  }
  const owner = await call(diamond, "owner");
  console.log(`Upgrading lending diamond ${diamond} on chain ${chainId}${FORK ? " (anvil fork)" : ""}`);
  console.log(`   owner ${owner}`);

  // ── who signs the cut: the owner (impersonated on a fork, or its key)
  let ownerSigner;
  if (FORK) {
    await ethers.provider.send("anvil_impersonateAccount", [owner]);
    await ethers.provider.send("anvil_setBalance", [owner, "0x56BC75E2D63100000"]);
    const raw = new ethers.JsonRpcProvider(hre.network.config.url, chainId, { staticNetwork: true });
    ownerSigner = await raw.getSigner(owner);
  } else if (process.env.OWNER_PRIVATE_KEY) {
    ownerSigner = new ethers.Wallet(process.env.OWNER_PRIVATE_KEY.trim(), ethers.provider);
  } else {
    [ownerSigner] = await ethers.getSigners();
  }
  if (ethers.getAddress(await ownerSigner.getAddress()) !== ethers.getAddress(owner)) {
    throw new Error(`The cut must be signed by the owner ${owner}; signer is ${await ownerSigner.getAddress()}.`);
  }
  const [deployer] = await ethers.getSigners();

  // ── live routing
  const loupe = await ethers.getContractAt("DiamondLoupeFacet", diamond);
  const routedTo = new Map();
  for (const f of await loupe.facets()) for (const sel of f.functionSelectors) routedTo.set(sel.toLowerCase(), f.facetAddress);

  const plan = [];
  const allNew = new Set();
  const oldAddrs = new Set();
  for (const name of TARGETS) {
    const factory = await ethers.getContractFactory(name);
    const sels = getSelectors(factory).map((s) => s.toLowerCase());
    sels.forEach((s) => allNew.add(s));
    const replace = sels.filter((s) => routedTo.has(s));
    const add = sels.filter((s) => !routedTo.has(s));
    replace.forEach((s) => oldAddrs.add(routedTo.get(s)));
    plan.push({ name, factory, replace, add });
  }
  const removals = [...routedTo.entries()]
    .filter(([sel, addr]) => oldAddrs.has(addr) && !allNew.has(sel))
    .map(([sel]) => sel);
  const unexpected = removals.filter((s) => !EXPECTED_REMOVALS.has(s));

  console.log("\n── Cut plan ──");
  for (const p of plan) console.log(`   ${p.name.padEnd(18)} replace ${String(p.replace.length).padStart(2)}  add ${String(p.add.length).padStart(2)}${p.add.length ? `  [${p.add.join(", ")}]` : ""}`);
  console.log(`   remove ${removals.length}: ${removals.map((s) => EXPECTED_REMOVALS.get(s) || s).join(", ") || "(none)"}`);
  if (unexpected.length) {
    throw new Error(
      `Refusing: the old facets serve ${unexpected.length} selector(s) the new code does not, ` +
        `and they are not the expected dead getters: ${unexpected.join(", ")}. ` +
        "Identify each (an older facet version?) before removing it.",
    );
  }

  confirmMainnet({
    chainId,
    script: "upgrade-lending-hardening.js",
    plan: [
      ["diamond", diamond],
      ["owner (signs the cut)", owner],
      ...plan.map((p) => [p.name, `replace ${p.replace.length}, add ${p.add.length}`]),
      ["remove", removals.map((s) => EXPECTED_REMOVALS.get(s) || s).join(", ")],
      ["then nominate", process.env.NEW_OWNER || "(no ownership change)"],
    ],
  });

  // ── state before
  console.log("\n── Live state before ──");
  const before = await crossSection(diamond);
  console.log(`   ${Object.keys(before.s).length} values: ${before.requests} requests, ${before.users} participants, ${before.tokens} tokens`);
  if (DRY_RUN) {
    console.log("\n🅳 DRY_RUN — nothing deployed or sent.");
    return;
  }

  // ── deploy the three facets (anyone may deploy; only the cut is owner-gated).
  /* On a fork the funded anvil account deploys (the impersonated owner signs via
     a raw provider that cannot await a deployment on automine). On a real
     testnet the OWNER deploys too: it is the account with gas there — the new
     owner starts with none — and it keeps the whole upgrade in one wallet. */
  const facetDeployer = FORK ? deployer : ownerSigner;
  const cut = [];
  if (removals.length) cut.push({ facetAddress: ethers.ZeroAddress, action: FacetCutAction.Remove, functionSelectors: removals });
  for (const p of plan) {
    const c = await p.factory.connect(facetDeployer).deploy();
    await c.waitForDeployment();
    p.address = await c.getAddress();
    console.log(`   deployed ${p.name} ${p.address}`);
    if (p.replace.length) cut.push({ facetAddress: p.address, action: FacetCutAction.Replace, functionSelectors: p.replace });
    if (p.add.length) cut.push({ facetAddress: p.address, action: FacetCutAction.Add, functionSelectors: p.add });
  }

  const cutter = new ethers.Contract(diamond, ["function diamondCut((address,uint8,bytes4[])[],address,bytes)"], ownerSigner);
  const tx = await cutter.diamondCut(cut.map((c) => [c.facetAddress, c.action, c.functionSelectors]), ethers.ZeroAddress, "0x");
  const rc = await waitReceipt(tx.hash);
  console.log(`\n   diamondCut ${tx.hash} (block ${rc.blockNumber}, gas ${rc.gasUsed})`);

  // ── verify routing, state, new behaviour
  let failures = 0;
  const check = (label, ok, detail = "") => {
    console.log(`   ${ok ? "✅" : "❌"} ${label}${detail ? `  (${detail})` : ""}`);
    if (!ok) failures++;
  };
  console.log("\n── After ──");
  for (const p of plan) {
    const want = [...p.replace, ...p.add];
    let wrong = 0;
    for (const s of want) if (ethers.getAddress(await loupe.facetAddress(s)) !== ethers.getAddress(p.address)) wrong++;
    check(`${p.name}: all ${want.length} selectors routed to the new facet`, wrong === 0, wrong ? `${wrong} wrong` : "");
  }
  for (const s of removals) check(`${EXPECTED_REMOVALS.get(s) || s} removed`, (await loupe.facetAddress(s)) === ethers.ZeroAddress);

  const after = await crossSection(diamond);
  const moved = Object.keys(before.s).filter((k) => String(before.s[k]) !== String(after.s[k]));
  check(`live state unchanged (${Object.keys(before.s).length} values)`, moved.length === 0,
    moved.slice(0, 5).map((k) => `${k}: ${before.s[k]} → ${after.s[k]}`).join("; "));
  check("paused() is false (the reused slot was never written)", (await call(diamond, "paused")) === false);
  check("no ownership transfer pending", (await call(diamond, "pendingOwner")) === ethers.ZeroAddress);

  // ── optional: move ownership (two-step)
  const newOwner = (process.env.NEW_OWNER || "").trim();
  if (newOwner) {
    const own = new ethers.Contract(diamond, ["function transferOwnership(address)", "function acceptOwnership()"], ownerSigner);
    await waitReceipt((await own.transferOwnership(ethers.getAddress(newOwner))).hash);
    check(`${newOwner} nominated; owner unchanged until accepted`,
      ethers.getAddress(await call(diamond, "pendingOwner")) === ethers.getAddress(newOwner) &&
        ethers.getAddress(await call(diamond, "owner")) === ethers.getAddress(owner));
    if (process.env.ACCEPT === "1" && !FORK) {
      /* Real testnet: the new owner signs acceptOwnership with the hardhat
         signer (DEPLOYER_PRIVATE_KEY). It usually has no gas on a testnet, so
         the outgoing owner sends it a small top-up first. */
      const [acceptor] = await ethers.getSigners();
      if (ethers.getAddress(acceptor.address) !== ethers.getAddress(newOwner)) {
        throw new Error(`ACCEPT=1 needs the hardhat signer to be NEW_OWNER (${newOwner}); it is ${acceptor.address}.`);
      }
      const topUp = ethers.parseEther(process.env.GAS_TOP_UP || "0.01");
      if ((await ethers.provider.getBalance(newOwner)) < topUp / 2n) {
        await waitReceipt((await ownerSigner.sendTransaction({ to: newOwner, value: topUp })).hash);
        console.log(`   sent ${ethers.formatEther(topUp)} native to ${newOwner} for gas`);
      }
      const nw = new ethers.Contract(diamond, ["function acceptOwnership()"], acceptor);
      await waitReceipt((await nw.acceptOwnership()).hash);
      check(`${newOwner} accepted and now owns it`, ethers.getAddress(await call(diamond, "owner")) === ethers.getAddress(newOwner));
    }
    if (process.env.ACCEPT === "1" && FORK) {
      await ethers.provider.send("anvil_impersonateAccount", [newOwner]);
      await ethers.provider.send("anvil_setBalance", [newOwner, "0x56BC75E2D63100000"]);
      const raw = new ethers.JsonRpcProvider(hre.network.config.url, chainId, { staticNetwork: true });
      const nw = new ethers.Contract(diamond, ["function acceptOwnership()"], await raw.getSigner(newOwner));
      await waitReceipt((await nw.acceptOwnership()).hash);
      check(`${newOwner} accepted and now owns it`, ethers.getAddress(await call(diamond, "owner")) === ethers.getAddress(newOwner));
    }
  }

  console.log(`\n${failures === 0 ? "✅ Upgrade verified." : `❌ ${failures} check(s) failed.`}`);
  if (failures) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
