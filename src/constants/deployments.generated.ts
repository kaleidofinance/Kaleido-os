/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Written by `node --import tsx scripts/gen-registry.mjs` (npm run gen:registry),
 * which reads the `smart-contract/deployment-*.json` records that each deploy
 * script emits and folds them into one chain-keyed map. Run the generator after
 * every deploy; `registry.ts` spreads this into `DEPLOYMENTS`.
 *
 * Editing this file by hand is not just discouraged, it is silently undone: the
 * generator rewrites the whole file, so a manual correction survives exactly
 * until the next deploy. If an address here is wrong, fix the deployment record
 * (or add an explicit override in `registry.ts`'s `DEPLOYMENTS`, which spreads
 * this first for that purpose) — do not edit here.
 *
 * The trailing comment on each address names the record it came from, so a wrong
 * value can be traced to a deploy rather than guessed at.
 *
 * The type import is deliberately `import type`. `registry.ts` imports the value
 * below, so a value import in this direction would be a genuine runtime cycle;
 * `import type` is erased at compile time by tsc, tsx and webpack alike, which
 * leaves a single one-way runtime edge: registry.ts -> deployments.generated.ts.
 */
import type { ChainContracts, LendingRegistration } from "./registry";

export const GENERATED_DEPLOYMENTS: Record<number, ChainContracts> = {
  97: {
    diamond: "0x2E7dd52073d6653F610607dA9B947ba59B585bf8", // deployment-diamond-bscTestnet.json
    faucet: "0x5B8Ce8F0a44ED4F73CFD9b6E7DC1E15Ebe7F6e8e", // deployment-faucet-bscTestnet.json
    kafUSD: "0xf36ef8273ed6223Cd71B775929036505cCdF4976", // deployment-stablecoin-bscTestnet-1787453692948.json
    kfUSD: "0xCF59972d09Dbf9b37c1e3CDa55c47d0253038D76", // deployment-stablecoin-bscTestnet-1787453692948.json
    kld: "0x0d6a6F10adeCdc8a8b93aAc0Fa5210653de3511d", // deployment-kld-bscTestnet.json
    kldVault: "0x73B7341c15b12BcfA328733d753f5c30e67dBdce", // deployment-kld-bscTestnet.json
    oracleKind: "aggregator-v3", // deployment-oracle-bscTestnet.json
    poolInitCodeHash:
      "0xcc2ce4a3b82b174879c877ec55dd52475d3e31a30b7ba006307e278f22942938", // deployment-v3-bscTestnet-1787453320471.json
    priceOracle: "0xf9928C816b75Bb3EA081Fc0d1C0172E475957C48", // deployment-diamond-bscTestnet.json
    stKLD: "0x6D066143d21863c6Ef2975f213346d41CE3321c2", // deployment-kld-bscTestnet.json
    usdc: "0xf9e2A7Ac9143Ea0f25116009095D0B5700e2317F", // deployment-stablecoin-bscTestnet-1787453692948.json
    usde: "0xa2e103934877FFfbaEC8fF0eA45cde017AB845f6", // deployment-stablecoin-bscTestnet-1787453692948.json
    usdt: "0xeAeE746b5eDF09FA45B53F1E080b3eF9817cf6a2", // deployment-stablecoin-bscTestnet-1787453692948.json
    v2Factory: "0x2b882149eBfC79710E6E0c93661CE2718866705b", // deployment-dex-bscTestnet.json
    v2Router: "0x5900dDe9b1583e5Fc1783D41152235725cbC867d", // deployment-dex-bscTestnet.json
    v3Factory: "0x23E4236D1bB3f9944faa8d01b7e3e4a5521a2E1A", // deployment-v3-bscTestnet-1787453320471.json
    v3PositionDescriptor: "0xB939f0eEA9EF2F27985A3091D82c1621ef739c66", // deployment-v3-bscTestnet-1787453320471.json
    v3PositionManager: "0x248Cf3951Fdb6469B49ded78e310322CbA5651A1", // deployment-v3-bscTestnet-1787453320471.json
    v3Quoter: "0xAc1a10df0a742f107517f1944e0a37da74932c06", // deployment-v3-bscTestnet-1787453320471.json
    v3Router: "0x8A6BbC81d9678c92aa33A3eD0580389B82B18579", // deployment-v3-bscTestnet-1787453320471.json
    wrappedNative: "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd", // deployment-dex-bscTestnet.json
    yieldTreasury: "0x1fb928c085A9CBF2e5eC3Ca2Caea77c765E5882A", // deployment-stablecoin-bscTestnet-1787453692948.json
  },
  46630: {
    diamond: "0x3565904975AE169c0a48af085b9f786660875874", // deployment-diamond-robinhoodTestnet.json
    faucet: "0xD65927aF66B52E5a43C9C4Fb405D6F0823B65441", // deployment-faucet-robinhoodTestnet.json
    kafUSD: "0xdAFf6E1941CA376A5cA711EF2D6762BC545D5d89", // deployment-stablecoin-robinhoodTestnet-1787447030493.json
    kfUSD: "0x1e2BeA8a1958088b50eC9410F7870a2C254e43E4", // deployment-stablecoin-robinhoodTestnet-1787447030493.json
    kld: "0x6F57844d0C6DCB7eB906d21C99195a3FC446E81D", // deployment-kld-robinhoodTestnet.json
    kldVault: "0x46351a88bf64DFd0Cb8e88D6F88fd84d70ABe50e", // deployment-kld-robinhoodTestnet.json
    oracleKind: "aggregator-v3", // deployment-oracle-robinhoodTestnet.json
    poolInitCodeHash:
      "0xcc2ce4a3b82b174879c877ec55dd52475d3e31a30b7ba006307e278f22942938", // deployment-v3-robinhoodTestnet-1787450008885.json
    priceOracle: "0x7Ee07e9eb94B6b21589539a491E37804886AB201", // deployment-diamond-robinhoodTestnet.json
    stKLD: "0x99d6c3d9C2f00BD5da74C9A78035DD5790d17F50", // deployment-kld-robinhoodTestnet.json
    usdc: "0xcf00f8609deECcE0a84E2A7b9D11210ac495938B", // deployment-stablecoin-robinhoodTestnet-1787447030493.json
    usde: "0x5C95260eBD1dD21547528E73dc601d74B2793e0D", // deployment-stablecoin-robinhoodTestnet-1787447030493.json
    usdt: "0xcB8A20e5d3eD3940678Cc00E70F6CF307f5750Df", // deployment-stablecoin-robinhoodTestnet-1787447030493.json
    v2Factory: "0x0abf6Dc7f20A05E4c731FFa66c09B6688EfcCF93", // deployment-dex-robinhoodTestnet.json
    v2Router: "0x1632F2d350291e8ab9Dec9F14B518c6076fE3500", // deployment-dex-robinhoodTestnet.json
    v3Factory: "0x2987378eeB3E61bC8F9D2A80bFd0b1628771AC68", // deployment-v3-robinhoodTestnet-1787450008885.json
    v3PositionDescriptor: "0x6147279C2B7d84b178Ff9cfaAfD8482710454aAc", // deployment-v3-robinhoodTestnet-1787450008885.json
    v3PositionManager: "0x3a2A6cbD201f090878502b48c94fE5b418211DdC", // deployment-v3-robinhoodTestnet-1787450008885.json
    v3Quoter: "0xE0646438bd4744Cb2052fA21420794DC58A6b9a1", // deployment-v3-robinhoodTestnet-1787450008885.json
    v3Router: "0xD78c79129410883fD818498e18f0D4f1d3B5DF9f", // deployment-v3-robinhoodTestnet-1787450008885.json
    wrappedNative: "0x7943e237c7F95DA44E0301572D358911207852Fa", // deployment-dex-robinhoodTestnet.json
    yieldTreasury: "0x387d687B9574E93aCCEF1c272ce0D77381305eC3", // deployment-stablecoin-robinhoodTestnet-1787447030493.json
  },
  84532: {
    diamond: "0x1e2BeA8a1958088b50eC9410F7870a2C254e43E4", // deployment-diamond-baseTestnet.json
    faucet: "0x459fA03715EbE0B2914273720Ad687d4Ff3Ed888", // deployment-faucet-baseTestnet.json
    kafUSD: "0xb4b8fF43BC177C7cB1180c2f6010ab979A7Ee336", // deployment-stablecoin-baseTestnet.json
    kfUSD: "0xAE330a471E09733F66b0423352D61A2B6228dBD1", // deployment-stablecoin-baseTestnet.json
    kld: "0x6140Da1f66fCafa0b5197065ae91A00208F3Cd86", // deployment-kld-baseTestnet.json
    kldVault: "0x32E24AAdb0e346A3b334D29C9A334390aE022BE1", // deployment-kld-baseTestnet.json
    oracleKind: "aggregator-v3", // deployment-oracle-baseTestnet.json
    poolInitCodeHash:
      "0xcc2ce4a3b82b174879c877ec55dd52475d3e31a30b7ba006307e278f22942938", // deployment-v3-baseTestnet-1787327167156.json
    priceOracle: "0x1fb928c085A9CBF2e5eC3Ca2Caea77c765E5882A", // deployment-diamond-baseTestnet.json
    stKLD: "0xdFbF7276dd0ed0DaBb40EFD4Afc99f811484bD2c", // deployment-kld-baseTestnet.json
    usdc: "0x688Fc5D842F863d5DA4A0E5d553A7bE6524dAbB9", // deployment-stablecoin-baseTestnet.json
    usde: "0x42bea7B539Ce0eB7368534c94e522F092F6A2bc9", // deployment-stablecoin-baseTestnet.json
    usdt: "0x031d0127d14793b2B632F1eb25b57F66abD1dE0B", // deployment-stablecoin-baseTestnet.json
    v2Factory: "0x750b10d92bE67Ba86593169B5E8442CefEcBF708", // deployment-dex-baseTestnet.json
    v2Router: "0x629C8Af0230466558953ea305a6319E5e938d7f0", // deployment-dex-baseTestnet.json
    v3Factory: "0x76B9aF77B7e8323E30b6d933B0A0ea41bE466D9A", // deployment-v3-baseTestnet-1787327167156.json
    v3PositionDescriptor: "0x6A86c768C4cABca7ddaEbB6D47b21105fF22F323", // deployment-v3-baseTestnet-1787327167156.json
    v3PositionManager: "0xa6e6219937921102d95370F5fE2DD35a89b41278", // deployment-v3-baseTestnet-1787327167156.json
    v3Quoter: "0x36E323fFA93c724ae7EC5b28f4cbac9121dB4945", // deployment-v3-baseTestnet-1787327167156.json
    v3Router: "0xfEC12073E7b833508734052Cf72b53428d2e478b", // deployment-v3-baseTestnet-1787327167156.json
    wrappedNative: "0x4200000000000000000000000000000000000006", // deployment-dex-baseTestnet.json
    yieldTreasury: "0xC4d4B493039c3957A7fcF24d78dc169b44E08372", // deployment-stablecoin-baseTestnet.json
  },
  5042002: {
    diamond: "0x90a1620578CE419242F806e7387Db7e70c8cfa96", // deployment-diamond-arcTestnet.json
    faucet: "0x41D38A5b47887B98957cD2Bbe53528c2be0a3238", // deployment-faucet-arcTestnet.json
    kafUSD: "0x1fb928c085A9CBF2e5eC3Ca2Caea77c765E5882A", // deployment-stablecoin-arcTestnet-1787384790044.json
    kfUSD: "0xf36ef8273ed6223Cd71B775929036505cCdF4976", // deployment-stablecoin-arcTestnet-1787384790044.json
    kld: "0xC0f8D36ec1D96477F26228A629a31248c584f477", // deployment-kld-arcTestnet.json
    kldVault: "0x2987378eeB3E61bC8F9D2A80bFd0b1628771AC68", // deployment-kld-arcTestnet.json
    oracleKind: "pyth", // deployment-oracle-arcTestnet.json
    poolInitCodeHash:
      "0xcc2ce4a3b82b174879c877ec55dd52475d3e31a30b7ba006307e278f22942938", // deployment-v3-arcTestnet-1787358306379.json
    priceOracle: "0x0262aff2a0D8E56048e408D5fE875EA051dED65c", // deployment-diamond-arcTestnet.json
    pythContract: "0x2880aB155794e7179c9eE2e38200202908C17B43", // deployment-oracle-arcTestnet.json
    stKLD: "0xD78c79129410883fD818498e18f0D4f1d3B5DF9f", // deployment-kld-arcTestnet.json
    usdc: "0x3600000000000000000000000000000000000000", // deployment-stablecoin-arcTestnet-1787384790044.json
    usde: "0xCF59972d09Dbf9b37c1e3CDa55c47d0253038D76", // deployment-stablecoin-arcTestnet-1787384790044.json
    usdt: "0xa2e103934877FFfbaEC8fF0eA45cde017AB845f6", // deployment-stablecoin-arcTestnet-1787384790044.json
    v2Factory: "0x5900dDe9b1583e5Fc1783D41152235725cbC867d", // deployment-dex-arcTestnet.json
    v2Router: "0xeAeE746b5eDF09FA45B53F1E080b3eF9817cf6a2", // deployment-dex-arcTestnet.json
    v3Factory: "0x8A6BbC81d9678c92aa33A3eD0580389B82B18579", // deployment-v3-arcTestnet-1787358306379.json
    v3PositionDescriptor: "0x248Cf3951Fdb6469B49ded78e310322CbA5651A1", // deployment-v3-arcTestnet-1787358306379.json
    v3PositionManager: "0xAc1a10df0a742f107517f1944e0a37da74932c06", // deployment-v3-arcTestnet-1787358306379.json
    v3Quoter: "0x2b882149eBfC79710E6E0c93661CE2718866705b", // deployment-v3-arcTestnet-1787358306379.json
    v3Router: "0x65149395E67867Db4Ef74b4151Ca0A2c1C014c80", // deployment-v3-arcTestnet-1787358306379.json
    wrappedNative: "0x911b4000D3422F482F4062a913885f7b035382Df", // deployment-dex-arcTestnet.json
    yieldTreasury: "0xcB8A20e5d3eD3940678Cc00E70F6CF307f5750Df", // deployment-stablecoin-arcTestnet-1787384790044.json
  },
  11155111: {
    diamond: "0x32a9971381C969d15205AC9e509C204D31341080", // deployment-diamond-sepolia.json
    faucet: "0x94553403B87430c9263b1bE0f0DcEC478E7a7CbB", // deployment-faucet-sepolia.json
    kafUSD: "0xb56439976066BBb2a2084916c5fd53403D87F289", // deployment-stablecoin-sepolia.json
    kfUSD: "0x6A6D4dA719b5275C1a927DBc2177614f61a49289", // deployment-stablecoin-sepolia.json
    kld: "0x79C14246120369A98c4226a01158645a7A501F35", // deployment-kld-sepolia.json
    kldVault: "0x3305F04C7DDb32C23F250620CBa50C8DE61f67B5", // deployment-kld-sepolia.json
    oracleKind: "aggregator-v3", // deployment-oracle-sepolia.json
    poolInitCodeHash:
      "0xcc2ce4a3b82b174879c877ec55dd52475d3e31a30b7ba006307e278f22942938", // deployment-v3-sepolia-1787339244721.json
    priceOracle: "0x126C64a2d48F40EeAEcD534387902f5da74c9dbb", // deployment-diamond-sepolia.json
    stKLD: "0xb13744e75aA50B6204b445673341A1fE03b02dFd", // deployment-kld-sepolia.json
    usdc: "0x0B485b9E120464F3DE5DD7C3AF96f7aF3f8E9F70", // deployment-stablecoin-sepolia.json
    usde: "0xFD58F8B21DDaBF004f87AE9023c7cfD8700BA58b", // deployment-stablecoin-sepolia.json
    usdt: "0x5deA1292ceDd7Ca24aCe12DEc727f00A6865BC55", // deployment-stablecoin-sepolia.json
    v2Factory: "0xc6e96bcb53bf9f5235Df8c4018717DEA3d9d7fb6", // deployment-dex-sepolia.json
    v2Router: "0xe049B8d1E31510BE156B9230169aC2199989D93A", // deployment-dex-sepolia.json
    v3Factory: "0x57440671f8F67A56C4D56665553Bf7d8c2C73794", // deployment-v3-sepolia-1787339244721.json
    v3PositionDescriptor: "0xc376Add659cbE5a32421Ac3B932Ea51740222B8d", // deployment-v3-sepolia-1787339244721.json
    v3PositionManager: "0xCda76853D991184EB273bC493e43f92Caaa31E77", // deployment-v3-sepolia-1787339244721.json
    v3Quoter: "0x6653B81FEE8CECf0AB5ce2863A63D9D3C28C1DE7", // deployment-v3-sepolia-1787339244721.json
    v3Router: "0x482555B9232A5BEE6034cdfa91dBcF4F19633c59", // deployment-v3-sepolia-1787339244721.json
    wrappedNative: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14", // deployment-dex-sepolia.json
    yieldTreasury: "0x2488216dF30680f96078E3B303D6Aa0391f3f79F", // deployment-stablecoin-sepolia.json
  },
};

