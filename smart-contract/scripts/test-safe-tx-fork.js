/**
 * Test scripts/safe-tx.js against a FORK of Arc mainnet — every action, end to end:
 *
 *   anvil --fork-url https://rpc.mainnet.arc.io --chain-id 5042 --compute-units-per-second 10 --retries 30
 *   npx hardhat run scripts/test-safe-tx-fork.js --network arcFork
 *
 * For each action it runs the REAL tool (as a child process, exactly as an operator
 * would), reads the Transaction Builder file it wrote, then executes that transaction
 * through the live Safe — signing the way the Safe app does, with a pre-approved hash:
 * each signer calls approveHash(<the hash printed on the review card>), then
 * execTransaction is sent with their approvals as the signatures. That path only works
 * if the hash on the card equals the hash the Safe itself computes, so it proves the
 * number a signer compares on their device is the right one. Then it checks the EFFECT.
 *
 * Also: a real 2-of-2 flow (one approval is refused, two succeed) and the guard rails
 * (refuses a threshold that would lock the Safe, an impure facet swap, nothing to accept).
 *
 * FORK ONLY: it impersonates the Safe's signer and writes to a fork. Refuses without anvil.
 */
const hre = require("hardhat");
const { ethers } = hre;
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const SAFE = "0x4c72B4799d374D2Ad9a8C9716766f8325808B94F";
const DIAMOND = "0xE4e7f16DB22e6bb2E505fbC504d7B2B4B995A6E3";
const ORDERS = "0x83CA08cd25a663f0a66bda93E5f3c67D382C9856";
const DEPLOYER = "0x0Ce7f8Aeaad60b9E19ACBe9803518182adC351Bc";
const KYBER = "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5";

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
    throw new Error("The node is not anvil.");
  }
  const rpc = (m, p = []) => ethers.provider.send(m, p);
  const raw = new ethers.JsonRpcProvider("http://127.0.0.1:8545", undefined, { staticNetwork: true });
  const signerOf = async (a) => {
    await rpc("anvil_impersonateAccount", [a]);
    await rpc("anvil_setBalance", [a, "0x3635C9ADC5DEA00000"]);
    return raw.getSigner(a);
  };
  const deployer = await signerOf(DEPLOYER);
  const [relayer] = await ethers.getSigners(); // anyone can send the final execute
  await rpc("anvil_setBalance", [relayer.address, "0x3635C9ADC5DEA00000"]);

  const safeAbi = [
    "function getOwners() view returns (address[])",
    "function getThreshold() view returns (uint256)",
    "function nonce() view returns (uint256)",
    "function approveHash(bytes32)",
    "function getTransactionHash(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,uint256) view returns (bytes32)",
    "function execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes) payable returns (bool)",
  ];
  const safe = new ethers.Contract(SAFE, safeAbi, relayer);
  const diamond = new ethers.Contract(DIAMOND, ["function paused() view returns (bool)"], ethers.provider);
  const loupe = await ethers.getContractAt("DiamondLoupeFacet", DIAMOND);
  const orders = new ethers.Contract(ORDERS, ["function isAggregator(address) view returns (bool)", "function fillerFeeBps() view returns (uint16)"], ethers.provider);

  /* Run the real tool; returns { batch, cardHash, card } or throws its message. */
  const tool = (action, vars = {}) => {
    const dir = path.join(__dirname, "..", "safe-txs");
    const before = new Set(fs.existsSync(dir) ? fs.readdirSync(dir) : []);
    let out;
    try {
      out = execFileSync("npx", ["hardhat", "run", "scripts/safe-tx.js", "--network", hre.network.name], {
        cwd: path.join(__dirname, ".."),
        env: { ...process.env, ACTION: action, ...vars },
        encoding: "utf8",
        shell: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      const msg = `${e.stdout || ""}${e.stderr || ""}`.split("\n").find((l) => l.trim() && !l.includes("npm notice") && !l.includes("hardhat run")) || "failed";
      throw new Error(msg.trim());
    }
    const files = fs.readdirSync(dir).filter((f) => !before.has(f));
    const jsonF = files.find((f) => f.endsWith(`-${action}.json`));
    const cardF = files.find((f) => f.endsWith(`-${action}.md`));
    const card = fs.readFileSync(path.join(dir, cardF), "utf8");
    const after = card.slice(card.indexOf("it must be:"));
    const cardHash = (after.match(/`(0x[0-9a-f]{64})`/) || [])[1];
    const rollbackF = files.find((f) => f.endsWith("-ROLLBACK.json"));
    return {
      batch: JSON.parse(fs.readFileSync(path.join(dir, jsonF), "utf8")),
      rollback: rollbackF ? JSON.parse(fs.readFileSync(path.join(dir, rollbackF), "utf8")) : null,
      cardHash,
      card,
    };
  };

  /* Execute a tool-produced transaction through the Safe the way the Safe app does: each
     listed signer approves the CARD's hash on chain; the signatures are their approvals,
     sorted by signer address. Returns normally on success, throws the revert otherwise. */
  async function execThroughSafe(t, signers) {
    const tx = t.batch.transactions[0];
    const nonce = await safe.nonce();
    const onChainHash = await safe.getTransactionHash(tx.to, 0, tx.data, 0, 0, 0, 0, ethers.ZeroAddress, ethers.ZeroAddress, nonce);
    if (t.cardHash !== onChainHash) throw new Error(`HASH MISMATCH: card ${t.cardHash} vs Safe ${onChainHash}`);
    for (const s of signers) await (await new ethers.Contract(SAFE, safeAbi, await signerOf(s)).approveHash(onChainHash)).wait();
    const sigs = ethers.concat(
      [...signers].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1)).map((s) => ethers.concat([ethers.zeroPadValue(s, 32), ethers.ZeroHash, "0x01"])),
    );
    const args = [tx.to, 0, tx.data, 0, 0, 0, 0, ethers.ZeroAddress, ethers.ZeroAddress, sigs];
    await safe.execTransaction.staticCall(...args);
    await (await safe.execTransaction(...args, { gasLimit: 6_000_000 })).wait();
  }
  const owners = async () => (await safe.getOwners()).map((o) => o.toLowerCase());

  console.log(`Fork of Arc mainnet at block ${await ethers.provider.getBlockNumber()}`);
  check("the live Safe is 1-of-1 with the deployer as its signer", (await safe.getThreshold()) === 1n && (await owners()).includes(DEPLOYER.toLowerCase()));

  // ── pause / unpause
  console.log("\n1. pause / unpause (the lending market)");
  {
    let t = tool("pause");
    check("the card names the function and the target", /`pause\(\)`/.test(t.card) && t.card.includes(DIAMOND));
    await execThroughSafe(t, [DEPLOYER]);
    check("pause: the market is paused (and the card's hash was the Safe's own)", (await diamond.paused()) === true);
    t = tool("unpause");
    await execThroughSafe(t, [DEPLOYER]);
    check("unpause: the market is open again", (await diamond.paused()) === false);
  }

  // ── orders admin
  console.log("\n2. limit-orders admin (set-aggregator, set-filler-fee)");
  {
    let t = tool("set-aggregator", { AGGREGATOR: KYBER, ALLOWED: "false" });
    await execThroughSafe(t, [DEPLOYER]);
    check("set-aggregator false: the router is off the allowlist", (await orders.isAggregator(KYBER)) === false);
    t = tool("set-aggregator", { AGGREGATOR: KYBER, ALLOWED: "true" });
    check("allowing a router is flagged HIGH risk", /\*\*Risk:\*\* HIGH/.test(t.card));
    await execThroughSafe(t, [DEPLOYER]);
    check("set-aggregator true: the router is back", (await orders.isAggregator(KYBER)) === true);
    t = tool("set-filler-fee", { BPS: "10" });
    await execThroughSafe(t, [DEPLOYER]);
    check("set-filler-fee 10: fee is 10 bps", (await orders.fillerFeeBps()) === 10n);
    t = tool("set-filler-fee", { BPS: "0" });
    await execThroughSafe(t, [DEPLOYER]);
    check("…and back to 0", (await orders.fillerFeeBps()) === 0n);
  }

  // ── facet upgrade + rollback
  console.log("\n3. facet-upgrade (and the rollback file)");
  {
    const probe = ethers.id("createLendingRequest(uint128,uint16,uint256,address)").slice(0, 10);
    const oldFacet = await loupe.facetAddress(probe);
    const artifact = await hre.artifacts.readArtifact("ProtocolFacet");
    const f = await new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer).deploy();
    await f.waitForDeployment();
    const newFacet = await f.getAddress();
    const t = tool("facet-upgrade", { NEW_FACET: newFacet });
    check("a pure Replace: the card says the compiled artifact matches the chain", /on-chain code equals the compiled artifact/.test(t.card));
    check("a ROLLBACK file was written", !!t.rollback);
    await execThroughSafe(t, [DEPLOYER]);
    check("upgrade: the live facet is now the new one", (await loupe.facetAddress(probe)).toLowerCase() === newFacet.toLowerCase());
    // the rollback file is a ready-to-sign transaction for the old facet
    const rb = { batch: t.rollback, cardHash: null };
    const nonce = await safe.nonce();
    rb.cardHash = await safe.getTransactionHash(rb.batch.transactions[0].to, 0, rb.batch.transactions[0].data, 0, 0, 0, 0, ethers.ZeroAddress, ethers.ZeroAddress, nonce);
    await execThroughSafe(rb, [DEPLOYER]);
    check("rollback: the old facet serves again", (await loupe.facetAddress(probe)).toLowerCase() === oldFacet.toLowerCase());
    // not a pure Replace → refused. Deploy a facet with a different selector set (LendingAdminFacet) and try to swap ProtocolFacet for it.
    const adminArt = await hre.artifacts.readArtifact("LendingAdminFacet");
    const other = await new ethers.ContractFactory(adminArt.abi, adminArt.bytecode, deployer).deploy();
    await other.waitForDeployment();
    let msg = "";
    try {
      tool("facet-upgrade", { NEW_FACET: await other.getAddress() });
    } catch (e) {
      msg = e.message;
    }
    check("a facet whose code is not the compiled build is REFUSED (not just warned)", /does NOT equal the compiled/.test(msg), msg.slice(0, 90));
  }

  // ── Safe signer changes + a real 2-of-2
  console.log("\n4. adding a second signer, then 2-of-2");
  const second = ethers.Wallet.createRandom().address;
  {
    let t = tool("safe-add-owner", { NEW_OWNER: second, THRESHOLD: "1" });
    check("adding at threshold 1 warns that the new signer can act alone", /can act ALONE/.test(t.card));
    await execThroughSafe(t, [DEPLOYER]);
    check("the Safe now has 2 signers, threshold still 1", (await owners()).length === 2 && (await safe.getThreshold()) === 1n);
    // prove the new signer can sign on its own BEFORE raising the threshold (the safe order of operations)
    t = tool("pause");
    await execThroughSafe(t, [second]);
    check("the NEW signer alone can execute (threshold 1) — confirms it works before raising", (await diamond.paused()) === true);
    t = tool("unpause");
    await execThroughSafe(t, [DEPLOYER]);

    t = tool("safe-change-threshold", { THRESHOLD: "2" });
    check("raising the threshold warns that single-signer scripts stop working", /stop working at threshold 2/.test(t.card));
    await execThroughSafe(t, [DEPLOYER]);
    check("threshold is now 2-of-2", (await safe.getThreshold()) === 2n);

    t = tool("pause");
    let refused = false;
    try {
      await execThroughSafe(t, [DEPLOYER]);
    } catch {
      refused = true;
    }
    check("ONE signature is no longer enough", refused && (await diamond.paused()) === false);
    t = tool("pause");
    await execThroughSafe(t, [DEPLOYER, second]);
    check("both signatures execute it", (await diamond.paused()) === true);
    t = tool("unpause");
    await execThroughSafe(t, [DEPLOYER, second]);
    check("…and unpause the same way", (await diamond.paused()) === false);
  }

  // ── guard rails
  console.log("\n5. guard rails");
  {
    const expectFail = (label, fn, re) => {
      let msg = "";
      try {
        fn();
      } catch (e) {
        msg = e.message;
      }
      check(label, re.test(msg), msg.slice(0, 90));
    };
    expectFail("a threshold above the number of signers is refused", () => tool("safe-change-threshold", { THRESHOLD: "3" }), /between 1 and 2/);
    expectFail("removing a signer that leaves threshold 2 with one signer is refused", () => tool("safe-remove-owner", { OWNER: second, THRESHOLD: "2" }), /locks for ever/);
    expectFail("accept-ownership with nothing nominated is refused", () => tool("accept-ownership", { TARGET: ORDERS }), /nothing to accept/);
    expectFail("a made-up address with no code is refused", () => tool("set-filler-fee", { TARGET: "0x000000000000000000000000000000000000dEaD", BPS: "1" }), /no contract code/);
    // restore the original 1-of-1: lower the threshold, then remove the second signer
    let t = tool("safe-change-threshold", { THRESHOLD: "1" });
    await execThroughSafe(t, [DEPLOYER, second]);
    t = tool("safe-remove-owner", { OWNER: second, THRESHOLD: "1" });
    await execThroughSafe(t, [DEPLOYER]);
    check("restoring 1-of-1: the second signer is removed", (await owners()).length === 1 && (await safe.getThreshold()) === 1n);
    t = tool("safe-swap-owner", { OLD_OWNER: DEPLOYER, NEW_OWNER: second });
    check("swap-owner builds (not executed): replaces a signer", /Replace signer/.test(t.card));
    t = tool("transfer-ownership", { TARGET: ORDERS, NEW_OWNER: second });
    check("transfer-ownership builds and is flagged HIGH", /\*\*Risk:\*\* HIGH/.test(t.card));
    t = tool("call", { TARGET: DIAMOND, SIGNATURE: "pause()", ARGS: "[]" });
    check("the generic call mode encodes and decodes", /`pause\(\)`/.test(t.card));
    t = tool("raw", { TARGET: DIAMOND, DATA: "0x8456cb59" });
    check("raw mode decodes known calldata", /`pause\(\)`/.test(t.card));
  }

  console.log(failures === 0 ? "\n✅ Safe tool test passed." : `\n❌ ${failures} check(s) failed.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
