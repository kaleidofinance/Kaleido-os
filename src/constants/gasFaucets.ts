import { CHAINS, getChainMeta } from "@/constants/chains";

/**
 * Where a wallet holding exactly zero gas goes first.
 *
 * KaleidoTokenFaucet already hands out the chain's native gas — it is listed
 * under the NATIVE_TOKEN sentinel and paid from the faucet's own balance
 * (Faucet.sol:88, :206, :457). What it cannot do is bootstrap a wallet at zero,
 * because `claim` is itself a transaction the wallet has to pay for. That first
 * drop has to come from somewhere else, and there are exactly two somewheres:
 * the chain's own public faucet, listed here, or us paying the fee
 * (/api/gas-drip, which is off unless an operator key is set).
 *
 * ── Why this is a separate module and not a `chains.ts` field ────────────────
 *
 * A chain has one canonical explorer and one canonical rpc list; it does not
 * have one canonical faucet. Sepolia has a dozen run by unrelated companies, and
 * the set churns — faucets close, move behind sign-in, or start asking for a
 * mainnet balance. Keeping them beside `id`/`nativeCurrency`/`blockExplorer`
 * would put the most volatile facts on the page in the file that describes a
 * chain's identity. It also keeps the churn out of a file the deploy tooling and
 * the push watcher both read.
 *
 * ── Verified, not assumed ───────────────────────────────────────────────────
 *
 * /faucet used to carry no links at all, on the reasoning that four invented
 * URLs are worse than none because a dead faucet link costs the reader a round
 * trip to find out it is dead. That reasoning stands, so every URL below was
 * fetched on 2026-08-29 and its status recorded in `verified`. Two things that
 * probe turned up, both of which would have shipped a wrong link:
 *
 *  - `arc.network` and `docs.arc.network` both redirect to `arc.io`, which is
 *    the Arc *browser* by The Browser Company — nothing to do with Circle's Arc
 *    L1. Arc's gas is USDC (chains.ts:217), so its gas faucet is Circle's USDC
 *    faucet; there is no separate one to link.
 *  - `docs.base.org/base-chain/tools/network-faucets` 302s to
 *    `/get-started/get-funds`. The redirect target is what is stored, so the
 *    reader makes one request rather than two.
 *
 * Robinhood's answered `429 Too Many Requests` rather than `200`: the host
 * resolves, completes TLS and serves HTTP, it just rate-limited the probe. That
 * is a live service and is recorded as what it was, not rounded up to a 200.
 *
 * Amounts per claim are deliberately absent. They are the field most likely to
 * be quietly wrong — an operator halves a drip without announcing it — and this
 * environment could not read page bodies to confirm any of them. A number we
 * cannot check is worse than no number, for the same reason a dead link is.
 */
export type GasFaucet = {
  /**
   * Who runs it. Shown to the reader: for a page that asks someone to leave the
   * app, connect a wallet elsewhere and wait, the operator's name is the part
   * that decides whether they follow the link at all.
   */
  operator: string;
  url: string;
  /** What it pays out, in the chain's own words for it. */
  gives: string;
  /**
   * True when the operator is the chain's own team or, for Arc, the issuer whose
   * token the gas is. Sorted first, because a first-party faucet is the one that
   * survives the chain changing something.
   */
  firstParty: boolean;
  /** HTTP status this URL returned when it was last checked by hand. */
  verified: { on: string; status: number };
  /** Only where the reader would otherwise be surprised. */
  note?: string;
};

/**
 * Keyed by chain id. Every chain carrying a `faucet` contract has an entry —
 * `gasFaucets.test.ts` fails the build if one is missing, because a chain where
 * we hand out test tokens but cannot say how to afford the claim is the exact
 * dead end this module exists to close.
 */
export const GAS_FAUCETS: Record<number, GasFaucet[]> = {
  /* Sepolia. No first-party faucet: the Ethereum Foundation does not run one,
     so both of these are third parties and both want a Google or GitHub
     sign-in. Google's is first because it is the one that does not also require
     a mainnet balance. */
  11155111: [
    {
      operator: "Google Cloud Web3",
      url: "https://cloud.google.com/application/web3/faucet/ethereum/sepolia",
      gives: "Sepolia ETH",
      firstParty: false,
      verified: { on: "2026-08-29", status: 200 },
      note: "Needs a Google sign-in.",
    },
    {
      operator: "Chainlink",
      url: "https://faucets.chain.link/sepolia",
      gives: "Sepolia ETH",
      firstParty: false,
      verified: { on: "2026-08-29", status: 200 },
    },
  ],

  /* Base Sepolia. Base's own "get funds" page rather than a direct link to
     Coinbase Developer Platform's faucet: the CDP faucet sits behind a portal
     sign-in and its path has moved once already, whereas the docs page is
     maintained by the chain team and lists whatever is current. */
  84532: [
    {
      operator: "Base",
      url: "https://docs.base.org/get-started/get-funds",
      gives: "Base Sepolia ETH",
      firstParty: true,
      verified: { on: "2026-08-29", status: 200 },
      note: "Lists Coinbase Developer Platform's faucet and the Sepolia bridge.",
    },
  ],

  /* BNB Smart Chain testnet. Run by BNB Chain themselves. */
  97: [
    {
      operator: "BNB Chain",
      url: "https://www.bnbchain.org/en/testnet-faucet",
      gives: "tBNB",
      firstParty: true,
      verified: { on: "2026-08-29", status: 200 },
    },
  ],

  /* Robinhood Chain testnet. Gas is ETH (chains.ts:200) — it is an Arbitrum
     Orbit L2, so the gas token is ether and not a Robinhood asset. */
  46630: [
    {
      operator: "Robinhood Chain",
      url: "https://faucet.testnet.chain.robinhood.com",
      gives: "Testnet ETH",
      firstParty: true,
      verified: { on: "2026-08-29", status: 429 },
    },
  ],

  /* Arc testnet. Circle's faucet is the gas faucet here, because Arc's native
     currency IS USDC (chains.ts:217) — the one case in this map where "get gas"
     and "get the stablecoin" are the same errand. */
  5042002: [
    {
      operator: "Circle",
      url: "https://faucet.circle.com",
      gives: "USDC, which is Arc's gas",
      firstParty: true,
      verified: { on: "2026-08-29", status: 200 },
    },
  ],
};

