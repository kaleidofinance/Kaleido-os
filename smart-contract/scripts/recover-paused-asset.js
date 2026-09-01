/**
 * Recover an asset the live faucet is not handing out.
 *
 *   RECOVER_TOKEN=WBNB RECOVER_DRY_RUN=1 npx hardhat run scripts/recover-paused-asset.js --network bscTestnet
 *   RECOVER_TOKEN=WBNB RECOVER_UNWRAP=1 npx hardhat run scripts/recover-paused-asset.js --network bscTestnet
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * The faucet hands out only what we issued. A third-party asset — canonical WBNB,
 * a provider's USDC — is listed for the page's sake and paused at drip 0, with the
 * Claim button linking out to whoever issues it. That rule is right and is not in
 * question here. What it leaves behind is stock: the deploy scripts wrapped and
 * stocked those assets before the rule existed, and a paused row keeps its balance
 * forever because nothing pays it out and nothing takes it back.
 *
 * On BSC that stranded stock was 0.2815 WBNB — which is 0.2815 BNB, which at 0.1
 * gwei is about seven thousand keeper fills. The keeper on that chain had no gas at
 * all. So the asset nobody could claim was, all along, the funding for the thing
 * that was broken.
 *
 * ── The one refusal ─────────────────────────────────────────────────────────
 *
 * It will not touch an asset whose drip is non-zero. `withdraw(token, to, 0)` takes
 * the entire balance, so aimed at a paying row it empties /faucet for that asset in
 * one transaction, and a paused address and a live one differ by a character in a
 * plan a human types. The chain is the authority: `drips(token).amount == 0` or
 * this stops. `RECOVER_FORCE=1` overrides it and prints what it is overriding —
 * for the case where the intent really is to drain a live row before delisting it.
 *
 * ── Unwrapping ──────────────────────────────────────────────────────────────
 *
 * `RECOVER_UNWRAP=1` follows the withdrawal with `WETH9.withdraw(amount)` so the
 * recovered balance comes out as gas rather than as a wrapper nothing needs. The
 * deployed bytecode is probed for the selector first: a token that is not a wrapper
 * deserves a clear error rather than a reverted transaction, and by then the funds
 * are already out of the faucet and safe either way.
 *
 * The deployment record is updated in place, because a `stocked` figure left at
 * 0.2815 after the stock is gone reads as a measurement and is how a later run
 * decides there is nothing to do here.
 */

const fs = require("fs");
const hre = require("hardhat");
const { ethers } = hre;

const NATIVE_TOKEN = "0x0000000000000000000000000000000000000001";
/** `withdraw(uint256)` — WETH9's unwrap. */
const UNWRAP_SELECTOR = "0x2e1a7d4d";

const ERC20 = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function withdraw(uint256)",
];

function recordPath(network) {
  const file = `deployment-faucet-${network}.json`;
  if (!fs.existsSync(file)) {
    throw new Error(
      `No ${file}. This script recovers from the faucet that record names; ` +
        "without it there is nothing to check the address against.",
    );
  }
  return file;
}

/** Accepts an address or an asset key from the record ("WBNB"). */
function resolveToken(record, wanted) {
  if (ethers.isAddress(wanted)) {
    const entry = (record.config?.assets || []).find(
      (a) => a.address?.toLowerCase() === wanted.toLowerCase(),
    );
    return { address: ethers.getAddress(wanted), entry };
  }
  const entry = (record.config?.assets || []).find(
    (a) => a.key?.toUpperCase() === wanted.toUpperCase(),
  );
  if (!entry) {
    const keys = (record.config?.assets || []).map((a) => a.key).join(", ");
    throw new Error(`No asset "${wanted}" in the record. It lists: ${keys}`);
  }
  return { address: ethers.getAddress(entry.address), entry };
}

