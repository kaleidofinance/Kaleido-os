/**
 * The lending liquidation keeper: finds serviced loans that may be liquidated
 * (overdue, or the borrower's account health factor below 1) and liquidates them.
 *
 * ── Why the protocol runs one ──────────────────────────────────────────────────
 *
 * `liquidateUserRequest` is permissionless and pays the caller a share of the
 * 6.4% penalty, so in principle outside liquidators do this. In practice a new
 * market on a new chain has none, and an unhealthy loan nobody liquidates keeps
 * losing value until the collateral no longer covers the debt — a loss that lands
 * on the LENDER. The pre-launch audit (2026-09-28) found nothing in the repo that
 * ever called it. This is that caller; outside liquidators are still welcome and
 * simply race it.
 *
 * ── What it decides, and what it leaves to the contract ───────────────────────
 *
 * `candidates()` is only a filter to keep the RPC bill small: a loan is a
 * candidate when it is past its return date or its borrower's health factor
 * reads below 1. The contract is the judge — every candidate is simulated from
 * the keeper's own address first (`staticCall`), and only a simulation that
 * succeeds is sent. A candidate the contract refuses (healthy again after a price
 * move, already liquidated by someone else) is reported as skipped, never forced.
 *
 * Gas is padded ×1.3 over the estimate: a liquidation's cost drifts a few hundred
 * gas between the block it is estimated in and the block it lands in (interest and
 * seizure amounts move with time), and an unpadded limit dies on EIP-2200's SSTORE
 * sentry — measured in the Arc testnet parity rehearsal (351,105 vs 351,376).
 *
 * The liquidator's reward is credited to the keeper's ledger INSIDE the diamond
 * (like every lending balance), not sent to its wallet; `rewards` in the result
 * reports what has accumulated there. Withdrawing it is a separate, deliberate act.
 *
 * Signs with KEEPER_PRIVATE_KEY only, and refuses a key equal to PRIVATE_KEY or
 * DEPLOYER_PRIVATE_KEY — the same rule as the price and CCTP keepers: a key
 * reachable over HTTP must never be able to cut the diamond.
 */
import { ethers } from "ethers";

import ProtocolFacetAbi from "@/abi/ProtocolFacet.json";
import { getChainMeta } from "@/constants/chains";
import { getContracts } from "@/constants/registry";
import { retryRpc } from "@/lib/dex/rpcRetry";
import { lendingChains } from "@/lib/lending/chain";

if (typeof window !== "undefined") {
  throw new Error("liquidator is server-only: it signs with the keeper key");
}

/** getHealthFactor's answer for an account with no debt (type(uint256).max). */
export const NO_DEBT = (1n << 256n) - 1n;
export const HEALTH_ONE = 10n ** 18n;
const STATUS_SERVICED = 1n;
/** Estimate × 13/10: see "Gas is padded" above. */
export const GAS_PAD_NUM = 13n;
export const GAS_PAD_DEN = 10n;

export interface Loan {
  requestId: bigint;
  author: string;
  lender: string;
  returnDate: bigint;
  totalRepayment: bigint;
}

export interface ChainBook {
  /** Chain time (latest block timestamp), seconds — never the host clock. */
  now: bigint;
  loans: Loan[];
  /** Health factor per borrower (lowercased). Absent = could not be read. */
  health: Map<string, bigint>;
}

export interface Candidate {
  requestId: bigint;
  borrower: string;
  overdue: boolean;
  /** null when the health factor could not be read. */
  healthFactor: bigint | null;
}

export type Simulation = { ok: true } | { ok: false; reason: string };
export type SendOutcome =
  | { hash: string }
  /** Could not pay for it right now (gas); stop this chain for the run. */
  | { skipped: string }
  | { error: string };

export interface LiquidatorDeps {
  keeperAddress(): string | null;
  readBook(chainId: number): Promise<ChainBook | { error: string }>;
  simulate(chainId: number, requestId: bigint): Promise<Simulation>;
  send(chainId: number, requestId: bigint): Promise<SendOutcome>;
  /** Collateral credited to the keeper's ledger in the diamond, per token. */
  rewards(chainId: number): Promise<Record<string, string>>;
}

export interface ChainLiquidation {
  chainId: number;
  status: "ok" | "error";
  error?: string;
  loansChecked: number;
  candidates: number;
  liquidated: { requestId: string; hash: string; overdue: boolean }[];
  wouldLiquidate: { requestId: string; overdue: boolean }[];
  skipped: { requestId: string; reason: string }[];
  failed: { requestId: string; error: string }[];
  rewards?: Record<string, string>;
}

export interface LiquidationResult {
  ok: boolean;
  error?: string;
  dryRun: boolean;
  keeper: string | null;
  chains: ChainLiquidation[];
  liquidated: number;
  wouldLiquidate: number;
  failed: number;
}

