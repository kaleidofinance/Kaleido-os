/**
 * Prepare an admin action as a Safe transaction you can sign in the Safe web app
 * (app.safe.global, which supports Arc) — with one signer today and with two or more
 * tomorrow. READ-ONLY: it sends nothing and needs no key. It reads the chain to check
 * the action makes sense, then writes:
 *
 *   safe-txs/<time>-<action>.json   a batch file for the Safe "Transaction Builder"
 *                                   (Apps → Transaction Builder → drop the file in)
 *   safe-txs/<time>-<action>.md     a plain-language REVIEW CARD: what it does, what it
 *                                   targets, the decoded call, the exact calldata, and
 *                                   the Safe transaction hash the signers' devices show
 *
 *   ACTION=<name> [VARS…] npx hardhat run scripts/safe-tx.js --network arcMainnet
 *
 * Actions (VARS in brackets; TARGET defaults are the live Arc mainnet contracts):
 *   pause | unpause                          the lending market (DIAMOND)
 *   accept-ownership        [TARGET]         the Safe accepts a nominated ownership
 *   transfer-ownership      TARGET NEW_OWNER
 *   set-aggregator          AGGREGATOR ALLOWED=true|false [TARGET=orders]
 *   set-filler-fee          BPS [TARGET=orders]
 *   set-token-feed          TOKEN FEED_ID    (LendingAdminFacet on DIAMOND)
 *   set-feed-max-age        FEED_ID MAX_AGE  (DIAMOND)
 *   facet-upgrade           NEW_FACET [FACET=ProtocolFacet]
 *                           a pure Replace of whatever the live facet serves; deploy the
 *                           facet first (any wallet can); also writes a ROLLBACK file
 *   safe-add-owner          NEW_OWNER THRESHOLD
 *   safe-remove-owner       OWNER THRESHOLD
 *   safe-swap-owner         OLD_OWNER NEW_OWNER
 *   safe-change-threshold   THRESHOLD
 *   call                    TARGET SIGNATURE="fn(type,type)" ARGS='[…json…]'  (any other call)
 *   raw                     TARGET DATA=0x…
 *
 * Refuses an owner change that would leave the threshold above the number of owners
 * (which would lock the Safe for ever). See docs/guides/SAFE_ADMIN.md for the signing
 * walk-through.
 */
const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

/* The live Arc mainnet contracts, as defaults; override with env for another chain. */
const DEFAULTS = {
  5042: {
    SAFE: "0x4c72B4799d374D2Ad9a8C9716766f8325808B94F",
    DIAMOND: "0xE4e7f16DB22e6bb2E505fbC504d7B2B4B995A6E3",
    ORDERS: "0x83CA08cd25a663f0a66bda93E5f3c67D382C9856",
  },
};

const SAFE_ABI = [
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function nonce() view returns (uint256)",
  "function getTransactionHash(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 _nonce) view returns (bytes32)",
  // calls the Safe makes on itself:
  "function addOwnerWithThreshold(address owner, uint256 _threshold)",
  "function removeOwner(address prevOwner, address owner, uint256 _threshold)",
  "function swapOwner(address prevOwner, address oldOwner, address newOwner)",
  "function changeThreshold(uint256 _threshold)",
];
const SENTINEL = "0x0000000000000000000000000000000000000001";

const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== "" ? process.env[k] : d);
const need = (k) => {
  const v = process.env[k];
  if (v === undefined || v === "") throw new Error(`${k} is required for this action.`);
  return v;
};
const addr = (k, d) => ethers.getAddress(d !== undefined ? env(k, d) : need(k));

