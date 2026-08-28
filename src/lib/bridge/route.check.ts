/**
 * The bridge resolver's routing, checked directly.
 *
 *   npx tsx src/lib/bridge/route.check.ts
 *   BRIDGE_LIVE=1 npx tsx src/lib/bridge/route.check.ts   (adds the aggregator
 *   probes, including the whole ERC20 leg)
 *
 * NOT part of `npm test`. build.test.ts and auditor.test.ts are offline by
 * construction and forbidden from the aggregator's live HTTP call, so they
 * exercise the resolver only through the network-free canonical corridor and a
 * stubbed error — build.test.ts says as much where it stubs the resolver and
 * defers "the resolver's routing" here by name. This is that file.
 *
 * The body is still offline and deterministic: the canonical Sepolia -> Base
 * Sepolia corridor is encoded with no network call, and every refusal it asserts
 * is decided before either the portal or an aggregator is touched. Those
 * assertions run on a default invocation and make no request. What is gated
 * behind BRIDGE_LIVE is everything that needs a provider to answer: the
 * aggregator's refusal on an unrouted corridor, and the whole ERC20 leg — a token
 * route exists only through an aggregator, and every cross-check the resolver
 * makes on one is a claim about a real quote, which a stub could not test. Both
 * are skipped-and-counted rather than omitted, because a green run must not hide
 * the hole.
 *
 * `to`, `data` and `value` are the trusted origin of a bridge Intent, so this
 * decodes the canonical calldata rather than pattern-matching it: the recipient,
 * the L2 gas and the empty extra-data are read back out of the bytes the wallet
 * would sign. On the ERC20 leg the same distrust applies to one more field —
 * `spender`, the only address this app grants an allowance to without having
 * deployed it.
 */

