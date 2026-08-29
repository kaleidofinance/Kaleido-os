import { NextRequest, NextResponse } from "next/server";
import { ethers, isAddress } from "ethers";
import faucetAbi from "@/abi/TokenFaucet.json";
import { getChainMeta } from "@/constants/chains";
import { getContracts } from "@/constants/registry";
import { retryRpc } from "@/lib/dex/rpcRetry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/gas-drip — pays for one wallet's first transaction.
 *
 * KaleidoTokenFaucet already hands out the chain's native gas: it is listed
 * under the NATIVE_TOKEN sentinel and paid from the faucet's own balance
 * (Faucet.sol:88, :206, :457). The gap this closes is narrower than "give people
 * gas" — it is the single transaction a wallet at exactly zero cannot afford to
 * send, which is the `claim` that would have given it gas. One fee, once, and
 * from then on the faucet does the work.
 *
 * So the amount here is a fee, not a balance. It is sized to one claim and
 * capped per chain; nobody funds a position out of this route.
 *
 * ── The key ─────────────────────────────────────────────────────────────────
 *
 * Read from GAS_DRIP_PRIVATE_KEY and from nothing else. It deliberately does NOT
 * fall back to PRIVATE_KEY: that is the Diamond owner, it can call diamondCut,
 * and a route reachable by anyone on the internet must not hold it. The fallback
 * is the kind that gets added later for convenience, so the refusal below is
 * explicit and loud rather than merely absent.
 *
 * Unset is the default and is not an error state — the route answers 503 and the
 * page falls back to the public faucet links in constants/gasFaucets.ts. That is
 * the same shape /api/referral uses, and it means this ships inert: it cannot
 * spend anything until an operator sets a key that exists only in the runtime
 * environment.
 *
 * Fund that key thinly. It is a hot wallet whose whole purpose is to pay
 * strangers' fees, and the sections below bound the damage rather than prevent
 * it.
 *
 * ── What stops this being drained ───────────────────────────────────────────
 *
 * Deliberately no database. Every limit is either chain state or a constant,
 * because a limiter that needs Supabase fails open on the day Supabase is down —
 * and it would be the one request in the app where failing open costs money.
 *
 *  1. The recipient must be unable to pay. If they already hold the fee, there
 *     is nothing to bootstrap and the answer is `already_funded`.
 *  2. `hasClaimedBefore(recipient)` must be false. One bootstrap per address,
 *     ever, enforced by the faucet's own records rather than ours: the moment
 *     the address claims anything it stops being eligible, and that flag is set
 *     by the very claim this fee paid for. There is no window in which a caller
 *     can bank two.
 *  3. The sponsor keeps a reserve. Below it the route 503s rather than emptying
 *     the wallet, so the failure mode is "no drips today", not "no gas to run
 *     the keepers".
 *
 * What this does not stop is a caller with many fresh addresses, and nothing
 * short of identity would. That is priced in rather than solved: the loss
 * ceiling is (sponsor balance − reserve), the reserve is what makes that a
 * number rather than everything, and the per-drip cap is dust on every chain
 * here. Testnet gas is also the least valuable thing we hold, which is why this
 * trade is acceptable on testnet and would need rethinking on mainnet.
 */

/**
 * Gas one native `claim` needs, as a constant rather than an `estimateGas`.
 *
 * Estimating would mean simulating the claim as the recipient, which reverts for
 * every caller who is not eligible — cooldown, no stock, asset paused — and a
 * revert there is indistinguishable from a chain problem. It would turn a
 * three-read route into one that can fail for reasons that have nothing to do
 * with gas. The claim's cost is knowable instead: 21k base, four cold SSTOREs
 * (lastClaimed, totalClaimed, hasClaimedBefore, the allUsers push), and a value
 * call. 250k is roughly double that, and the cap below is what actually bounds
 * the spend.
 */
const CLAIM_GAS = 250_000n;

