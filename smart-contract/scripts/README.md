# Deployment scripts

This directory held 93 files. 81 were deleted (plus two stray probes removed from
the `smart-contract/` root: `check-pairs.js` and `selector_check.js`). What went
was one-off probes written against a single Abstract testnet deployment that no
longer exists, with its addresses baked in as literals. They could not be run —
they would have queried dead contracts and reported confident nonsense — and they
buried the handful of scripts that matter.

Deleted with them: all of `scripts/abi/`, roughly 6,000 lines of ABI JSON
referenced only by those probes. The frontend has its own copies under
`src/abi/` and never read these.

What survives is the deploy path plus the two checks that catch failures which
do not surface until after money is at risk. Four scripts have since been added
for this deployment wave, because the path had holes that made it unrunnable:
`deploy-oracle.js` (nothing deployed the oracle `deploy.js` requires),
`register-tokens.js` (nothing registered the lending assets),
`libraries/pyth-feeds.js` (no Pyth feed-id table existed anywhere in the repo)
and `probe-pyth.js` (read-only, to find out whether a chain has Pyth at all
before committing to it).

## Nothing is deployed yet

`DEPLOYMENTS` in `src/constants/registry.ts` is empty for every chain, and
`isDeployed()` stays false until `diamond` is set for one.

Addresses get there by generator, not by hand. Every script below writes a
`deployment-<component>-<network>.json` when it finishes; `npm run gen:registry`
from the repo root reads all of them and rewrites
`src/constants/deployments.generated.ts`, which `registry.ts` spreads into
`DEPLOYMENTS`. Run it after each deploy — until you do, the app still resolves
the previous run's addresses.

Do not transcribe addresses into the registry by hand. There are around fifteen
per chain across five chains, and a mistyped one does not throw: it is still
twenty well-formed bytes, `isDeployed()` still returns true, the page still
renders, and the first symptom is a revert — or a transaction that succeeds
against whatever else lives at that address. The generator also refuses to write
a chain whose `v3Factory` has no `poolInitCodeHash`, and errors rather than
guessing when two records disagree about a shared address such as the wrapped
native.

The component in the filename matters. It used to be `deployment-<network>.json`
with no component, which meant two scripts writing the same file and whichever
ran second silently discarded the other's addresses.

## Order

```bash
cd smart-contract
npm install              # node_modules here holds one package; nothing has been built
npx hardhat compile
```

Then, before deploying anywhere:

```bash
npx hardhat run scripts/check-contract-sizes.js
```

EIP-170 caps deployed bytecode at 24,576 bytes on every EVM chain. Abstract
does not enforce it, and `allowUnlimitedContractSize` hides it locally — so a
facet can deploy fine on Abstract and be undeployable on Base. A facet over the
limit should be split, not squeezed.

### Oracle first

```bash
npx hardhat run scripts/deploy-oracle.js --network <net>
```

`deploy.js` requires `PYTH_PRICE_ORACLE` and refuses to start without it, so this
runs first. No env var is needed for a routine deploy — the script picks the
backend and the addresses from `scripts/libraries/aggregator-feeds.js`.

**Robinhood Testnet has one more step, before this one.** It reads feeds we publish
ourselves, so its aggregator addresses do not exist until we deploy them:

```bash
npx hardhat run scripts/deploy-pushable-feeds.js --network robinhoodTestnet
```

deploys a `PushablePriceFeed` per feed and seeds it from Hermes, writing
`pricefeeds-robinhoodTestnet.json`. `deploy-oracle.js` then resolves those addresses
(via `resolveSelfHosted`) and registers them — run it second. Every other chain
reads Chainlink or Pyth and skips straight to `deploy-oracle.js`. See the Robinhood
caveat above for why we publish our own price there.

**Two backends, one seam.** The diamond asks its oracle for exactly one thing,
`getPrice(bytes32) -> PythStructs.Price`, and `_priceScaled18` already handles an
arbitrary `expo`. That makes the backend a deployment-time choice rather than a
protocol change:

| Chain | Backend | Reads |
| --- | --- | --- |
| Base Sepolia, Arc Testnet | `pyth` | Pyth — but nothing relays it on Arc; see `push-prices.js` |
| Sepolia, BSC Testnet | `aggregator-v3` | Chainlink |
| Robinhood Testnet | `aggregator-v3` | a `PushablePriceFeed` we publish ourselves — no third party publishes one |

Robinhood is the row that needs a caveat. Its own docs name **Chainlink** and name
no one else, and that is correct for **mainnet**: Chainlink publishes 57 feeds for
`robinhood-mainnet` — ETH/USD `0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9`,
BTC/USD `0xa2c5184bF03d373Dc9dE4876eb4Bce595B460251`, USDC/USD, USDT/USD, LINK/USD,
all 8 decimals on an 86400s heartbeat, plus ~40 tokenized-equity feeds. On **chain
46630** nobody publishes anything, measured 2026-08-22: Chainlink's reference
directory has a `feeds-robinhood-mainnet.json` and no `feeds-robinhood-testnet.json`;
Pyth has no deployment there; and API3 has an ETH/USD reader proxy deployed but
reverts `latestRoundData()` until a plan is bought, which then expires in 7 days on
a 24h-only heartbeat. So we publish our own: `deploy-pushable-feeds.js` deploys a
`PushablePriceFeed` per feed, seeds it from Hermes, and `push-aggregator.js` refreshes
it on a schedule. The trade this makes — the price becomes ours, one key writes it,
a stopped keeper is an outage only we can fix — is stated in full in
`contracts/utils/oracle/PushablePriceFeed.sol`. A **mainnet** deploy repoints
`AggregatorPriceOracle` at the Chainlink proxies above instead, which are already 8
decimals, so nothing about the rescale path changes.

Pyth is stale or absent on the latter three, so `AggregatorPriceOracle` normalises
a Chainlink or API3 answer to `expo = -8` — the same shape a Pyth USD feed
reports. Ask a deployed oracle which one it is with `oracleKind()`; both answer it,
so detection is positive rather than inferred from a revert. Override the choice
with `ORACLE_BACKEND=pyth|aggregator-v3`, a single feed with
`AGGREGATOR_<SYMBOL>=0x...`, and its bound with `FEED_MAX_AGE_<SYMBOL>=<seconds>`.

On the Pyth path, `PythPriceOracle` takes Pyth's own contract as a **constructor
argument and stores it `immutable`** — a wrong `PYTH_CONTRACT` cannot be
corrected, only redeployed. The script probes `getValidTimePeriod()` on it rather
than only checking for code, because a `getCode` hit proves a contract exists and
never which contract: `0x2880aB…7B43` is Pyth on Arc and 1,067 bytes of something
unrelated on Robinhood.

Price _feed ids_ are global and identical on every chain, and stay the protocol's
only name for an asset on both backends. On an aggregator chain the id is a
**label** mapped to an aggregator address, not a data source — Chainlink and API3
publish no global identifier, so the id is cross-checked against the aggregator's
own `description()` string. That is self-reported: evidence, not proof. There is no
Hermes equivalent.

`deploy-oracle.js` deliberately does **not** install per-feed staleness bounds.
`setFeedMaxAge` lives on the diamond, which does not exist yet at this point in the
order, so `register-tokens.js` installs them. The oracle script prints the bounds
it expects so the two can be reconciled.

### V3 DEX

```bash
WRAPPED_NATIVE=0x... NATIVE_LABEL=ETH \
  npx hardhat run scripts/deploy-v3.js --network baseTestnet

npx hardhat run scripts/verify-pool-init-hash.js --network baseTestnet
```

`WRAPPED_NATIVE` is required, with no default. It is not derivable from the
chain's native symbol: WETH on Ethereum, WBNB on BNB, WPOL on Polygon, and on
Arc it wraps USDC rather than ether. The script also rejects an address holding
no code on the target chain, which is what a value copied from another chain
looks like.