import { ethers } from "ethers";
import {
  resolveBridgeRoute,
  isKnownBridgeAddress,
  isKnownBridgeSpender,
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

/* The mainnet ERC20 corridor the live probe uses, and the two addresses it
   asserts against. Mainnet because the aggregators do not index any testnet, so
   a token route is only observable here — the same reason the ERC20 leg is
   mainnet-only in practice. Both addresses were read off a real
   li.quest/v1/quote for 10 USDC from 1 to 8453 rather than looked up. */
const ETHEREUM = 1;
const BASE = 8453;
const LIFI_ROUTER = "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE";
const MAINNET_USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

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
    /* A token no longer refused for being a token — but still refused here, and
       for a reason that fires BEFORE any routing. That ordering is what keeps
       this file offline now that an ERC20 corridor falls through to a live
       aggregator quote: name an unroutable destination and the guard that fires
       is the chain one, with nothing about native currency in it. */
    const r = await resolveBridgeRoute({
      fromChainId: SEPOLIA,
      toChain: "Narnia",
      asset: "USDC",
      amount: "10",
      decimals: 6,
      isNative: false,
      tokenAddress: MAINNET_USDC,
      userAddress: USER,
    });
    check(
      "an ERC20 corridor is refused on its destination, not for being an ERC20",
      "error" in r &&
        errorOf(r).includes('I don\'t recognise the chain "Narnia"') &&
        !errorOf(r).includes("native"),
      errorOf(r),
    );
  }

  {
    /* The canonical corridor asked for with a token, checked WITHOUT a network
       call by giving it no wallet. The portal branch is native only — an
       L1StandardBridge ERC20 deposit credits the OptimismMintableERC20 the
       factory paired with the L1 token, which our mocks are not — so a token must
       fall through to the aggregator instead. The two branches refuse a missing
       wallet in different words, and that difference is the observable: reaching
       the portal would say "the deposit credits your own address", reaching the
       aggregator says "to resolve an executable bridge route". */
    const r = await resolveBridgeRoute({
      fromChainId: SEPOLIA,
      toChain: "Base Sepolia",
      asset: "USDC",
      amount: "10",
      decimals: 6,
      isNative: false,
      tokenAddress: MAINNET_USDC,
      userAddress: "",
    });
    check(
      "a token over the canonical corridor skips the portal branch entirely",
      "error" in r &&
        errorOf(r).includes("to resolve an executable bridge route") &&
        !errorOf(r).includes("credits your own address"),
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
      "error" in r &&
        errorOf(r).includes('I don\'t recognise the chain "Narnia"'),
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

  /* -------------------------------------------- isKnownBridgeSpender pure -- *
   * The allowlist the approve auditor was widened by, and the only address in
   * this app that may hold an allowance without being a Kaleido contract. It is
   * chain-blind by design — LI.FI deploys the same diamond everywhere — so the
   * checks that matter are that it admits exactly one address and nothing else.
   * ---------------------------------------------------------------------- */
  check(
    "isKnownBridgeSpender accepts the LI.FI diamond",
    isKnownBridgeSpender(LIFI_ROUTER),
  );
  check(
    "isKnownBridgeSpender is case-insensitive on the address",
    isKnownBridgeSpender(LIFI_ROUTER.toLowerCase()),
  );
  check(
    "isKnownBridgeSpender rejects an unrelated address",
    !isKnownBridgeSpender(USER),
  );
  check(
    "isKnownBridgeSpender rejects the canonical portal — a portal is not a spender",
    !isKnownBridgeSpender(PORTAL),
  );
  check(
    "isKnownBridgeSpender rejects an empty address",
    !isKnownBridgeSpender(""),
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

    /* ------------------------------------------------- the ERC20 leg (live) -- *
     * The only place a token route can actually be observed. Everything the
     * resolver checks about it is a claim about a real provider response, so
     * asserting it against a stub would assert nothing: the point of these two
     * cases is that a LIVE quote satisfies the cross-checks, and that the token
     * cross-check refuses when it should.
     * -------------------------------------------------------------------- */
    const erc20 = await resolveBridgeRoute({
      fromChainId: ETHEREUM,
      toChain: "Base",
      asset: "USDC",
      amount: "10",
      decimals: 6,
      isNative: false,
      tokenAddress: MAINNET_USDC,
      userAddress: USER,
    });
    if ("error" in erc20) {
      check("a mainnet ERC20 corridor resolves", false, erc20.error);
    } else {
      /* One address, named as both the allowance target and the call target. The
         auditor re-checks this same equality, because an allowance split off from
         the call it authorises is the one mistake an approve leaves standing on
         the token after the transaction is over. */
      check(
        "the token route names a router that is both the spender and the call target",
        Boolean(erc20.spender) &&
          erc20.spender!.toLowerCase() === erc20.to.toLowerCase() &&
          isKnownBridgeSpender(erc20.spender!),
        JSON.stringify({ spender: erc20.spender, to: erc20.to }),
      );
      check(
        "it attaches no native value, and carries calldata rather than a bare send",
        erc20.value === "0" && erc20.data.length > 2,
        JSON.stringify({ value: erc20.value, dataLen: erc20.data.length }),
      );
      check(
        "it is tagged lifi and names the destination from the registry",
        erc20.provider === "lifi" &&
          erc20.toChainId === BASE &&
          erc20.toChainName === "Base",
        JSON.stringify({
          provider: erc20.provider,
          toChainId: erc20.toChainId,
          toChainName: erc20.toChainName,
        }),
      );
    }

    {
      /* The same live corridor, told the token is something else. LI.FI resolves
         `USDC` against its own list for chain 1 and will name Circle's; we claim
         a different contract, which is the shape of the real hazard — Sepolia
         lending runs a mock USDC where LI.FI would name Circle's. Approving one
         token and handing the router calldata that pulls another must refuse. */
      const mismatch = await resolveBridgeRoute({
        fromChainId: ETHEREUM,
        toChain: "Base",
        asset: "USDC",
        amount: "10",
        decimals: 6,
        isNative: false,
        tokenAddress: PORTAL, // a real address, and not USDC
        userAddress: USER,
      });
      check(
        "a token the provider does not agree is the asset is refused, both named",
        "error" in mismatch &&
          errorOf(mismatch).includes("not the USDC Kaleido would approve") &&
          errorOf(mismatch).includes(PORTAL),
        errorOf(mismatch),
      );
    }
  } else {
    skip(
      "the aggregator path returns an honest refusal on an unrouted corridor",
      "live HTTP; set BRIDGE_LIVE=1 to run it",
    );
    skip(
      "a live ERC20 corridor resolves to a vetted router, and a mismatched token is refused",
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
