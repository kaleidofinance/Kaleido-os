import { getChainMeta, type ChainMeta } from "./chains";
import {
  GENERATED_DEPLOYMENTS,
  GENERATED_LENDING_REGISTRATION,
  GENERATED_SEEDED_POOLS,
} from "./deployments.generated";

/**
 * Chain-keyed contract and token registry.
 *
 * Replaces the scattered address constants (addresses.ts, tokens.ts,
 * BORROW_CURRENCIES, STABLE_CONTRACTS, formatTokenDecimals.ts) with one
 * source of truth that carries a chain dimension. Those files each held a
 * partial, Abstract-only view, and the disagreements between them were real
 * bugs: the DEX list and the lending list used different addresses for native
 * ETH, and repay approved a 6-decimal token as though it had 18.
 *
 * Three rules this module exists to enforce, all of which the current chain
 * list already breaks somewhere:
 *
 * 1. IDENTITY IS (chainId, address), NEVER SYMBOL OR ADDRESS ALONE.
 *    Nine registered chains call their native asset "ETH". They are not the
 *    same asset — Base ETH and Arbitrum ETH are different balances on
 *    different chains, and an address is only meaningful alongside its chain.
 *
 * 2. DECIMALS ARE DECLARED DATA, NEVER INFERRED.
 *    Arc's native currency is USDC with 18 decimals, while ERC20 USDC is 6
 *    decimals on every other chain. Any "USDC means 6" shortcut is wrong on
 *    Arc by a factor of 10^12. The same applies to guessing a default: the
 *    old getTokenDecimals returned 6 for anything unrecognised, which after a
 *    redeploy is every new address.
 *
 * 3. THE NATIVE SENTINEL IS A PROTOCOL CONVENTION, NOT A CHAIN PROPERTY.
 *    Kaleido's lending facet identifies native value as ADDRESS_1, while the
 *    DEX router uses the 0xEeee… convention. Both are correct for their own
 *    contract and neither is "the" native address, so callers must ask for
 *    the sentinel of the protocol they are calling.
 *
 * ChainMeta is a parameter on the exported helpers that take one — the same
 * reason fromCommand.ts takes its token list as an argument — so a caller
 * holding the wallet's chain object never has to hope this module resolved the
 * same one.
 *
 * This module used to have no runtime imports at all, which let `node
 * registry.test.ts` run it under bare Node. It now imports two values, and both
 * earned it:
 *
 * - `GENERATED_DEPLOYMENTS`, because the alternative was hand-transcribing
 *   roughly fifteen addresses per chain across five chains, and a mistyped
 *   address does not fail at deploy, it fails at first use.
 * - `getChainMeta`, because borrowCurrencies() has to name the native asset and
 *   hardcoding "ETH" was wrong on two of the five deployed chains (BNB on 97,
 *   USDC on Arc). A chainId is the only thing its callers have, so resolving the
 *   metadata here is the difference between one correct answer and a mislabel
 *   repeated at every call site.
 *
 * `test:registry` runs under tsx as a result, matching the four other test
 * scripts that already do. Both imports are leaves — chains.ts imports nothing
 * at all and deployments.generated.ts imports nothing but a type from here — so
 * the runtime graph stays acyclic and two files deep. That is the invariant, not
 * the import count: adding a dependency that is NOT a leaf (a hook, a chain
 * client, anything from src/lib) would make this registry unloadable outside a
 * bundler and is not a trade worth making.
 */

/* ------------------------------------------------------------- sentinels -- */

/**
 * Per-protocol native-value sentinels. These are not addresses of anything;
 * they are the magic values each contract family expects when a call carries
 * native value instead of an ERC20 transfer.
 */
export const NATIVE_SENTINEL = {
  /** V3 router / quoter convention. */
  dex: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  /** ProtocolFacet (lending, collateral, listings) convention. */
  lending: "0x0000000000000000000000000000000000000001",
} as const;

export type Protocol = keyof typeof NATIVE_SENTINEL;

export function isNativeSentinel(address: string, protocol: Protocol): boolean {
  return address.toLowerCase() === NATIVE_SENTINEL[protocol].toLowerCase();
}

/* -------------------------------------------------------------- contracts -- */

/**
 * Deployed addresses for one chain. Every field is optional because a chain
 * can be registered for balance-reading long before anything is deployed to
 * it — `tradable` in chains.ts is the flag for "has the Diamond", and code
 * should check for the specific contract it needs rather than assume.
 */
export interface ChainContracts {
  /* -- Diamond (EIP-2535). Facets live behind this one address. ----------- */
  diamond?: string;

  /* -- DEX V3. Deployed as a set; the periphery is bound to factory+WETH -- */
  v3Factory?: string;
  v3Router?: string;
  v3Quoter?: string;
  v3PositionManager?: string;
  v3PositionDescriptor?: string;

  /* -- DEX V2 (KaleidoSwap, Uniswap-V2-shaped) --------------------------- */
  /**
   * V2 is a separate venue, not a fallback for V3, and both are deployed per
   * chain — /trade quotes against whichever has liquidity.
   *
   * Unlike V3 there is no init-code-hash field to keep in sync, and that is a
   * property of the contracts rather than an omission: KaleidoSwapLibrary.pairFor
   * resolves a pair with `IKaleidoSwapFactory(factory).getPair(token0, token1)`,
   * asking the factory instead of deriving the address via CREATE2. So a V2
   * deployment cannot develop the class of bug poolInitCodeHash exists to catch.
   */
  v2Factory?: string;
  v2Router?: string;

  /* -- Stablecoin ------------------------------------------------------- */
  kfUSD?: string;
  kafUSD?: string;
  yieldTreasury?: string;

  /* -- Staking ---------------------------------------------------------- */
  kldVault?: string;
  stKLD?: string;
  kld?: string;

  /* -- Oracle ----------------------------------------------------------- */
  /**
   * Our oracle wrapper, deployed per chain. Either a `PythPriceOracle` or an
   * `AggregatorPriceOracle` — `oracleKind` below says which, and the diamond
   * calls both through the same one-function interface.
   */
  priceOracle?: string;

  /**
   * Which backend `priceOracle` reads. Copied from the deployment record, which
   * reads it back from the contract's own `oracleKind()` rather than inferring
   * it, so it cannot drift from the deployed bytecode.
   *
   * Worth carrying into the frontend rather than leaving in the deploy log,
   * because the two backends differ in what they can report: Pyth returns a
   * confidence interval and the aggregator path returns `conf = 0`, since
   * `AggregatorV3Interface` has no confidence concept. Anything rendering a
   * price band has to know which it is looking at.
   */
  oracleKind?: "pyth" | "aggregator-v3";

  /** Testnet only. */
  faucet?: string;

  /* -- External, NOT deployed by us ------------------------------------- */
  /**
   * Canonical wrapped native (WETH9-shaped). Required by the V3 router,
   * position manager and quoter, all of which take it as a constructor
   * argument. Differs per chain and is NOT derivable from the native symbol:
   * it is WETH on Ethereum, WBNB on BNB, WPOL on Polygon, and on Arc it wraps
   * USDC rather than ether.
   */
  wrappedNative?: string;
  /**
   * Pyth's own contract on this chain. PythPriceOracle takes it as a
   * constructor argument, and it is different on every chain. Price *feed
   * ids* (ETH_USD etc. in constant.sol) are global and do not vary, so only
   * this address is per-chain.
   */
  pythContract?: string;
  /** Canonical USDC where one exists; a mock on testnets that lack it. */
  usdc?: string;
  /**
   * USDT and USDe are listed here rather than in TOKENS because on our testnets
   * they are OURS: scripts/deploy-stablecoin.js deploys `USDT(address)` at 6
   * decimals and `USDe(address)` at 18 as kfUSD's accepted backing assets, so
   * they arrive from a deployment record like every other generated address.
   * On a mainnet these would be third-party contracts and belong in TOKENS
   * instead — the field being set is not a claim about which.
   */
  usdt?: string;
  usde?: string;

  /* -- Derived, must be verified per deployment ------------------------- */
  /**
   * keccak of the compiled V3 pool creation bytecode.
   *
   * The V3 periphery derives pool addresses via CREATE2 from this constant
   * rather than asking the factory, and the swap callback authenticates
   * msg.sender against the derived address. The hash is a property of the
   * COMPILED BYTECODE, and Kaleido targets two compilers: zksolc for the
   * Abstract (zkSync) chains, solc for every EVM chain. Identical source
   * yields different bytecode under each.
   *
   * A wrong value does not fail at deploy. The factory still creates pools.
   * It breaks at the first swap, when the callback compares against an
   * address holding no code. Run smart-contract/scripts/verify-pool-init-hash.js
   * against each deployment and record the result here.
   */
  poolInitCodeHash?: string;
}

/**
 * Deployments, keyed by chain id.
 *
 * GENERATED, NOT HAND-MAINTAINED. The contents come from
 * `deployments.generated.ts`, which `scripts/gen-registry.mjs` writes by reading
 * the `deployment-*.json` records every deploy script emits. Run that after
 * deploying; do not paste addresses in by hand.
 *
 * The reason is the failure mode. A wrong address here does not throw — it is a
 * well-formed string, `isDeployed()` returns true, the UI renders, and the first
 * symptom is a transaction reverting or, worse, succeeding against the wrong
 * contract. There are roughly fifteen addresses per chain across five chains,
 * and transcribing them from console scrollback is exactly the kind of work
 * that fails silently once and stays broken.
 *
 * The spread is a deliberate seam, not decoration: an address that must be
 * corrected before a redeploy can be added below and will override the
 * generated value, which keeps a bad deploy record from being a blocker. Every
 * such entry should say why it is there and be removed once the generator
 * carries it.
 */