/**
 * Multiple applied to the fee we compute, covering the gap between reading a gas
 * price here and the recipient's claim landing a minute later.
 */
const FEE_MARGIN = 2n;

/**
 * Per-chain ceiling on one drip, and the reserve the sponsor keeps back.
 *
 * These are in whole native units and every chain here is 18 decimals — Arc
 * included, whose native is USDC at 18 places rather than the 6 its ERC20 USDC
 * uses (chains.ts:217, and see registry.ts's Arc note). So `parseEther` is
 * correct on all five, but it is correct by measurement rather than by ETH being
 * the unit, which is why this is spelled out.
 *
 * `reserve` is a floor on the sponsor's balance, not a budget. Sizing it as a
 * multiple of the cap means "always enough left for ~40 more drips", so the
 * wallet degrades to refusing new requests while still able to serve the ones
 * already promised.
 */
const LIMITS: Record<number, { cap: string; reserve: string }> = {
  /* Sepolia's base fee is the least predictable of the five and occasionally
     spikes an order of magnitude, so its cap is the loosest here. */
  11155111: { cap: "0.002", reserve: "0.08" },
  84532: { cap: "0.0005", reserve: "0.02" },
  /* tBNB. Gas is cheap but the unit is worth less, so the figure looks larger
     than Base's while buying about the same thing. */
  97: { cap: "0.005", reserve: "0.2" },
  46630: { cap: "0.0005", reserve: "0.02" },
  /* USDC, being Arc's gas. A cent and a half. */
  5042002: { cap: "0.015", reserve: "0.6" },
};

/** Minimum ms between attempts from one address, per instance. */
const RATE_LIMIT_MS = 30_000;
const lastSeen = new Map<string, number>();

/**
 * Serialises sends per chain.
 *
 * Two requests arriving together would both read the same pending nonce and the
 * second would replace the first rather than follow it — one caller silently
 * gets nothing while the route reports success to both. ethers will not prevent
 * that; only not being in flight twice at once does.
 */
const chainLocks = new Map<number, Promise<unknown>>();

function serialise<T>(chainId: number, work: () => Promise<T>): Promise<T> {
  const prior = chainLocks.get(chainId) ?? Promise.resolve();
  const next = prior.then(work, work);
  /* Swallow on the stored copy only: the returned promise still rejects to the
     caller, but an unhandled rejection here would take the process down. */
  chainLocks.set(
    chainId,
    next.catch(() => undefined),
  );
  return next;
}

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

