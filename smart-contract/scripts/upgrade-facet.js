/**
 * Replace a facet's implementation on an already-deployed diamond.
 *
 * `deploy.js` only ever performs the initial `Add` cut, so until now there was no
 * way to ship a facet fix to the five live diamonds. This is that path.
 *
 * ── The two things that make a diamond upgrade dangerous ────────────────────
 *
 *  1. **Selector drift.** `Replace` reverts unless every selector it names is
 *     already served by some facet, and it silently leaves behind any selector
 *     the new ABI dropped. So the cut is computed against the LIVE loupe, never
 *     against the deployment record — the record is what we *intended* to deploy
 *     — and anything other than a pure `Replace` aborts unless the operator opts
 *     in explicitly. A facet that gained or lost functions is a different review.
 *
 *  2. **Storage layout.** Slot offsets are compile-time constants baked into the
 *     facet bytecode. If the AppStorage struct gained a field anywhere but the
 *     end, the new code reads the old data at the wrong offsets and every
 *     balance in the protocol becomes garbage — with no revert to warn you.
 *     Nothing on-chain can detect this after the fact, so this script reads a
 *     cross-section of live state before the cut and again after, and screams if
 *     any of it moved. That is a smoke alarm, not a proof: validate the upgrade
 *     against a fork first (anvil --fork-url) where a failure costs nothing.
 *
 * ── Usage ──────────────────────────────────────────────────────────────────
 *
 *   npx hardhat run scripts/upgrade-facet.js --network sepolia
 *   DRY_RUN=1 npx hardhat run scripts/upgrade-facet.js --network sepolia
 *   FACET=ProtocolFacet ALLOW_SHAPE_CHANGE=1 npx hardhat run ... --network ...
 *
 * DRY_RUN reports the cut it would send and exits without deploying or signing.
 * Run it first. The old facet address is printed before the cut so a rollback is
 * one `Replace` back to it — the old code is still on chain, untouched.
 */
const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

const FACET = process.env.FACET || "ProtocolFacet";
const DRY_RUN = process.env.DRY_RUN === "1";
const ALLOW_SHAPE_CHANGE = process.env.ALLOW_SHAPE_CHANGE === "1";

const FacetCutAction = { Add: 0, Replace: 1, Remove: 2 };

/* Public RPCs on the newer testnets drop calls under no load at all; a read that
 * fails here would abort an upgrade that is otherwise fine. Writes are NOT
 * retried — see sendCut. */
const retry = async (label, fn, n = 6) => {
  let last;
  for (let i = 1; i <= n; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i < n) await new Promise((r) => setTimeout(r, 4000));
    }
  }
  throw new Error(`${label} failed after ${n} attempts: ${last.shortMessage || last.message}`);
};

function recordPath(net) {
  return path.join(__dirname, "..", `deployment-diamond-${net}.json`);
}

/**
 * A cross-section of live storage, read through the diamond.
 *
 * Every zero-argument view the facet exposes, plus `getFeedMaxAge` for each feed
 * the oracle record names. The point is coverage of the STRUCT, not of the API:
 * scalars near the top, the dynamic arrays in the middle, the fields appended at
 * the end, and at least one mapping — a mapping's slot base is derived from its
 * own slot number, so it moves if anything above it shifts.
 */
async function readCrossSection(diamond, abi, net) {
  const iface = new ethers.Interface(abi);
  const zeroArgViews = [];
  iface.forEachFunction((f) => {
    if ((f.stateMutability === "view" || f.stateMutability === "pure") && f.inputs.length === 0)
      zeroArgViews.push(f.name);
  });

  const c = await ethers.getContractAt(FACET, diamond);
  const out = {};
  for (const name of zeroArgViews) {
    try {
      const v = await retry(name, () => c[name]());
      out[name] = Array.isArray(v) ? [...v].map(String).join(",") : String(v);
    } catch (e) {
      out[name] = `REVERT(${e.message})`;
    }
  }

  if (typeof c.getFeedMaxAge === "function") {
    const oraclePath = path.join(__dirname, "..", `deployment-oracle-${net}.json`);
    if (fs.existsSync(oraclePath)) {
      const oracle = JSON.parse(fs.readFileSync(oraclePath, "utf8"));
      const ids = new Set();
      for (const f of oracle.feeds || []) {
        const id = f.feedId || f.id;
        if (id) ids.add(id);
      }
      for (const id of ids) {
        try {
          out[`getFeedMaxAge(${id.slice(0, 10)}…)`] = String(
            await retry("getFeedMaxAge", () => c.getFeedMaxAge(id)),
          );
        } catch (e) {
          out[`getFeedMaxAge(${id.slice(0, 10)}…)`] = `REVERT(${e.message})`;
        }
      }
    }
  }
  return out;
}