export const DEPLOYMENTS: Record<number, ChainContracts> = {
  ...GENERATED_DEPLOYMENTS,
};

export function getContracts(chainId: number | undefined): ChainContracts {
  if (chainId === undefined) return {};
  return DEPLOYMENTS[chainId] ?? {};
}

/** True once the Diamond is deployed here, so trading UI can gate on it. */
export function isDeployed(chainId: number | undefined): boolean {
  return Boolean(getContracts(chainId).diamond);
}

/* ----------------------------------------------------------------- tokens -- */

export interface TokenEntry {
  chainId: number;
  /** Sentinel value when `isNative`, otherwise the ERC20 contract address. */
  address: string;
  symbol: string;
  name: string;
  /** Always explicit. Never inferred from symbol, never defaulted. */
  decimals: number;
  isNative?: boolean;
  tags?: string[];
  logoURI?: string;
}

/**
 * Per-chain token lists: canonical third-party ERC20s.
 *
 * This was empty on the reasoning that nothing is deployed yet. That conflated
 * two unrelated facts. Whether KALEIDO's Diamond is live on a chain has no
 * bearing on whether USDC exists there — USDC, WETH and WBTC are real contracts
 * at the addresses below right now, deployed by other people, and they do not
 * become valid when we deploy. `isDeployed()` is the gate for "can we transact
 * here"; this list answers the separate question "what assets exist here".
 *
 * So nothing here is speculative, and nothing here needs updating after our
 * deploy. Our OWN tokens (KLD, kfUSD, kafUSD, stKLD) are deliberately absent:
 * those genuinely do not exist yet, and they arrive from DEPLOYMENTS.
 *
 * Entries are per (chainId, address). Note BSC in particular: USDC and USDT are
 * 18 decimals there and 6 everywhere else. That is not a typo, it is the exact
 * reason rule 2 above forbids inferring decimals from a symbol.
 *
 * Addresses are the canonical/bridged issuance for each chain. Robinhood and
 * Abstract carry no entries because they have no canonical ERC20 set worth
 * hardcoding yet — they still list their native asset, which chains.ts supplies
 * without needing any deployment. Arc was in that group on the assumption that a
 * new L1 has nothing; probing it on 2026-08-21 found canonical USDC, wrapped
 * USDC and EURC, so the assumption was wrong and the entries are below.
 */
export const TOKENS: Record<number, TokenEntry[]> = {
  /* -- Ethereum ---------------------------------------------------------- */
  [1]: [
    {
      chainId: 1,
      address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      symbol: "WETH",
      name: "Wrapped Ether",
      decimals: 18,
      tags: ["wrapped-native"],
    },
    {
      chainId: 1,
      address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
      tags: ["stablecoin"],
    },
    {
      chainId: 1,
      address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      symbol: "USDT",
      name: "Tether USD",
      decimals: 6,
      tags: ["stablecoin"],
    },
    {
      chainId: 1,
      address: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
      symbol: "DAI",
      name: "Dai Stablecoin",
      decimals: 18,
      tags: ["stablecoin"],
    },
    {
      chainId: 1,
      address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
      symbol: "WBTC",
      name: "Wrapped BTC",
      decimals: 8,
    },
  ],

  /* -- Sepolia ----------------------------------------------------------- */
  [11155111]: [
    {
      chainId: 11155111,
      address: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
      symbol: "WETH",
      name: "Wrapped Ether",
      decimals: 18,
      tags: ["wrapped-native"],
    },
    /* USDC is intentionally not declared here. It was Circle's real testnet USDC
     * until 2026-08-27, when scripts/switch-usdc-to-mock.js replaced it with a
     * mintable MockERC20 we deployed — so the faucet can drip it and USDC pools can
     * be seeded. Our USDC now comes from getContracts().usdc through
     * DEPLOYED_TOKENS, exactly like USDT/USDe here and like the mock USDC on BSC and
     * Robinhood. Re-declaring Circle's dead address would put a second USDC row in
     * every picker, because deployedTokens dedupes against TOKENS by address, and
     * the mock's address differs from Circle's. */
  ],
  /* -- Base -------------------------------------------------------------- */
  [8453]: [
    {
      chainId: 8453,
      address: "0x4200000000000000000000000000000000000006",
      symbol: "WETH",
      name: "Wrapped Ether",
      decimals: 18,
      tags: ["wrapped-native"],
    },
    {
      chainId: 8453,
      address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
      tags: ["stablecoin"],
    },
    {
      chainId: 8453,
      address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
      symbol: "cbBTC",
      name: "Coinbase Wrapped BTC",
      decimals: 8,
    },
    {
      chainId: 8453,
      address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
      symbol: "DAI",
      name: "Dai Stablecoin",
      decimals: 18,
      tags: ["stablecoin"],
    },
  ],

  /* -- Base Sepolia. The first target for our own deploy. ---------------- */
  [84532]: [
    {
      chainId: 84532,
      address: "0x4200000000000000000000000000000000000006",
      symbol: "WETH",
      name: "Wrapped Ether",
      decimals: 18,
      tags: ["wrapped-native"],
    },
    /* USDC is intentionally not declared here — see the Sepolia [11155111] note
     * above. Circle's real Base-Sepolia USDC was replaced by a mintable MockERC20
     * on 2026-08-27 (scripts/switch-usdc-to-mock.js); it now comes from
     * getContracts().usdc via DEPLOYED_TOKENS. */
  ],
  /* -- BNB Smart Chain. 18-decimal USDC/USDT — see the note above. ------- */
  [56]: [
    {
      chainId: 56,
      address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
      symbol: "WBNB",
      name: "Wrapped BNB",
      decimals: 18,
      tags: ["wrapped-native"],
    },
    {
      chainId: 56,
      address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
      symbol: "USDC",
      name: "Binance-Peg USD Coin",
      decimals: 18,
      tags: ["stablecoin"],
    },
    {
      chainId: 56,
      address: "0x55d398326f99059fF775485246999027B3197955",
      symbol: "USDT",
      name: "Binance-Peg USDT",
      decimals: 18,
      tags: ["stablecoin"],
    },
    {
      chainId: 56,
      address: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
      symbol: "BTCB",
      name: "Binance-Peg BTCB",
      decimals: 18,
    },
  ],

  /* -- BSC Testnet ------------------------------------------------------- */
  [97]: [
    {
      chainId: 97,
      address: "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd",
      symbol: "WBNB",
      name: "Wrapped BNB",
      decimals: 18,
      tags: ["wrapped-native"],
    },
  ],

  /* -- Robinhood Chain Testnet -------------------------------------------- *
   * This chain was recorded as having no ERC20 at all, which was wrong, and the
   * way it was wrong is worth keeping: the address below is published on
   * docs.robinhood.com/chain/protocol-contracts under "L2 (Testnet)" and was
   * never looked for there. Confirmed on-chain 2026-08-22.
   *
   * Robinhood Chain is an Arbitrum Orbit L2 (ArbSys and ArbGasInfo both hold
   * code at their fixed precompile addresses), so this is the bridge's aeWETH
   * rather than a stock WETH9 — upgradeable, and minted by the L2 Weth Gateway.
   * That distinction is why it was worth probing rather than assuming: our
   * routers call deposit() and withdraw(), which a pure bridge token need not
   * have. Both are callable (checked by staticCall, so nothing was spent), and
   * it already holds 1,913.98 WETH of real supply — so wrapping works and there
   * is liquidity to trade against.
   *
   * Deploying our own WETH9 here, which the wave plan budgeted for, would have
   * split that supply away from the token everything else on the chain uses. */
  [46630]: [
    {
      chainId: 46630,
      address: "0x7943e237c7F95DA44E0301572D358911207852Fa",
      symbol: "WETH",
      name: "WETH",
      decimals: 18,
      tags: ["wrapped-native"],
    },
  ],

  /* -- Arc Testnet ------------------------------------------------------- *
   * Every address and decimal count below was read off the chain on
   * 2026-08-21 and cross-checked against Circle's own
   * docs.arc.io/arc/references/contract-addresses on 2026-08-22. Both sources
   * are kept because they disagree on one point that matters, and the chain is
   * not automatically the winner: the docs say plainly "There is no wrapped
   * USDC address on Arc", yet a WUSDC contract with 650,438 holders is sitting
   * there and working. See the WUSDC entry for how that is resolved.
   *
   * Arc's native currency is USDC, and that makes this the one chain in the
   * list where "what assets exist here" has a genuinely confusing answer: the
   * SAME dollar has three on-chain faces, at two different decimal scalings.
   * Getting that wrong in either direction — treating the faces as separate
   * assets, or collapsing them — is a real error, so each is recorded with what
   * distinguishes it.
   *
   * Circle documents a fourth asset here, USYC (tokenized money-market shares,
   * 0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C, 6 decimals). It is deliberately
   * absent rather than overlooked: transfers are gated by an Entitlements
   * allowlist restricted to non-US institutions with a $100,000 minimum, so a
   * permissionless AMM pool or lending market against it cannot function — most
   * holders could not receive the token a swap or a liquidation would send them.
   * Listing it would produce a market whose every settlement reverts. */
  [5042002]: [
    {
      chainId: 5042002,
      /* Not a placeholder despite the shape — a system predeploy, and it is
       * the ERC20 FACE OF THE NATIVE BALANCE rather than a token beside it.
       * Measured: the deployer's balanceOf here read 19.998221 against a
       * native balance of 19.998221743625, and transferring 1000 units moved
       * exactly 1e15 wei of native. So it is one balance viewed at 6 decimals
       * instead of 18, and a UI that lists this next to the native asset is
       * showing one holding twice.
       *
       * It is nonetheless the right USDC to point contracts at: it carries the
       * canonical symbol and the 6 decimals every other chain's USDC has, and
       * — the part that is not obvious — a transfer to a contract with no
       * `receive()` succeeds (49,314 gas, against 49,097 to an EOA). It moves
       * balances directly rather than making a native call, so kfUSD, kafUSD
       * and YieldTreasury can hold it despite none of the three being
       * payable. A wrapper that paid by native send could not be their reserve
       * asset at all. */
      address: "0x3600000000000000000000000000000000000000",
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
      tags: ["stablecoin", "native-alias"],
    },
    {
      chainId: 5042002,
      /* The wrapped native, and a real ERC20 rather than a view: deposit() of
       * 0.01 native minted exactly 0.01e18 and withdraw() returned it, so it
       * carries the WETH9 surface the V2 and V3 routers call. It reports
       * "Wrapped USDC"/"WUSDC" honestly, which is why no WETH9 is deployed
       * here — WETH9 hardcodes "Wrapped Ether"/"WETH" and would have labelled
       * a wrapped dollar as wrapped ether.
       *
       * NOT a Circle contract, and this entry used to call it canonical, which
       * was wrong. Circle's docs state outright that there is no wrapped USDC
       * address on Arc, on the reasoning that the 0x3600 ERC20 face above makes
       * a wrapper unnecessary. That reasoning is right about Arc and wrong about
       * our routers, which call deposit()/withdraw() that 0x3600 does not have.
       *
       * So it is third-party code, and the question is whether to trust it or
       * deploy our own. Trust it, for a reason stronger than its 650,438 holders
       * and 68.9M supply: its source is verified and it is WETH9 verbatim —
       * solc 0.4.18, optimizer off, 1,835 bytes, and exactly the six functions
       * deposit/withdraw/totalSupply/approve/transfer/transferFrom plus the
       * payable fallback. No owner, no mint, no pause, no blocklist, no upgrade
       * path, no delegatecall. There is no privileged role to abuse because the
       * contract has none, so "unaudited third party" overstates the exposure
       * here — whereas deploying our own would split the chain's wrapped-dollar
       * liquidity away from where all of it already is. */
      address: "0x911b4000D3422F482F4062a913885f7b035382Df",
      symbol: "WUSDC",
      name: "Wrapped USDC",
      decimals: 18,
      tags: ["wrapped-native", "stablecoin"],
    },
    {
      chainId: 5042002,
      /* Listed because it exists and is liquid here — Arc already carries a
       * USDC/EURC pool. It is NOT a lending asset: pricing it needs FX.EUR/USD,
       * which is a different Pyth asset type from the crypto feeds
       * scripts/libraries/pyth-feeds.js carries and is not relayed here.
       * Tradable, not borrowable.
       *
       * Circle's FiatTokenProxy, the same EIP-1967 upgradeable pattern behind
       * USDC on every chain — so Circle can pause, blocklist and upgrade it.
       * That is the accepted property of every Circle stablecoin rather than
       * something peculiar to Arc, but it is worth stating once here: a
       * blocklisted borrower's collateral stops being transferable, which is a
       * liquidation failure mode no price feed will warn about. */
      address: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
      symbol: "EURC",
      name: "Euro Coin",
      decimals: 6,
      tags: ["stablecoin"],
    },
    {
      chainId: 5042002,
      /* Circle Wrapped Bitcoin, the third asset Circle's testnet faucet hands
       * out here, and the only non-dollar-denominated one on the chain — the
       * EURC entry above claimed that distinction until this was added.
       *
       * 8 decimals, matching WBTC and NOT the 18 an EVM token is assumed to
       * have. A 1e10 error either way is the whole position.
       *
       * Identifying the right contract is the real work: ArcScan's token search
       * returns ten tokens whose symbol is some case of "cirBTC", including
       * "Mock cirBTC" at 6 decimals and two more calling themselves "Wrapped
       * Bitcoin" at 8. Symbol and decimals therefore do not identify it. What
       * does is that this one is a Circle FiatTokenProxy — byte-identical
       * deployment pattern to EURC above and to USDC everywhere — with 93,720
       * holders, and it is the contract that actually delivered the faucet
       * balance to the deployer. The impostors are plain ERC20s.
       *
       * Tradable, not borrowable, and deliberately absent from
       * scripts/libraries/pyth-feeds.js. Arc relays Crypto.BTC/USD at 4s, so
       * this is the one non-dollar asset on the chain that COULD be priced
       * tightly — but Crypto.BTC/USD prices bitcoin, and cirBTC is a claim on
       * Circle's custody of bitcoin. The 1:1 is an issuer attestation, not the
       * contract redemption that licenses pricing WETH off ETH/USD, which is
       * exactly why pyth-feeds.js keeps a separate Crypto.WBTC/USD id rather
       * than reusing BTC's. Leaving the feed unmapped means register-tokens.js
       * throws if someone lists it, instead of quietly lending against a
       * custodial wrapper at the underlying's price with no haircut. */
      address: "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF",
      symbol: "cirBTC",
      name: "Circle Wrapped Bitcoin",
      decimals: 8,
      tags: ["wrapped-btc"],
    },
  ],

  /* -- Arbitrum. Balances only; no Diamond planned here yet. ------------- */
  [42161]: [
    {
      chainId: 42161,
      address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
      symbol: "WETH",
      name: "Wrapped Ether",
      decimals: 18,
      tags: ["wrapped-native"],
    },
    {
      chainId: 42161,
      address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
      tags: ["stablecoin"],
    },
    {
      chainId: 42161,
      address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
      symbol: "USDT",
      name: "Tether USD",
      decimals: 6,
      tags: ["stablecoin"],
    },
  ],

  /* -- Polygon ----------------------------------------------------------- */
  [137]: [
    {
      chainId: 137,
      address: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
      symbol: "WPOL",
      name: "Wrapped POL",
      decimals: 18,
      tags: ["wrapped-native"],
    },
    {
      chainId: 137,
      address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
      tags: ["stablecoin"],
    },
  ],
};

