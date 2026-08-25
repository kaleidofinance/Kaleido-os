import { ethers } from "ethers";
import { getKaleidoContract } from "@/config/contracts";
import type { MarketRow } from "@/lib/v2/intents/build";

/**
 * The P2P order book, read from the diamond that holds it.
 *
 * Everything here used to be answered from the Supabase mirror — the browser
 * planner via `/api/listings?searchId=`, `serverPlanDeps` via a direct
 * `kaleido_listings` query, the agent's `getMarkets` via another. On 2026-08-25
 * all three were measured answering "nothing here" about a book that had
 * entries: Sepolia's diamond held listing #1 and request #3, both OPEN, while
 * `kaleido_listings` and `kaleido_requests` held zero rows each. So "take
 * listing 1" refused a listing with real tokens escrowed in it, and "what can I
 * borrow" replied "No open offers match. Suggest the user post their own offer
 * at the rate they want" — advising a duplicate of an offer already sitting on
 * the book.
 *
 * The mirror is filled by `server/src/syncListing.ts`, which nobody is running
 * and which would write nothing if they did: its `startId` defaults to a legacy
 * 2859, above the real max id, so it takes the `startId > maxListingId` branch
 * and logs "Already up to date."
 *
 * Fixing that keeper would not make it the right source for these reads.
 *
 * The chain is authoritative, so a filled listing cannot look open — whereas a
 * stalled indexer's freshest row is indistinguishable from a current one, and an
 * empty result from a stalled indexer is indistinguishable from an empty market.
 * Both of those are claims a model relays to a user as fact.
 *
 * The chain is also chain-scoped, and the mirror structurally is not: those
 * tables carry no chainId column, which is the whole reason `LENDING_CHAIN_ID`
 * exists (see chain.ts) and why a row cannot say which of five deployments it
 * describes. Addresses read from the caller's own diamond are on the chain being
 * asked about by construction, so symbols and decimals resolve against the right
 * registry with nothing to pin.
 *
 * There is deliberately no mirror fallback anywhere in this file. Falling back
 * would answer a question about the caller's chain with a row from whichever
 * chain the mirror happens to hold — an address read on one deployment and
 * signed against another, which is the failure this codebase keeps closing.
 *
 * What the mirror is still right for is the browsable book behind /borrow, where
 * the query is "every open offer, filtered and paged" and there is no id to look
 * up. Indexes are good at that and 200 sequential `eth_call`s are not.
 *
 * ONE module for both planners and the agent, like `readFaucetAssets` and
 * `readLendingAssets`. Fixing only the server copy would have been worse than
 * leaving both broken: the same "take listing 1" would work in the chat and be
 * refused on the agent page.
 *
 * `chainId` must be the chain of `provider` in every function here — the pairing
 * rule `getKaleidoContract` documents. Reading a listing id through the wrong
 * connection returns a different deployment's order at the same number.
 */

/** One open entry on the P2P book, in the units the contract stores. */
export interface BookEntry {
  id: number;
  /** The borrowed / offered token. Raw address — pair it with `chainId`. */
  tokenAddress: string;
  /** Base units, unformatted, for the same reason MarketRow.amount is. */
  amountRaw: string;
  interestBps: number;
  returnDateUnix: number;
  /** Lender on a listing, borrower on a request. */
  counterparty: string;
}

/**
 * How many ids back from the counter one book read will look.
 *
 * The scan is bounded because the counter is monotonic and unbounded: nothing
 * stops a chain reaching id 50,000, and a read tool that issues 50,000
 * `eth_call`s inside a chat turn is a read tool that times out.
 *
 * Newest-first rather than oldest-first, and that ordering is what makes the cap
 * cheap rather than arbitrary: an old id has almost certainly been filled,
 * cancelled or matured, so the budget gets spent where the OPEN entries are. The
 * number of entries a caller wants back (12 for the agent) is far below the cap,
 * so the cap only bites on a book with 200 consecutive dead ids at the top — and
 * `scanned`/`total` come back so the caller can say it saw a partial view rather
 * than imply it saw everything.
 */
const DEFAULT_SCAN_CAP = 200;

/** Concurrency per batch. Enough to be quick, low enough for a public RPC. */
const BATCH = 20;

/**
 * The open half of one side of the book.
 *
 * `null` means the book could not be read — no diamond on this chain, or the
 * counter call failed. That is deliberately NOT the same value as an empty array,
 * because the sentence a caller should say differs: "there are no open offers" is
 * a claim about the market, and making it off a failed read is exactly how the
 * mirror misled a user.
 *
 * Returned unsorted. Rate ordering is the caller's decision — a borrower wants
 * the lowest APR and a lender the highest — and this function serves both sides.
 */