async function main() {
  const net = hre.network.name;
  const rp = recordPath(net);
  if (!fs.existsSync(rp)) throw new Error(`no deployment record at ${rp}`);
  const record = JSON.parse(fs.readFileSync(rp, "utf8"));
  const diamond = record.contracts?.diamond;
  if (!diamond) throw new Error(`record has no contracts.diamond`);
  const recordedFacet = record.facets?.[FACET];

  const [signer] = await ethers.getSigners();
  console.log(`\n🔧 Upgrading ${FACET} on ${net}`);
  console.log(`   diamond ${diamond}`);
  console.log(`   signer  ${signer.address}`);

  /* Ownership first: diamondCut is onlyOwner, and a wrong signer produces a
   * revert that reads like a malformed cut rather than a permissions problem. */
  const ownership = await ethers.getContractAt("OwnershipFacet", diamond);
  const owner = await retry("owner()", () => ownership.owner());
  if (ethers.getAddress(owner) !== ethers.getAddress(signer.address)) {
    throw new Error(
      `diamond is owned by ${owner}, signer is ${signer.address}. diamondCut is onlyOwner.`,
    );
  }
  console.log(`   owner   ${owner} (matches signer)`);

  const artifact = await hre.artifacts.readArtifact(FACET);
  const iface = new ethers.Interface(artifact.abi);
  const fresh = new Map();
  iface.forEachFunction((f) => fresh.set(f.selector, f.format("sighash")));

  /* The live map. Grouped by owning facet so a selector that lives somewhere
   * unexpected is visible rather than assumed. */
  const loupe = await ethers.getContractAt("DiamondLoupeFacet", diamond);
  const facets = await retry("facets()", () => loupe.facets());
  const ownerOf = new Map();
  for (const f of facets)
    for (const s of f.functionSelectors)
      ownerOf.set(s, ethers.getAddress(f.facetAddress));

  const replace = [];
  const add = [];
  for (const [sel, sig] of fresh) {
    if (ownerOf.has(sel)) replace.push(sel);
    else add.push(`${sel} ${sig}`);
  }
  /* Selectors the OLD facet serves that the new ABI no longer declares. Left in
   * place by a Replace, so they would keep executing old code. */
  const currentlyOnTarget = recordedFacet
    ? [...ownerOf.entries()]
        .filter(([, a]) => a === ethers.getAddress(recordedFacet))
        .map(([s]) => s)
    : [];
  const orphaned = currentlyOnTarget.filter((s) => !fresh.has(s));

  console.log(`\n   selectors: ${fresh.size} in the new ABI`);
  console.log(`   REPLACE ${replace.length}   ADD ${add.length}   ORPHANED ${orphaned.length}`);
  add.forEach((a) => console.log(`     + ${a}`));
  orphaned.forEach((s) => console.log(`     - ${s} (would keep running old code)`));

  if ((add.length || orphaned.length) && !ALLOW_SHAPE_CHANGE) {
    throw new Error(
      `${FACET}'s selector set changed (${add.length} added, ${orphaned.length} orphaned). ` +
        `That is a different review than an implementation swap: an Add needs the new ` +
        `function audited, an orphan needs a Remove. Re-run with ALLOW_SHAPE_CHANGE=1 ` +
        `only once you have decided what each one should be.`,
    );
  }

  /* Nothing to do is a success, not an error — this makes the script safe to run
   * across all chains without tracking which ones are already current. */
  const onchainCode = await retry("getCode", () =>
    ethers.provider.getCode(recordedFacet || ethers.ZeroAddress),
  );
  if (
    recordedFacet &&
    onchainCode.toLowerCase() === artifact.deployedBytecode.toLowerCase()
  ) {
    console.log(`\n✅ deployed ${FACET} bytecode already matches the artifact — nothing to do.`);
    return;
  }

  console.log(`\n   reading live state cross-section before the cut …`);
  const before = await readCrossSection(diamond, artifact.abi, net);
  console.log(`   ${Object.keys(before).length} values captured`);

  if (DRY_RUN) {
    console.log(`\n🅳 DRY_RUN — would deploy a new ${FACET} and Replace ${replace.length} selectors. Nothing sent.`);
    return;
  }

  console.log(`\n   deploying new ${FACET} …`);
  const Factory = await ethers.getContractFactory(FACET);
  const nf = await Factory.deploy();
  await nf.waitForDeployment();
  const newFacet = await nf.getAddress();
  console.log(`   new ${FACET} ${newFacet}`);
  console.log(`   ROLLBACK: Replace these selectors back to ${recordedFacet} (old code still on chain)`);

  console.log(`\n   executing diamondCut Replace (${replace.length} selectors) …`);
  const cutter = await ethers.getContractAt("IDiamondCut", diamond);
  /* Not retried. A resent cut can land twice, and the second one reverts on a
   * selector the first already moved — which reads as a failed upgrade when it
   * actually succeeded. Let it fail and re-run the script; it is idempotent. */
  const tx = await cutter.diamondCut(
    [{ facetAddress: newFacet, action: FacetCutAction.Replace, functionSelectors: replace }],
    ethers.ZeroAddress,
    "0x",
  );
  console.log(`   tx ${tx.hash}`);
  const rcpt = await tx.wait();
  console.log(`   mined in block ${rcpt.blockNumber}, gas ${rcpt.gasUsed}`);

  /* Read-back: the cut reporting success is not the same as the selectors having
   * moved. Sample rather than all 68 on the flaky chains — but sample widely. */
  console.log(`\n   verifying selector routing …`);
  let wrong = 0;
  for (const sel of replace) {
    const a = await retry(`facetAddress(${sel})`, () => loupe.facetAddress(sel));
    if (ethers.getAddress(a) !== ethers.getAddress(newFacet)) {
      wrong++;
      console.log(`     !! ${sel} -> ${a}, expected ${newFacet}`);
    }
  }
  console.log(`   ${replace.length - wrong}/${replace.length} selectors now served by the new facet`);
  if (wrong) throw new Error(`${wrong} selectors did not move — the diamond is in a mixed state`);

  console.log(`\n   re-reading the state cross-section …`);
  const after = await readCrossSection(diamond, artifact.abi, net);
  let diffs = 0;
  for (const k of Object.keys(before)) {
    if (before[k] !== after[k]) {
      diffs++;
      console.log(`     !! ${k}\n        before: ${before[k]}\n        after : ${after[k]}`);
    }
  }
  if (diffs) {
    throw new Error(
      `${diffs} of ${Object.keys(before).length} live values CHANGED across the cut. ` +
        `This is the storage-layout failure mode. Roll back immediately: Replace the ` +
        `selectors back to ${recordedFacet}.`,
    );
  }
  console.log(`   ${Object.keys(before).length}/${Object.keys(before).length} values unchanged ✅`);

  /* Record last, and only on success, so a record that names the new facet always
   * means the new facet is the one serving traffic. */
  record.facets = record.facets || {};
  const previous = record.facets[FACET];
  record.facets[FACET] = newFacet;
  record.upgrades = record.upgrades || [];
  record.upgrades.push({
    facet: FACET,
    from: previous || null,
    to: newFacet,
    txHash: tx.hash,
    block: rcpt.blockNumber,
    selectorsReplaced: replace.length,
    signer: signer.address,
    /* No timestamp from the host clock: the block is the authoritative time and
     * it is already recorded above. */
  });
  fs.writeFileSync(rp, JSON.stringify(record, null, 2) + "\n");
  console.log(`\n✅ ${FACET} upgraded on ${net}. Record updated: ${path.basename(rp)}`);
}

main().catch((e) => {
  console.error(`\n❌ ${e.message}`);
  process.exit(1);
});