const tokenKey = (chainId: number, address: string) =>
  `${chainId}:${address.toLowerCase()}`;

const TOKEN_INDEX: Map<string, TokenEntry> = new Map(
  Object.values(TOKENS)
    .flat()
    .map((t) => [tokenKey(t.chainId, t.address), t]),
);

/**
 * Exact lookup in the DECLARED third-party table, and only there.
 *
 * Narrower than it reads, so prefer `chainTokenByAddress` in tokens.ts unless you
 * specifically mean "is this address hand-declared in TOKENS": that is the
 * question `deployedTokens` asks to avoid emitting a duplicate row, and the one
 * `auditRegistry` asks to catch the two tables disagreeing. Anything resolving an
 * address that came off a contract or an API wants the union, because our own
 * tokens and the recorded stablecoins are not in here.
 */
export function getToken(
  chainId: number | undefined,
  address: string | undefined,
): TokenEntry | undefined {
  if (chainId === undefined || !address) return undefined;
  return TOKEN_INDEX.get(tokenKey(chainId, address));
}

/** The declared third-party ERC20s for one chain. See `registeredTokens`. */
export function getTokens(chainId: number | undefined): TokenEntry[] {
  if (chainId === undefined) return [];
  return TOKENS[chainId] ?? [];
}

/**
 * Symbol lookup, scoped to one chain.
 *
 * Only for resolving user input ("swap 500 usdc"), where a symbol is all the
 * user gave us. Never use it to resolve an address that came from a contract
 * or an API — use getToken for that, since a symbol is ambiguous across
 * chains and can collide within one (a chain's native USDC and a bridged
 * ERC20 USDC can coexist with different decimals).
 *
 * Searches `registeredTokens`, not `getTokens`. It read TOKENS alone until
 * 2026-08-24, which made it blind to every token whose address comes from a
 * deployment record — kfUSD and kafUSD on all five deployed chains, USDT and USDe
 * on all five, USDC on two. The pickers already offered those, so the resolver
 * and the UI disagreed about what the chain had.
 */
export function findTokenBySymbol(
  chainId: number | undefined,
  symbol: string,
): TokenEntry | undefined {
  const s = symbol.toLowerCase();
  return registeredTokens(chainId).find((t) => t.symbol.toLowerCase() === s);
}

/* ----------------------------------------------------------------- native -- */

/**
 * The chain's own native asset, as a TokenEntry.
 *
 * Sourced from chains.ts rather than assumed: nine chains here call it "ETH",
 * BNB testnet calls it "tBNB", Polygon "POL", Hyperliquid "HYPE", and Arc
 * uses USDC at 18 decimals. Anything that hardcodes ETH is wrong on five of
 * the fourteen registered chains today, and the ratio worsens as more are
 * added.
 *
 * `protocol` selects which sentinel the address carries, because the correct
 * value depends on which contract you are about to call.
 */
export function nativeTokenOf(
  meta: ChainMeta | undefined,
  protocol: Protocol,
): TokenEntry | undefined {
  if (!meta) return undefined;

  return {
    chainId: meta.id,
    address: NATIVE_SENTINEL[protocol],
    symbol: meta.nativeCurrency.symbol,
    name: meta.nativeCurrency.name,
    decimals: meta.nativeCurrency.decimals,
    isNative: true,
  };
}

