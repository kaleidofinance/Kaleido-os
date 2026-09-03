#!/usr/bin/env node
/**
 * Write faucet config — drip sizes and the claim cooldown — across the testnets.
 *
 * The write half of `verify:faucet`. That script measures capacity as
 * `balance / drip` and names the asset that binds each chain; this moves the two
 * owner-settable numbers behind that figure.
 *
 *   npm run faucet:drip     -- WETH 0.005                 # dry run, all chains listing WETH
 *   npm run faucet:drip     -- WETH 0.005 --send
 *   npm run faucet:drip     -- WETH 0.005 --send 11155111 84532
 *   npm run faucet:cooldown -- 12h --send                 # every faucet, one value
 *
 * DRY RUN IS THE DEFAULT, and `--send` is the only thing that changes it. This
 * signs with the faucet owner's key against live contracts on up to five chains,
 * so the shape that costs a mistake has to be the one you type on purpose.
 *
 * THE TWO NUMBERS TRADE OFF AGAINST EACH OTHER, which is the whole reason they
 * live in one tool. Drip sets how many users the stock can serve; cooldown sets
 * how fast one address can come back for more. Capacity is `balance / drip` and
 * is blind to cooldown — but drain resistance is `drip / cooldown`, and with a
 * shared access code that will not stay private, that second ratio is what stops
 * one scripted claimer emptying an asset overnight. Change one, reconsider the
 * other. Cooldown is per (asset, claimer), so a longer wait does not stop a user
 * collecting every asset on their first visit.
 *
 * The asset is named by SYMBOL and resolved through the faucet's own `assetInfo`,
 * not passed as an address. A mistyped address is a silent `setDrip` on a token the
 * faucet does not list — accepted by the contract, invisible in the UI, and
 * indistinguishable from having done nothing.
 *
 * `owner()` is checked before anything is sent. The alternative is a revert per
 * chain that reads as an RPC fault, and on a testnet whose ownership was handed to
 * a multisig it would be the correct and confusing answer.
 */

import {
  Interface,
  JsonRpcProvider,
  Wallet,
  formatUnits,
  parseUnits,
} from "ethers";
import fs from "node:fs";
import path from "node:path";

import { CHAINS } from "../src/constants/chains";
import { DEPLOYMENTS } from "../src/constants/registry";

/* ── args ──────────────────────────────────────────────────────────────────── */

const USAGE =
  "Usage: npm run faucet:drip     -- <SYMBOL> <amount> [--send] [chainId...]\n" +
  "       npm run faucet:cooldown -- <duration>        [--send] [chainId...]\n" +
  "\n" +
  "       npm run faucet:drip     -- WETH 0.005 --send 11155111\n" +
  "       npm run faucet:cooldown -- 12h --send        (also accepts 30m, 43200)";

const argv = process.argv.slice(2);
const send = argv.includes("--send");
const positional = argv.filter((a) => a !== "--send");
const mode = positional.shift();

if (mode !== "drip" && mode !== "cooldown") {
  console.error(USAGE);
  process.exit(2);
}

/* Durations are accepted as 12h / 30m / raw seconds. A bare number is seconds
   because that is what the contract stores; the suffixed forms exist because
   "43200" is not a number anyone should have to recognise in a command they are
   about to send to five chains. */
