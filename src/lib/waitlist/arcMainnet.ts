import { JsonRpcProvider } from "ethers";

/**
 * The private/unofficial Arc mainnet, used ONLY by the waitlist activation reader.
 *
 * Some protocols are already deploying to this RPC ahead of Arc's official Sep-16
 * mainnet, so people are genuinely transacting on it today. That makes it the one
 * place we can prove a waitlisted wallet is a real, active user *now*, which is
 * what gates pending points into Season 1 (see api/waitlist/activate).
 *
 * Keep this scoped to activation. It is deliberately NOT wired into chains.ts /
 * the app's chain registry — the official mainnet (and a point_chains entry) can
 * replace it later. chain_id 5042 is distinct from Arc Testnet 5042002.
 */
export const ARC_MAINNET_CHAIN_ID = 5042;
// rpc.mainnet.arc.io answers block reads reliably; rpc.arc-scan.org (the
// explorer's node) returns the right chainId but was measured "unreachable" on
// eth_blockNumber 2026-09-16, so it is no longer the default. Override with
// ARC_MAINNET_RPC_URL if the official endpoint changes.
export const ARC_MAINNET_RPC =
  process.env.ARC_MAINNET_RPC_URL ?? "https://rpc.mainnet.arc.io";

let cached: JsonRpcProvider | null = null;
function provider(): JsonRpcProvider {
  if (!cached) {
    // staticNetwork: the chain id is fixed and the endpoint is single-purpose, so
    // skip the eth_chainId probe on every call.
    cached = new JsonRpcProvider(ARC_MAINNET_RPC, ARC_MAINNET_CHAIN_ID, {
      staticNetwork: true,
    });
  }
  return cached;
}

/**
 * Activation signal v1: has this wallet done anything on Arc mainnet?
 *
 * A sent transaction bumps the account nonce, and a nonce cannot move without
 * paying gas, so `nonce > 0` is a cheap, sybil-resistant "this is a real wallet
 * that has actually transacted here" gate — exactly what we want before turning a
 * free signup bonus into real Season 1 points. Tighten to "interacted with
 * Kaleido contracts on 5042" once Kaleido is deployed there.
 */
export async function hasArcActivity(wallet: string): Promise<boolean> {
  const nonce = await provider().getTransactionCount(wallet, "latest");
  return nonce > 0;
}