/**
 * What each chain's lending market accepts, read back off the diamond.
 *
 * From the `onChain` block of `deployment-tokens-<network>.json`, which
 * register-tokens.js writes from `getAllCollateralToken()` and
 * `getLoanableAssets()` after the registration transactions confirmed. So these
 * are the facet's own answers, not the operator's intent.
 *
 * This is NOT the list above with different names, and treating it as one is the
 * bug it exists to prevent: what the app offers comes from address existence,
 * what the market accepts comes from a per-chain owner transaction gated on a
 * usable price feed, and the two differ on every deployed chain. A chain absent
 * from this map is "we have not recorded what it accepts", which
 * `registeredLendingAssets` treats as a refusal rather than as an empty market.
 *
 * A SNAPSHOT, and the one thing to keep in mind about it: registering a token
 * on-chain does not update this file. `register-tokens.js` then
 * `npm run gen:registry` does. The borrow UI reads the same two getters live
 * (src/lib/lending/assets.ts), so the UI self-corrects and this does not — which
 * is why the synchronous paths that cannot make an RPC call (the intent builder
 * and the plan auditor) are the only intended consumers.
 */
export const GENERATED_LENDING_REGISTRATION: Record<
  number,
  LendingRegistration
> = {
  97: {
    // deployment-tokens-bscTestnet.json
    collateral: [
      "0x0000000000000000000000000000000000000001",
      "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd",
      "0xf9e2A7Ac9143Ea0f25116009095D0B5700e2317F",
      "0xeAeE746b5eDF09FA45B53F1E080b3eF9817cf6a2",
    ],
    loanable: [
      "0xf9e2A7Ac9143Ea0f25116009095D0B5700e2317F",
      "0xeAeE746b5eDF09FA45B53F1E080b3eF9817cf6a2",
      "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd",
    ],
  },
  46630: {
    // deployment-tokens-robinhoodTestnet.json
    collateral: [
      "0x0000000000000000000000000000000000000001",
      "0x7943e237c7F95DA44E0301572D358911207852Fa",
      "0xcf00f8609deECcE0a84E2A7b9D11210ac495938B",
    ],
    loanable: [
      "0x7943e237c7F95DA44E0301572D358911207852Fa",
      "0xcf00f8609deECcE0a84E2A7b9D11210ac495938B",
    ],
  },
  84532: {
    // deployment-tokens-baseTestnet.json
    collateral: [
      "0x0000000000000000000000000000000000000001",
      "0x4200000000000000000000000000000000000006",
      "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "0x031d0127d14793b2B632F1eb25b57F66abD1dE0B",
      "0x688Fc5D842F863d5DA4A0E5d553A7bE6524dAbB9",
    ],
    loanable: [
      "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "0x031d0127d14793b2B632F1eb25b57F66abD1dE0B",
      "0x4200000000000000000000000000000000000006",
      "0x688Fc5D842F863d5DA4A0E5d553A7bE6524dAbB9",
    ],
  },
  5042002: {
    // deployment-tokens-arcTestnet.json
    collateral: [
      "0x0000000000000000000000000000000000000001",
      "0x911b4000D3422F482F4062a913885f7b035382Df",
    ],
    loanable: ["0x911b4000D3422F482F4062a913885f7b035382Df"],
  },
  11155111: {
    // deployment-tokens-sepolia.json
    collateral: [
      "0x0000000000000000000000000000000000000001",
      "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
      "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
      "0x0B485b9E120464F3DE5DD7C3AF96f7aF3f8E9F70",
    ],
    loanable: [
      "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
      "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
      "0x0B485b9E120464F3DE5DD7C3AF96f7aF3f8E9F70",
    ],
  },
};

