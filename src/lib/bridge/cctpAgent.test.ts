/**
 * End-to-end CCTP bridge check across BOTH agent paths — offline.
 *
 * Proves that a "bridge USDC" request produces a correct CCTP burn plan through
 * the local grammar path (parseCommand -> buildIntents) AND the cloud/model path
 * (planFromToolCalls -> buildIntents), that the auditor accepts it, and that the
 * destination-mint completion builds. Drives the REAL functions the app ships;
 * the only injected seams are speed:"standard" (skips Circle's fee network call,
 * deterministic) and a stub attestation/pricer. No transaction is ever sent.
 *
 *   npx tsx src/lib/bridge/cctpAgent.check.ts
 */

import { ethers } from "ethers";
import { buildIntents, type PlanDeps } from "@/lib/v2/intents/build";
import { parseCommand } from "@/lib/v2/intents/fromCommand";
import { planFromToolCalls, type ToolCall } from "@/lib/ai/fromToolCall";
import { serverPlanDeps } from "@/lib/ai/planDeps";
import { resolveBridgeRoute } from "@/lib/bridge/route";
import {
  CCTP_USDC,
  TOKEN_MESSENGER_V2,
  MESSAGE_TRANSMITTER_V2,
} from "@/lib/bridge/cctp";
import { auditPlan, type Pricer } from "@/lib/ai/auditor";
import { resolveCctpCompletion } from "@/lib/bridge/cctpAttestation";
import { chainTokens } from "@/constants/tokens";

const ARC = 5042;
const BASE = 8453;
const ETH = 1;
const USER = "0x1111111111111111111111111111111111111111";
const OPTS = { slippageBps: 50, deadlineMin: 20 };

// depositForBurn / receiveMessage selectors, derived independently of the code
// under test so a wrong-shape calldata cannot pass by matching itself.
const DEPOSIT_FOR_BURN = ethers
  .id(
    "depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)",
  )
  .slice(0, 10);
const RECEIVE_MESSAGE = ethers.id("receiveMessage(bytes,bytes)").slice(0, 10);

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (ok) pass++;
  else fail++;
}

/** $1 for USDC, priced off the amount, no network. */
const stubPricer: Pricer = async (_symbol, amount) => ({
  usd: Number(amount),
  source: "stub",
});

/** The real cloud deps, with the CCTP fee forced to the deterministic Standard
 *  lane so the check needs no network. Everything else is the shipped resolver. */
function deps(chainId: number): PlanDeps {
  const base = serverPlanDeps(USER, chainId);
  return {
    ...base,
    chainId,
    bridgeRoute: (req) =>
      resolveBridgeRoute({
        ...req,
        fromChainId: req.sourceChainId ?? chainId,
        userAddress: USER,
        speed: "standard",
      }),
  };
}

function burnIntentOf(build: { intents: unknown[] }) {
  return build.intents.find(
    (i): i is Record<string, unknown> =>
      !!i && (i as Record<string, unknown>).kind === "bridge",
  );
}
function approveIntentOf(build: { intents: unknown[] }) {
  return build.intents.find(
    (i): i is Record<string, unknown> =>
      !!i && (i as Record<string, unknown>).kind === "approve",
  );
}