/**
 * The faucets for one chain, first-party first, or `[]` for a chain we have
 * nothing checked for.
 *
 * Returns a new array so a caller sorting or slicing it cannot reorder the
 * module's own table for everyone else on the page.
 */
export function gasFaucetsFor(chainId: number | undefined): GasFaucet[] {
  if (chainId === undefined) return [];
  const entries = GAS_FAUCETS[chainId];
  if (!entries) return [];
  return [...entries].sort(
    (a, b) => Number(b.firstParty) - Number(a.firstParty),
  );
}

/**
 * ── Tokens we do not issue ───────────────────────────────────────────────────
 *
 * The table above answers "where do I get gas". This one answers "where do I get
 * a token our faucet lists but will never pay", and it exists because a faucet
 * should only hand out what we deployed ourselves.
 *
 * Anything else we cannot mint, so a drip against it is a countdown to an empty
 * row — and while it lasts it implies we are the place to get the token, when the
 * issuer gives out more, faster, and without waiting on our stock. Both of Arc's
 * are Circle's: `source: "literal"` in the faucet's deployment record, meaning
 * hardcoded addresses we never deployed. They are paused on chain (drip 0) and
 * their Claim buttons point here instead.
 *
 * Keyed by lowercased token address rather than symbol, because a symbol is not
 * unique per chain — Arc lists both Circle's USDC alias and our own WUSDC, and
 * Sepolia's faucet has carried two different USDC contracts at once
 * (`useFaucet.ts:337`). The address is the thing that cannot collide.
 *
 * `gives` names the ONE token this entry is for, not everything the faucet
 * offers, because it is rendered next to that token's row. faucet.circle.com
 * hands out USDC, EURC and cirBTC with Arc as its default network, one claim per
 * asset every 2 hours — checked 2026-08-30, which is also why cirBTC and EURC get
 * separate entries pointing at the same URL rather than one shared line.
 *
 * ── Why BSC's WBNB is paused but absent from here ───────────────────────────
 *
 * It is paused for the same reason (the canonical BSC testnet wrapper, not ours)
 * and deliberately gets no entry, because nothing *issues* WBNB. It is a wrapper:
 * you mint it by depositing tBNB, so the only honest destination is BNB Chain's
 * tBNB faucet — which chain 97 already shows twice, as the synthetic gas row's
 * Claim button and in the link panel below the table. A third copy sitting on the
 * WBNB row would read as though that faucet handed out WBNB, for a route the page
 * already spells out one row above. Absence here is the decision, not a gap;
 * `gasFaucets.test.ts` pins it.
 */
export const ISSUER_FAUCETS: Record<number, Record<string, GasFaucet>> = {
  /* Arc testnet. Same URL as its gas entry above, and deliberately not folded
     into it: there the errand is "afford a transaction", here it is "hold a
     token", and the two are only the same errand for USDC. */
  5042002: {
    /* EURC */
    "0x89b50855aa3be2f677cd6303cec089b5f319d72a": {
      operator: "Circle",
      url: "https://faucet.circle.com",
      gives: "EURC",
      firstParty: true,
      verified: { on: "2026-08-30", status: 200 },
    },
    /* cirBTC */
    "0xf0c4a4ce82a5746abaad9425360ab04fbba432bf": {
      operator: "Circle",
      url: "https://faucet.circle.com",
      gives: "cirBTC",
      firstParty: true,
      verified: { on: "2026-08-30", status: 200 },
    },
  },
};

/**
 * The issuer's faucet for one token, or `undefined` when the token is ours (the
 * common case — nothing to link, our own row pays it).
 *
 * Lowercases the address rather than trusting the caller's casing: the faucet
 * contract returns EIP-55 checksummed addresses and the deployment records store
 * them the same way, so a raw lookup against this table would miss every time.
 */
export function issuerFaucetFor(
  chainId: number | undefined,
  address: string | undefined,
): GasFaucet | undefined {
  if (chainId === undefined || !address) return undefined;
  return ISSUER_FAUCETS[chainId]?.[address.toLowerCase()];
}

/**
 * "Sepolia ETH" — what the reader is short of, phrased as the chain phrases it.
 *
 * Reads `nativeCurrency.name` rather than the symbol so Arc says USDC and BSC
 * testnet says BNB rather than its tBNB ticker. Falls back to the bare word for
 * a chain `chains.ts` does not carry, which is the same case where
 * `gasFaucetsFor` returns nothing.
 */
export function gasNameFor(chainId: number | undefined): string {
  const meta = chainId === undefined ? undefined : getChainMeta(chainId);
  return meta ? meta.nativeCurrency.name : "gas";
}

/** Chain ids this module has at least one checked faucet for. */
export const GAS_FAUCET_CHAIN_IDS: number[] = CHAINS.filter(
  (c) => (GAS_FAUCETS[c.id]?.length ?? 0) > 0,
).map((c) => c.id);