export async function POST(request: NextRequest) {
  let address: unknown;
  let chainId: unknown;

  try {
    const body = await request.json();
    address = body?.address;
    chainId = body?.chainId;
  } catch {
    return json({ error: "Expected a JSON body." }, 400);
  }

  if (typeof address !== "string" || !isAddress(address)) {
    return json({ error: "address must be a valid address." }, 400);
  }
  if (typeof chainId !== "number" || !Number.isInteger(chainId)) {
    return json({ error: "chainId must be an integer." }, 400);
  }

  const meta = getChainMeta(chainId);
  const limits = LIMITS[chainId];
  const faucetAddress = getContracts(chainId).faucet;

  /* No faucet means no claim to pay for, so there is nothing this route could
     usefully do even with a key and a balance. */
  if (!meta || !limits || !faucetAddress) {
    return json({ error: "No faucet on this chain." }, 400);
  }

  const privateKey = process.env.GAS_DRIP_PRIVATE_KEY;
  if (!privateKey) {
    /* Not an error — the deliberate default. The client falls back to the public
       faucet links, which is why this is info rather than error level. */
    console.info(
      "[gas-drip] GAS_DRIP_PRIVATE_KEY is not set — declining, as configured.",
    );
    return json({ error: "Gas sponsorship is not enabled." }, 503);
  }
  if (privateKey === process.env.PRIVATE_KEY) {
    /* The Diamond owner can call diamondCut. It must never be the signer on a
       route anyone can reach; refusing is the only safe response to finding it
       here, and it is louder than a comment asking someone not to. */
    console.error(
      "[gas-drip] GAS_DRIP_PRIVATE_KEY equals PRIVATE_KEY (the Diamond owner). Refusing.",
    );
    return json({ error: "Gas sponsorship is misconfigured." }, 503);
  }

  const key = `${chainId}:${address.toLowerCase()}`;
  const previous = lastSeen.get(key);
  if (previous && Date.now() - previous < RATE_LIMIT_MS) {
    return json({ error: "Too many attempts. Try again shortly." }, 429);
  }
  lastSeen.set(key, Date.now());

  try {
    /* This route's own provider rather than config/provider.ts's cache, which
       exists for the browser read path and pins one chain as the read chain.
       staticNetwork skips an eth_chainId round trip on every request. */
    const provider = new ethers.JsonRpcProvider(
      meta.rpcUrls[0],
      { chainId, name: meta.name },
      { staticNetwork: true },
    );
    const wallet = new ethers.Wallet(privateKey, provider);
    const faucet = new ethers.Contract(faucetAddress, faucetAbi, provider);

    const cap = ethers.parseEther(limits.cap);
    const reserve = ethers.parseEther(limits.reserve);

    /* Two of the five endpoints answer HTTP 200 with a JSON-RPC rate-limit body,
       which ethers renders as "missing revert data" — so an unretried read here
       would report a throttled chain as an ineligible caller. See
       lib/dex/rpcRetry.ts for the measurement. */
    const [balance, claimedBefore, feeData, sponsorBalance] = await retryRpc(
      () =>
        Promise.all([
          provider.getBalance(address as string),
          faucet.hasClaimedBefore(address as string) as Promise<boolean>,
          provider.getFeeData(),
          provider.getBalance(wallet.address),
        ]),
    );

    /* One bootstrap per address, ever. The flag is set by the claim this fee
       pays for, so eligibility closes itself. */
    if (claimedBefore) {
      return json({
        status: "already_bootstrapped",
        message: `This address has already claimed from the ${meta.shortName} faucet.`,
      });
    }

    const gasPrice = feeData.maxFeePerGas ?? feeData.gasPrice;
    if (!gasPrice || gasPrice <= 0n) {
      console.error("[gas-drip] no gas price from", meta.name);
      return json({ error: "Could not read the network's gas price." }, 502);
    }

    const fee = CLAIM_GAS * gasPrice * FEE_MARGIN;
    const amount = fee > cap ? cap : fee;

    /* Already able to pay for the claim, so there is nothing to bootstrap.
       Compared against the fee rather than the drip: a wallet holding more than
       the claim costs is not stuck, even if it holds less than the cap. */
    if (balance >= fee) {
      return json({
        status: "already_funded",
        message: `This address already holds enough ${meta.nativeCurrency.symbol} to claim.`,
      });
    }

    if (sponsorBalance < reserve + amount) {
      console.warn(
        `[gas-drip] sponsor on ${meta.name} is at its reserve — declining.`,
      );
      return json(
        {
          error: `Gas sponsorship is out of funds on ${meta.shortName}.`,
          status: "sponsor_empty",
        },
        503,
      );
    }

    const receipt = await serialise(chainId, async () => {
      const tx = await wallet.sendTransaction({ to: address as string, value: amount });
      return tx.wait(1);
    });

    return json({
      status: "sent",
      chainId,
      amount: ethers.formatEther(amount),
      symbol: meta.nativeCurrency.symbol,
      transactionHash: receipt?.hash,
    });
  } catch (error) {
    /* Never the raw error: it carries the RPC URL and, on a signing failure, can
       carry signer detail. Same reasoning as /api/referral. */
    console.error("[gas-drip] failed on chain", chainId, error);
    return json({ error: "Could not send gas right now." }, 500);
  }
}