function parseDuration(raw: string): number | null {
  const m = /^(\d+(?:\.\d+)?)\s*(s|m|h|d)?$/i.exec(raw.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const mult =
    { s: 1, m: 60, h: 3600, d: 86400 }[(m[2] ?? "s").toLowerCase()] ?? 1;
  const total = n * mult;
  return Number.isInteger(total) && total >= 0 ? total : null;
}

function humanDuration(seconds: number): string {
  if (seconds === 0) return "0 (no cooldown)";
  if (seconds % 86400 === 0) return `${seconds / 86400}d`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

let wantSymbol = "";
let dripAmount = "";
let cooldownSeconds = 0;
let chainArgs: string[];

if (mode === "drip") {
  const [symbolArg, amountArg, ...rest] = positional;
  if (!symbolArg || !amountArg) {
    console.error(USAGE);
    process.exit(2);
  }
  if (!/^\d+(\.\d+)?$/.test(amountArg)) {
    console.error(
      `Drip amount must be a plain decimal number (got "${amountArg}")`,
    );
    process.exit(2);
  }
  wantSymbol = symbolArg.toUpperCase();
  dripAmount = amountArg;
  chainArgs = rest;
} else {
  const [durationArg, ...rest] = positional;
  const parsed = durationArg == null ? null : parseDuration(durationArg);
  if (parsed === null) {
    console.error(
      `Cooldown must be a duration like 12h, 30m or 43200 (got "${durationArg ?? ""}")`,
    );
    process.exit(2);
  }
  cooldownSeconds = parsed;
  chainArgs = rest;
}

const only = chainArgs.map(Number).filter((n) => Number.isInteger(n) && n > 0);
if (chainArgs.length !== only.length) {
  console.error(
    `Chain ids must be positive integers (got ${chainArgs.join(" ")})`,
  );
  process.exit(2);
}

/* ── key ───────────────────────────────────────────────────────────────────── */

/* Read straight out of .env rather than importing a config: this is a standalone
   script, and hardhat's own loader is not available outside smart-contract/.

   The search walks UP from cwd, because .env is gitignored and therefore does not
   exist inside a git worktree — a worktree is a fresh checkout of tracked files
   only. Walking up from .claude/worktrees/<name>/ reaches the real checkout and
   its .env, which is the difference between this script working there and not.
   Which file was used is printed, so a run is never ambiguous about where its
   authority came from. The key itself is never printed. */
function loadEnvKey(): { key: string; from: string } {
  const fromProcess =
    process.env.PRIVATE_KEY ?? process.env.DEPLOYER_PRIVATE_KEY;
  if (fromProcess) {
    return {
      key: fromProcess.startsWith("0x") ? fromProcess : `0x${fromProcess}`,
      from: "process environment",
    };
  }

  let dir = process.cwd();
  for (let up = 0; up < 6; up++) {
    for (const candidate of [".env.local", ".env"]) {
      const file = path.join(dir, candidate);
      if (!fs.existsSync(file)) continue;
      for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        const m = /^\s*(PRIVATE_KEY|DEPLOYER_PRIVATE_KEY)\s*=\s*(.+?)\s*$/.exec(
          line,
        );
        if (!m) continue;
        const raw = m[2].replace(/^["']|["']$/g, "");
        if (raw && raw !== "your_private_key_here") {
          return { key: raw.startsWith("0x") ? raw : `0x${raw}`, from: file };
        }
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  console.error(
    "No PRIVATE_KEY / DEPLOYER_PRIVATE_KEY found in the environment or in any\n" +
      ".env / .env.local from here upwards — nothing can be signed.",
  );
  process.exit(2);
}

const { key: signerKey, from: keySource } = loadEnvKey();
const signerAddress = new Wallet(signerKey).address;

/* ── abis ──────────────────────────────────────────────────────────────────── */

const faucetAbi = new Interface([
  "function assetInfo(address user) view returns (address[] tokens, uint256[] amounts, uint256[] balances, uint256[] nextClaimAt)",
  "function cooldown() view returns (uint256)",
  "function owner() view returns (address)",
  "function setCooldown(uint256 seconds_)",
  "function setDrip(address token, uint256 amount)",
]);
const erc20Abi = new Interface([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

/* The faucet lists the native coin under NATIVE_TOKEN = address(1), which it must
   because that is the protocol's lending sentinel (Faucet.sol:88). It is not a
   contract, so it never answers symbol(). address(0) and the 0xEeee… alias are
   here because other tables in this repo reach for those. */
const NATIVE_SENTINELS = new Set([
  "0x0000000000000000000000000000000000000001",
  "0x0000000000000000000000000000000000000000",
  "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
]);

/* ── run ───────────────────────────────────────────────────────────────────── */

const heading =
  mode === "drip"
    ? `set ${wantSymbol} drip to ${dripAmount}`
    : `set cooldown to ${humanDuration(cooldownSeconds)}`;
console.log(
  `\n${send ? "SENDING" : "DRY RUN"} — ${heading}\n` +
    `signer ${signerAddress}  (key from ${keySource})\n`,
);

let changed = 0;
let problems = 0;

for (const [idRaw, deployment] of Object.entries(DEPLOYMENTS)) {
  const chainId = Number(idRaw);
  const faucet = deployment?.faucet;
  if (!faucet) continue;
  if (only.length > 0 && !only.includes(chainId)) continue;

  const chain = CHAINS.find((c) => c.id === chainId);
  const label = chain?.name ?? `chain ${chainId}`;
  const rpc = chain?.rpcUrls?.[0];
  if (!rpc) {
    console.log(`${label} — no RPC endpoint, skipped`);
    continue;
  }

  /* staticNetwork: these endpoints fail eth_chainId-based network detection from a
     dev machine, and a provider that cannot detect its network cannot send. The
     chain id is already known from the registry, so detection buys nothing. */
  const provider = new JsonRpcProvider(rpc, chainId, { staticNetwork: true });
  const wallet = new Wallet(signerKey, provider);

  const readAssetInfo = async (blockTag?: number) =>
    faucetAbi.decodeFunctionResult(
      "assetInfo",
      await provider.call({
        to: faucet,
        data: faucetAbi.encodeFunctionData("assetInfo", [
          "0x0000000000000000000000000000000000000000",
        ]),
        ...(blockTag === undefined ? {} : { blockTag }),
      }),
    );

  try {
    /* ── work out what this chain's change actually is ────────────────────── */

    let what: string;
    let from: string;
    let to: string;
    let data: string;
    /* Reads the settled value back, at a given block, so a stale node cannot be
       mistaken for a failed write. Returns null when this node cannot answer. */
    let readBack: (blockTag: number) => Promise<string | null>;

    if (mode === "drip") {
      const info = await readAssetInfo();
      const tokens = info[0] as string[];
      const amounts = info[1] as bigint[];

      let match: { token: string; drip: bigint; decimals: number } | null =
        null;
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        let symbol: string;
        let decimals: number;
        if (NATIVE_SENTINELS.has(token.toLowerCase())) {
          symbol = chain?.nativeCurrency?.symbol ?? "NATIVE";
          decimals = 18;
        } else {
          try {
            symbol = String(
              erc20Abi.decodeFunctionResult(
                "symbol",
                await provider.call({
                  to: token,
                  data: erc20Abi.encodeFunctionData("symbol"),
                }),
              )[0],
            );
            decimals = Number(
              erc20Abi.decodeFunctionResult(
                "decimals",
                await provider.call({
                  to: token,
                  data: erc20Abi.encodeFunctionData("decimals"),
                }),
              )[0],
            );
          } catch {
            continue;
          }
        }
        if (symbol.toUpperCase() !== wantSymbol) continue;
        /* Two rows can carry one symbol — Sepolia and Base each list a paused
           Circle USDC beside the live mock. Prefer the one with a non-zero drip,
           so a retune never lands on the deliberately-paused twin and silently
           un-pauses it. */
        if (match === null || (match.drip === 0n && amounts[i] !== 0n)) {
          match = { token, drip: amounts[i], decimals };
        }
      }

      if (!match) {
        console.log(`${label} — does not list ${wantSymbol}, skipped`);
        continue;
      }

      const next = parseUnits(dripAmount, match.decimals);
      what = `${wantSymbol} drip`;
      from = formatUnits(match.drip, match.decimals);
      to = formatUnits(next, match.decimals);
      data = faucetAbi.encodeFunctionData("setDrip", [match.token, next]);
      if (match.drip === next) {
        console.log(`${label} — ${what} already ${to}, nothing to do`);
        continue;
      }
      readBack = async (blockTag) => {
        const after = await readAssetInfo(blockTag);
        const idx = (after[0] as string[]).findIndex(
          (t) => t.toLowerCase() === match!.token.toLowerCase(),
        );
        if (idx < 0) return null;
        return formatUnits((after[1] as bigint[])[idx], match!.decimals);
      };
    } else {
      const current = Number(
        faucetAbi.decodeFunctionResult(
          "cooldown",
          await provider.call({
            to: faucet,
            data: faucetAbi.encodeFunctionData("cooldown"),
          }),
        )[0],
      );
      what = "cooldown";
      from = humanDuration(current);
      to = humanDuration(cooldownSeconds);
      data = faucetAbi.encodeFunctionData("setCooldown", [cooldownSeconds]);
      if (current === cooldownSeconds) {
        console.log(`${label} — ${what} already ${to}, nothing to do`);
        continue;
      }
      readBack = async (blockTag) =>
        humanDuration(
          Number(
            faucetAbi.decodeFunctionResult(
              "cooldown",
              await provider.call({
                to: faucet,
                data: faucetAbi.encodeFunctionData("cooldown"),
                blockTag,
              }),
            )[0],
          ),
        );
    }

    /* ── owner, then send ─────────────────────────────────────────────────── */

    const owner = faucetAbi.decodeFunctionResult(
      "owner",
      await provider.call({
        to: faucet,
        data: faucetAbi.encodeFunctionData("owner"),
      }),
    )[0] as string;
    if (owner.toLowerCase() !== signerAddress.toLowerCase()) {
      problems++;
      console.log(
        `${label} — OWNER MISMATCH: faucet owner is ${owner}, signer is not. Skipped.`,
      );
      continue;
    }

    if (!send) {
      console.log(`${label} — would set ${what} ${from} → ${to}`);
      changed++;
      continue;
    }

    const tx = await wallet.sendTransaction({ to: faucet, data });
    const receipt = await tx.wait();
    const block = receipt?.blockNumber;

    /* Read it back. A receipt says the transaction executed, not that the value is
       the one asked for, and setDrip is exactly the kind of call where a wrong
       decimals assumption still succeeds.

       Pinned to the receipt's own block and retried, because Base's public RPC is
       load balanced and a read issued immediately after a write can land on a node
       that does not have that block yet. Read at "latest" it answered with the old
       drip, and a single unpinned read reported a landed write as a failure. A node
       missing the block errors, which the retry absorbs; it cannot answer staleness
       as if it were truth. */
    let confirmed: string | null = null;
    let readErr: unknown;
    for (let attempt = 0; attempt < 5 && block !== undefined; attempt++) {
      try {
        confirmed = await readBack(block);
        if (confirmed !== null) break;
      } catch (err) {
        readErr = err;
      }
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }

    if (confirmed === to) {
      changed++;
      console.log(
        `${label} — ${what} ${from} → ${to}  ok  block ${block}  ${tx.hash}`,
      );
    } else if (confirmed === null) {
      /* The write is on chain with status 1; only the confirming read failed. Say
         which, rather than implying the change did not land. */
      problems++;
      console.log(
        `${label} — sent ${tx.hash} (block ${block}, status 1) but could not read it back: ` +
          `${readErr instanceof Error ? readErr.message : "no answer"}. Verify with npm run verify:faucet.`,
      );
    } else {
      problems++;
      console.log(
        `${label} — sent ${tx.hash} but ${what} reads ${confirmed}, expected ${to}`,
      );
    }
  } catch (err) {
    problems++;
    console.log(
      `${label} — failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

console.log(
  `\n${changed} chain(s) ${send ? "updated" : "would change"}, ${problems} problem(s).` +
    (send
      ? "\nRe-check with: npm run verify:faucet -- 3000"
      : "\nAdd --send to apply."),
);
process.exit(problems > 0 ? 1 : 0);