/**
 * Resolves user-typed input to a token on a specific chain, native included.
 *
 * The native asset is checked first and by this chain's own symbol, so "eth"
 * on Base resolves to Base's native rather than to some ERC20 that happens to
 * share the ticker, and "usdc" on Arc resolves to the native asset (18
 * decimals) rather than the 6-decimal ERC20 shape it has elsewhere.
 */
export function resolveUserToken(
  meta: ChainMeta | undefined,
  input: string,
  protocol: Protocol,
): TokenEntry | undefined {
  const native = nativeTokenOf(meta, protocol);
  if (native && native.symbol.toLowerCase() === input.toLowerCase())
    return native;
  return findTokenBySymbol(meta?.id, input);
}

/* -------------------------------------------------------- our own tokens -- */

/**
 * Kaleido's own ERC20s, described once and independently of any chain.
 *
 * TOKENS above holds third-party contracts that exist right now. These are the
 * opposite case: the identity is known, the address is not, because nothing is
 * deployed yet. So the descriptor lives here and the address is read from
 * DEPLOYMENTS at call time — which means a chain gains our tokens the moment
 * its addresses are recorded, with no second list to remember to update.
 *
 * `field` is the ChainContracts key holding the address. That indirection is
 * what keeps the two structures from drifting: adding a token here without a
 * home in ChainContracts is a type error, not a silent no-op.
 *
 * Decimals come from the contracts, not from convention: kfUSD.sol:98 and
 * kafUSD.sol:74 are plain 18-decimal ERC20s, StKLD.sol:42 returns 18 from a
 * pure function. They are declared here for the same reason rule 2 at the top
 * of this file exists — a symbol is not a decimals lookup.
 */
export type OwnTokenField = "kld" | "stKLD" | "kfUSD" | "kafUSD";

export interface OwnTokenSpec {
  /** The ChainContracts field carrying this token's address. */
  field: OwnTokenField;
  symbol: string;
  name: string;
  decimals: number;
  tags?: string[];
  /**
   * Set when this repository contains no contract that mints the token, so a
   * deploy plan cannot silently assume one exists. Checked by auditDeployPlan.
   *
   * Nothing sets it right now. KLD carried it for months — Faucet.sol,
   * KLDVaultV2 and MasterChef all take a KLD address in their constructor while
   * nothing minted one — and it is cleared because contracts/Token/KLD.sol now
   * exists and is deployed on all five testnets. The field stays because it is
   * the mechanism that made that gap visible, and the next own-token added
   * ahead of its contract needs it.
   */
  noContract?: string;
}

export const OWN_TOKENS: readonly OwnTokenSpec[] = [
  {
    field: "kld",
    symbol: "KLD",
    name: "Kaleido",
    decimals: 18,
    tags: ["governance"],
  },
  {
    field: "stKLD",
    symbol: "stKLD",
    name: "Liquid Staked KLD",
    decimals: 18,
    tags: ["staking-receipt"],
  },
  {
    field: "kfUSD",
    symbol: "kfUSD",
    name: "Kaleido Finance USD",
    decimals: 18,
    tags: ["stablecoin"],
  },
  {
    field: "kafUSD",
    symbol: "kafUSD",
    name: "Kaleido Finance Liquid Staked USD",
    decimals: 18,
    tags: ["stablecoin", "yield-bearing"],
  },
];

/**
 * Our own tokens on one chain, as registry entries.
 *
 * Sourced from DEPLOYMENTS, so it answers per chain rather than globally. All
 * four now resolve on the five deployed testnets: kfUSD and kafUSD from the
 * stablecoin records, KLD and stKLD from the ones deploy-kld.js writes. This
 * used to note that KLD and stKLD never resolved anywhere because no KLD ERC20
 * existed — that gap is closed, and closing it is what put KLD in the token
 * pickers and gave `stake` an address to spend.
 *
 * Populate a chain's ChainContracts and its tokens appear in every picker at
 * once, because chainTokens() in tokens.ts concatenates this.
 */
export function ownTokens(chainId: number | undefined): TokenEntry[] {
  const c = getContracts(chainId);
  if (chainId === undefined) return [];

  return OWN_TOKENS.flatMap((spec) => {
    const address = c[spec.field];
    if (!address) return [];
    return [
      {
        chainId,
        address,
        symbol: spec.symbol,
        name: spec.name,
        decimals: spec.decimals,
        tags: spec.tags,
      },
    ];
  });
}

/* ------------------------------------------------- stablecoins we deployed -- */

/**
 * The three stablecoin fields ChainContracts carries, described once.
 *
 * Same indirection as OWN_TOKENS and for the same reason — the identity is fixed,
 * the address is per chain and comes from a deployment record — but a different
 * claim about provenance. `usdc` is a mintable MockERC20 we deployed on Sepolia,
 * Base, BSC and Robinhood — scripts/switch-usdc-to-mock.js swapped Circle's real
 * token for the mock on the first two on 2026-08-27, deploy-mock-tokens.js
 * deployed it on the other two — plus the 0x3600 predeploy on Arc, whose native
 * currency is USDC; `usdt` and `usde` are ours everywhere, deployed by
 * scripts/deploy-stablecoin.js as kfUSD's backing assets. The field being set is
 * not a claim about which, so this table declares only what is true of all of
 * them: the symbol, the name, and the decimals.
 *
 * WHY THIS EXISTS AT ALL. TOKENS could not answer for these. Measured
 * 2026-08-24, `resolveUserToken` — the symbol resolver the AI path and every
 * picker reach — missed USDT and USDe on all five deployed chains and USDC on
 * two, because the addresses live in DEPLOYMENTS and nothing merged them in. The
 * effect was not a cosmetic gap: `swap 100 USDC to USDT` on BSC Testnet or
 * Robinhood resolved neither side and the agent refused a trade against tokens it
 * had just handed the user from the faucet. Pasting them into TOKENS was the
 * other option and is wrong twice over — it is documented as third-party
 * contracts, and auditDeployPlan flags a symbol that appears in both as a mock
 * duplicating a real contract.
 *
 * DECIMALS ARE MEASURED, NOT CONVENTIONAL (rule 2). All fifteen addresses were
 * read on-chain on 2026-08-24: `symbol()` returns USDC/USDT/USDe as expected on
 * every chain, `decimals()` returns 6 for USDC and USDT on all five and 18 for
 * USDe on all five. USDe at 18 is the value the old code could not supply at all
 * — `declaredDecimals` returned undefined for it, so getTokenDecimals fell
 * through to its `?? 6` and every USDe figure rendered 1e12 too large. (The
 * Sepolia and Base USDC addresses changed on 2026-08-27 when Circle's token was
 * swapped for a mintable mock; the mock is 6dp too, so the values above hold.)
 */
export type DeployedTokenField = "usdc" | "usdt" | "usde";

export interface DeployedTokenSpec {
  /** The ChainContracts field carrying this token's address. */
  field: DeployedTokenField;
  symbol: string;
  name: string;
  decimals: number;
  tags?: string[];
}

export const DEPLOYED_TOKENS: readonly DeployedTokenSpec[] = [
  {
    field: "usdc",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    tags: ["stablecoin"],
  },
  {
    /* Stablecoin/USDT.sol:16 — ERC20("Tether USD", "USDT"), 6 decimals. */
    field: "usdt",
    symbol: "USDT",
    name: "Tether USD",
    decimals: 6,
    tags: ["stablecoin"],
  },
  {
    /* Stablecoin/USDe.sol:16 — ERC20("Ethena USD", "USDe"), 18 decimals. */
    field: "usde",
    symbol: "USDe",
    name: "Ethena USD",
    decimals: 18,
    tags: ["stablecoin"],
  },
];

/**
 * The stablecoins recorded for one chain, as registry entries.
 *
 * Deduplicated against TOKENS by address, which is the whole reason this is a
 * projection rather than a second table: Arc's 0x3600 USDC predeploy is declared
 * there (and Circle's USDC on Sepolia and Base was, until switch-usdc-to-mock.js
 * swapped it for a mintable mock on 2026-08-27 and removed those TOKENS entries),
 * and the same address appearing twice would put a duplicate row in every picker
 * and make `findTokenBySymbol` answer from whichever came first. TOKENS wins,
 * because an entry written by hand there carries a logoURI and a name chosen for
 * it, while this table only knows the generic ones.
 *
 * The dedupe is BY ADDRESS, so it only suppresses a duplicate when a TOKENS entry
 * and the recorded address match exactly. That is why the switch also deleted the
 * Circle TOKENS entries: the mock has a new address, so leaving Circle's in TOKENS
 * would have shown two USDC rows — the dead Circle one and the live mock.
 */
export function deployedTokens(chainId: number | undefined): TokenEntry[] {
  if (chainId === undefined) return [];
  const c = getContracts(chainId);

  return DEPLOYED_TOKENS.flatMap((spec) => {
    const address = c[spec.field];
    if (!address || getToken(chainId, address)) return [];
    return [
      {
        chainId,
        address,
        symbol: spec.symbol,
        name: spec.name,
        decimals: spec.decimals,
        tags: spec.tags,
      },
    ];
  });
}

/**
 * Every ERC20 this registry can name on one chain, from all three sources.
 *
 * The union, in trust order: declared third-party contracts, then the
 * stablecoins recorded for the chain, then ours. Every symbol- or address-based
 * lookup goes through here so they cannot disagree about what exists — before
 * this, `chainTokens` concatenated our own tokens for the pickers while
 * `findTokenBySymbol` read TOKENS alone, so a symbol the swap UI offered was one
 * the agent could not resolve. kfUSD and kafUSD were in exactly that state on all
 * five deployed chains.
 *
 * Not the native asset. That comes from chains.ts rather than a token table (see
 * nativeTokenOf) and carries a per-protocol sentinel instead of an address, so it
 * is added by the callers that know which protocol they are addressing.
 */
