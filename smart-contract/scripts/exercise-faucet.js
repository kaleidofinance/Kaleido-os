/**
 * Exercise the faucet as a wallet that owns nothing.
 *
 *   npx hardhat run scripts/exercise-faucet.js --network sepolia
 *   FRESH=2 npx hardhat run scripts/exercise-faucet.js --network baseTestnet
 *
 * Every other route in this plan is driven by the deployer, which holds 995M KLD,
 * every mock mint and `MINTER_ROLE` on the stablecoin. That makes the deployer the
 * one wallet that can never test the faucet, because the faucet's entire purpose
 * is the opposite condition: a wallet with nothing, which needs the drip before it
 * can do anything else. So this derives a fresh wallet, funds it with gas and
 * nothing else, and claims.
 *
 * `FRESH=<n>` selects which derived wallet to use. The cooldown is per user per
 * asset, so a re-run inside the window against the same wallet can only ever
 * measure the cooldown; bumping n gets a genuinely first-time claimer again,
 * which is what proves the first-claim path rather than the repeat path.
 *
 * Both paths are exercised deliberately:
 *
 *   - `claimMany` for everything with a nonzero drip, and each balance delta is
 *     checked against the configured drip. A listed asset whose drip is zero is
 *     reported rather than claimed: `claimMany` skips it silently, and a listed
 *     asset that pays nothing looks identical from the UI to one that is not
 *     listed at all. That distinction only exists in `drips(token)`, so it gets
 *     printed.
 *
 *   - then one immediate re-claim, which must revert `CooldownNotOver`. A faucet
 *     that pays twice in a row is the failure that matters here, and it cannot be
 *     observed by any run that only claims once.
 *
 * Native is claimed too, under the `NATIVE_TOKEN()` sentinel. Its delta is
 * measured net of gas, so the assertion is "balance rose by at least the drip
 * less the fee actually paid" rather than an exact match — the only figure on the
 * run that cannot be exact, and the receipt supplies the fee to make it tight.
 */

const hre = require("hardhat");
const { ethers } = hre;
const { registryFor } = require("./libraries/registry.js");

const FAUCET_ABI = require(
  "../artifacts/contracts/Faucet.sol/KaleidoTokenFaucet.json",
).abi;

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
];

