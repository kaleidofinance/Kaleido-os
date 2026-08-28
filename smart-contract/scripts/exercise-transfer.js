/**
 * Route 13 — transfer. The one verb that calls nothing of ours.
 *
 *   npx hardhat run scripts/exercise-transfer.js --network sepolia
 *
 * Every other route in this plan proves a contract answers. None of them proves
 * the plain signing path is sound on its own, because each one's failure could
 * always be blamed on the contract it called. `send` has nothing to blame: native
 * leaves as a bare value transfer with no `data`, an ERC20 as `transfer(to,
 * amount)` and nothing else. So it is run last and deliberately alone — if this
 * works and a product route does not, the fault is in the product.
 *
 * Both legs, because they fail differently. A native transfer can only fail by
 * running out of value or gas. An ERC20 `transfer` can *succeed as a transaction*
 * and still move nothing: the classic non-reverting `return false`. So the ERC20
 * leg asserts on the recipient's balance delta rather than on the receipt's
 * status, which is the only assertion that can tell those two apart.
 *
 * The counterparty is the same deterministically-derived wallet the lending
 * scripts use, so the dollar lands somewhere already in play rather than in a
 * fresh address nobody will look at again.
 *
 * `receive` is not exercised here and cannot be: `build.ts` returns
 * `error: "receive"` by design and the page renders a panel instead of a
 * transaction. There is nothing to sign, which is the intended behaviour rather
 * than a gap.
 */

const hre = require("hardhat");
const { ethers } = hre;
const { registryFor } = require("./libraries/registry.js");

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
  /* The event has to be declared here or the log assertion below cannot pass:
   * `parseLog` matches against this interface, and an interface built from
   * functions alone throws on every log it is handed. Left as a comment because
   * the first run of this script "found" a missing Transfer event on a transfer
   * whose balance delta was exact — which is impossible, and was this omission
   * rather than anything on chain. */
  "event Transfer(address indexed from, address indexed to, uint256 value)",
];

/** Same derivation as seed-lending.js / exercise-lending.js. */
function counterpartyWallet(provider) {
  const explicit = process.env.COUNTERPARTY_PRIVATE_KEY;
  if (explicit)
    return new ethers.Wallet(
      explicit.startsWith("0x") ? explicit : `0x${explicit}`,
      provider,
    );
  const seed = process.env.DEPLOYER_PRIVATE_KEY;
  if (!seed) throw new Error("no DEPLOYER_PRIVATE_KEY to derive a counterparty from");
  return new ethers.Wallet(
    ethers.keccak256(ethers.toUtf8Bytes(`kaleido-testnet-counterparty-v1:${seed}`)),
    provider,
  );
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const from = await deployer.getAddress();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const reg = registryFor(chainId);
  const to = await counterpartyWallet(ethers.provider).getAddress();

  console.log(`\n=== ${hre.network.name} (${chainId}): route 13, transfer ===`);
  console.log(`from ${from}\n  to ${to}`);

  let pass = 0;
  let fail = 0;
  const check = (name, ok, detail) => {
    if (ok) pass += 1;
    else fail += 1;
    console.log(`   ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  };

  /* ---------------------------------------------------------- native leg -- */

  /* $1 at the native asset's own price would need an oracle, and an oracle is the
   * one thing this route is supposed not to depend on. A fixed small amount keeps
   * the assertion exact — the point is that the value arrives, not what it is
   * worth. */
  const amount = ethers.parseEther("0.0005");
  const beforeNative = await ethers.provider.getBalance(to);
  const tx = await deployer.sendTransaction({ to, value: amount });
  const rc = await tx.wait();
  const afterNative = await ethers.provider.getBalance(to);

  console.log(`\nnative ${ethers.formatEther(amount)} — tx ${tx.hash}`);
  check(
    "the recipient's balance rose by exactly the amount sent",
    afterNative - beforeNative === amount,
    `+${ethers.formatEther(afterNative - beforeNative)}`,
  );
  /* A value transfer must carry no calldata. Worth asserting rather than assuming:
   * this is the one path where an accidental `data` field would turn a payment to
   * a contract into a function call. */
  const sent = await ethers.provider.getTransaction(tx.hash);
  check("it went out as a bare value transfer, with no calldata", sent.data === "0x", sent.data);
  check("21000 gas, so nothing executed at the far end", rc.gasUsed === 21000n, `${rc.gasUsed}`);

  /* ----------------------------------------------------------- ERC20 leg -- */

  /* The mock USDC rather than KLD: KLD is unpriced by design, and a route whose
   * whole claim is "this moved a dollar" reads better against the asset that is
   * actually a dollar. Falls back to whatever the registry does have. */
  const tokenAddr = reg.usdc ?? reg.usdt ?? reg.kld;
  if (!tokenAddr) {
    console.log("\nno ERC20 in the registry for this chain — native leg only");
  } else {
    const token = new ethers.Contract(tokenAddr, ERC20_ABI, deployer);
    const [symbol, decimals] = await Promise.all([
      token.symbol().catch(() => tokenAddr.slice(0, 8)),
      token.decimals().then(Number).catch(() => 18),
    ]);
    const one = ethers.parseUnits("1", decimals);
    const held = await token.balanceOf(from);
    if (held < one) {
      console.log(`\ndeployer holds ${ethers.formatUnits(held, decimals)} ${symbol} — cannot send 1`);
      fail += 1;
    } else {
      const beforeTok = await token.balanceOf(to);
      const t2 = await token.transfer(to, one);
      const rc2 = await t2.wait();
      const afterTok = await token.balanceOf(to);
      console.log(`\n${symbol} 1.0 — tx ${t2.hash}  gas ${rc2.gasUsed}`);
      check("the transaction succeeded", rc2.status === 1, `status ${rc2.status}`);
      /* The assertion that matters. A token that returns false instead of
       * reverting produces status 1 and moves nothing; only the delta separates
       * the two. */
      check(
        "and the recipient actually received it, not merely a status-1 receipt",
        afterTok - beforeTok === one,
        `+${ethers.formatUnits(afterTok - beforeTok, decimals)} ${symbol}`,
      );
      const ev = rc2.logs
        .map((l) => {
          try {
            return token.interface.parseLog(l);
          } catch {
            return null;
          }
        })
        .find((e) => e?.name === "Transfer");
      check(
        "a Transfer event was emitted, which is what the portfolio indexes",
        ev !== undefined && ev.args[1].toLowerCase() === to.toLowerCase(),
        ev ? `to ${ev.args[1]}` : "no Transfer log",
      );
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("TRANSFER EXERCISE FAILED:", e.shortMessage || e.message || e);
  process.exit(1);
});
