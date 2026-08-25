/**
 * The bridge resolver's routing, checked directly.
 *
 *   npx tsx src/lib/bridge/route.check.ts
 *   BRIDGE_LIVE=1 npx tsx src/lib/bridge/route.check.ts   (adds the aggregator probe)
 *
 * NOT part of `npm test`. build.test.ts and auditor.test.ts are offline by
 * construction and forbidden from the aggregator's live HTTP call, so they
 * exercise the resolver only through the network-free canonical corridor and a
 * stubbed error — build.test.ts says as much where it stubs the resolver and
 * defers "the resolver's routing" here by name. This is that file.
 *
 * The body is still offline and deterministic: the canonical Sepolia -> Base
 * Sepolia corridor is encoded with no network call, and every refusal is decided
 * before either the portal or an aggregator is touched. Those assertions run on
 * a default invocation and make no request. The one genuinely live thing the
 * resolver does — asking LI.FI/Relay for a non-canonical corridor's calldata —
 * is gated behind BRIDGE_LIVE so a default run stays offline; skipped-and-counted
 * rather than omitted, because a green run must not hide the hole.
 *
 * `to`, `data` and `value` are the trusted origin of a bridge Intent, so this
 * decodes the canonical calldata rather than pattern-matching it: the recipient,
 * the L2 gas and the empty extra-data are read back out of the bytes the wallet
 * would sign.
 */

import { ethers } from "ethers";
import {
  resolveBridgeRoute,
  isKnownBridgeAddress,
} from "@/lib/bridge/route";

/* The same signature route.ts encodes against, redeclared here so the check
   decodes the bytes independently of the value under test rather than importing
   the constant it is meant to verify. */
const L1_STANDARD_BRIDGE_ABI = [
  "function depositETHTo(address _to, uint32 _minGasLimit, bytes _extraData) payable",
];

const SEPOLIA = 11155111;
const BASE_SEPOLIA = 84532;
const PORTAL = "0xfd0Bf71F60660E2f608ed56e1659C450eB113120";
/* A valid checksummed address standing in for the connected wallet — the UNI
   token's, chosen only because it is a real EIP-55 address, never called. */
const USER = "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984";