async function main() {
  // ---------------------------------------------------------------- routes --
  console.log("\n— resolveBridgeRoute: CCTP is chosen for USDC on every corridor —");
  for (const [name, from, to, dest] of [
    ["Arc -> Base", ARC, BASE, "Base"],
    ["Base -> Arc", BASE, ARC, "Arc"],
    ["Ethereum -> Arc", ETH, ARC, "Arc"],
  ] as const) {
    // The ERC20 6-dec USDC face on the source chain — what the agent must burn.
    const tokenAddress = CCTP_USDC[from];
    const r = await resolveBridgeRoute({
      fromChainId: from,
      toChain: dest,
      asset: "USDC",
      amount: "10",
      decimals: 6,
      isNative: false,
      tokenAddress,
      userAddress: USER,
      speed: "standard",
    });
    const ok =
      !("error" in r) &&
      r.provider === "cctp" &&
      r.to.toLowerCase() === TOKEN_MESSENGER_V2.toLowerCase() &&
      r.value === "0" &&
      typeof r.data === "string" &&
      r.data.startsWith(DEPOSIT_FOR_BURN) &&
      r.spender?.toLowerCase() === TOKEN_MESSENGER_V2.toLowerCase();
    check(
      name,
      ok,
      "error" in r ? r.error : `provider=${r.provider} to=${r.to}`,
    );
  }

  // ------------------------------------------------------- local agent path --
  console.log("\n— local agent (parseCommand -> buildIntents), connected to Arc —");
  {
    const tokens = chainTokens(ARC);
    // Lowercase asset on purpose: the grammar must not care.
    const parsed = parseCommand("bridge 10 usdc to base", tokens);
    check(
      "grammar parses 'bridge 10 usdc to base' to a bridge command",
      parsed.status === "ok" && parsed.command.kind === "bridge",
      parsed.status,
    );
    if (parsed.status === "ok" && parsed.command.kind === "bridge") {
      const built = await buildIntents(parsed.command, OPTS, deps(ARC));
      check("buildIntents ok", built.ok, built.ok ? "" : built.error);
      if (built.ok) {
        const burn = burnIntentOf(built.build) as Record<string, unknown>;
        const approve = approveIntentOf(built.build) as Record<string, unknown>;
        check(
          "plan is approve + bridge (ERC20 leg, not the native gas path)",
          !!approve && !!burn,
          `intents=${built.build.intents.length}`,
        );
        check(
          "bridge intent is a CCTP burn of the 6-dec USDC alias",
          !!burn &&
            burn.provider === "cctp" &&
            burn.isNative === false &&
            burn.decimals === 6 &&
            (burn.token as string).toLowerCase() ===
              CCTP_USDC[ARC].toLowerCase() &&
            (burn.to as string).toLowerCase() ===
              TOKEN_MESSENGER_V2.toLowerCase() &&
            burn.value === "0",
          burn
            ? `provider=${burn.provider} isNative=${burn.isNative} decimals=${burn.decimals} token=${burn.token}`
            : "no bridge intent",
        );
        check(
          "approve targets TokenMessenger for the same alias",
          !!approve &&
            (approve.spender as string).toLowerCase() ===
              TOKEN_MESSENGER_V2.toLowerCase() &&
            (approve.token as string).toLowerCase() ===
              CCTP_USDC[ARC].toLowerCase(),
          approve ? `spender=${approve.spender}` : "no approve",
        );
        // Auditor must accept the plan the local path built.
        const v = await auditPlan({
          plan: built.build.intents as never,
          chainId: ARC,
          pricer: stubPricer,
        });
        check(
          "auditor accepts the local plan",
          v.ok === true && v.blocked.length === 0,
          v.ok ? "" : v.blocked.join("; "),
        );
      }
    }
  }

  // ------------------------------------------------------- cloud agent path --
  console.log("\n— cloud agent (bridge tool call -> planFromToolCalls), on Arc —");
  {
    const calls: ToolCall[] = [
      { name: "bridge", args: { amount: "10", asset: "usdc", toChain: "Base" } },
    ];
    const built = await planFromToolCalls(calls, ARC, deps(ARC), OPTS);
    check(
      "tool call builds a plan with no errors",
      built.errors.length === 0 && built.plan.length > 0,
      built.errors.join("; "),
    );
    const burn = built.plan.find(
      (i) => (i as unknown as Record<string, unknown>).kind === "bridge",
    ) as unknown as Record<string, unknown> | undefined;
    check(
      "cloud plan bridge intent is the same CCTP burn",
      !!burn &&
        burn.provider === "cctp" &&
        burn.isNative === false &&
        burn.decimals === 6 &&
        (burn.to as string).toLowerCase() === TOKEN_MESSENGER_V2.toLowerCase(),
      burn ? `provider=${burn.provider} isNative=${burn.isNative}` : "no burn",
    );
    const v = await auditPlan({
      plan: built.plan as never,
      chainId: ARC,
      pricer: stubPricer,
    });
    check(
      "auditor accepts the cloud plan",
      v.ok === true && v.blocked.length === 0,
      v.ok ? "" : v.blocked.join("; "),
    );
  }

  // --------------------------------------------------------- completion leg --
  console.log("\n— completion (resolveCctpCompletion -> cctpReceive), on Base —");
  {
    const fakeIris: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          messages: [
            {
              status: "complete",
              message: "0x" + "ab".repeat(40),
              attestation: "0x" + "cd".repeat(65),
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const res = await resolveCctpCompletion({
      sourceChainId: ARC,
      sourceChainName: "Arc",
      destChainId: BASE,
      txHash: "0x" + "11".repeat(32),
      amount: "10",
      symbol: "USDC",
      fetchImpl: fakeIris,
    });
    check("completion builds a plan", res.ok, res.ok ? "" : res.error);
    if (res.ok) {
      const mint = res.build.intents[0] as unknown as Record<string, unknown>;
      check(
        "mint is a cctpReceive to MessageTransmitter with receiveMessage calldata",
        mint.kind === "cctpReceive" &&
          (mint.to as string).toLowerCase() ===
            MESSAGE_TRANSMITTER_V2.toLowerCase() &&
          (mint.data as string).startsWith(RECEIVE_MESSAGE) &&
          mint.chainId === BASE,
        `kind=${mint.kind} to=${mint.to}`,
      );
      const v = await auditPlan({
        plan: res.build.intents as never,
        chainId: BASE,
        pricer: stubPricer,
      });
      check(
        "auditor accepts the mint on the destination chain",
        v.ok === true && v.blocked.length === 0,
        v.ok ? "" : v.blocked.join("; "),
      );
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
