/**
 * Hand the ownership of KaleidoOrdersV2 to the Safe — the same two-step the lending
 * diamond went through:
 *
 *   # read-only: checks everything, prints the plan, sends nothing
 *   DRY_RUN=1 SAFE_ADDRESS=0x… ORDERS=0x… npx hardhat run scripts/handover-orders-to-safe.js --network arcMainnet
 *
 *   # the real thing
 *   CONFIRM_MAINNET=5042 SAFE_ADDRESS=0x… ORDERS=0x… npx hardhat run scripts/handover-orders-to-safe.js --network arcMainnet
 *
 *   STEP=nominate   only step 1        STEP=accept   only step 2        (default: both)
 *
 *   1. NOMINATE — the current owner (the hardhat signer) calls transferOwnership(Safe).
 *      Ownable2Step: this changes NOTHING but `pendingOwner`; the signer stays the
 *      owner and can nominate someone else if the address was wrong.
 *   2. ACCEPT — the Safe executes acceptOwnership() on the orders contract, signed
 *      by the signer as the Safe's owner ("approved by the sender" signature; the
 *      same mechanism scripts/safe-exec.js uses). Only now does the owner change.
 *
 * Safe against a wrong address: nothing moves until step 2, which only the nominee
 * can do. Idempotent: re-running skips whatever is already done.
 *
 * What the owner controls here — only two things: `setAggregator` (the allowlist of
 * routers a fill may call, which is why it should sit behind the Safe) and
 * `setFillerFeeBps` (capped at the contract's MAX_FILLER_FEE_BPS). Order fills,
 * cancels and everything the keeper does are NOT owner-gated, and the keeper signs
 * with its own key, so a handover does not touch operations.
 *
 * After the real run: node/hardhat scripts/verify-orders-owner.js, and update
 * deployment-orders-<network>.json (config.owner).
 */
const hre = require("hardhat");
const { ethers } = hre;
const { confirmMainnet } = require("./libraries/mainnet-guard.js");

const DRY_RUN = process.env.DRY_RUN === "1";
const STEP = (process.env.STEP || "both").toLowerCase();

const ORDERS_ABI = [
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
  "function transferOwnership(address newOwner)",
  "function acceptOwnership()",
  "function fillerFeeBps() view returns (uint16)",
  "function isAggregator(address) view returns (bool)",
];
const SAFE_ABI = [
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function isOwner(address) view returns (bool)",
  "function nonce() view returns (uint256)",
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)",
];