`NATIVE_LABEL` is baked into every position NFT's rendered SVG through the
descriptor's immutable `nativeCurrencyLabelBytes`, so it cannot be corrected
without redeploying the descriptor and it renders on already-minted positions.
`BNB` on BSC Testnet, `USDC` on Arc Testnet, `ETH` elsewhere.

`verify-pool-init-hash.js` is the one that will bite you. `PoolAddress.sol`
hardcodes the keccak of the pool's creation bytecode, and the periphery derives
pool addresses from it via CREATE2 rather than asking the factory. The hash is a
property of the _compiled bytecode_, so it changes with the compiler and with
optimizer settings — see the `0.7.6` entry in `hardhat.config.js`. A wrong value
does not fail at deploy. The factory still creates pools. It fails at the first
swap, when the callback authenticates `msg.sender` against a derived address
that holds no code.

On Abstract this check refuses to give a pass at all: zkSync's CREATE2
derivation differs from the EVM `0xff` scheme, so `computeAddress` is
structurally wrong there no matter which hash is stored, and pools must be
resolved through `factory.getPool()`.

### Diamond, V2 DEX, stablecoin, staking

```bash
npx hardhat run scripts/deploy.js            --network <net>   # EIP-2535 Diamond + facets
npx hardhat run scripts/deploy-dex.js        --network <net>   # V2 factory + router
npx hardhat run scripts/deploy-stablecoin.js --network <net>   # kfUSD / kafUSD / YieldTreasury
npx hardhat run scripts/deploy-masterchef.js --network <net>   # farm emissions
npx hardhat run scripts/deploy-kld.js        --network <net>   # KLD + KLDVaultV2 + stKLD, wired
```

`deploy-kld.js` replaced `scripts/KLDVault/deployment/` (`KLDVault.js`,
`STkLD.js`, `uupsKLDVault.js`), which is deleted rather than kept for reference.
All three were unrunnable, not merely stale: two called
`getContractFactory("KLDVault")` for a contract that does not exist — the
contract is `KLDVaultV2` — the third went through `hre.zkUpgrades`, which only
loads on the retired Abstract network, and `STkLD.js` passed two dead Abstract
literals as the vault and token it wires to. A script that cannot run is worse
than none: it reads as a supported path.

The replacement is one script for all three contracts because their wiring order
is load-bearing (KLD → vault → stKLD → `setStKLD` → `setSupport`), and it is
resumable: every address is written to `deployment-kld-<net>.json` as
`status: "partial"` the moment it deploys, each wiring step re-reads its own
precondition before sending, and a rerun adopts what is already live after
checking its identity on chain. `gen-registry.mjs` skips `partial` records, so a
half-wired set cannot reach the app.

`genSelectors.js` and `libraries/diamond.js` compute the facet selector arrays
that `deploy.js` cuts into the Diamond.

### Then register the lending assets, or nothing is usable

```bash
COLLATERAL_TOKENS="NATIVE,WETH=0x...,USDC=0x..." \
LOANABLE_TOKENS="USDC=0x...,USDT=0x..." \
  npx hardhat run scripts/register-tokens.js --network <net>
```

`deploy.js` prints that these calls are still required and then leaves them
undone. Until `register-tokens.js` runs, the lending market has no assets:
`_isTokenAllowed` is `s_priceFeeds[token] != 0`, so every deposit, borrow and
health-factor read reverts with `Protocol__TokenNotAllowed`.

Five things it gets right that are easy to get wrong by hand:

- **Collateral before loanable.** Both calls write `s_priceFeeds`, but only
  `addCollateralToken` checks it first — so registering a token as loanable
  first bars it from the collateral set permanently. The script orders the whole
  plan before sending anything.