export function registeredTokens(chainId: number | undefined): TokenEntry[] {
  return [
    ...getTokens(chainId),
    ...deployedTokens(chainId),
    ...ownTokens(chainId),
  ];
}

/* --------------------------------------------- chain-scoped lending views -- */

/**
 * Stablecoin-family addresses for one chain, projected from DEPLOYMENTS.
 *
 * This replaces the flat Abstract-only STABLE_CONTRACTS table that every
 * stablecoin call site used to read directly. Because it is a projection of
 * getContracts(chainId), a chain gains these the moment its addresses land in
 * deployments.generated.ts, and there is no second table to drift from the
 * first — which is exactly the disagreement the file header warns about
 * (addresses.ts once declared a YIELD_TREASURY_ADDRESS that no call site used).
 *
 * Fields are `string | undefined` on purpose: a chain that has not deployed the
 * stablecoin returns undefined rather than a stale Abstract address, so the
 * caller must gate on isDeployed() — which the trading UI already does.
 */
export function stableContracts(chainId: number | undefined) {
  const c = getContracts(chainId);
  return {
    USDC: c.usdc,
    USDT: c.usdt,
    USDe: c.usde,
    kfUSD: c.kfUSD,
    kafUSD: c.kafUSD,
    YieldTreasury: c.yieldTreasury,
  };
}

/**
 * The symbols this list OFFERS as collateral / loan currency.
 *
 * Not the symbols the diamond accepts. Measured 2026-08-23 against
 * getAllCollateralToken() / getLoanableAssets() on all five deployed diamonds
 * (smart-contract/deployment-tokens-*.json, `onChain` block), the registered
 * sets differ per chain and none of them is this list:
 *
 *   Sepolia    collateral NATIVE, WETH9, USDC     loanable USDC
 *   Base       collateral NATIVE, WETH, USDC, USDT loanable USDC, USDT
 *   BSC        collateral NATIVE, WBNB, USDC, USDT loanable USDC, USDT
 *   Arc        collateral NATIVE, WUSDC            loanable WUSDC
 *   Robinhood  collateral NATIVE, WETH, USDC       loanable WETH, USDC
 *
 * So: kfUSD is offered on five chains and registered on none (it is our token
 * and has no public feed); USDT is offered on five and registered on two; the
 * wrapped native is registered on five and offered on none; and ETH is offered
 * as a LOAN currency on five while being loanable on none, so borrowing it
 * reverts Protocol__TokenNotLoanable everywhere. On Arc the offered USDC is the
 * 0x3600… predeploy while the registered token is WUSDC, so every ERC20 here is
 * unregistered there. All of these fail closed — _isTokenAllowed and
 * getUsdValue read the same s_priceFeeds mapping — so they revert rather than
 * misprice.
 *
 * WHAT TO USE INSTEAD, depending on whether you can await:
 *
 *   - readLendingAssets() in src/lib/lending/assets.ts asks the diamond for both
 *     getters. Live, self-correcting, needs a provider. The borrow UI uses it.
 *   - registeredLendingAssets() below answers the same question from the
 *     read-back the deploy recorded. Synchronous, so it is what the intent
 *     builder and the plan auditor use; a snapshot, so it is only as current as
 *     the last `npm run gen:registry`.
 *
 * This list stays because "what we offer" is still a real question — it is what
 * the marketing surfaces and the mock fixtures describe, and it is the only
 * symbol→address table for a chain whose registration is unrecorded. It is not
 * a validation source.
 *
 * USDR is gone — it had no deployment record on any of the five chains, so a
 * chain-scoped lookup could never resolve it anyway.
 */
export const BORROW_SYMBOLS = ["ETH", "USDC", "USDT", "kfUSD"] as const;

/**
 * A lending asset symbol. Deliberately `string`, not a union of the four above.
 *
 * It used to be `(typeof BORROW_SYMBOLS)[number]`, and that union was worse than
 * no type at all: it type-checked `"kfUSD"` — which every deployed diamond
 * rejects — while rejecting `"WETH"` and `"WUSDC"`, which two of them accept as
 * loan currencies. A compile-time union over a runtime, per-chain, on-chain fact
 * can only ever be wrong in both directions, so the check belongs where the fact
 * lives: readLendingAssets() in src/lib/lending/assets.ts asks the diamond.
 */
export type BorrowCurrency = string;

export interface BorrowCurrencyEntry {
  symbol: BorrowCurrency;
  address: string;
  decimals: number;
}

/**
 * Collateral and loan currencies this UI offers, for one chain.
 *
 * Derived from address EXISTENCE in the registry, not from on-chain
 * registration — see the BORROW_SYMBOLS comment above for the measured gap
 * between what this returns and what each diamond actually accepts.
 *
 * The native entry is named from nativeTokenOf(getChainMeta(chainId)), not from
 * a hardcoded "ETH" — that literal was wrong on two of the five deployed chains
 * (the native asset is BNB on 97 and USDC on Arc). An unregistered chain falls
 * back to ETH/18, which is a guess and labelled as one; it is only reachable for
 * a chainId that is not in chains.ts, and such a chain has no addresses here
 * either, so the entry it produces is the lone native row and nothing else.
 *
 * ETH carries NATIVE_SENTINEL.lending, not the DEX sentinel — rule 3 at the
 * top of this file. Handing the ProtocolFacet a 0xEeee… address would send
 * collateral to the wrong place and then try to ERC20-approve something that
 * is not a token. The ERC20 addresses come from getContracts(chainId); a
 * currency whose contract is not deployed on this chain is simply absent.
 *
 * Decimals are DECLARED, not inferred (rule 2), and every value here was
 * checked against the deployed contract: deploy-mock-tokens.js mints the USDC
 * mock at 6 and Stablecoin/USDT.sol is 6, so both are 6 on all five chains — as
 * is canonical Sepolia/Base USDC and the Arc 0x3600 predeploy — while
 * Stablecoin/kfUSD.sol is an 18-decimal ERC20. Do not "restore" any of these to
 * 18 without re-reading decimals() on-chain first: that was the USDR bug, a
 * factor of 1e12 on every amount handed to createLendingRequest / createLoanListing.
 */
export function borrowCurrencies(
  chainId: number | undefined,
): BorrowCurrencyEntry[] {
  const c = getContracts(chainId);
  const native = nativeTokenOf(getChainMeta(chainId), "lending");
  const out: BorrowCurrencyEntry[] = [
    {
      symbol: native?.symbol ?? "ETH",
      address: NATIVE_SENTINEL.lending,
      decimals: native?.decimals ?? 18,
    },
  ];
  if (c.usdc) out.push({ symbol: "USDC", address: c.usdc, decimals: 6 });
  if (c.usdt) out.push({ symbol: "USDT", address: c.usdt, decimals: 6 });
  if (c.kfUSD) out.push({ symbol: "kfUSD", address: c.kfUSD, decimals: 18 });
  return out;
}

/* -------------------------------------------- what the market accepts -- */

/**
 * The two token sets one chain's lending market actually accepts.
 *
 * Addresses only, because that is all the diamond reports. `getAllCollateralToken()`
 * and `getLoanableAssets()` return address arrays; naming them is this file's job
 * (see registeredLendingAssets).
 */
export interface LendingRegistration {
  collateral: string[];
  loanable: string[];
}

/**
 * Which lending assets are registered, per chain. GENERATED — same discipline as
 * DEPLOYMENTS above, and the same override seam for a value that must be
 * corrected before the next deploy.
 *
 * The contents come from the `onChain` block of each
 * `smart-contract/deployment-tokens-*.json`, which register-tokens.js fills by
 * READING THE DIAMOND BACK after the registration transactions confirm. So an
 * entry here is the facet's own answer, not the operator's intent — the two came
 * apart on Arc, where kfUSD and the 0x3600 USDC predeploy were passed and
 * neither registered.
 */
export const LENDING_REGISTRATION: Record<number, LendingRegistration> = {
  ...GENERATED_LENDING_REGISTRATION,
};

/**
 * Every V3 pool the deployer opened, per chain. GENERATED, with the same override
 * seam as the two maps above for a value that has to be corrected before the next
 * deploy can regenerate it.
 *
 * Sourced from the `deployment-pool-*.json` that seed-v3-pool.js writes, so a pool
 * is in here because a run of ours created it and funded it, not because someone
 * decided it was legitimate. See `GENERATED_SEEDED_POOLS` for the exact scope of
 * that claim.
 */
export const SEEDED_POOLS: Record<number, string[]> = {
  ...GENERATED_SEEDED_POOLS,
};

/**
 * Did we open this pool? The question behind the verified tick on a pool row.
 *
 * Case-insensitive, because the two sides reach this function from different
 * places: the generated list is checksummed by `getAddress`, while the address it
 * is compared against arrives from a factory call, a URL, or a paste, in whatever
 * case that produced. A `===` would answer no for a pool that is unambiguously
 * ours, and the failure would be invisible — a missing tick looks like a pool we
 * simply did not seed.
 *
 * A missing chain or address is false rather than a throw. This decides whether a
 * badge renders, and the honest answer to "we cannot tell" is no badge.
 */
export function isSeededPool(
  chainId: number | undefined,
  address: string | undefined,
): boolean {
  if (chainId === undefined || !address) return false;
  const seeded = SEEDED_POOLS[chainId];
  if (!seeded) return false;
  const wanted = address.toLowerCase();
  return seeded.some((pool) => pool.toLowerCase() === wanted);
}