async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const reg = registryFor(chainId);
  if (!reg.faucet) throw new Error(`chain ${chainId} has no faucet`);

  /* Derived, not random: a random wallet per run strands its gas somewhere nobody
   * will look again, and cannot be revisited to check the cooldown later. */
  const n = process.env.FRESH ?? "1";
  const fresh = new ethers.Wallet(
    ethers.keccak256(ethers.toUtf8Bytes(`kaleido-faucet-user-v1:${chainId}:${n}`)),
    ethers.provider,
  );
  const who = await fresh.getAddress();

  const faucet = new ethers.Contract(reg.faucet, FAUCET_ABI, fresh);
  const asOwner = faucet.connect(deployer);
  console.log(`\n=== ${hre.network.name}: faucet ${reg.faucet} ===`);
  console.log(`fresh wallet #${n} ${who}`);
  const [cooldown, users, claimedBefore] = await Promise.all([
    faucet.cooldown(),
    faucet.getTotalUsers(),
    faucet.hasClaimedBefore(who),
  ]);
  console.log(
    `cooldown ${Number(cooldown) / 3600}h  users so far ${users}  this wallet has claimed before: ${claimedBefore}`,
  );

  /* Gas, and only gas. Anything more would defeat the point of the wallet. */
  const fee = await ethers.provider.getFeeData();
  const price = fee.maxFeePerGas ?? fee.gasPrice ?? 1_000_000_000n;
  const want = price * 4_000_000n;
  const has = await ethers.provider.getBalance(who);
  if (has < want) {
    console.log(`funding it with ${ethers.formatEther(want - has)} native for gas`);
    await (await deployer.sendTransaction({ to: who, value: want - has })).wait();
  }

  const NATIVE = await faucet.NATIVE_TOKEN();
  const [tokens, amounts, , nextAt] = await faucet.assetInfo(who);
  console.log(`\n${tokens.length} listed asset(s):`);

  const rows = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const addr = tokens[i];
    const isNative = addr.toLowerCase() === NATIVE.toLowerCase();
    let symbol = "NATIVE";
    let dec = 18;
    if (!isNative) {
      const t = new ethers.Contract(addr, ERC20_ABI, ethers.provider);
      symbol = await t.symbol().catch(() => addr.slice(0, 8));
      dec = Number(await t.decimals().catch(() => 18));
    }
    const stock = isNative
      ? await ethers.provider.getBalance(reg.faucet)
      : await new ethers.Contract(addr, ERC20_ABI, ethers.provider).balanceOf(reg.faucet);
    const ready = Number(nextAt[i]) === 0;
    console.log(
      `  ${symbol.padEnd(6)} drip ${ethers.formatUnits(amounts[i], dec).padEnd(12)}` +
        `  faucet holds ${ethers.formatUnits(stock, dec).padEnd(16)}` +
        (amounts[i] === 0n
          ? "  DRIP IS ZERO — listed but pays nothing"
          : stock < amounts[i]
            ? "  UNDERFUNDED — a claim would revert InsufficientContractBalance"
            : ready
              ? "  claimable now"
              : `  on cooldown for ${((Number(nextAt[i]) * 1000 - Date.now()) / 3600000).toFixed(1)}h`),
    );
    rows.push({ addr, symbol, dec, drip: amounts[i], isNative, stock, ready });
  }

  const claimable = rows.filter((r) => r.drip > 0n && r.stock >= r.drip && r.ready);
  if (!claimable.length) {
    console.log(`\nnothing claimable for this wallet — try FRESH=${Number(n) + 1}`);
    return;
  }

  /* Balances before, then one claimMany for everything at once — the call the
   * /faucet page's "claim all" button makes. */
  const before = new Map();
  for (const r of rows)
    before.set(
      r.addr,
      r.isNative
        ? await ethers.provider.getBalance(who)
        : await new ethers.Contract(r.addr, ERC20_ABI, ethers.provider).balanceOf(who),
    );

  console.log(`\nclaimMany over ${claimable.length} asset(s)`);
  const paid = await faucet.claimMany.staticCall(claimable.map((r) => r.addr));
  const tx = await faucet.claimMany(claimable.map((r) => r.addr));
  const rc = await tx.wait();
  const gasCost = rc.gasUsed * (rc.gasPrice ?? price);
  console.log(`  tx ${tx.hash}  gas ${rc.gasUsed}  contract reports ${paid} asset(s) paid`);

  for (const r of claimable) {
    const now = r.isNative
      ? await ethers.provider.getBalance(who)
      : await new ethers.Contract(r.addr, ERC20_ABI, ethers.provider).balanceOf(who);
    const delta = now - before.get(r.addr);
    if (r.isNative) {
      /* The only inexact line on the run: the same transaction paid the fee, and
       * on an OP-stack chain the receipt's gasUsed x gasPrice is the L2 execution
       * fee only — the L1 data fee is charged on top and is not in the receipt
       * ethers exposes. So a shortfall of a few picoether on Base is that fee, not
       * a faucet that paid the wrong amount; anything larger would be. */
      const net = delta + gasCost;
      const off = r.drip - net;
      console.log(
        `  ${r.symbol.padEnd(6)} +${ethers.formatUnits(delta, r.dec)} net of ${ethers.formatEther(gasCost)} L2 gas` +
          `  = ${ethers.formatUnits(net, r.dec)} claimed vs ${ethers.formatUnits(r.drip, r.dec)} drip` +
          (off === 0n
            ? "  (exact)"
            : off > 0n && off < 10n ** 12n
              ? `  (short by ${off} wei — the L1 data fee)`
              : "  — MISMATCH"),
      );
    } else {
      console.log(
        `  ${r.symbol.padEnd(6)} +${ethers.formatUnits(delta, r.dec)} vs ${ethers.formatUnits(r.drip, r.dec)} drip` +
          (delta === r.drip ? "  (exact)" : "  — MISMATCH"),
      );
    }
  }

  /* The repeat path. A faucet that pays twice in a row is the failure that
   * matters, and only a second call can show it does not. */
  const repeat = claimable[0];
  console.log(`\nimmediately re-claiming ${repeat.symbol}, which must be refused`);
  const refusal = await faucet.claim
    .staticCall(repeat.addr)
    .then(() => "NOT REFUSED — the faucet would pay twice in a row")
    /* Naming the guard is the assertion, not just observing a revert: a claim
     * refused for the wrong reason — paused, unlisted, out of stock — would read
     * identically to a cooldown if all we printed was "execution reverted".
     *
     * `e.revert` alone did not get there, and the reason is worth writing down
     * because it is not the obvious one. Measured 2026-08-28 against both
     * testnets: the node DOES return revert data, `0x650980c5` for this call.
     * What it does not do is arrive as an ethers `CallException` — under
     * `hardhat run` the in-process provider throws its own error first
     * (`_isProviderError`, `code: 3`, `data` set, and no `shortMessage` at all),
     * so ethers never wraps it and `e.revert` is undefined no matter what came
     * back over the wire. Reaching for `e.data` and decoding against the faucet's
     * own interface is therefore the fix; `e.revert` is kept first for the
     * direct-provider case, where ethers does populate it.
     *
     * The no-data branch stays anyway. It is not dead weight on a chain that
     * answers differently, and "the node returned no data" is a fact about the
     * RPC — printing it is what stops it being misread as a fact about the
     * contract. */
    .catch((e) => {
      if (e.revert?.name) return `${e.revert.name} (decoded by ethers)`;
      const data = e.data ?? e.info?.error?.data ?? e.error?.data;
      if (typeof data === "string" && data.length > 2) {
        try {
          const parsed = faucet.interface.parseError(data);
          if (parsed) return `${parsed.name} (decoded from ${data})`;
        } catch {
          /* Data that will not parse is a stronger signal than no data: it means
           * something reverted that this ABI does not describe. */
          return `reverted with data this ABI cannot decode: ${data.slice(0, 20)}…`;
        }
      }
      return (
        `${e.shortMessage ?? e.message} — and this RPC returned no revert data, ` +
        `so the guard cannot be named from the call alone`
      );
    });
  console.log(`  ${refusal}`);
  /* Which is why claimableAt is read straight after, and why it is not
   * decoration: it is the independent witness that the refusal above was the
   * cooldown. A nonzero wait from the contract's own accounting says the same
   * thing the error name would have, from state rather than from a string. */
  const at = await faucet.claimableAt(repeat.addr, who);
  const hoursLeft = (Number(at) * 1000 - Date.now()) / 3600000;
  console.log(
    `  claimableAt says ${hoursLeft.toFixed(2)}h from now` +
      (hoursLeft > 0
        ? " — the cooldown is what refused it, confirmed from state"
        : " — WHICH DOES NOT AGREE: state says claimable, yet the call was refused"),
  );

  console.log(
    `\nusers now ${await faucet.getTotalUsers()}  hasClaimedBefore ${await faucet.hasClaimedBefore(who)}` +
      `  (owner ${await asOwner.owner()})`,
  );
}

main().catch((e) => {
  console.error("FAUCET EXERCISE FAILED:", e.shortMessage || e.message || e);
  process.exit(1);
});