/**
 * Every V3 pool the deployer opened, per chain, from the
 * `deployment-pool-<network>-<pair>-<fee>.json` that seed-v3-pool.js writes when
 * it creates one and mints the first liquidity into it.
 *
 * This is what the verified tick on a pool row reads, so it is worth being exact
 * about the claim. The record proves the protocol's own deployer opened this pool
 * and funded it at a price taken from the diamond's oracle. It does NOT claim the
 * pool is still ours, still deep, or still correctly priced: any address can add
 * liquidity to a V3 pool, and a seeded pool's price moves with whoever trades it.
 * Sepolia's KLD/USDC has drifted to roughly 2.2x its seed through ordinary
 * trading and is no less ours for it.
 *
 * The distinction it does draw is the one a reader cannot make by looking. A pool
 * at the same pair and the same tier, opened by a stranger at a price they chose,
 * is otherwise identical in the table. That is not hypothetical either: on
 * Robinhood a third party had minted KLD at $9-$11 against our $0.03.
 *
 * Absence means "no record", never "not ours" -- an unseeded chain and an
 * unrecorded seed look the same here. So this list only ever ADDS a tick; nothing
 * uses it to mark a pool as suspect.
 */
export const GENERATED_SEEDED_POOLS: Record<number, string[]> = {
  97: [
    "0x75159b4Da8C5FF7C1Bc2B53106300a50171c2169",
    "0x82A907fe860886d01FF8E13D74af2b990829B832",
    "0xE52C6AaBe6B6C0E2cfA8A589ad7182FD65fBe04d",
  ],
  46630: [
    "0x3d5043fa8353b5A636eeFdeC6Ac26B488c99E518",
    "0x4741473a0C0E15F1dA1B9E9C972fe9E90316D290",
    "0xEDACd83d9CE55E81493F15C1E099BefBD92B5A0d",
    "0xF00783C4B0687a805CB25047aa2f1C969E068c97",
    "0xb2B96857437176674Bc3Bb276A5E25602cb668e6",
  ],
  84532: [
    "0x32C3E8E8F6620d0D6716F656aa7C92BE87B7E180",
    "0x7306100bE0464aF15E3552dC38C08b499C3C0E99",
    "0x814C64a304e2A837f2A76589587Fdc9C527C5C28",
    "0xD03FC526BC9Cbf6f4ed0A4996347EBFb1ffca22C",
    "0xD888671C7525D592c0f7aa5f31Ede5B7C7eB8F5B",
  ],
  11155111: [
    "0x04EfB41F6aCeCB6B1eB46be75A929cD5b42dC1e4",
    "0x0C71361DAd26dD63ba0D10Bc72928FDCB38e673b",
    "0x6de82ffB6D2180F77D284F287F53199547E87428",
    "0x8c832F0Ef9F7d2EF89769D1e9bd97cCC4a2218eB",
    "0xbA88dF1A2353e2d0141F0756c4e91D62EF0BF20F",
    "0xf95b8155ad0Dda2f64fD73B9771F59FDfd0df7E4",
  ],
};