/**
 * Which side of the lending market a token has to be registered on.
 *
 * The distinction is not cosmetic — it is two different mappings in
 * ProtocolFacet, checked by different functions, and a token can be on one and
 * not the other. On four of the five deployed chains the two sets differ:
 *
 *   collateral  `_isTokenAllowed`, i.e. `s_priceFeeds[token] != 0`. Gates
 *               depositCollateral and withdrawCollateral.
 *   loanable    `s_isLoanable[token]`. Gates createLendingRequest and
 *               createLoanListing, which revert Protocol__TokenNotLoanable.
 *
 * Nothing is gated on both, and no path is gated on the union, so a caller has
 * to say which question it is asking.
 */
export type LendingSide = "collateral" | "loanable";

export interface RegisteredLendingAssets {
  /**
   * False when this chain has no recorded registration at all. Distinct from an
   * empty `assets`, which is "we know, and it accepts nothing" — a chain that
   * was deployed but never had register-tokens.js run against it.
   */
  known: boolean;
  assets: BorrowCurrencyEntry[];
  /**
   * Registered addresses this registry cannot name or cannot give decimals for.
   *
   * Empty on all five deployed chains, and reported rather than dropped anyway:
   * an address in here IS accepted by the market, so leaving it out of `assets`
   * silently would understate what the chain does. A caller that only needs a
   * membership test should count these as accepted; a caller about to build a
   * transaction cannot, because it has no decimals to parse an amount with.
   */
  unnamed: string[];
}

/**
 * Address membership, case-insensitively — the recorded arrays are checksummed,
 * a caller's address may not be.
 */
const hasAddress = (list: string[], address: string) =>
  list.some((a) => a.toLowerCase() === address.toLowerCase());

/**
 * What one chain's lending market accepts on one side, named and with decimals.
 *
 * THE COUNTERPART TO borrowCurrencies, AND THE ONE THAT MAY GATE A WRITE. That
 * list is what this app offers, derived from address existence; this is what the
 * facet will not revert on, derived from a per-chain owner transaction. Every
 * consumer that was validating a lending step against the offered list was
 * passing plans that revert — `lend 500 kfUSD` and `borrow 1 ETH` build cleanly
 * on all five chains and are loanable on none of them.
 *
 * COLLATERAL IS THE UNION of the two recorded arrays, deliberately. The gate for
 * a deposit is `s_priceFeeds[token] != 0`, and `addLoanableToken` writes
 * `s_priceFeeds` too (ProtocolFacet.sol:533-539) — so registering a token as
 * loanable also makes it depositable, whether or not it is in
 * `s_collateralToken`. Using the collateral array alone would refuse a deposit
 * the facet accepts. It happens not to bite today, because loanable ⊆ collateral
 * on all five chains, and that is a fact about these five registrations rather
 * than an invariant of the contract. The reverse union would be wrong: a
 * collateral token is NOT loanable.
 *
 * It is an approximation of the feed mapping in one direction only.
 * `removeCollateralTokens` clears a feed and leaves `s_loanableToken` alone, so a
 * removed-then-still-listed token would read as accepted here and revert
 * on-chain. Nothing calls that path in any script, and a token in that state
 * cannot be priced either, so the failure is a refusal rather than a mispricing.
 * The exact answer needs the two on-chain reads that readLendingAssets makes.
 *
 * Names and decimals come from declaredSymbol/declaredDecimals — the same
 * (chainId, address) resolution everything else uses, never a symbol guess. An
 * address the registry cannot resolve goes to `unnamed` rather than being
 * dropped or given a default: rule 2 at the top of this file, and the reason is
 * that a defaulted 6 on an 18-decimal token under-sends by 1e12.
 */
export function registeredLendingAssets(
  chainId: number | undefined,
  side: LendingSide,
): RegisteredLendingAssets {
  const reg = chainId === undefined ? undefined : LENDING_REGISTRATION[chainId];
  if (!reg) return { known: false, assets: [], unnamed: [] };

  const addresses =
    side === "loanable"
      ? reg.loanable
      : [
          ...reg.collateral,
          ...reg.loanable.filter((a) => !hasAddress(reg.collateral, a)),
        ];

  const assets: BorrowCurrencyEntry[] = [];
  const unnamed: string[] = [];
  for (const address of addresses) {
    const symbol = declaredSymbol(chainId, address);
    const decimals = declaredDecimals(chainId, address);
    if (symbol && decimals !== undefined) {
      assets.push({ symbol, address, decimals });
    } else {
      unnamed.push(address);
    }
  }
  return { known: true, assets, unnamed };
}

/**
 * Resolve a user-typed symbol against what the market accepts on one side.
 *
 * The replacement for findBorrowCurrency on every path that ends in a lending
 * transaction. Case-insensitive, symbol-scoped for the same reason
 * findBorrowCurrency is: a caller holding a DEX address must re-resolve rather
 * than carry an address across a protocol boundary whose native sentinel differs.
 *
 * First match wins, and one chain can return two entries for one symbol: on Arc
 * the native currency IS USDC, so "USDC" names both the lending sentinel and the
 * 0x3600 ERC20 face of the same balance at a different decimal scaling. Only the
 * sentinel is registered there, so the ambiguity does not currently reach a
 * signature — but that is why this returns a registered entry rather than
 * resolving a symbol against the offered table and checking membership after.
 */
export function findRegisteredLendingAsset(
  chainId: number | undefined,
  side: LendingSide,
  symbol: string,
): BorrowCurrencyEntry | undefined {
  const s = symbol.toLowerCase();
  return registeredLendingAssets(chainId, side).assets.find(
    (a) => a.symbol.toLowerCase() === s,
  );
}

/**
 * The same lookup by address, for validating a step someone else assembled.
 *
 * Returns the entry when the address is registered on that side AND nameable,
 * `{ registered: true }` with no entry when it is registered but unnameable, and
 * `{ registered: false }` otherwise. The auditor needs those three cases apart:
 * an unnameable address is accepted by the market, so refusing it would be
 * wrong, but there are no declared decimals to check the step's own against.
 */
export function registeredLendingAssetAt(
  chainId: number | undefined,
  side: LendingSide,
  address: string,
): { registered: boolean; entry?: BorrowCurrencyEntry } {
  if (!address) return { registered: false };
  const { assets, unnamed } = registeredLendingAssets(chainId, side);
  const a = address.toLowerCase();
  const entry = assets.find((x) => x.address.toLowerCase() === a);
  if (entry) return { registered: true, entry };
  return { registered: hasAddress(unnamed, address) };
}

/**
 * Declared decimals for one (chainId, address) pair, or undefined.
 *
 * The strict half of the decimals question, and the only one a write path may
 * use. getTokenDecimals() in utils/formatTokenDecimals.ts is the lenient half:
 * it wraps this and substitutes 6 so a display never renders NaN. That fallback
 * is correct for a label and catastrophic for a parseUnits — 6 where the token
 * has 18 under-sends by 1e12, which is precisely the USDR bug rule 2 exists to
 * prevent. So callers that are about to sign something ask this, and treat
 * undefined as "I do not know this token" rather than as a number.
 *
 * Both sentinels resolve, because the caller's protocol is not knowable from an
 * address alone and the answer is the same either way: the chain's own native
 * decimals. Everything else is an exact (chainId, address) lookup — never a
 * symbol match, per rule 1 — against `registeredTokens`, then the lending
 * currency list. The lending step is not redundant: it names the addresses a
 * diamond accepts that no token table declares.
 *
 * `registeredTokens` rather than TOKENS-then-ownTokens, because that pair left a
 * measured hole. USDe is in neither, so this returned undefined for it on all
 * five deployed chains, getTokenDecimals fell through to its `?? 6`, and an
 * 18-decimal token rendered every figure 1e12 too large. borrowCurrencies did not
 * cover it either — it offers ETH, USDC, USDT and kfUSD.
 */
export function declaredDecimals(
  chainId: number | undefined,
  address: string | undefined,
): number | undefined {
  if (chainId === undefined || !address) return undefined;

  if (
    isNativeSentinel(address, "lending") ||
    isNativeSentinel(address, "dex")
  ) {
    return getChainMeta(chainId)?.nativeCurrency.decimals;
  }

  const a = address.toLowerCase();
  return (
    registeredTokens(chainId).find((t) => t.address.toLowerCase() === a)
      ?.decimals ??
    borrowCurrencies(chainId).find((c) => c.address.toLowerCase() === a)
      ?.decimals
  );
}

/**
 * Declared symbol for one (chainId, address) pair, or undefined.
 *
 * The label half of the same question `declaredDecimals` answers, resolved
 * through the same sources in the same order and for the same reason: an
 * address that came off a contract or an API is only meaningful together with
 * its chain (rule 1), so there is no address-only table that can name it.
 *
 * IT REPLACES ONE. `constants/utils/tokenImageMap.ts` was a flat
 * address → { image, label } map of five Abstract-testnet literals, and after the
 * address cutover not one of its keys existed on any deployed chain — so every
 * lookup missed and the callers rendered their fallbacks: an active loan row
 * showed its currency as "—" and a filter query went out reading
 * `tokenType=undefined`. Nothing threw and nothing looked broken, which is the
 * failure mode this file's rule 1 exists to prevent. Both call sites already
 * resolved *decimals* correctly through `declaredDecimals`; only the label was
 * still coming from the flat table.
 *
 * Undefined rather than a guessed symbol. A label is display-only, so unlike the
 * decimals case there is no catastrophic version of being wrong here — but naming
 * a token we cannot identify is still worse than admitting we cannot. Callers
 * substitute their own placeholder.
 */
