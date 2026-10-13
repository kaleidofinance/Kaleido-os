/**
 * Create a Safe (1.4.1, SafeL2) through the official factory — the address that
 * will OWN the lending diamond and oracle, so that who controls the protocol can
 * later change by changing the Safe's signers (addOwnerWithThreshold / swapOwner /
 * removeOwner / changeThreshold) without touching any protocol contract.
 *
 *   SAFE_OWNERS=0xA,0xB SAFE_THRESHOLD=1 [SAFE_SALT=kaleido-lending-owner-v1] \
 *   CONFIRM_MAINNET=5042 npx hardhat run scripts/create-safe.js --network arcMainnet
 *
 * Everything is Safe's own canonical deployment (same addresses on every chain,
 * checked for code before use); Safe's config service lists Arc (5042, l2: true),
 * so the result is manageable in app.safe.global. SafeL2 because Safe uses the L2
 * singleton on L2-flagged chains (it emits the events their indexer reads).
 *
 * The address is CREATE2-deterministic (factory + initializer + salt), printed
 * before anything is sent, and the script refuses if a Safe already lives there.
 * After creation it reads back owners, threshold and version and fails unless they
 * match what was asked. Writes deployment-safe-<network>.json.
 *
 * Mainnet: refuses without CONFIRM_MAINNET=<chainId> typed in the shell, and the
 * owners/threshold must come from the shell too (never from .env).
 */
const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const { confirmMainnet } = require("./libraries/mainnet-guard.js");

const SAFE = {
  factory: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67", // SafeProxyFactory 1.4.1
  singletonL2: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762", // SafeL2 1.4.1
  fallbackHandler: "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99", // CompatibilityFallbackHandler 1.4.1
};
const FACTORY_ABI = [
  "function createProxyWithNonce(address singleton, bytes initializer, uint256 saltNonce) returns (address proxy)",
  "function proxyCreationCode() view returns (bytes)",
  "event ProxyCreation(address indexed proxy, address singleton)",
];
const SAFE_ABI = [
  "function setup(address[] _owners, uint256 _threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)",
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function VERSION() view returns (string)",
  "function nonce() view returns (uint256)",
];

async function main() {
  const [signer] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const owners = (process.env.SAFE_OWNERS || "").split(",").map((a) => a.trim()).filter(Boolean).map((a) => ethers.getAddress(a));
  const threshold = Number(process.env.SAFE_THRESHOLD || "0");
  const saltLabel = process.env.SAFE_SALT || "kaleido-lending-owner-v1";
  if (!owners.length) throw new Error("SAFE_OWNERS is required (comma-separated addresses)");
  if (new Set(owners.map((o) => o.toLowerCase())).size !== owners.length) throw new Error("duplicate owner");
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > owners.length) {
    throw new Error(`SAFE_THRESHOLD must be 1..${owners.length}`);
  }

  for (const [name, a] of Object.entries(SAFE)) {
    if ((await ethers.provider.getCode(a)) === "0x") throw new Error(`Safe ${name} has no code at ${a} on chain ${chainId}`);
  }

  const safeIface = new ethers.Interface(SAFE_ABI);
  const initializer = safeIface.encodeFunctionData("setup", [
    owners, threshold, ethers.ZeroAddress, "0x", SAFE.fallbackHandler, ethers.ZeroAddress, 0, ethers.ZeroAddress,
  ]);
  const saltNonce = BigInt(ethers.id(saltLabel));
  const factory = new ethers.Contract(SAFE.factory, FACTORY_ABI, signer);

  // CREATE2 prediction: salt = keccak(keccak(initializer) ++ saltNonce), code = creationCode ++ singleton.
  const creationCode = await factory.proxyCreationCode();
  const salt = ethers.keccak256(ethers.concat([ethers.keccak256(initializer), ethers.toBeHex(saltNonce, 32)]));
  const initCode = ethers.concat([creationCode, ethers.zeroPadValue(SAFE.singletonL2, 32)]);
  const predicted = ethers.getCreate2Address(SAFE.factory, salt, ethers.keccak256(initCode));
  const exists = (await ethers.provider.getCode(predicted)) !== "0x";

  console.log(`\n🔐 Safe on chain ${chainId}`);
  console.log(`   owners     ${owners.join(", ")}`);
  console.log(`   threshold  ${threshold} of ${owners.length}`);
  console.log(`   salt       "${saltLabel}"`);
  console.log(`   address    ${predicted}${exists ? "  (ALREADY DEPLOYED)" : ""}`);
  if (exists) throw new Error("A Safe already exists at the predicted address — nothing to do (change SAFE_SALT for a new one).");

  await confirmMainnet({
    chainId,
    script: "create-safe.js",
    plan: [
      ["factory", SAFE.factory],
      ["singleton", `${SAFE.singletonL2} (SafeL2 1.4.1)`],
      ["owners", owners.join(", ")],
      ["threshold", `${threshold} of ${owners.length}`],
      ["predicted Safe", predicted],
      ["payer", signer.address],
    ],
    // On mainnet both must be typed in the shell for this run, never inherited from .env.
    explicit: ["SAFE_OWNERS", "SAFE_THRESHOLD"],
  });

  const tx = await factory.createProxyWithNonce(SAFE.singletonL2, initializer, saltNonce);
  const receipt = await tx.wait();
  const created = receipt.logs
    .map((l) => { try { return factory.interface.parseLog(l); } catch { return null; } })
    .find((e) => e?.name === "ProxyCreation")?.args?.proxy;
  if (!created || ethers.getAddress(created) !== predicted) {
    throw new Error(`created ${created} but predicted ${predicted} — check the receipt ${tx.hash}`);
  }

  const safe = new ethers.Contract(predicted, SAFE_ABI, ethers.provider);
  const [gotOwners, gotThreshold, version] = await Promise.all([safe.getOwners(), safe.getThreshold(), safe.VERSION()]);
  const same = gotOwners.length === owners.length && owners.every((o) => gotOwners.map((g) => g.toLowerCase()).includes(o.toLowerCase()));
  if (!same || Number(gotThreshold) !== threshold) {
    throw new Error(`read-back mismatch: owners ${[...gotOwners].join(",")}, threshold ${gotThreshold}`);
  }
  console.log(`\n✅ Safe ${version} created at ${predicted} (tx ${tx.hash})`);
  console.log(`   owners ${[...gotOwners].join(", ")} · threshold ${gotThreshold}`);

  const net = hre.network.name;
  fs.writeFileSync(`deployment-safe-${net}.json`, JSON.stringify({
    network: net,
    chainId,
    purpose: "Owner of the lending diamond + price oracle (signers rotatable without touching protocol contracts)",
    contracts: { safe: predicted },
    config: { owners, threshold, saltLabel, saltNonce: saltNonce.toString(), version, singleton: SAFE.singletonL2, factory: SAFE.factory, fallbackHandler: SAFE.fallbackHandler },
    txHash: tx.hash,
    block: receipt.blockNumber,
    createdBy: signer.address,
  }, null, 2) + "\n");
  console.log(`   record deployment-safe-${net}.json`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
