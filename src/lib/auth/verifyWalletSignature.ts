/**
 * Does `signature` prove `address` signed one of `messages`?
 *
 * Every rewards endpoint used `ethers.verifyMessage`, which only recovers a
 * plain EOA. Two failures came out of that:
 *  - A smart-contract wallet (Coinbase Smart Wallet, Safe, Ambire, …) signs per
 *    ERC-1271, or ERC-6492 before it is deployed; those never recover to the
 *    wallet's address.
 *  - Endpoints that accept two message wordings fell back to the second only
 *    when the first THREW — but ecrecover over the wrong message returns a
 *    stranger's address rather than throwing, so the fallback never ran.
 *
 * Order: every message through the EOA check first (free, no RPC — almost every
 * user). Only then the contract-wallet path via viem (ERC-1271 + ERC-6492), and
 * only where it can apply: a non-65-byte signature (6492 wraps a counterfactual
 * wallet's signature), or an address with code on that chain. A plain wrong
 * signature from a plain wallet therefore fails fast with no RPC at all.
 * Server-side only.
 */
import { verifyMessage as eoaRecover } from "ethers";
import { createPublicClient, defineChain, http, type Chain } from "viem";
import { base, mainnet } from "viem/chains";
import { CHAINS_BY_ID } from "@/constants/chains";

const arcRpc = CHAINS_BY_ID[5042]?.rpcUrls?.[0];
const arc: Chain | null = arcRpc
  ? defineChain({
      id: 5042,
      name: "Arc",
      nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
      rpcUrls: { default: { http: [arcRpc] } },
    })
  : null;

const CHAINS: Chain[] = [arc, base, mainnet].filter((c): c is Chain => !!c);
const transport = () => http(undefined, { timeout: 6_000, retryCount: 0 });

/** 0x + 65 bytes: an ordinary ECDSA signature. */
const isPlainEcdsa = (sig: string) => /^0x[0-9a-fA-F]{130}$/.test(sig);

export async function verifyWalletSignature(
  address: string,
  messages: string | readonly string[],
  signature: string,
): Promise<boolean> {
  const want = address.toLowerCase();
  const list = typeof messages === "string" ? [messages] : [...messages];
  if (!signature) return false;

  for (const m of list) {
    try {
      if (eoaRecover(m, signature).toLowerCase() === want) return true;
    } catch {
      /* not an EOA signature — maybe a contract wallet's */
    }
  }

  for (const chain of CHAINS) {
    const client = createPublicClient({ chain, transport: transport() });
    try {
      if (isPlainEcdsa(signature)) {
        const code = await client.getCode({ address: address as `0x${string}` });
        if (!code || code === "0x") continue; // a plain wallet here; EOA already said no
      }
      for (const m of list) {
        const ok = await client.verifyMessage({
          address: address as `0x${string}`,
          message: m,
          signature: signature as `0x${string}`,
        });
        if (ok) return true;
      }
    } catch {
      /* RPC hiccup on this chain — try the next */
    }
  }
  return false;
}