let pass = 0;
let fail = 0;
let skipped = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${name} ${detail}`);
  }
};
const skip = (name: string, why: string) => {
  skipped += 1;
  console.log(`  skip ${name} — ${why}`);
};

/** The error string of a refusal, or a sentinel that fails any `includes`. */
const errorOf = (r: unknown): string =>
  r && typeof r === "object" && "error" in r
    ? String((r as { error: unknown }).error)
    : "(no error — a route was returned)";

async function main() {
  /* ---------------------------------------------------- canonical route -- */
  {
    const r = await resolveBridgeRoute({
      fromChainId: SEPOLIA,
      toChain: "Base Sepolia",
      asset: "ETH",
      amount: "0.05",
      decimals: 18,
      isNative: true,
      userAddress: USER,
    });

    if ("error" in r) {
      check("the canonical corridor resolves", false, r.error);
    } else {
      check(
        "the canonical corridor resolves to the verified L1 portal",
        r.to.toLowerCase() === PORTAL.toLowerCase(),
        r.to,
      );
      check(
        "and the auditor would recognise that address on the source chain",
        isKnownBridgeAddress(SEPOLIA, r.to),
        r.to,
      );
      check(
        "the value is the amount in wei, to the wei",
        r.value === "50000000000000000",
        r.value,
      );
      check(
        "it is tagged canonical, with no fabricated ETA and the hardcoded gas floor",
        r.provider === "canonical" &&
          r.etaSeconds === null &&
          r.gasLimit === "1000000",
        JSON.stringify({
          provider: r.provider,
          etaSeconds: r.etaSeconds,
          gasLimit: r.gasLimit,
        }),
      );
      check(
        "it names the destination chain from the registry",
        r.toChainId === BASE_SEPOLIA && r.toChainName === "Base Sepolia",
        JSON.stringify({ toChainId: r.toChainId, toChainName: r.toChainName }),
      );

      /* Decode the calldata the wallet would sign, rather than trust its shape:
         a depositETHTo crediting THIS wallet, buying the fixed L2 gas, with no
         extra data. */
      try {
        const [to, minGasLimit, extraData] = new ethers.Interface(
          L1_STANDARD_BRIDGE_ABI,
        ).decodeFunctionData("depositETHTo", r.data);
        check(
          "the calldata is a depositETHTo crediting the connected wallet",
          ethers.getAddress(to) === ethers.getAddress(USER) &&
            Number(minGasLimit) === 200000 &&
            extraData === "0x",
          JSON.stringify({ to, minGasLimit: String(minGasLimit), extraData }),
        );
      } catch (e) {
        check(
          "the calldata is a depositETHTo crediting the connected wallet",
          false,
          `did not decode as depositETHTo: ${String(e)}`,
        );
      }
    }
  }

  /* ------------------------------------------------------------ refusals -- */
  {
    const r = await resolveBridgeRoute({
      fromChainId: SEPOLIA,
      toChain: "Base Sepolia",
      asset: "USDC",
      amount: "10",
      decimals: 6,
      isNative: false,
      userAddress: USER,
    });
    check(
      "an ERC20 corridor is refused before any routing — native only",
      "error" in r && errorOf(r).includes("only a chain's native currency is"),
      errorOf(r),
    );
  }

  {
    const r = await resolveBridgeRoute({
      fromChainId: SEPOLIA,
      toChain: "Narnia",
      asset: "ETH",
      amount: "0.05",
      decimals: 18,
      isNative: true,
      userAddress: USER,
    });
    check(
      "an unrecognised destination chain is refused by name",
      "error" in r && errorOf(r).includes('I don\'t recognise the chain "Narnia"'),
      errorOf(r),
    );
  }

  {
    const r = await resolveBridgeRoute({
      fromChainId: SEPOLIA,
      toChain: "Sepolia",
      asset: "ETH",
      amount: "0.05",
      decimals: 18,
      isNative: true,
      userAddress: USER,
    });
    check(
      "a destination equal to the source is refused",
      "error" in r && errorOf(r).includes("chain you're already on"),
      errorOf(r),
    );
  }

  {
    const r = await resolveBridgeRoute({
      fromChainId: SEPOLIA,
      toChain: "Base Sepolia",
      asset: "ETH",
      amount: "not-a-number",
      decimals: 18,
      isNative: true,
      userAddress: USER,
    });
    check(
      "an unparsable amount is refused, not thrown",
      "error" in r && errorOf(r).includes("isn't a valid ETH amount"),
      errorOf(r),
    );
  }

  {
    const r = await resolveBridgeRoute({
      fromChainId: SEPOLIA,
      toChain: "Base Sepolia",
      asset: "ETH",
      amount: "0",
      decimals: 18,
      isNative: true,
      userAddress: USER,
    });
    check(
      "a zero amount is refused",
      "error" in r && errorOf(r).includes("needs a positive amount"),
      errorOf(r),
    );
  }

  {
    /* Reaches the canonical branch — chain and amount are fine — and is stopped
       there because the deposit has no valid recipient to credit on L2. */
    const r = await resolveBridgeRoute({
      fromChainId: SEPOLIA,
      toChain: "Base Sepolia",
      asset: "ETH",
      amount: "0.05",
      decimals: 18,
      isNative: true,
      userAddress: "",
    });
    check(
      "a canonical deposit with no connected wallet is refused",
      "error" in r && errorOf(r).includes("Connect a wallet first"),
      errorOf(r),
    );
  }

  /* -------------------------------------------- isKnownBridgeAddress pure -- */
  check(
    "isKnownBridgeAddress accepts the corridor's portal",
    isKnownBridgeAddress(SEPOLIA, PORTAL),
  );
  check(
    "isKnownBridgeAddress is case-insensitive on the address",
    isKnownBridgeAddress(SEPOLIA, PORTAL.toUpperCase().replace("0X", "0x")),
  );
  check(
    "isKnownBridgeAddress rejects an unrelated address on a known chain",
    !isKnownBridgeAddress(SEPOLIA, USER),
  );
  check(
    "isKnownBridgeAddress rejects the portal on a chain with no corridor",
    !isKnownBridgeAddress(999999, PORTAL),
  );
  check(
    "isKnownBridgeAddress rejects an empty address",
    !isKnownBridgeAddress(SEPOLIA, ""),
  );

  /* ------------------------------------------------- aggregator (live) -- */
  if (process.env.BRIDGE_LIVE) {
    /* Base Sepolia -> Sepolia has no canonical portal, so the resolver falls
       through to LI.FI/Relay. The aggregators do not index the testnets, so the
       honest outcome is a named refusal rather than a route — this asserts the
       live failure degrades to `{ error }` rather than throwing. */
    const r = await resolveBridgeRoute({
      fromChainId: BASE_SEPOLIA,
      toChain: "Sepolia",
      asset: "ETH",
      amount: "0.05",
      decimals: 18,
      isNative: true,
      userAddress: USER,
    });
    check(
      "a non-canonical testnet corridor degrades to an honest refusal",
      "error" in r && errorOf(r).includes("No executable route"),
      errorOf(r),
    );
  } else {
    skip(
      "the aggregator path returns an honest refusal on an unrouted corridor",
      "live HTTP; set BRIDGE_LIVE=1 to run it",
    );
  }

  console.log(`\n${"─".repeat(78)}`);
  console.log(`  ${pass} passed, ${fail} failed, ${skipped} skipped`);
  console.log(`${"─".repeat(78)}\n`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("ROUTE CHECK FAILED:", e);
  process.exit(1);
});
