/**
 * isCctpMinted — the on-chain "has this transfer already landed?" check, offline.
 *
 *   npx tsx src/lib/bridge/cctpMinted.test.ts
 *
 * A CCTP burn (destinationCaller = 0) can be completed by anyone — the user, our
 * keeper, or a public relayer — so the pending bar clears off the CHAIN, not our
 * records. This proves the four states, with the attestation fetch and the
 * destination eth_call both injected: not-attested → not minted; attested and a
 * dry receiveMessage that would succeed → not minted (still claimable); attested
 * and a "nonce already used" revert → minted; any other revert → not minted (so
 * a transient error never makes the bar vanish over funds in flight).
 */

import { isCctpMinted } from "@/lib/bridge/cctpAttestation";

const ARC = 5042;
const BASE = 8453;
const TX = "0x" + "11".repeat(32);

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  FAIL: ${name}${extra === undefined ? "" : ` — ${JSON.stringify(extra)}`}`);
  }
}

/** A fetch that returns a ready attestation (status complete + real-ish bytes). */
const attested: typeof fetch = async () =>
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

/** A fetch that says Circle hasn't attested yet (404 → pending). */
const notAttested: typeof fetch = async () => new Response("", { status: 404 });

const base = { sourceChainId: ARC, destChainId: BASE, txHash: TX } as const;

async function main() {
  {
    // Not attested → cannot have minted, and no eth_call is even attempted.
    let called = false;
    const minted = await isCctpMinted({
      ...base,
      fetchImpl: notAttested,
      callImpl: async () => {
        called = true;
        return "0x";
      },
    });
    check("not attested → not minted", minted === false);
    check("not attested → the chain is not even queried", called === false);
  }

  {
    // Attested, and a dry receiveMessage that WOULD succeed → still claimable.
    const minted = await isCctpMinted({
      ...base,
      fetchImpl: attested,
      callImpl: async () => "0x0000000000000000000000000000000000000000000000000000000000000001",
    });
    check("attested + call succeeds → not minted (still claimable)", minted === false);
  }

  {
    // Attested, and the receive reverts as a used nonce → someone completed it.
    for (const reason of [
      "execution reverted: Nonce already used",
      "nonce already used",
      "execution reverted: message already received",
    ]) {
      const minted = await isCctpMinted({
        ...base,
        fetchImpl: attested,
        callImpl: async () => {
          throw new Error(reason);
        },
      });
      check(`used-nonce revert → minted (${reason.slice(0, 24)}…)`, minted === true);
    }
  }

  {
    // Attested, but the call reverts for an unrelated reason → inconclusive, so
    // the bar stays rather than clearing over funds that may still be in flight.
    const minted = await isCctpMinted({
      ...base,
      fetchImpl: attested,
      callImpl: async () => {
        throw new Error("execution reverted: Invalid attestation");
      },
    });
    check("unrelated revert → not minted (bar stays)", minted === false);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