export async function readOpenBook(
  provider: ethers.Provider | ethers.Signer | null | undefined,
  chainId: number | undefined,
  side: "listings" | "requests",
  opts: { want?: number; scanCap?: number } = {},
): Promise<{ entries: BookEntry[]; scanned: number; total: number } | null> {
  if (!provider) return null;

  const want = opts.want ?? 12;
  const scanCap = opts.scanCap ?? DEFAULT_SCAN_CAP;

  let diamond: ethers.Contract;
  let total: number;
  try {
    diamond = getKaleidoContract(provider, chainId);
    total = Number(
      side === "listings"
        ? await diamond.getListingId()
        : await diamond.getRequestId(),
    );
    if (!Number.isFinite(total)) return null;
  } catch {
    return null;
  }

  const entries: BookEntry[] = [];
  let scanned = 0;
  let id = total;

  while (id >= 1 && scanned < scanCap && entries.length < want) {
    const batch: number[] = [];
    while (id >= 1 && batch.length < BATCH && scanned + batch.length < scanCap) {
      batch.push(id);
      id -= 1;
    }
    scanned += batch.length;

    const rows = await Promise.all(
      batch.map(async (n) => {
        try {
          if (side === "listings") {
            const l = await diamond.getLoanListing(n);
            if (Number(l.listingStatus) !== 0) return null;
            return {
              id: n,
              tokenAddress: String(l.tokenAddress),
              amountRaw: BigInt(l.amount).toString(),
              interestBps: Number(l.interest),
              returnDateUnix: Number(l.returnDate),
              counterparty: String(l.author),
            };
          }
          const r = await diamond.getRequest(n);
          if (Number(r.status) !== 0) return null;
          return {
            id: n,
            tokenAddress: String(r.loanRequestAddr),
            amountRaw: BigInt(r.amount).toString(),
            interestBps: Number(r.interest),
            returnDateUnix: Number(r.returnDate),
            counterparty: String(r.author),
          };
        } catch {
          /* An unwritten id reverts Protocol__IdNotExist. Dropped rather than
             aborting the scan: one bad id must not empty the whole book. */
          return null;
        }
      }),
    );
    for (const row of rows) if (row) entries.push(row);
  }

  return { entries, scanned, total };
}

/**
 * One listing or request the caller already named by id.
 *
 * This is the read a plan is built on, so it needs no index and does not scan:
 * `getLoanListing`/`getRequest` are single `eth_call`s.
 *
 * `null` for every "you cannot act on this": no diamond on the chain, no such id,
 * an id that exists but is not OPEN, and a failed read. build.ts turns it into a
 * refusal naming the id, which is the right answer to all four — and the reason
 * an RPC failure is folded in here rather than thrown is that the alternative is
 * a plan built on an id nothing confirmed.
 */
export async function readMarketRow(
  provider: ethers.Provider | ethers.Signer | null | undefined,
  chainId: number | undefined,
  kind: "listings" | "requests",
  id: number,
): Promise<MarketRow | null> {
  if (!provider || !Number.isInteger(id) || id <= 0) return null;
  try {
    const diamond = getKaleidoContract(provider, chainId);

    if (kind === "listings") {
      const l = await diamond.getLoanListing(id);
      /* ListingStatus is { OPEN, CLOSED } — model/Protocol.sol:102 — so OPEN is
         0 and anything else is filled or cancelled. */
      if (Number(l.listingStatus) !== 0) return null;
      const amount = BigInt(l.amount);
      if (amount <= 0n) return null;
      return { tokenAddress: String(l.tokenAddress), amount: amount.toString() };
    }

    const r = await diamond.getRequest(id);
    /* Status is { OPEN, SERVICED, CLOSED } — model/Protocol.sol:90. SERVICED
       already has a lender, and funding it again reverts. */
    if (Number(r.status) !== 0) return null;
    const amount = BigInt(r.amount);
    if (amount <= 0n) return null;
    /* `loanRequestAddr` is the borrowed token on a request; `tokenAddress` is
       what the same field is called on a listing. Same meaning, two names in the
       struct, and MarketRow uses the listing's. */
    return { tokenAddress: String(r.loanRequestAddr), amount: amount.toString() };
  } catch {
    /* An id past the counter reverts Protocol__IdNotExist, which lands here and
       means the same thing to the caller as "not open". */
    return null;
  }
}