/**
 * What the generator last read, for debugging a wrong or missing address.
 */
export const GENERATED_META: {
  generatedAt: string | null;
  sources: string[];
} = {
  generatedAt: "2026-09-04T18:40:57.536Z",
  sources: [
    "deployment-dex-arcTestnet.json",
    "deployment-dex-baseTestnet.json",
    "deployment-dex-bscTestnet.json",
    "deployment-dex-robinhoodTestnet.json",
    "deployment-dex-sepolia.json",
    "deployment-diamond-arcTestnet.json",
    "deployment-diamond-baseTestnet.json",
    "deployment-diamond-bscTestnet.json",
    "deployment-diamond-robinhoodTestnet.json",
    "deployment-diamond-sepolia.json",
    "deployment-faucet-arcTestnet.json",
    "deployment-faucet-baseTestnet.json",
    "deployment-faucet-bscTestnet.json",
    "deployment-faucet-robinhoodTestnet.json",
    "deployment-faucet-sepolia.json",
    "deployment-kld-arcTestnet.json",
    "deployment-kld-baseTestnet.json",
    "deployment-kld-bscTestnet.json",
    "deployment-kld-robinhoodTestnet.json",
    "deployment-kld-sepolia.json",
    "deployment-oracle-arcTestnet.json",
    "deployment-oracle-baseTestnet.json",
    "deployment-oracle-bscTestnet.json",
    "deployment-oracle-robinhoodTestnet.json",
    "deployment-oracle-sepolia.json",
    "deployment-pool-baseTestnet-KLD-USDC-3000.json",
    "deployment-pool-baseTestnet-USDT-USDC-3000.json",
    "deployment-pool-baseTestnet-USDT-WETH-500.json",
    "deployment-pool-baseTestnet-USDe-USDC-3000.json",
    "deployment-pool-baseTestnet-WETH-USDC-500.json",
    "deployment-pool-bscTestnet-KLD-USDC-500.json",
    "deployment-pool-bscTestnet-USDT-USDC-3000.json",
    "deployment-pool-bscTestnet-USDe-USDC-3000.json",
    "deployment-pool-robinhoodTestnet-KLD-USDC-3000.json",
    "deployment-pool-robinhoodTestnet-USDT-USDC-3000.json",
    "deployment-pool-robinhoodTestnet-USDe-USDC-3000.json",
    "deployment-pool-robinhoodTestnet-WETH-USDC-500.json",
    "deployment-pool-robinhoodTestnet-WETH-USDT-500.json",
    "deployment-pool-sepolia-USDC-KLD-3000.json",
    "deployment-pool-sepolia-USDC-USDT-3000.json",
    "deployment-pool-sepolia-USDC-USDe-3000.json",
    "deployment-pool-sepolia-USDC-WETH-500.json",
    "deployment-pool-sepolia-USDT-USDe-500.json",
    "deployment-pool-sepolia-USDT-WETH-500.json",
    "deployment-stablecoin-arcTestnet-1787384790044.json",
    "deployment-stablecoin-baseTestnet.json",
    "deployment-stablecoin-bscTestnet-1787453692948.json",
    "deployment-stablecoin-robinhoodTestnet-1787447030493.json",
    "deployment-stablecoin-sepolia.json",
    "deployment-tokens-arcTestnet.json",
    "deployment-tokens-baseTestnet.json",
    "deployment-tokens-bscTestnet.json",
    "deployment-tokens-robinhoodTestnet.json",
    "deployment-tokens-sepolia.json",
    "deployment-v3-arcTestnet-1787358306379.json",
    "deployment-v3-baseTestnet-1787327167156.json",
    "deployment-v3-bscTestnet-1787453320471.json",
    "deployment-v3-robinhoodTestnet-1787450008885.json",
    "deployment-v3-sepolia-1787339244721.json",
  ],
};