export function declaredSymbol(
  chainId: number | undefined,
  address: string | undefined,
): string | undefined {
  if (chainId === undefined || !address) return undefined;

  if (
    isNativeSentinel(address, "lending") ||
    isNativeSentinel(address, "dex")
  ) {
    return nativeTokenOf(getChainMeta(chainId), "lending")?.symbol;
  }

  const a = address.toLowerCase();
  return (
    registeredTokens(chainId).find((t) => t.address.toLowerCase() === a)
      ?.symbol ??
    borrowCurrencies(chainId).find((c) => c.address.toLowerCase() === a)?.symbol
  );
}

/**
 * Staking addresses on one chain: the token, the receipt and the vault.
 *
 * Was a flat three-literal object holding Abstract-testnet addresses, with a
 * header explaining that there was nothing to move to — KLD had no ERC20 in
 * smart-contract/contracts, so `kld`/`stKLD`/`kldVault` were absent from every
 * chain in DEPLOYMENTS. `contracts/Token/KLD.sol` now exists and
 * scripts/deploy-kld.js has deployed the three-contract set on all five
 * testnets, so this resolves from DEPLOYMENTS like every other address.
 *
 * Returns a partial rather than throwing, because the three arrive together or
 * not at all and "not on this chain" is a normal answer: `deposit` needs the
 * token address as an argument, the vault needs its own, and a caller with two
 * of the three has nothing it can safely do. Callers gate on `supported`.
 *
 * The chainId argument is the point. The old flat object made every staking call
 * single-chain by construction: a wallet on Base sent `deposit` with Abstract's
 * KLD address, which is not a type error and not a revert the UI can explain —
 * it is a transaction against a codeless address on a chain nobody deployed to.
 */
export interface StakingContracts {
  kld?: string;
  stKLD?: string;
  kldVault?: string;
  /** True when all three are present, so staking is possible here. */
  supported: boolean;
}

export function stakingContracts(
  chainId: number | undefined,
): StakingContracts {
  const c = getContracts(chainId);
  const { kld, stKLD, kldVault } = c;
  return {
    kld,
    stKLD,
    kldVault,
    supported: Boolean(kld && stKLD && kldVault),
  };
}

/**
 * Resolve a user-typed symbol against one chain's lending currency list.
 *
 * Symbol-scoped on purpose: a caller holding a DEX address must re-resolve
 * through here before touching the lending facet, rather than passing the
 * address across protocol boundaries. chainId is required now that the list is
 * per-chain — the auditor comment predicting "this helper is the one place that
 * has to change" was right.
 */
export function findBorrowCurrency(
  chainId: number | undefined,
  symbol: string,
): BorrowCurrencyEntry | undefined {
  const s = symbol.toLowerCase();
  return borrowCurrencies(chainId).find((c) => c.symbol.toLowerCase() === s);
}

/* ------------------------------------------------------- the deploy plan -- */

/**
 * Which chains we deploy to, in order, and what each one needs first.
 *
 * This is a plan, not a record — it says nothing about what is live. That stays
 * DEPLOYMENTS' job, and `isDeployed()` remains the only gate on whether the UI
 * may submit. The plan exists because the three prerequisites below are per
 * chain, easy to get wrong, and each one breaks at first use rather than at
 * deploy: the V3 periphery takes `wrappedNative` as a constructor argument, the
 * oracle takes `pythContract`, and the stablecoin needs a real collateral ERC20
 * to mint against.
 *
 * `mocks` is the part worth reading. A testnet with no canonical issuance needs
 * us to deploy stand-ins, and smart-contract/contracts/Stablecoin already holds
 * two of them (USDT.sol at 6 decimals, USDe.sol at 18) plus test/MockERC20.sol.
 * A chain whose `counterparties` list is empty cannot host a swap at all — there
 * is no second asset to trade against — which is the concrete reason Robinhood
 * testnet needs more setup than the other two despite being a priority chain.
 */
export interface DeployTarget {
  chainId: number;
  /** Order within the wave; lower goes first. */
  step: number;
  /**
   * Third-party ERC20 symbols already registered on this chain in TOKENS,
   * usable as a swap counterparty and as stablecoin collateral today.
   */
  counterparties: string[];
  /** Symbols we must deploy ourselves because the chain has no issuance. */
  mocks: string[];
  /** Why this chain is in the wave, and what is unresolved about it. */
  note: string;
}

/**
 * Testnet wave: Sepolia, Base Sepolia, BSC testnet, Robinhood testnet, Arc
 * testnet — every chain chains.ts marks `tradable` and `testnet`.
 *
 * Ordered by how much has to be built before the app is exercisable, not by
 * business priority. Sepolia and Base Sepolia both already carry WETH and USDC,
 * so a swap and a kfUSD mint work there against real contracts. BSC has one
 * canonical counterparty. Robinhood and Arc carry nothing, so everything they
 * need is a mock — which makes them the wrong place to find out whether the
 * protocol works, and the right place to confirm it deploys.
 *
 * The two chains added last are the two with a per-chain trap in them, and both
 * traps are in the `note` rather than encodable here: BSC prices a different
 * native asset, and Arc's native asset is a dollar.
 */
export const TESTNET_WAVE: readonly DeployTarget[] = [
  {
    chainId: 11155111,
    step: 1,
    counterparties: ["WETH"],
    mocks: ["USDC", "USDT", "USDe"],
    note: "Widest tooling and the most faucet options, so failures here are ours rather than the chain's. USDC, USDT and USDe are all mocked: the stable pages offer all three collaterals and Sepolia has no mintable canonical issuance for any of them. USDC was Circle's real testnet token until 2026-08-27, when switch-usdc-to-mock.js moved it to a mintable MockERC20 — Circle's cannot be minted, so the faucet could not stock it and USDC pools/collateral could not be seeded. The mock is 6 decimals, matching Circle's, so decimals stay declared and correct.",
  },
  {
    chainId: 84532,
    step: 2,
    counterparties: ["WETH"],
    mocks: ["USDC", "USDT", "USDe"],
    note: "Circle issued real testnet USDC here, but it cannot be minted, so the faucet could not stock it and USDC was unusable in-app. Switched to a mintable 6-decimal MockERC20 on 2026-08-27 (switch-usdc-to-mock.js) — same decimals as Circle's, so the mint/repay path still runs against a genuine 6-decimal token (the case that broke repay when decimals were inferred), now one we can seed. USDT and USDe are mocked for the same reason as on Sepolia.",
  },
  {
    chainId: 97,
    step: 3,
    counterparties: ["WBNB"],
    mocks: ["USDC", "USDT", "USDe"],
    note: "The only chain in the wave whose native asset is not ether, and the only one where a defaulted price feed is a solvency hole rather than a display bug: registering collateral against Crypto.ETH/USD here would value BNB at ether's price and let a borrower draw several times what their collateral is worth, so register-tokens.js needs NATIVE_FEED_SYMBOL=BNB and deploy-v3.js needs NATIVE_LABEL=BNB (baked permanently into position-NFT SVGs). Note also that canonical BSC USDC and USDT are 18 decimals while our own USDT.sol is 6 — the mocks here will not match the mainnet convention, which is fine because decimals are declared per entry and never inferred.",
  },
  {
    chainId: 46630,
    step: 4,
    counterparties: ["WETH"],
    mocks: ["USDC", "USDT", "USDe"],
    note: "An Arbitrum Orbit L2, so solc output applies rather than zksolc — confirmed on-chain 2026-08-22, ArbSys and ArbGasInfo both hold code. This entry used to say the chain had no ERC20 at all and that we would deploy our own wrapped native; both were wrong, and wrong for the same reason as Arc's original note — the chain was never asked. Robinhood publishes a canonical L2 Weth for testnet at 0x7943e237c7F95DA44E0301572D358911207852Fa (docs.robinhood.com/chain/protocol-contracts), it carries the deposit/withdraw surface our routers need, and it already holds 1,913.98 WETH, so a WETH9 of ours would only have split that liquidity. A mock USDC is still needed: the chain's canonical stablecoin is USDG and it exists on MAINNET ONLY — that address holds no code here, which the probe confirmed rather than assumed. The oracle is the open question on this chain, not the tokens. Robinhood's docs name Chainlink, and Chainlink publishes 57 feeds for Robinhood MAINNET (ETH/USD, BTC/USD, USDC/USD, USDT/USD, LINK/USD plus ~40 tokenized-equity feeds) and none for this testnet — its reference directory has a robinhood-mainnet file and no robinhood-testnet file. So the API3 dAPI in scripts/libraries/aggregator-feeds.js is a testnet stand-in for an absent feed, not the chain's oracle, and mainnet must read Chainlink instead.",
  },
  {
    chainId: 5042002,
    step: 5,
    counterparties: ["USDC", "WUSDC", "EURC", "cirBTC"],
    mocks: ["WETH", "USDT", "USDe"],
    note: "Native currency is USDC, so the wrapped native is wrapped USDC. This entry claimed the chain had no counterparties and that kfUSD's USDC_ADDRESS would therefore have to point at the wrapped native, with a WETH9 wrapper reporting Wrapped Ether while holding dollars — all three of which probing the chain on 2026-08-21 disproved. WUSDC at 0x911b4000 carries the WETH9 deposit/withdraw surface (verified 1:1 both ways) and reports its own name honestly, so no WETH9 is deployed here; the 6-decimal USDC at the 0x3600 predeploy is kfUSD's reserve. Do not call WUSDC canonical, which this note previously did: Circle's docs state there is no wrapped USDC on Arc, and it is third-party code — trusted here because its verified source is WETH9 verbatim with no owner, mint, pause or upgrade path, not because it is official. EURC and cirBTC are canonical, both Circle FiatTokenProxy deployments, both faucet-funded on the deployer on 2026-08-22. The thing to keep in mind is that 0x3600 is the ERC20 face of the native balance rather than a token beside it, so it must not be registered as a lending asset alongside NATIVE — that would put one balance in the collateral set twice, at two decimal scalings. Of the four counterparties only WUSDC is priceable for lending today: EURC needs FX.EUR/USD, which is not relayed here, and cirBTC is a custodial claim on bitcoin rather than bitcoin, so it is not given Crypto.BTC/USD's id. WETH stays a mock and is the point of the chain's lending market: Arc relays Crypto.ETH/USD at 4s, its freshest feed, while USDC/USD — its own gas token — measured 58,510s, so ether is the only asset here worth pricing tightly.",
  },
];