async function main() {
  const net = hre.network.name;
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const [signer] = await ethers.getSigners();

  const wanted = (process.env.RECOVER_TOKEN || "").trim();
  if (!wanted) {
    throw new Error("RECOVER_TOKEN must name the asset — an address or a record key.");
  }
  const dry = process.env.RECOVER_DRY_RUN === "1";
  const unwrap = process.env.RECOVER_UNWRAP === "1";
  const force = process.env.RECOVER_FORCE === "1";

  const file = recordPath(net);
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  const faucetAddress = record.contracts?.faucet;
  if (!faucetAddress || !ethers.isAddress(faucetAddress)) {
    throw new Error(`${file} names no faucet address.`);
  }

  const { address: token, entry } = resolveToken(record, wanted);

  console.log(`\n💧 Recovering a paused asset on ${net} (chain ${chainId})${dry ? " — DRY RUN" : ""}`);
  console.log(`   faucet ${faucetAddress} (${file})`);
  console.log(`   token  ${token}${entry ? ` — ${entry.key}, source "${entry.source}"` : ""}`);
  console.log(`   to     ${signer.address}`);

  const faucet = await ethers.getContractAt("KaleidoTokenFaucet", faucetAddress, signer);
  const owner = await faucet.owner();
  if (owner !== signer.address) {
    throw new Error(
      `The faucet is owned by ${owner}, not this signer. withdraw() is onlyOwner.`,
    );
  }

  const drip = await faucet.drips(token);
  const listed = drip[1];
  const amount = drip[0];
  const erc20 = new ethers.Contract(token, ERC20, signer);
  const decimals = token === NATIVE_TOKEN ? 18 : Number(await erc20.decimals());
  const symbol = token === NATIVE_TOKEN ? "native" : await erc20.symbol();

  console.log(
    `   drip   ${ethers.formatUnits(amount, decimals)} ${symbol} per claim` +
      `, listed ${listed}`,
  );

  if (amount !== 0n) {
    const line =
      `${symbol} is paying out ${ethers.formatUnits(amount, decimals)} per claim. ` +
      "withdraw() takes the whole balance, so this would empty a live row.";
    if (!force) throw new Error(`${line}\nSet RECOVER_FORCE=1 if that is the intent.`);
    console.log(`   ⚠️  RECOVER_FORCE: ${line}`);
  }

  const held =
    token === NATIVE_TOKEN
      ? await ethers.provider.getBalance(faucetAddress)
      : await erc20.balanceOf(faucetAddress);
  console.log(`   held   ${ethers.formatUnits(held, decimals)} ${symbol}`);
  if (held === 0n) {
    console.log("\n   Nothing to recover. The record may be the stale part; check it.");
    return;
  }

  if (unwrap && token !== NATIVE_TOKEN) {
    const code = await ethers.provider.getCode(token);
    if (!code.includes(UNWRAP_SELECTOR.slice(2))) {
      throw new Error(
        `${symbol} at ${token} has no withdraw(uint256) in its deployed bytecode, ` +
          "so RECOVER_UNWRAP would revert. Run without it and unwrap by hand if the " +
          "wrapper uses another name.",
      );
    }
  }

  if (dry) {
    console.log(
      `\n   Would withdraw ${ethers.formatUnits(held, decimals)} ${symbol} to ${signer.address}` +
        (unwrap ? " and unwrap it to native." : "."),
    );
    return;
  }

  const before = await ethers.provider.getBalance(signer.address);

  /* 0 means "everything", which is why the refusal above is the whole safety of
     this script rather than a warning. */
  const tx = await faucet.withdraw(token, signer.address, 0);
  const receipt = await tx.wait();
  console.log(`\n   withdrawn — ${tx.hash} (block ${receipt.blockNumber})`);

  let unwrapTx;
  if (unwrap && token !== NATIVE_TOKEN) {
    const mine = await erc20.balanceOf(signer.address);
    unwrapTx = await erc20.withdraw(mine);
    await unwrapTx.wait();
    console.log(`   unwrapped ${ethers.formatUnits(mine, decimals)} ${symbol} — ${unwrapTx.hash}`);
    const left = await erc20.balanceOf(signer.address);
    if (left !== 0n) {
      console.log(`   ⚠️  ${ethers.formatUnits(left, decimals)} ${symbol} still wrapped`);
    }
  }

  const after = await ethers.provider.getBalance(signer.address);
  console.log(
    `   native ${ethers.formatEther(before)} → ${ethers.formatEther(after)}` +
      ` (${after > before ? "+" : ""}${ethers.formatEther(after - before)}, gas included)`,
  );

  /* The faucet's own view, read back: `held` above was one block old and the point
     of the exercise is that the row is empty now. */
  const remaining =
    token === NATIVE_TOKEN
      ? await ethers.provider.getBalance(faucetAddress)
      : await erc20.balanceOf(faucetAddress);
  console.log(`   faucet now holds ${ethers.formatUnits(remaining, decimals)} ${symbol}`);

  if (entry) {
    entry.funding = {
      method: "recovered",
      stocked: ethers.formatUnits(remaining, decimals),
      recoveredHuman: ethers.formatUnits(held, decimals),
      recoveredTo: signer.address,
      recoveredTx: tx.hash,
      ...(unwrapTx ? { unwrappedTx: unwrapTx.hash } : {}),
      note:
        "Paused at drip 0 under the rule that the faucet hands out only assets we " +
        "issued, so the stock was unreachable. Recovered by " +
        "scripts/recover-paused-asset.js.",
    };
    record.recoveredAt = new Date().toISOString();
    fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
    console.log(`   ${file} updated — ${entry.key}.funding now reads "recovered"`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