/* Public RPCs drop calls; a failed READ must not abort a handover that is otherwise
   fine. Writes are never retried blindly. */
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
  if (!["both", "nominate", "accept"].includes(STEP)) throw new Error('STEP must be "nominate", "accept" or "both".');
  const [signer] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const safeAddress = ethers.getAddress(process.env.SAFE_ADDRESS || "");
  const ordersAddress = ethers.getAddress(process.env.ORDERS || "");

  const orders = new ethers.Contract(ordersAddress, ORDERS_ABI, signer);
  const safe = new ethers.Contract(safeAddress, SAFE_ABI, signer);

  if ((await retry("code", () => ethers.provider.getCode(ordersAddress))) === "0x")
    throw new Error(`No contract at ORDERS ${ordersAddress}.`);
  if ((await retry("safe code", () => ethers.provider.getCode(safeAddress))) === "0x")
    throw new Error(`No contract at SAFE_ADDRESS ${safeAddress}.`);

  const [owner, pending, fee, safeOwners, threshold, nonce, signerIsSafeOwner] = await retry("state", () =>
    Promise.all([
      orders.owner(),
      orders.pendingOwner(),
      orders.fillerFeeBps(),
      safe.getOwners(),
      safe.getThreshold(),
      safe.nonce(),
      safe.isOwner(signer.address),
    ]),
  );

  const isSafe = (a) => a.toLowerCase() === safeAddress.toLowerCase();
  const isSigner = (a) => a.toLowerCase() === signer.address.toLowerCase();
  const done = isSafe(owner);
  const nominated = isSafe(pending);

  if (!done && !isSigner(owner))
    throw new Error(`The orders contract is owned by ${owner}, not the signer ${signer.address} — only the owner can nominate.`);
  if (Number(threshold) !== 1) throw new Error(`Safe threshold is ${threshold}; the accept step needs the other signatures in app.safe.global.`);
  if (!signerIsSafeOwner) throw new Error(`${signer.address} is not an owner of the Safe (owners: ${safeOwners.join(", ")}).`);

  confirmMainnet({
    chainId,
    script: "handover-orders-to-safe.js",
    plan: [
      ["orders contract", ordersAddress],
      ["current owner", `${owner}${isSigner(owner) ? "  (= the signer)" : ""}`],
      ["pending owner", pending === ethers.ZeroAddress ? "(none)" : pending],
      ["new owner (Safe)", `${safeAddress}  nonce ${nonce}, ${threshold}-of-${safeOwners.length}`],
      ["signer", signer.address],
      ["fillerFeeBps (unchanged)", String(fee)],
      ["steps", done ? "already done — nothing to do" : `${nominated ? "(1 nominate: already done) " : "1 nominate → "}2 accept via the Safe   [STEP=${STEP}]`],
      ["mode", DRY_RUN ? "DRY RUN — sends nothing" : "BROADCAST"],
    ],
    explicit: ["SAFE_ADDRESS", "ORDERS"],
  });
  if (done) {
    console.log("Already owned by the Safe. Nothing to do.");
    return;
  }
  if (DRY_RUN) {
    console.log("DRY RUN complete — nothing sent.");
    return;
  }

  // ── 1. nominate
  if (STEP !== "accept" && !nominated) {
    console.log("1. nominating the Safe (the owner does not change yet) …");
    const tx = await orders.transferOwnership(safeAddress);
    console.log(`   sent ${tx.hash}`);
    await tx.wait();
    const [o, p] = await Promise.all([retry("owner", () => orders.owner()), retry("pending", () => orders.pendingOwner())]);
    if (!isSafe(p)) throw new Error(`pendingOwner is ${p}, expected the Safe.`);
    if (!isSigner(o)) throw new Error(`owner changed to ${o} on a nomination — unexpected, stop.`);
    console.log(`   ✅ pendingOwner = the Safe; owner is still ${o}`);
  } else if (nominated) {
    console.log("1. already nominated — skipping.");
  }
  if (STEP === "nominate") return;

  // ── 2. the Safe accepts
  console.log("2. the Safe executes acceptOwnership() …");
  const data = orders.interface.encodeFunctionData("acceptOwnership", []);
  const signature = ethers.concat([ethers.zeroPadValue(signer.address, 32), ethers.ZeroHash, "0x01"]);
  const args = [ordersAddress, 0, data, 0, 0, 0, 0, ethers.ZeroAddress, ethers.ZeroAddress, signature];
  await safe.execTransaction.staticCall(...args); // throws with the Safe/inner revert reason
  const tx = await safe.execTransaction(...args, { gasLimit: 500_000 });
  console.log(`   sent ${tx.hash}`);
  const receipt = await tx.wait();
  const ok = receipt.logs.some((l) => l.address.toLowerCase() === safeAddress.toLowerCase() && l.topics[0] === ethers.id("ExecutionSuccess(bytes32,uint256)"));
  if (!ok) throw new Error(`The Safe reported no ExecutionSuccess — tx ${tx.hash}`);

  // ── verify (a lagging public RPC can briefly show the old owner: re-read ~30s)
  let finalOwner = owner;
  for (let i = 0; i < 10; i++) {
    finalOwner = await retry("owner", () => orders.owner());
    if (isSafe(finalOwner)) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  if (!isSafe(finalOwner)) throw new Error(`Owner still reads ${finalOwner} — re-check before doing anything else.`);
  const [p2, fee2] = await Promise.all([retry("pending", () => orders.pendingOwner()), retry("fee", () => orders.fillerFeeBps())]);
  console.log(`   ✅ owner = ${finalOwner}; pendingOwner = ${p2 === ethers.ZeroAddress ? "(none)" : p2}; fillerFeeBps ${fee2} (was ${fee})`);
  console.log("\nDone. Update deployment-orders-<network>.json (config.owner) and run scripts/verify-orders-owner.js.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