/** The plan for one chain, if it is in the wave. */
export function deployTarget(
  chainId: number | undefined,
): DeployTarget | undefined {
  if (chainId === undefined) return undefined;
  return TESTNET_WAVE.find((t) => t.chainId === chainId);
}

/**
 * Gaps between the plan and what the repository can actually deliver.
 *
 * Separate from auditRegistry because it checks a different class of thing:
 * auditRegistry validates recorded data, this validates intent against the
 * contracts and token lists that exist. Both return strings rather than
 * throwing so a test or a dev boot check can print them.
 */
export function auditDeployPlan(chains: ChainMeta[]): string[] {
  const problems: string[] = [];
  const known = new Map(chains.map((c) => [c.id, c]));

  for (const t of TESTNET_WAVE) {
    const meta = known.get(t.chainId);
    if (!meta) {
      problems.push(
        `TESTNET_WAVE targets chain ${t.chainId}, which is not in chains.ts`,
      );
      continue;
    }
    if (meta.network !== "testnet") {
      problems.push(
        `${meta.name} is in the testnet wave but chains.ts calls it ${meta.network}`,
      );
    }

    // A symbol listed as an existing counterparty must really be registered,
    // or the plan is asserting collateral that is not there.
    const registered = new Set(
      (TOKENS[t.chainId] ?? []).map((e) => e.symbol.toUpperCase()),
    );
    for (const symbol of t.counterparties) {
      if (!registered.has(symbol.toUpperCase())) {
        problems.push(
          `${meta.name}: plan lists ${symbol} as an existing counterparty, but TOKENS has no such entry`,
        );
      }
    }
    // And a mock must not duplicate one.
    for (const symbol of t.mocks) {
      if (registered.has(symbol.toUpperCase())) {
        problems.push(
          `${meta.name}: plan mocks ${symbol}, which TOKENS already registers as a real contract`,
        );
      }
    }
    if (t.counterparties.length === 0 && t.mocks.length === 0) {
      problems.push(
        `${meta.name}: no counterparty and no mock — nothing can be swapped or used as collateral here`,
      );
    }
  }

  for (const spec of OWN_TOKENS) {
    if (spec.noContract) {
      problems.push(`${spec.symbol}: ${spec.noContract}`);
    }
  }

  return problems;
}

/* ------------------------------------------------------------------ audit -- */

/**
 * Development check for the class of mistake this module exists to prevent.
 * Returns human-readable problems rather than throwing, so it can run in a
 * test or a dev-only boot check without taking the app down.
 */
export function auditRegistry(chains: ChainMeta[]): string[] {
  const problems: string[] = [];
  const known = new Set(chains.map((c) => c.id));

  for (const [idStr, list] of Object.entries(TOKENS)) {
    const chainId = Number(idStr);
    if (!known.has(chainId)) {
      problems.push(`TOKENS has chain ${chainId}, which is not in chains.ts`);
    }

    const seen = new Set<string>();
    for (const t of list) {
      if (t.chainId !== chainId) {
        problems.push(
          `${t.symbol} is filed under chain ${chainId} but declares ${t.chainId}`,
        );
      }
      if (!Number.isInteger(t.decimals) || t.decimals < 0 || t.decimals > 36) {
        problems.push(
          `${t.symbol} on ${chainId} has implausible decimals: ${t.decimals}`,
        );
      }
      const k = t.address.toLowerCase();
      if (seen.has(k)) {
        problems.push(
          `${t.symbol} on ${chainId} duplicates address ${t.address}`,
        );
      }
      seen.add(k);
    }
  }

  for (const idStr of Object.keys(DEPLOYMENTS)) {
    const chainId = Number(idStr);
    if (!known.has(chainId)) {
      problems.push(
        `DEPLOYMENTS has chain ${chainId}, which is not in chains.ts`,
      );
    }
    const c = DEPLOYMENTS[chainId];

    // Each of these is a failure that surfaces late (at first swap, first
    // price read) rather than at deploy time, which is exactly why they are
    // worth asserting statically.
    if (c.v3Router && !c.wrappedNative) {
      problems.push(
        `chain ${chainId}: v3Router deployed but no wrappedNative recorded`,
      );
    }
    if (c.v3Factory && !c.poolInitCodeHash) {
      problems.push(
        `chain ${chainId}: v3Factory deployed but no poolInitCodeHash — swaps will fail at the callback, not at deploy`,
      );
    }
    /* Only the Pyth backend has a Pyth contract to record. An
     * AggregatorPriceOracle reads Chainlink/API3 aggregators and takes no Pyth
     * address at all, so requiring one there reported a complete, verified
     * deployment as broken — which it did for Base Sepolia on 2026-08-21.
     *
     * An oracle with no recorded kind is still flagged: that combination means the
     * record predates oracleKind() or the probe failed, and then whether a missing
     * pythContract is correct is genuinely unknown. Unknown is worth a line here;
     * "correct on this backend" is not. */
    if (c.priceOracle && c.oracleKind !== "aggregator-v3" && !c.pythContract) {
      problems.push(
        c.oracleKind === "pyth"
          ? `chain ${chainId}: priceOracle is the Pyth backend but no pythContract recorded — PythPriceOracle takes it as a constructor argument, so the record is incomplete`
          : `chain ${chainId}: priceOracle deployed with no oracleKind and no pythContract — cannot tell whether the missing Pyth address is correct for this backend`,
      );
    }
    if (c.kafUSD && !c.kfUSD) {
      problems.push(
        `chain ${chainId}: kafUSD without kfUSD — the vault has nothing to wrap`,
      );
    }
    if ((c.kfUSD || c.kafUSD) && !c.yieldTreasury) {
      problems.push(
        `chain ${chainId}: stablecoin deployed without a yieldTreasury`,
      );
    }
    if (c.stKLD && !c.kldVault) {
      problems.push(`chain ${chainId}: stKLD without a kldVault to mint it`);
    }

    /* Every string field here is an address, with two deliberate exceptions that
     * are checked against their own shape rather than skipped: poolInitCodeHash is
     * a 32-byte hash, and oracleKind is an enum. Skipping either would mean a typo
     * in it produces no finding at all, which is worse than the wrong error. */
    for (const [field, value] of Object.entries(c)) {
      if (typeof value !== "string") continue;

      if (field === "oracleKind") {
        if (value !== "pyth" && value !== "aggregator-v3") {
          problems.push(
            `chain ${chainId}: oracleKind is "${value}", expected "pyth" or "aggregator-v3"`,
          );
        }
        continue;
      }

      const isHash = field === "poolInitCodeHash";
      const shape = isHash ? /^0x[0-9a-fA-F]{64}$/ : /^0x[0-9a-fA-F]{40}$/;
      if (!shape.test(value)) {
        problems.push(
          `chain ${chainId}: ${field} is not a well-formed ${isHash ? "hash" : "address"}: ${value}`,
        );
      }
    }

    /* The one disagreement `deployedTokens` can hide. It skips an address TOKENS
     * already declares, so the hand-written row wins — which is right for a name
     * and a logo and wrong for decimals, since the two tables would then be
     * naming the same contract differently and only one of them can match
     * decimals() on-chain. Sepolia, Base and Arc all have a USDC in both. */
    for (const spec of DEPLOYED_TOKENS) {
      const address = c[spec.field];
      if (!address) continue;
      const declared = getToken(chainId, address);
      if (!declared) continue;
      if (declared.decimals !== spec.decimals) {
        problems.push(
          `chain ${chainId}: ${spec.field} ${address} is ${declared.decimals} decimals in TOKENS but ${spec.decimals} in DEPLOYED_TOKENS`,
        );
      }
      if (declared.symbol.toUpperCase() !== spec.symbol.toUpperCase()) {
        problems.push(
          `chain ${chainId}: ${spec.field} ${address} is ${declared.symbol} in TOKENS but ${spec.symbol} in DEPLOYED_TOKENS`,
        );
      }
    }
  }

  return problems;
}

/** Chains the app will let a user trade on: registered, flagged, and deployed. */
export function tradableChains(chains: ChainMeta[]): ChainMeta[] {
  return chains.filter((c) => c.tradable && isDeployed(c.id));
}

/**
 * Chains with a token faucet recorded.
 *
 * Separate from `tradableChains` and deliberately not `&& isDeployed(c.id)`:
 * `faucet` is its own field, written by its own deploy record, so a chain can
 * carry one without a Diamond and vice versa. Anding in the Diamond would make
 * /faucet claim there is nowhere to claim on a chain that hands out tokens
 * perfectly well.
 *
 * Testnet only by construction — deploy-faucet.js refuses to run outside its own
 * chain allowlist, so nothing can put a mainnet address in this field.
 */
export function faucetChains(chains: ChainMeta[]): ChainMeta[] {
  return chains.filter((c) => Boolean(getContracts(c.id).faucet));
}