- **`addLoanableToken` has no duplicate guard.** It pushes onto
  `s_loanableToken` unconditionally, and nothing anywhere removes from that
  array — `removeCollateralTokens` clears the feed and `s_collateralToken` only.
  A re-run without the pre-flight check would grow the list forever.
- **Native value needs its own registration.** `depositCollateral(address(1), …)`
  runs the same allowlist check, so the `NATIVE` sentinel takes a feed entry of
  its own or native deposits revert while ERC20 deposits work.
- **A wrong-but-real feed id never reverts.** It silently misprices the asset
  forever, so each id is checked twice: on-chain to prove it resolves on this
  chain, and against Hermes to prove it names the right asset. Hermes is consulted
  on aggregator chains too — the id is only a label there, but it is the label the
  registry and the frontend key on across all five chains, so a chain that stored
  the USDC/USD id for ETH would price correctly locally and be wrong everywhere the
  id is compared. Set `NATIVE_FEED_SYMBOL=BNB` on BSC — defaulting to ETH there
  would price BNB off ether and overvalue every borrower's collateral
  several-fold.
- **Per-feed staleness bounds, installed after registration.** One global bound
  cannot describe the publisher cadences the protocol has to read: Sepolia measured
  Chainlink ETH/USD at 1,594s old and USDC/USD at 13,438s **in the same block**, an
  8x spread on one chain, against a global bound of 300s. Loose enough for the
  stablecoin means accepting a four-hour-old ETH price to liquidate against; tight
  enough for ETH means the stablecoin never prices and `/borrow` is dead on that
  chain. So the script calls `setFeedMaxAge(feedId, seconds)` per feed, capped at
  `MAX_FEED_PRICE_AGE` (90000s / 25h — API3's only heartbeat option is 24 hours).
  It deduplicates by feed id, because ETH and WETH share one and the bound is
  stored per id; refuses if two symbols sharing an id ask for different bounds; and
  reads each value back rather than trusting a status-1 receipt, since a selector
  that was never cut in reaches the diamond's fallback, which does not always
  revert. **Only defensible on a pegged asset** — using it to silence a reverting
  volatile feed converts a refusal to price into a wrong price, which is strictly
  worse. Every bound in `aggregator-feeds.js` carries a `maxAgeBasis` string
  recording its derivation.

### Finally, fold the addresses into the app

```bash
cd .. && npm run gen:registry
```

## Addresses still hardcoded in the kept scripts

These survived because the deploy logic is sound, but each carries a literal
from the dead deployment and will deploy against a non-contract if run as-is.
Parameterise as you reach them:

| Script                         | Literal                       |
| ------------------------------ | ----------------------------- |
| `deploy-masterchef.js`         | `KLD_ADDRESS`                 |

MasterChef is the last one. It is on the staking path, which used to be out of
scope for a reason that no longer holds — there was no KLD ERC20 in `contracts/`
at all, only consumers of one. `contracts/Token/KLD.sol` exists now and
`deploy-kld.js` has recorded it on all five testnets, so the fix is mechanical:
read `kld` out of `deployment-kld-<net>.json` instead of the literal. Nothing in
this wave deploys the farm, so it is still unrun.

Four are already fixed, all in the same shape: read the address from the
environment and refuse to start without it.

- `deploy.js` — `KALEIDO_FEE_VAULT` and `PYTH_PRICE_ORACLE`, both required.
  `PYTH_PRICE_ORACLE` is also `getCode`-checked, because a wrong-chain oracle
  address cuts and configures the diamond cleanly: `setPythOracle` stores
  whatever it is given and the read-back confirms only that the value stuck, not
  that anything lives there. The first symptom would be `_priceScaled18`
  reverting on a call to a codeless address, taking deposit, borrow, health
  factor and liquidation offline together — the state the docstring on
  `readProtocolConfig` calls "the collateral would have been locked with no path
  out". `SWAP_ROUTER` is optional and checked only when set — and it is inert
  either way: it writes `AppStorage.swapRouter`, which no facet reads and no
  getter exposes, so `setSwapRouter` configures nothing today. Swaps run on the
  standalone V3 periphery, resolved per chain from the deployment registry.
  Leaving it unset is not an incomplete deployment, whatever the older warning
  text implied.
  `KALEIDO_FEE_VAULT` is deliberately **not** code-checked: it should be a
  multisig, but an EOA there is a discouraged configuration rather than a broken
  one.
- `deploy-oracle.js` — nothing required. The backend and every address come from
  `libraries/aggregator-feeds.js`. On the Pyth path it resolves `PYTH_CONTRACT` from
  env or that table, `getCode`-checks it, and then probes `getValidTimePeriod()` on
  it — because code is not identity, and `0x2880aB…7B43` is Pyth on Arc but
  something unrelated on Robinhood. Immutable once deployed. On the aggregator path
  it verifies every aggregator's `decimals()` and `description()` **before** any gas
  is spent, refuses to deploy with zero feeds, and registers them in one atomic
  `setFeeds`. Optional overrides: `ORACLE_BACKEND`, `AGGREGATOR_<SYMBOL>`,
  `FEED_MAX_AGE_<SYMBOL>`.
- `deploy-v3.js` and `deploy-dex.js` — `WRAPPED_NATIVE`, plus a `getCode` check.
  `deploy-dex.js` used to hardcode `0x618B…Ce33`, commented "Old WETH" in the
  source; both scripts now read the same variable, and the generator errors if
  the two deploys end up recording different wrapped natives.
- `deploy-stablecoin.js` — `USDC_ADDRESS`, plus a `getCode` check and a
  `decimals()` read. The default it used to carry was the worst of the set: the
  address feeds three privileged writes that accept any non-zero value, so a
  wrong one produced a deploy that completed cleanly with an unrelated token in
  kfUSD's collateral list.

Every environment variable any script in this directory reads is documented in
`../.env.example`, including the ones the four new scripts introduced —
`PYTH_CONTRACT`, `NATIVE_LABEL`, `V2_FEE_TO_SETTER`, `KALEIDO_DIAMOND`,
`COLLATERAL_TOKENS`, `LOANABLE_TOKENS`, `NATIVE_FEED_SYMBOL`, the `FEED_<SYMBOL>`
overrides, `SKIP_HERMES`, and the aggregator-backend set `ORACLE_BACKEND`,
`AGGREGATOR_<SYMBOL>` and `FEED_MAX_AGE_<SYMBOL>`.

An `AGGREGATOR_<SYMBOL>` override is given `maxAge: 0` on purpose, meaning "inherit
the global bound" — a staleness bound is a risk parameter, and inventing one for an
address typed on a command line would be guessing. Because ETH and WETH share a
feed id, overriding one and not the other is refused rather than resolved: one id
holds one address, and object iteration order would otherwise decide silently.

The one pair worth reading twice is `PYTH_CONTRACT` and `PYTH_PRICE_ORACLE`.
`PYTH_CONTRACT` is Pyth's own contract, from Pyth's documentation, and is the
constructor argument to our oracle. `PYTH_PRICE_ORACLE` is _our_ oracle — the
address `deploy-oracle.js` prints — and is what `deploy.js` hands to
`setPythOracle`. `.env.example` described the second one as the first until
2026-08-20, and nothing in the deploy would have caught the swap: Pyth's contract
has code so the `getCode` check passes, `setPythOracle` accepts any non-zero
address, and Pyth's deprecated `getPrice(bytes32)` has the same ABI signature as
ours — so the market would have priced against Pyth's own validity window
instead of the `PRICE_MAX_AGE_SECONDS` / `PRICE_MAX_CONF_BPS` bounds configured
here.

## Credentials

`DEPLOYER_PRIVATE_KEY` and the RPC overrides come from `.env` — see
`hardhat.config.js`. A previous version of that config committed a deployer key
and two explorer API keys; those are permanently public and must never be
reused. Generate a fresh deployer offline for anything touching mainnet.