/**
 * Which serviced loans are worth simulating: overdue, or the borrower's account
 * health factor below 1. Overdue first (the lender has waited longest), then the
 * lowest health factor (the most collateral at risk). Pure.
 */
export function candidates(book: ChainBook): Candidate[] {
  const out: Candidate[] = [];
  for (const loan of book.loans) {
    if (loan.totalRepayment === 0n) continue;
    const borrower = loan.author.toLowerCase();
    const hf = book.health.has(borrower) ? (book.health.get(borrower) as bigint) : null;
    const overdue = loan.returnDate < book.now;
    const unhealthy = hf !== null && hf !== NO_DEBT && hf < HEALTH_ONE;
    if (overdue || unhealthy) {
      out.push({ requestId: loan.requestId, borrower, overdue, healthFactor: hf });
    }
  }
  return out.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    const ha = a.healthFactor ?? NO_DEBT;
    const hb = b.healthFactor ?? NO_DEBT;
    return ha < hb ? -1 : ha > hb ? 1 : 0;
  });
}

async function liquidateChain(
  chainId: number,
  opts: { dryRun: boolean; limit: number },
  deps: LiquidatorDeps,
): Promise<ChainLiquidation> {
  const report: ChainLiquidation = {
    chainId,
    status: "ok",
    loansChecked: 0,
    candidates: 0,
    liquidated: [],
    wouldLiquidate: [],
    skipped: [],
    failed: [],
  };
  const book = await deps.readBook(chainId);
  if ("error" in book) {
    report.status = "error";
    report.error = book.error;
    return report;
  }
  report.loansChecked = book.loans.length;
  const list = candidates(book);
  report.candidates = list.length;

  let acted = 0;
  for (const c of list) {
    if (acted >= opts.limit) break;
    const id = c.requestId.toString();
    const sim = await deps.simulate(chainId, c.requestId);
    if (!sim.ok) {
      report.skipped.push({ requestId: id, reason: sim.reason });
      continue;
    }
    acted++;
    if (opts.dryRun) {
      report.wouldLiquidate.push({ requestId: id, overdue: c.overdue });
      continue;
    }
    const sent = await deps.send(chainId, c.requestId);
    if ("hash" in sent) {
      report.liquidated.push({ requestId: id, hash: sent.hash, overdue: c.overdue });
    } else if ("skipped" in sent) {
      report.skipped.push({ requestId: id, reason: sent.skipped });
      break; // the keeper cannot pay here; the rest would fail the same way
    } else {
      report.failed.push({ requestId: id, error: sent.error });
    }
  }
  if (report.liquidated.length > 0) {
    try {
      report.rewards = await deps.rewards(chainId);
    } catch {
      /* a failed read of the reward ledger is not a failed liquidation */
    }
  }
  return report;
}

export async function runLiquidations(
  opts: { chainIds?: number[]; dryRun?: boolean; limit?: number } = {},
  deps: LiquidatorDeps = defaultDeps(),
): Promise<LiquidationResult> {
  const dryRun = Boolean(opts.dryRun);
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 5), 1), 25);
  const keeper = deps.keeperAddress();
  const base: LiquidationResult = {
    ok: false,
    dryRun,
    keeper,
    chains: [],
    liquidated: 0,
    wouldLiquidate: 0,
    failed: 0,
  };
  if (!keeper) {
    return { ...base, error: "KEEPER_PRIVATE_KEY is not set, or is an owner key — refusing to sign" };
  }
  const chainIds = opts.chainIds?.length ? opts.chainIds : lendingChains();
  // Chains in parallel (separate nonces); loans within a chain in sequence (one nonce).
  const chains = await Promise.all(chainIds.map((id) => liquidateChain(id, { dryRun, limit }, deps)));
  return {
    ...base,
    ok: chains.every((c) => c.status === "ok"),
    chains,
    liquidated: chains.reduce((n, c) => n + c.liquidated.length, 0),
    wouldLiquidate: chains.reduce((n, c) => n + c.wouldLiquidate.length, 0),
    failed: chains.reduce((n, c) => n + c.failed.length, 0),
  };
}

// ───────────────────────────────────────────── production dependencies (ethers)

const protocolIface = new ethers.Interface(ProtocolFacetAbi as ethers.InterfaceAbi);

/** The keeper key, or null when unset or equal to an owner key. */
function keeperKey(): string | null {
  const key = process.env.KEEPER_PRIVATE_KEY?.trim();
  if (!key) return null;
  if (key === process.env.PRIVATE_KEY?.trim() || key === process.env.DEPLOYER_PRIVATE_KEY?.trim()) {
    return null;
  }
  return key;
}

