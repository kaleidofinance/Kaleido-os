#!/usr/bin/env node
/**
 * Faucet capacity: how many new users can each chain's faucet actually serve?
 *
 * The question a campaign asks that no unit test does. `npm run test:gasfaucets`
 * checks the external-faucet link table; this asks the chains themselves whether
 * the assets behind /faucet have the balance to pay the crowd being invited to
 * them. Capacity per asset is `balance / drip`, and the chain's capacity is its
 * scarcest unpaused asset — one empty asset is a claim button that reverts, which
 * reads as a broken app rather than as a depleted faucet.
 *
 *   npm run verify:faucet            # default target, 3000 users
 *   npm run verify:faucet -- 1200    # size for expected activation, not list size
 *
 * Reads only, so it is safe against production and costs nothing.
 *
 * TWO THINGS THAT DICTATE THE SHAPE HERE.
 *
 * Addresses come from DEPLOYMENTS rather than a table in this file. A hardcoded
 * faucet address is how an audit ends up confidently reporting on a contract that
 * was redeployed last week, and the generated record is the one source that moves
 * when a deployment does.
 *
 * Raw `fetch` + `Interface` rather than JsonRpcProvider. Network detection fails
 * against several of these endpoints from a dev machine, and a provider that
 * cannot detect its network cannot make the call at all. The retry loop inspects
 * the JSON-RPC error body, not the HTTP status, because sepolia.base.org (-32016)
 * and Arc (-32005) both return rate limits as HTTP 200 with an error payload.
 */

import { Interface, formatUnits } from "ethers";

import { CHAINS } from "../src/constants/chains";
import { DEPLOYMENTS } from "../src/constants/registry";

const TARGET = Number(process.argv[2] ?? 3000);
if (!Number.isFinite(TARGET) || TARGET <= 0) {
  console.error(
    `Usage: npm run verify:faucet -- <users>   (got "${process.argv[2]}")`,
  );
  process.exit(2);
}

