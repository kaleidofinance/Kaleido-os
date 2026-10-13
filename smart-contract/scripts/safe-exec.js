/**
 * Execute one transaction FROM a Safe whose threshold is 1, signed by the hardhat
 * signer as an owner — e.g. the Safe accepting ownership of the lending diamond:
 *
 *   SAFE_ADDRESS=0x… TO=<diamond> CALLDATA=0x79ba5097 \
 *   CONFIRM_MAINNET=5042 npx hardhat run scripts/safe-exec.js --network arcMainnet
 *
 * or a signer change on the Safe itself (TO = the Safe):
 *   addOwnerWithThreshold(address,uint256) / swapOwner(address,address,address) /
 *   removeOwner(address,address,uint256) / changeThreshold(uint256)
 *
 * Uses Safe's "approved by the sender" signature (v = 1, r = the owner): valid
 * only when msg.sender IS that owner, so nothing is signed off-chain and no hash is
 * pre-approved. Refuses when the threshold is above 1 — then the other signers
 * must sign, and app.safe.global (which supports Arc) is the place to do it.
 *
 * Simulates first (execTransaction reverts GS013 when the inner call fails, since
 * safeTxGas = 0), prints the plan, and on mainnet needs CONFIRM_MAINNET.
 */
const hre = require("hardhat");
const { ethers } = hre;
const { confirmMainnet } = require("./libraries/mainnet-guard.js");

const SAFE_ABI = [
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function isOwner(address) view returns (bool)",
  "function nonce() view returns (uint256)",
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)",
];

async function main() {
  const [signer] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const safeAddress = ethers.getAddress(process.env.SAFE_ADDRESS || "");
  const to = ethers.getAddress(process.env.TO || "");
  const data = process.env.CALLDATA || "0x";
  const value = BigInt(process.env.VALUE || "0");
  if (!ethers.isHexString(data)) throw new Error("CALLDATA must be 0x-hex");

  const safe = new ethers.Contract(safeAddress, SAFE_ABI, signer);
  const [owners, threshold, nonce] = await Promise.all([safe.getOwners(), safe.getThreshold(), safe.nonce()]);
  if (Number(threshold) !== 1) {
    throw new Error(`Safe threshold is ${threshold}; collect the other signatures in app.safe.global instead.`);
  }
  if (!(await safe.isOwner(signer.address))) {
    throw new Error(`${signer.address} is not an owner of ${safeAddress} (owners: ${[...owners].join(", ")})`);
  }

  const signature = ethers.concat([ethers.zeroPadValue(signer.address, 32), ethers.ZeroHash, "0x01"]);
  const args = [to, value, data, 0, 0, 0, 0, ethers.ZeroAddress, ethers.ZeroAddress, signature];

  await confirmMainnet({
    chainId,
    script: "safe-exec.js",
    plan: [
      ["Safe", `${safeAddress} (nonce ${nonce}, ${threshold}-of-${owners.length})`],
      ["signer (owner)", signer.address],
      ["to", to],
      ["value", value.toString()],
      ["calldata", data.length > 74 ? `${data.slice(0, 74)}…` : data],
    ],
    explicit: ["SAFE_ADDRESS", "TO", "CALLDATA"],
  });

  await safe.execTransaction.staticCall(...args); // throws with the Safe/inner revert reason
  const tx = await safe.execTransaction(...args);
  const receipt = await tx.wait();
  /* Matched by topic + emitter, not decoded: SafeL2 1.4.1 indexes txHash, and a
     decode against the wrong indexing silently reads as "no success". */
  const SUCCESS = ethers.id("ExecutionSuccess(bytes32,uint256)");
  const ok = receipt.logs.some(
    (l) => l.address.toLowerCase() === safeAddress.toLowerCase() && l.topics[0] === SUCCESS,
  );
  if (!ok) throw new Error(`Safe reported no ExecutionSuccess — tx ${tx.hash}`);
  console.log(`\n✅ executed from ${safeAddress} (tx ${tx.hash}); Safe nonce now ${await safe.nonce()}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
