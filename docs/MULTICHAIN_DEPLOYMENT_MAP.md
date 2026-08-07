# Multichain deployment map

What has to exist on each chain before the app can point at it, derived by
reading the contracts and deploy scripts rather than the previous docs (which
disagree with each other — see "Known drift" below).

Deploy targets are already wired in `smart-contract/hardhat.config.js`:

| network | chainId | compiler | notes |
|---|---|---|---|
| `abstractMainnet` | 2741 | **zksolc** | zkSync stack |
| `abstractTestnet` | 11124 | **zksolc** | zkSync stack |
| `ethereum` | 1 | solc | |
| `sepolia` | 11155111 | solc | |
| `base` | 8453 | solc | |
| `baseTestnet` | 84532 | solc | |
| `bsc` | 56 | solc | native BNB |
| `bscTestnet` | 97 | solc | native **tBNB** |
| `robinhood` | 4663 | solc | |
| `robinhoodTestnet` | 46630 | solc | |
| `arcTestnet` | 5042002 | solc | **native currency is USDC, 18 decimals** |

---

## 1. Deployed per chain (ours)

**Diamond core** — `Diamond`, `DiamondCutFacet`, `DiamondInit`, then cut in:
`DiamondLoupeFacet`, `OwnershipFacet`, `ProtocolFacet`, `AgentPermissionFacet`.

> `AgentPermissionFacet` is what bounds Luca on-chain (per-agent spend budgets
> and token allowlists that hold even if the frontend is bypassed). It was
> written but historically never cut in. It must be in the facet list or the
> agent has no on-chain limits at all.

**DEX V3** — `KaleidoSwapV3Factory`, `SwapRouter`, `NFTDescriptor`,
`NonfungibleTokenPositionDescriptor`, `NonfungiblePositionManager`, `Quoter`.
The last four take `WETH9` as a constructor argument, so the wrapped native
must exist first.

**Stablecoin** — `kfUSD`, `kafUSD`, `YieldTreasury` (+ mock `USDT`/`USDe` on
testnets).

**Staking** — `KLDVaultV2`, `StKLD`, and the `KLD` token itself.

**Oracle** — `PythPriceOracle`, which takes Pyth's own contract address as a
constructor argument.

**Testnet only** — `Faucet`.

## 2. External per chain (not ours)

| what | why it is per-chain |
|---|---|
| **Wrapped native** | WETH on Ethereum, WBNB on BNB, WPOL on Polygon; on Arc it wraps USDC. Not derivable from the native symbol. |
| **Pyth contract** | Different address on every chain. Note the price *feed ids* (`ETH_USD` etc. in `constant.sol`) are global and do **not** vary. |
| **USDC** | Canonical where it exists; a mock on testnets that lack one. |

## 3. Derived, must be verified per deployment

**`POOL_INIT_CODE_HASH`** — the highest-risk value in the whole deploy.

The V3 periphery derives pool addresses via CREATE2 from this constant instead
of asking the factory, and the swap callback authenticates `msg.sender`
against the derived address. The hash is a property of the *compiled bytecode*,
and Kaleido targets two compilers: **zksolc** for Abstract, **solc** for every
other chain. Identical source produces different bytecode under each.

A wrong value **does not fail at deploy**. The factory still creates pools. It
breaks at the first swap, against an address holding no code.

Run `smart-contract/scripts/verify-pool-init-hash.js` per deployment and record
the result in the registry.

## 4. Post-deploy configuration

Deployment alone leaves the protocol inert. Required wiring:

- `setPythOracle(oracle)`
- `addCollateralToken(token, priceFeedId)` per accepted collateral
- `addLoanableToken(token, priceFeedId)` per loanable asset
- `setSwapRouter(router)`
- `setFeeVault`, `setBPS`, `setLiquidityBps`
- YieldTreasury: grant `YIELD_SOURCE_ROLE` to kfUSD, register kfUSD as a yield
  source, add supported yield assets
- kfUSD: set YieldTreasury, enable auto-transfer, configure collaterals
- kafUSD: set YieldTreasury, configure supported assets, cooldown

---

## Hardcoded values that block a clean multichain deploy

Found by scanning `contracts/` for address literals. These are baked into
bytecode and cannot be changed post-deploy.

| file | value | status |
|---|---|---|
| `utils/constants/constant.sol` | `WETH`, `USDC`, `ETH_USD`, `WETH_USD`, `USDC_USD` | **Fixed — deleted.** All five were dead code: nothing outside the file referenced them. `ProtocolFacet` is the sole importer and uses only `NATIVE_TOKEN` plus the numeric constants. No behaviour change. |
| `Faucet.sol` | `USDC`, `KLD` | **Fixed — now constructor arguments.** Left mutable so the existing owner-only `setUSDCAddress` still works; only the initial values moved. No deploy script constructs the Faucet, so nothing broke. |
| `dex-v3/periphery/libraries/PoolAddress.sol` | `POOL_INIT_CODE_HASH` | **Open, and the highest risk.** Per-compiler, see §3. Cannot be fixed by editing a literal — it must be regenerated and verified per deployment. |
| `NonfungibleTokenPositionDescriptor.sol` | DAI/USDC/USDT/TBTC/WBTC | **Open, cosmetic.** Ethereum-mainnet addresses inherited from the Uniswap fork, used only for NFT token-ratio ordering. Wrong off-mainnet but harmless to funds. |

Note on the Faucet: `MIN_CLAIM_AMOUNT` is `100 * 10**6`, which assumes 6-decimal USDC. On a chain whose USDC mock uses different decimals this is wrong, but it is owner-settable via `setMinClaimAmount`, so it is a deploy-time configuration step rather than a code change.

`constant.sol` also defines `NATIVE_TOKEN = address(1)`, which is the lending
sentinel the frontend registry mirrors as `NATIVE_SENTINEL.lending`. The DEX
uses the separate `0xEeee…` convention. Both are correct for their own
contract; neither is "the" native address.

Dead code worth removing: `scripts/deploy.js` declares
`pythOracleMainnetAddress`, `pythPriceOracleAddress` and `kaleidovaultAddress`
inside the facet loop, but `DiamondInit.init()` takes no arguments and never
receives them. The oracle is wired post-deploy via `setPythOracle` instead.

## Known drift (why the registry exists)

`kfUSD` currently has **two different addresses** recorded in this repo:

- `0x913f3354942366809A05e89D288cCE60d87d7348` — `useStablecoin.ts`, `README.md`
- `0xf55C1Bc56618e9b47479b9B650A540Bc9b218ed1` — `DEPLOYMENT_ADDRESSES.md`

and the pre-rebuild README carried a third
(`0x7f815685a7D686Ced7AE695c01974425C4ee7790`). Which is live cannot be settled
from the repo alone.

The cause is structural, not carelessness: `scripts/README_DEPLOYMENT.md`
instructs updating addresses by hand across roughly ten files after each
deploy. That is guaranteed to drift.

`src/constants/registry.ts` replaces that with one chain-keyed source of truth.
It ships deliberately empty — the old Abstract addresses are being redeployed,
and carrying them forward would only relocate stale data. `auditRegistry()`
catches the late-failing mistakes (factory without an init code hash, oracle
without a Pyth address, malformed values) at test time rather than at first
swap.