const faucetAbi = new Interface([
  "function assetInfo(address user) view returns (address[] tokens, uint256[] amounts, uint256[] balances, uint256[] nextClaimAt)",
  "function cooldown() view returns (uint256)",
  "function getTotalUsers() view returns (uint256)",
]);
const erc20Abi = new Interface([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

/* The faucet lists the native coin under `NATIVE_TOKEN = address(1)`, which it
   must because that is the protocol's lending sentinel (Faucet.sol:83-88). It is
   not a contract, so it never answers symbol() — without this the most important
   row in the audit, the gas the whole claim flow depends on, prints as a truncated
   address. address(0) and the 0xEeee… alias are here for the same reason, since
   other tables in this repo reach for those. */
const NATIVE_SENTINELS = new Set([
  "0x0000000000000000000000000000000000000001",
  "0x0000000000000000000000000000000000000000",
  "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
]);

let rpcSeq = 0;

async function ethCall(
  rpcs: readonly string[],
  to: string,
  data: string,
): Promise<string> {
  let lastErr: unknown;
  for (const url of rpcs) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: ++rpcSeq,
            method: "eth_call",
            params: [{ to, data }, "latest"],
          }),
        });
        const body = (await res.json()) as {
          result?: string;
          error?: { code: number; message: string };
        };
        if (body.error)
          throw new Error(`${body.error.code}: ${body.error.message}`);
        if (!body.result || body.result === "0x")
          throw new Error("empty result");
        return body.result;
      } catch (err) {
        lastErr = err;
        /* Linear backoff. These are throttles, not outages — a second endpoint is
           tried only once this one has refused three times. */
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function tokenMeta(
  rpcs: readonly string[],
  addr: string,
  nativeSymbol: string,
): Promise<{ symbol: string; decimals: number }> {
  if (NATIVE_SENTINELS.has(addr.toLowerCase())) {
    return { symbol: nativeSymbol, decimals: 18 };
  }
  try {
    const [sym, dec] = await Promise.all([
      ethCall(rpcs, addr, erc20Abi.encodeFunctionData("symbol")),
      ethCall(rpcs, addr, erc20Abi.encodeFunctionData("decimals")),
    ]);
    return {
      symbol: String(erc20Abi.decodeFunctionResult("symbol", sym)[0]),
      decimals: Number(erc20Abi.decodeFunctionResult("decimals", dec)[0]),
    };
  } catch {
    /* An asset whose metadata will not load still has a drip and a balance, and
       those are what this audit is about. Naming it by address beats dropping it. */
    return { symbol: `${addr.slice(0, 8)}…`, decimals: 18 };
  }
}

type Row = {
  symbol: string;
  drip: string;
  balance: string;
  capacity: number | null;
};

let shortfalls = 0;
let unreachable = 0;

console.log(`\nFaucet capacity — sized for ${TARGET.toLocaleString()} users\n`);

for (const [idRaw, deployment] of Object.entries(DEPLOYMENTS)) {
  const chainId = Number(idRaw);
  const faucet = deployment?.faucet;
  if (!faucet) continue;

  const chain = CHAINS.find((c) => c.id === chainId);
  const label = (chain?.name ?? `chain ${chainId}`).slice(0, 18);
  const rpcs = chain?.rpcUrls ?? [];
  const nativeSymbol = chain?.nativeCurrency?.symbol ?? "NATIVE";

  if (rpcs.length === 0) {
    console.log(`${label} — no RPC endpoint in CHAINS, skipped\n`);
    continue;
  }

  process.stdout.write(`${label}  `);
  try {
    /* assetInfo is asked about the zero address on purpose: nextClaimAt for a
       user nobody has ever been is meaningless, and the drips and balances — the
       only two columns this audit reads — are the same whoever asks. */
    const [infoRaw, cooldownRaw, usersRaw] = await Promise.all([
      ethCall(
        rpcs,
        faucet,
        faucetAbi.encodeFunctionData("assetInfo", [
          "0x0000000000000000000000000000000000000000",
        ]),
      ),
      ethCall(rpcs, faucet, faucetAbi.encodeFunctionData("cooldown")).catch(
        () => null,
      ),
      ethCall(
        rpcs,
        faucet,
        faucetAbi.encodeFunctionData("getTotalUsers"),
      ).catch(() => null),
    ]);

    const info = faucetAbi.decodeFunctionResult("assetInfo", infoRaw);
    const tokens = info[0] as string[];
    const amounts = info[1] as bigint[];
    const balances = info[2] as bigint[];

    const cooldown = cooldownRaw
      ? Number(faucetAbi.decodeFunctionResult("cooldown", cooldownRaw)[0])
      : null;
    const users = usersRaw
      ? Number(faucetAbi.decodeFunctionResult("getTotalUsers", usersRaw)[0])
      : null;

    console.log(
      `cooldown ${cooldown === null ? "?" : `${cooldown / 3600}h`}` +
        ` · ${users ?? "?"} users so far · ${tokens.length} assets`,
    );

    const rows: Row[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const { symbol, decimals } = await tokenMeta(
        rpcs,
        tokens[i],
        nativeSymbol,
      );
      const drip = amounts[i];
      rows.push({
        symbol,
        drip: formatUnits(drip, decimals),
        balance: formatUnits(balances[i], decimals),
        /* drip 0 is paused, which is a deliberate state (assets we did not issue)
           rather than a shortfall — see the faucet's own note on third-party
           assets. Capacity is undefined for those, not zero. */
        capacity: drip === 0n ? null : Number(balances[i] / drip),
      });
    }

    for (const r of rows) {
      const verdict =
        r.capacity === null
          ? "paused (drip 0)"
          : r.capacity >= TARGET
            ? `ok · serves ${r.capacity.toLocaleString()}`
            : `SHORT · serves ${r.capacity.toLocaleString()}`;
      if (r.capacity !== null && r.capacity < TARGET) shortfalls++;
      console.log(
        `    ${r.symbol.padEnd(9)} drip ${r.drip.padEnd(11)} balance ${r.balance.padEnd(17)} ${verdict}`,
      );
    }

    const live = rows
      .filter((r) => r.capacity !== null)
      .map((r) => r.capacity as number);
    if (live.length > 0) {
      const worst = Math.min(...live);
      const binding = rows.find((r) => r.capacity === worst);
      console.log(
        `    → chain serves ${worst.toLocaleString()} users, bound by ${binding?.symbol}`,
      );
    }
  } catch (err) {
    unreachable++;
    console.log(
      `unreachable — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  console.log();
}

console.log(
  shortfalls === 0 && unreachable === 0
    ? `Every unpaused asset serves ${TARGET.toLocaleString()}.`
    : `${shortfalls} asset(s) below target, ${unreachable} chain(s) unreachable.`,
);
/* Non-zero on a shortfall so this can gate a campaign step, and so an unreachable
   chain is never mistaken for a healthy one. */
process.exit(shortfalls > 0 || unreachable > 0 ? 1 : 0);