async function main() {
  const ACTION = (process.env.ACTION || "").toLowerCase();
  if (!ACTION) throw new Error("Set ACTION (see the header of scripts/safe-tx.js for the list).");
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const D = DEFAULTS[chainId] || {};
  const SAFE = addr("SAFE_ADDRESS", D.SAFE);
  const DIAMOND = () => addr("DIAMOND", D.DIAMOND);
  const ORDERS = () => addr("ORDERS", D.ORDERS);
  const safe = new ethers.Contract(SAFE, SAFE_ABI, ethers.provider);

  const [owners, threshold, nonce] = await Promise.all([safe.getOwners(), safe.getThreshold(), safe.nonce()]);

  /* ABIs used only to DECODE the call back into words for the review card. */
  const art = (rel) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "artifacts", "contracts", rel), "utf8")).abi;
  const known = [
    ["Safe", new ethers.Interface(SAFE_ABI)],
    ["ProtocolFacet", new ethers.Interface(art("facets/ProtocolFacet.sol/ProtocolFacet.json"))],
    ["LendingAdminFacet", new ethers.Interface(art("facets/LendingAdminFacet.sol/LendingAdminFacet.json"))],
    ["OwnershipFacet", new ethers.Interface(art("facets/OwnershipFacet.sol/OwnershipFacet.json"))],
    ["IDiamondCut", new ethers.Interface(art("interfaces/IDiamondCut.sol/IDiamondCut.json"))],
    ["KaleidoOrdersV2", new ethers.Interface(art("Orders/KaleidoOrdersV2.sol/KaleidoOrdersV2.json"))],
  ];
  const decode = (data) => {
    for (const [name, iface] of known) {
      try {
        const p = iface.parseTransaction({ data });
        if (p) return { contract: name, fn: p.signature, args: p.args };
      } catch { /* next */ }
    }
    return null;
  };
  const enc = (sig, args) => new ethers.Interface([`function ${sig}`]).encodeFunctionData(sig.split("(")[0], args);

  const notes = [];
  let to, data, title, what, risk = "medium", extra = [], rollback = null;

  const mustHaveCode = async (a, label) => {
    if ((await ethers.provider.getCode(a)) === "0x") throw new Error(`${label} ${a} has no contract code on this chain.`);
  };

  switch (ACTION) {
    case "pause":
    case "unpause": {
      to = DIAMOND();
      data = enc(`${ACTION}()`, []);
      title = `${ACTION === "pause" ? "Pause" : "Unpause"} the lending market`;
      what =
        ACTION === "pause"
          ? "Stops NEW loans, listings, fills and draws. Repaying, adding or withdrawing collateral and liquidation keep working, so nobody is trapped."
          : "Re-opens new loans, listings, fills and draws.";
      risk = ACTION === "pause" ? "medium" : "low";
      break;
    }
    case "accept-ownership": {
      to = addr("TARGET", D.ORDERS);
      await mustHaveCode(to, "TARGET");
      const c = new ethers.Contract(to, ["function pendingOwner() view returns (address)", "function owner() view returns (address)"], ethers.provider);
      const pending = await c.pendingOwner();
      if (pending.toLowerCase() !== SAFE.toLowerCase()) throw new Error(`pendingOwner of ${to} is ${pending}, not the Safe — nothing to accept.`);
      data = enc("acceptOwnership()", []);
      title = `Accept ownership of ${to}`;
      what = `The Safe becomes the owner (currently ${await c.owner()}).`;
      risk = "high";
      break;
    }
    case "transfer-ownership": {
      to = addr("TARGET");
      await mustHaveCode(to, "TARGET");
      const next = addr("NEW_OWNER");
      data = enc("transferOwnership(address)", [next]);
      title = `Nominate ${next} as the new owner of ${to}`;
      what = "Two-step: only the nomination is recorded; ownership moves when the nominee accepts.";
      risk = "high";
      break;
    }
    case "set-aggregator": {
      to = addr("TARGET", D.ORDERS);
      await mustHaveCode(to, "TARGET");
      const agg = addr("AGGREGATOR");
      const allowed = need("ALLOWED").toLowerCase() === "true";
      data = enc("setAggregator(address,bool)", [agg, allowed]);
      title = `${allowed ? "Allow" : "Stop allowing"} ${agg} as a router for limit-order fills`;
      what = allowed
        ? "Fills may now call this contract. Only allow a router you have reviewed: a fill hands it the maker's input tokens."
        : "Fills can no longer route through this contract.";
      risk = allowed ? "high" : "medium";
      if (allowed) await mustHaveCode(agg, "AGGREGATOR");
      break;
    }
    case "set-filler-fee": {
      to = addr("TARGET", D.ORDERS);
      await mustHaveCode(to, "TARGET");
      const bps = Number(need("BPS"));
      data = enc("setFillerFeeBps(uint16)", [bps]);
      title = `Set the filler fee to ${bps} bps (${bps / 100}%)`;
      what = "The share of a fill's input paid to the filler. The contract caps it (MAX_FILLER_FEE_BPS).";
      break;
    }
    case "set-token-feed": {
      to = DIAMOND();
      data = enc("setTokenFeed(address,bytes32)", [addr("TOKEN"), need("FEED_ID")]);
      title = `Point ${addr("TOKEN")} at price feed ${need("FEED_ID")}`;
      what = "Re-points a registered token's price feed in place, keeping balances. A wrong feed misprices every position in that token.";
      risk = "high";
      break;
    }
    case "set-feed-max-age": {
      to = DIAMOND();
      data = enc("setFeedMaxAge(bytes32,uint256)", [need("FEED_ID"), BigInt(need("MAX_AGE"))]);
      title = `Set the max price age of feed ${need("FEED_ID")} to ${need("MAX_AGE")}s`;
      what = "How old a price may be before the market refuses to use it. Must exceed the feed's heartbeat or valid prices get rejected.";
      break;
    }
    case "facet-upgrade": {
      const facetName = env("FACET", "ProtocolFacet");
      const newFacet = addr("NEW_FACET");
      to = DIAMOND();
      await mustHaveCode(newFacet, "NEW_FACET");
      const artifact = await hre.artifacts.readArtifact(facetName);
      const onChain = await ethers.provider.getCode(newFacet);
      const matches = onChain.toLowerCase() === artifact.deployedBytecode.toLowerCase();
      if (!matches) {
        /* A Replace points every live function at this address. If its code is not the build
           this checkout compiled, signing could route the protocol to the wrong contract — so
           this is a refusal, not a warning. (A deliberately different build, or one with
           immutables, needs ALLOW_CODE_MISMATCH=1 and a second pair of eyes.) */
        if (process.env.ALLOW_CODE_MISMATCH !== "1")
          throw new Error(`The code at NEW_FACET ${newFacet} does NOT equal the compiled ${facetName} artifact in this checkout — refusing. Wrong address, or a different build? (Set ALLOW_CODE_MISMATCH=1 only if you know why.)`);
        notes.push(`⚠️  The code at NEW_FACET does NOT equal the compiled ${facetName} artifact (ALLOW_CODE_MISMATCH=1 was set). Verify the build with another person before signing.`);
      }
      const loupe = new ethers.Contract(to, ["function facetAddress(bytes4) view returns (address)", "function facetFunctionSelectors(address) view returns (bytes4[])"], ethers.provider);
      const probe = env("PROBE_SIGNATURE", "createLendingRequest(uint128,uint16,uint256,address)");
      const oldFacet = await loupe.facetAddress(ethers.id(probe).slice(0, 10));
      if (oldFacet === ethers.ZeroAddress) throw new Error(`No facet serves ${probe} on ${to}.`);
      const oldSel = [...(await loupe.facetFunctionSelectors(oldFacet))];
      const iface = new ethers.Interface(artifact.abi);
      const newSel = artifact.abi.filter((f) => f.type === "function").map((f) => ethers.id(ethers.FunctionFragment.from(f).format("sighash")).slice(0, 10));
      const pure = newSel.length === oldSel.length && newSel.every((s) => oldSel.includes(s));
      if (!pure) throw new Error(`Not a pure Replace: the new ${facetName} serves ${newSel.length} selectors, the live facet ${oldSel.length}. That is a different review — stop.`);
      if (oldFacet.toLowerCase() === newFacet.toLowerCase()) notes.push("ℹ️  The live facet already IS this address — this would be a no-op.");
      const cut = new ethers.Interface(["function diamondCut((address facetAddress,uint8 action,bytes4[] functionSelectors)[] _diamondCut,address _init,bytes _calldata)"]);
      data = cut.encodeFunctionData("diamondCut", [[{ facetAddress: newFacet, action: 1, functionSelectors: oldSel }], ethers.ZeroAddress, "0x"]);
      title = `Upgrade ${facetName}: ${oldFacet} → ${newFacet}`;
      what = `Replaces all ${oldSel.length} functions the live ${facetName} serves with the new code. State and balances are untouched. The old code stays on chain.`;
      risk = "high";
      extra.push(`Compiled-artifact check: ${matches ? "✅ the on-chain code equals the compiled artifact" : "❌ MISMATCH"}`);
      extra.push(`Selectors: ${newSel.length} new = ${oldSel.length} live (pure Replace)`);
      rollback = {
        title: `ROLLBACK ${facetName}: ${newFacet} → ${oldFacet}`,
        data: cut.encodeFunctionData("diamondCut", [[{ facetAddress: oldFacet, action: 1, functionSelectors: oldSel }], ethers.ZeroAddress, "0x"]),
        to,
      };
      break;
    }
    case "safe-add-owner": {
      to = SAFE;
      const next = addr("NEW_OWNER");
      const t = Number(need("THRESHOLD"));
      if (owners.map((o) => o.toLowerCase()).includes(next.toLowerCase())) throw new Error(`${next} is already an owner.`);
      if (t < 1 || t > owners.length + 1) throw new Error(`THRESHOLD ${t} must be between 1 and ${owners.length + 1} (owners after the add).`);
      data = enc("addOwnerWithThreshold(address,uint256)", [next, t]);
      title = `Add ${next} as a Safe signer, threshold ${t}-of-${owners.length + 1}`;
      what = `After this, ${t} of ${owners.length + 1} signers must approve every admin action.`;
      risk = "high";
      if (t === 1) notes.push("ℹ️  Threshold stays 1: the new signer can act ALONE too. Raise it with safe-change-threshold once you have confirmed the new signer can sign.");
      break;
    }
    case "safe-remove-owner": {
      to = SAFE;
      const out = addr("OWNER");
      const t = Number(need("THRESHOLD"));
      const i = owners.findIndex((o) => o.toLowerCase() === out.toLowerCase());
      if (i < 0) throw new Error(`${out} is not an owner of the Safe.`);
      if (t < 1 || t > owners.length - 1) throw new Error(`THRESHOLD ${t} must be between 1 and ${owners.length - 1} (owners after the removal) — otherwise the Safe locks for ever.`);
      const prev = i === 0 ? SENTINEL : owners[i - 1];
      data = enc("removeOwner(address,address,uint256)", [prev, out, t]);
      title = `Remove signer ${out}, threshold ${t}-of-${owners.length - 1}`;
      what = "This signer can no longer approve anything.";
      risk = "high";
      break;
    }
    case "safe-swap-owner": {
      to = SAFE;
      const oldO = addr("OLD_OWNER"), newO = addr("NEW_OWNER");
      const i = owners.findIndex((o) => o.toLowerCase() === oldO.toLowerCase());
      if (i < 0) throw new Error(`${oldO} is not an owner of the Safe.`);
      if (owners.map((o) => o.toLowerCase()).includes(newO.toLowerCase())) throw new Error(`${newO} is already an owner.`);
      const prev = i === 0 ? SENTINEL : owners[i - 1];
      data = enc("swapOwner(address,address,address)", [prev, oldO, newO]);
      title = `Replace signer ${oldO} with ${newO}`;
      what = "The old signer loses all power; the new one takes its place. Threshold unchanged.";
      risk = "high";
      break;
    }
    case "safe-change-threshold": {
      to = SAFE;
      const t = Number(need("THRESHOLD"));
      if (t < 1 || t > owners.length) throw new Error(`THRESHOLD ${t} must be between 1 and ${owners.length} (the current number of signers).`);
      data = enc("changeThreshold(uint256)", [t]);
      title = `Change the Safe threshold ${threshold} → ${t}-of-${owners.length}`;
      what = `${t} of ${owners.length} signers must approve every admin action from now on.`;
      risk = "high";
      if (t > Number(threshold)) notes.push("ℹ️  Scripts that sign as a single owner (safe-exec.js, upgrade-facet-via-safe.js, handover-orders-to-safe.js) stop working at threshold 2; use this tool and the Safe app.");
      break;
    }
    case "call": {
      to = addr("TARGET");
      await mustHaveCode(to, "TARGET");
      const sig = need("SIGNATURE");
      data = enc(sig, JSON.parse(env("ARGS", "[]")));
      title = `Call ${sig} on ${to}`;
      what = "A generic call. Read the decoded arguments below carefully.";
      risk = "high";
      break;
    }
    case "raw": {
      to = addr("TARGET");
      data = need("DATA");
      if (!ethers.isHexString(data)) throw new Error("DATA must be 0x-hex.");
      title = `Raw call to ${to}`;
      what = "Raw calldata — nothing here was checked. Verify it with the person who produced it.";
      risk = "high";
      break;
    }
    default:
      throw new Error(`Unknown ACTION "${ACTION}". See the header of scripts/safe-tx.js.`);
  }

  // ── build the review card
  const value = "0";
  const safeTxHash = await safe.getTransactionHash(to, value, data, 0, 0, 0, 0, ethers.ZeroAddress, ethers.ZeroAddress, nonce);
  const dec = decode(data);
  const fmt = (v) => (Array.isArray(v) || (v && v.toArray) ? JSON.stringify((v.toArray ? v.toArray() : v).map((x) => (typeof x === "bigint" ? x.toString() : Array.isArray(x) ? x.map(String) : String(x)))) : typeof v === "bigint" ? v.toString() : String(v));
  const netName = hre.network.name;
  const lines = [];
  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`**Risk:** ${risk.toUpperCase()}   ·   **Chain:** ${netName} (${chainId})   ·   **Safe:** \`${SAFE}\` (${threshold}-of-${owners.length}, nonce ${nonce})`);
  lines.push("");
  lines.push(`**What it does:** ${what}`);
  lines.push("");
  lines.push("## The transaction");
  lines.push(`- **To:** \`${to}\``);
  lines.push(`- **Value:** 0`);
  lines.push(`- **Function:** ${dec ? `\`${dec.fn}\` (${dec.contract})` : "(not decoded — raw calldata)"}`);
  if (dec) dec.args.forEach((a, i) => lines.push(`- **Argument ${i}:** \`${fmt(a)}\``));
  lines.push(`- **Calldata (${(data.length - 2) / 2} bytes):** \`${data.length > 400 ? data.slice(0, 330) + "…" : data}\``);
  lines.push(`- **keccak256(calldata):** \`${ethers.keccak256(data)}\``);
  lines.push("");
  lines.push("## What the signers should see");
  lines.push(`On a hardware wallet the **Safe transaction hash** is shown. For nonce **${nonce}** it must be:`);
  lines.push("");
  lines.push(`\`${safeTxHash}\``);
  lines.push("");
  lines.push("(If the Safe app shows a different nonce, the hash differs — re-run this tool, or compare the To / calldata instead.)");
  if (extra.length) {
    lines.push("");
    lines.push("## Checks");
    extra.forEach((e) => lines.push(`- ${e}`));
  }
  if (notes.length) {
    lines.push("");
    lines.push("## Notes");
    notes.forEach((n) => lines.push(`- ${n}`));
  }
  lines.push("");
  lines.push("## How to sign");
  lines.push("1. app.safe.global → connect → select the Safe → **Apps → Transaction Builder** → drop the `.json` file in → Create batch → Send batch.");
  lines.push("2. Each signer opens the pending transaction in the Safe app and checks **To**, the function and arguments above, and (on a device) the hash. Sign only if they match.");
  lines.push("3. When the threshold is reached, anyone presses **Execute**.");
  lines.push("*No Transaction Builder?* → **New transaction → Custom data**: paste To, Value 0 and the calldata.");

  const batch = (name, t, d) => ({
    version: "1.0",
    chainId: String(chainId),
    createdAt: Date.now(),
    meta: {
      name,
      description: `${what}`.slice(0, 280),
      txBuilderVersion: "1.17.0",
      createdFromSafeAddress: SAFE,
      createdFromOwnerAddress: "",
    },
    transactions: [{ to: t, value, data: d, contractMethod: null, contractInputsValues: null }],
  });

  const outDir = path.join(__dirname, "..", "safe-txs");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
  const base = path.join(outDir, `${stamp}-${ACTION}`);
  fs.writeFileSync(`${base}.json`, JSON.stringify(batch(title, to, data), null, 2) + "\n");
  fs.writeFileSync(`${base}.md`, lines.join("\n") + "\n");
  if (rollback) fs.writeFileSync(`${base}-ROLLBACK.json`, JSON.stringify(batch(rollback.title, rollback.to, rollback.data), null, 2) + "\n");

  console.log(lines.slice(0, 20).join("\n"));
  console.log("\n────────────────────────────────────────────");
  console.log(`wrote ${path.relative(process.cwd(), base)}.json`);
  console.log(`wrote ${path.relative(process.cwd(), base)}.md   (the review card)`);
  if (rollback) console.log(`wrote ${path.relative(process.cwd(), base)}-ROLLBACK.json   (the one-step way back)`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