function decodeRevert(e: unknown): string {
  const err = e as { data?: string; info?: { error?: { data?: string } }; shortMessage?: string; message?: string };
  const text = `${err?.data ?? ""} ${err?.info?.error?.data ?? ""} ${err?.message ?? ""}`;
  for (const data of text.match(/0x[0-9a-fA-F]{8,}/g) ?? []) {
    try {
      const parsed = protocolIface.parseError(data);
      if (parsed) return parsed.name;
    } catch {
      /* not one of ours */
    }
  }
  return (err?.shortMessage ?? err?.message ?? "reverted").slice(0, 120);
}

function defaultDeps(): LiquidatorDeps {
  const key = keeperKey();
  const providers = new Map<number, ethers.JsonRpcProvider>();
  const provider = (chainId: number) => {
    let p = providers.get(chainId);
    if (!p) {
      const meta = getChainMeta(chainId);
      if (!meta?.rpcUrls?.[0]) throw new Error(`no RPC for chain ${chainId}`);
      p = new ethers.JsonRpcProvider(meta.rpcUrls[0], { chainId, name: String(chainId) }, { staticNetwork: true });
      providers.set(chainId, p);
    }
    return p;
  };
  const diamondAt = (chainId: number, runner: ethers.ContractRunner) => {
    const address = getContracts(chainId)?.diamond;
    if (!address) throw new Error(`no lending diamond on chain ${chainId}`);
    return new ethers.Contract(address, protocolIface, runner);
  };
  const wallet = (chainId: number) => new ethers.Wallet(key as string, provider(chainId));

  return {
    keeperAddress: () => (key ? new ethers.Wallet(key).address : null),

    async readBook(chainId) {
      try {
        const p = provider(chainId);
        const diamond = diamondAt(chainId, p);
        const [block, serviced] = await Promise.all([
          retryRpc(() => p.getBlock("latest")),
          retryRpc(() => diamond.getServicedRequests() as Promise<ethers.Result[]>),
        ]);
        const loans: Loan[] = [];
        for (const r of serviced) {
          if (BigInt(r.status) !== STATUS_SERVICED) continue;
          loans.push({
            requestId: BigInt(r.requestId),
            author: String(r.author),
            lender: String(r.lender),
            returnDate: BigInt(r.returnDate),
            totalRepayment: BigInt(r.totalRepayment),
          });
        }
        const health = new Map<string, bigint>();
        const borrowers = [...new Set(loans.map((l) => l.author.toLowerCase()))];
        await Promise.all(
          borrowers.map(async (b) => {
            try {
              health.set(b, BigInt(await retryRpc(() => diamond.getHealthFactor(b))));
            } catch {
              /* unreadable (e.g. a stale feed) — overdue loans still qualify */
            }
          }),
        );
        return { now: BigInt(block?.timestamp ?? 0), loans, health };
      } catch (e) {
        return { error: (e as Error).message.slice(0, 160) };
      }
    },

    async simulate(chainId, requestId) {
      try {
        const diamond = diamondAt(chainId, wallet(chainId));
        await diamond.liquidateUserRequest.staticCall(requestId);
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: decodeRevert(e) };
      }
    },

    async send(chainId, requestId) {
      try {
        const signer = wallet(chainId);
        const diamond = diamondAt(chainId, signer);
        const estimate: bigint = await diamond.liquidateUserRequest.estimateGas(requestId);
        const gasLimit = (estimate * GAS_PAD_NUM) / GAS_PAD_DEN;
        const fees = await retryRpc(() => signer.provider!.getFeeData());
        const price = fees.maxFeePerGas ?? fees.gasPrice ?? 0n;
        const balance = await retryRpc(() => signer.provider!.getBalance(signer.address));
        if (balance < gasLimit * price) {
          return { skipped: `keeper gas too low on ${chainId}: has ${ethers.formatEther(balance)}` };
        }
        const tx = await diamond.liquidateUserRequest(requestId, { gasLimit });
        const receipt = await tx.wait(1, 40_000);
        if (!receipt || receipt.status !== 1) return { error: `reverted: ${tx.hash}` };
        return { hash: tx.hash as string };
      } catch (e) {
        return { error: decodeRevert(e) };
      }
    },

    async rewards(chainId) {
      const p = provider(chainId);
      const diamond = diamondAt(chainId, p);
      const me = new ethers.Wallet(key as string).address;
      const tokens: string[] = await retryRpc(() => diamond.getAllCollateralToken());
      const out: Record<string, string> = {};
      for (const t of tokens) {
        const bal: bigint = await retryRpc(() => diamond.gets_addressToCollateralDeposited(me, t));
        if (bal > 0n) out[t] = bal.toString();
      }
      return out;
    },
  };
}
