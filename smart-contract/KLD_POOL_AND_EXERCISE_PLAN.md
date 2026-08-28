# KLD pool + first-transaction plan

Two jobs, in this order:

1. Open a KLD market on every chain at **$0.03 / $30M FDV**.
2. Put real transactions through every deployed product on every chain, with the
   assets already deployed there.

Written 2026-08-28. Every figure in section 0 was **measured** that day by a
read-only probe of the five testnets — deployer balances, live gas prices, oracle
answers, token decimals, mint ownership, pool existence, book counters and token
supplies. None of it came from a deployment record, because a record says what a
script intended and the chain says what is there.

Nothing in this document has been run. Every command in sections 1–3 signs with
the deployer key.

**Superseded on 2026-08-28 — see section 6.** The plan was executed the same day
it was written. That line above is left standing rather than edited because the
sections below are written in the future tense throughout, and quietly flipping
one sentence would leave the rest reading as a proposal. Section 6 records what
actually happened, route by route, including the two routes whose result differs
from what section 2 predicted and the three chains that could not be run at all.

**Section 2 is the map**: every route, one at a time, with the exact assets, the
exact calls in the order they must be sent, and the precondition each one has. It
is ordered by dependency, so a swap never appears before the pool it needs.
Section 3 groups the same routes into phases, and section 4 compresses them into a
sequence.

---

## 0. What the five chains actually look like today

### 0.1 Gas — three chains are at or below one run's cost

15M gas is roughly one chain's full pass through this plan (pool ≈ 6M, lending
seed ≈ 4M, everything else ≈ 5M).

| chain | id | deployer native | live gas price | 15M gas costs | headroom |
| --- | --- | --- | --- | --- | --- |
| Sepolia | 11155111 | 20.2691 ETH | 0.99 gwei | 0.0149 ETH | ~1,360× |
| Base Sepolia | 84532 | 39.4073 ETH | 0.006 gwei | 0.00009 ETH | ~437,000× |
| BSC testnet | 97 | **0.0014 tBNB** | 0.1 gwei | 0.0015 tBNB | **0.9× — short** |
| Robinhood testnet | 46630 | 0.0016 ETH | 0.01 gwei | 0.00015 ETH | ~10× |
| Arc testnet | 5042002 | 0.4290 USDC | 21 gwei | 0.315 USDC | ~1.4× |

**BSC cannot pay for its own pool.** Arc and Robinhood can pay for it once, with
no margin for a failed transaction. This is blocker zero: the rest of the plan is
unrunnable on three of five chains until it is fixed.

Top-ups to ask for, sized at ~100× the run so nobody has to think about this
again: **0.2 tBNB**, **20 USDC on Arc**, **0.02 ETH on Robinhood**. All three come
from each chain's own public faucet — there is no bridge from our Sepolia/Base
balances to any of them (the proven Abstract→Sepolia→Base canonical route reaches
Sepolia and Base only, and Arc/Robinhood are outside Wormhole's chain set too).

Arc is the awkward one: its gas *is* USDC, so a top-up there is simultaneously the
gas budget and the only mintless dollar on the chain. See 1.2.

### 0.2 The assets, and which mints we control

| chain | KLD held | quote candidates | mint control |
| --- | --- | --- | --- |
| Sepolia | 995,000,000 | USDC 6dp, 23,460 · USDT 6dp, 999.6M | USDC = public-mint mock; USDT/USDe deployer-owned |
| Base Sepolia | 995,000,000 | USDC 6dp, 23,460 · USDT 6dp, 999.8M | same |
| BSC testnet | 995,000,000 | USDC 6dp, 623,460 · USDT 6dp, 999.8M | same |
| Robinhood | 995,000,000 | USDC 6dp, 623,460 · USDT 6dp, 999.8M | same |
| Arc | 995,000,000 | **USDC = the gas token** · USDT 6dp, 1.0B | USDC mint owned by `0xDC29Bab4…`; USDT deployer-owned |

995M + the 5M sitting in each faucet = exactly 1,000,000,000 per chain.

Every wrapped native (WETH/WBNB/WUSDC) reads **0** and has no mint we control, so
nothing in this plan can use one as a funding source. Deposit-to-wrap is the only
route and it costs gas on the three thin chains.

### 0.3 The oracle — dead on two chains right now

`getUsdValue(token, 1 unit)` through each diamond, measured:

| chain | USDC | USDT | USDe | wrapped native |
| --- | --- | --- | --- | --- |
| Sepolia | $0.99997 | revert | revert | $2,500.94 |
| Base Sepolia | $0.99985 | $1.00011 | revert | $2,499.29 |
| BSC testnet | $1.00000 | $0.99993 | revert | **revert** |
| Robinhood | **revert** | **revert** | **revert** | **revert** |
| Arc | **revert** | **revert** | **revert** | **revert** |

Consequences, all of them real:

- **Lending is blocked on Robinhood and Arc.** `createLendingRequest`,
  `createLoanListing` and every health-factor read price through this call, and a
  revert is not a stale number — the transaction fails.
- **WBNB is not usable on BSC** until its feed is refreshed.
- The price keepers (`.github/workflows/price-keeper.yml`, `*/20`) are still inert
  — they need the secret and a merge to main. They were last run by hand on
  2026-08-25 and both self-hosted chains have since gone stale. Either merge the
  keeper or run `push-prices.js` / `push-aggregator.js` by hand before the lending
  phase, and re-measure through the diamond rather than trusting a global max-age.
- `getUsdValue(KLD)` reverts on **all five**. That is expected — no feed anywhere
  publishes KLD — and it is why the pool's price cannot come from the oracle
  (1.5), and why KLD cannot be collateral (1.8).

### 0.4 Nothing has been used yet — the measurable form of it

| what | measured |
| --- | --- |
| stKLD total supply | **0** on all five — nobody has ever staked |
| kfUSD total supply | **0** on all five — nothing minted |
| kafUSD total supply | **0** on all five — nothing locked |
| KLD/USDC V3 pool at 500 / 3000 / 10000 | **none**, on any chain |
| V2 pairs (`allPairsLength`) | **0** on all five |
| lending book | Sepolia: 3 requests, 1 listing. Base/BSC/Robinhood/Arc: **0 / 0** |
| V3 stable pools | 9 records across Sepolia/Base/BSC/Robinhood; **Arc has none** |

So `seed-lending.js` has only ever run on Sepolia, and Arc has never had a pool of
any kind. The KLD pool will be Arc's first — which makes it a live test of Arc's
V3 deployment (factory, position manager, `poolInitCodeHash`) as well as a market.

### 0.5 The app cannot see KLD yet

`src/constants/deployments.generated.ts` holds **20** `kld`/`stKLD` keys in the
working tree and **0** at HEAD. It is generated, it belongs to the other session,
and it is uncommitted. Until it lands:

- every hardhat script here still works — `libraries/registry.js` parses the
  working-tree file;
- the deployed app does not — Vercel builds from git, so production renders no
  KLD anywhere, and every UI check in section 3 would be checking the wrong build.

Not mine to commit. It gates section 3, not section 1.

---

## 1. The KLD pool

### 1.1 The price, and what $30M FDV means when there are five of them

$0.03 per KLD → **1 USDC buys 33.3333 KLD**. Supply per chain is exactly 1B, so
FDV is **$30,000,000 per chain**.

The nominal 5B across the wave is not $150M of anything. Each testnet is its own
KLD home with its own genesis mint and there is no bridge between them, so these
are five separate economies that happen to share a ticker. Two consequences worth
saying out loud before we open five markets:

- **Five pools means five prices.** With no bridge there is no arbitrage to hold
  them together, so the moment anyone trades, the chains' prices diverge and stay
  diverged. That is acceptable on testnet and would not be on mainnet, where one
  home chain plus NTT gives one price.
- The faucet drips 1,000 KLD, which at this price is **$30** — enough for a real
  swap, which is what the faucet is for.

### 1.2 The pair: USDC on four chains, USDT on Arc

**KLD/USDC** on Sepolia, Base Sepolia, BSC testnet and Robinhood testnet. USDC is
the quote the faucet hands out and a public-mint mock on all four, so depth is not
capped by what the deployer happens to hold.

**KLD/USDT on Arc**, and the reason is not preference. Arc's `usdc` registry entry
is the predeploy `0x3600000000000000000000000000000000000000`, and it is not a
token beside the gas — it *is* the gas, viewed at 6 decimals:

```
native balanceOf(deployer)  428962737042554409   (18dp)
0x3600 balanceOf(deployer)              428962   (6dp)   = native / 1e12
0x3600 mint owner            0xDC29Bab4…  (not us)
```

So on Arc, putting USDC into a pool spends the gas budget, and we cannot mint more.
USDT there is deployer-owned with a 1B balance. Same 6 decimals as USDC, so the
arithmetic in 1.6 is identical — only the token order flips.

### 1.3 The tier: 3000, and only 3000

`src/app/(app)/trade/swap/page.tsx:18` is `const DEFAULT_FEE = 3000` and the swap
page quotes nothing else. The agent scans every tier
(`src/lib/v2/intents/build.ts:533`) and would find a pool at 500, but the app's own
swap screen would show no route — which is the surface most people will judge KLD
by. `feeAmountTickSpacing(3000) = 60` is enabled on all five factories (measured),
and the nine existing stable pools are almost all at 3000, so this is also the
consistent choice.

That the swap page pins one tier is a real limitation, and it is not this plan's
job to fix. It is the reason the tier is not a knob here.

### 1.4 Depth: $50,000 a side

`USD=50000` gives each of the two positions 50,000 quote + 1,666,666.67 KLD, so a
chain's pool costs at most **100,000 USDC and 3,333,333 KLD** — 0.33% of FDV, and
0.33% of that chain's KLD supply. Across five chains: ≤500,000 quote units and
≤16.7M KLD out of 5B nominal.

Why that number: it is large enough that the $30-sized swaps a faucet user can
make have negligible price impact and the quote looks like a market rather than a
toy, and small enough that a mispriced pool is a cheap mistake. It is a knob
(`USD=`), not a constant — the arithmetic in 1.6 scales with it and the tick does
not change at all, because the tick depends on the *ratio*, not the size.

`seed-v3-pool.js` mints two positions per pool, deliberately: full range so the
pool never stops quoting, and ±2% so the depth is concentrated where the price
actually is. Both are also the only V3 positions that will exist on these chains
for KLD, which is what `collectPoolFees` and `decreasePoolLiquidity` need in
section 3.

### 1.5 The price comes from an operator override, and that needs saying

`seed-v3-pool.js` prices both sides from the diamond's oracle, falls back to Pyth
Hermes, and **refuses** rather than assuming. For KLD both routes are closed:
`getUsdValue(KLD)` reverts on all five chains and `feedFor("KLD")` has no feed id
to look up. The only remaining route is `STABLE_USD`, the script's one sanctioned
exception — a price the operator types, logged as an override on every line.

Its header says never point it at a volatile asset, and that is right. The
justification here is narrow and worth writing down so it is not reused casually:
**pre-TGE KLD has no market at all**, so $0.03 is a launch price pinned by
decision, exactly as our mock stablecoins' $1 is pinned by construction. There is
no feed to disagree with.

The moment the first pool exists that stops being true. **After section 1 runs,
KLD has a market price and `STABLE_USD=kld=…` must never be used again** — a
re-run would size a position against a stale $0.03 while the live tick has moved.
(The script would still centre the band on the live tick, so the failure is a
lopsided position rather than a gift to an arbitrageur, but it is still wrong.)

### 1.6 The commands

Four chains:

```bash
cd smart-contract && PAIR=kld/usdc FEE=3000 USD=50000 BAND_PCT=2 STABLE_USD="kld=0.03,usdc=1" npx hardhat run scripts/seed-v3-pool.js --network sepolia
```

then the same with `--network baseTestnet`, `--network bscTestnet`,
`--network robinhoodTestnet`.

Arc:

```bash
cd smart-contract && PAIR=kld/usdt FEE=3000 USD=50000 BAND_PCT=2 STABLE_USD="kld=0.03,usdt=1" npx hardhat run scripts/seed-v3-pool.js --network arcTestnet
```

`usdc=1` is overridden alongside KLD rather than left to the oracle on purpose:
the oracle answers $0.99997 on Sepolia, which would open the pool 0.003% away from
$0.03. Harmless, and it makes the log line impossible to check by hand. Pinning
both means the printed opening price is exactly the launch price.

`V3_FEE_PROTOCOL` stays unset. Whether the protocol takes a cut of LP fees is a
multisig-era economics decision, and it is one of the two items still open in the
audit backlog — not something to switch on while seeding.

No new script is needed. `seed-v3-pool.js` already reads both decimals off the
tokens, orders token0/token1 by address, derives the opening price from the ratio,
mints both ranges, and writes `deployment-pool-<network>-<t0>-<t1>-3000.json`.

### 1.7 The log lines that prove it worked

Computed with the script's own arithmetic, so these are the numbers it will print,
not estimates:

| chain | token0 | opening tick | aligned band centre |
| --- | --- | --- | --- |
| Sepolia (KLD/USDC) | **USDC** (`0x0B48…` < `0x79C1…`) | **+311,391** | +311,400 |
| Base Sepolia (KLD/USDC) | **KLD** (`0x6140…` < `0x688F…`) | **−311,392** | −311,400 |
| BSC testnet (KLD/USDC) | **KLD** (`0x0d6a…` < `0xf9e2…`) | **−311,392** | −311,400 |
| Robinhood (KLD/USDC) | **KLD** (`0x6F57…` < `0xcf00…`) | **−311,392** | −311,400 |
| Arc (KLD/USDT) | **USDT** (`0xa2e1…` < `0xC0f8…`) | **+311,391** | +311,400 |

The magnitude is ~311.4k rather than ~−35k because the raw price ratio between an
18-decimal token and a 6-decimal one carries a factor of 1e12 (`0.03 × 1e-12` =
3e-14, and `ln(3e-14)/ln(1.0001)` = −311,392). The sign is decided purely by
address order. Positions: full range `[−887220, 887220]`, band `±180` ticks
(`ln(1.02)/ln(1.0001)` = 198, aligned to spacing 60 → ±1.81%).

Check three things per chain and nothing else matters:

1. `1 KLD = $0.030000000000000000  [operator override $0.03]`
2. `|tick| ≈ 311,39x` with the sign matching the table. A tick near **0** means a
   decimals bug; anything beyond ±887,272 and the script refuses on its own.
3. `pool liquidity now` is nonzero and both `tokenId`s printed.

Then re-run the read-only survey and confirm the pool is visible to the app's own
registry path:

```bash
cd smart-contract && npx hardhat run scripts/survey-state.js --network sepolia
```

### 1.8 What a pool does *not* give you

Three gaps a seeded pool does not close, all of which will otherwise look like
bugs the first time someone opens the app:

**a. The UI will still show KLD with no dollar value.** `src/lib/points/prices.ts`
prices by *symbol* from Hermes and holds `UNPRICED = new Set(["KLD", "stKLD"])`,
which is deliberate pre-TGE: KLD-denominated points accrue in token-units × time
instead of USD × time. A pool does not change that — nothing reads the pool for a
price. Three options:

- *Leave it.* Consistent with "no market before TGE", but now false in a visible
  way: there is a market, and every KLD row shows an em dash.
- *Pin $0.03* beside `ASSUMED_PAR`, with its own `source: "launch-price"`. One
  line, honest about being an assumption, and chain-independent like the rest of
  the module. **The catch, and it is a real one: this module is what values points,
  so pinning a price converts KLD staking rewards from token-time to dollar-time
  mid-season.**
- *Read the pool.* The only genuinely correct price, and it breaks the module's
  central invariant — prices are keyed by symbol because a dollar of USDC is a
  dollar anywhere, whereas five unbridged pools give five different KLD prices.

Recommendation: **pin $0.03 for display and keep points unpriced**, which means
the launch price does not belong in `prices.ts` at all but in the display layer.
That is a small piece of work, not a one-liner, and it is yours to call.

**b. `/pool` will not list it.** That table enumerates the **V2** factory
(`allPairsLength`/`allPairs`) because V3 has no enumeration, and V2 has **0 pairs
on every chain** — so the page is empty everywhere today and a V3 KLD pool will not
appear there either. `/pool/new` mints V3, `/trade/swap` quotes V3. Either seed a
V2 KLD pair as well (a second market with its own price, on a DEX nothing else
uses — I would not) or accept that /pool is an empty V2 view until V3 enumeration
lands. Naming it here so it is not discovered as "the pool didn't work".

**c. KLD cannot be collateral.** `getUsdValue(KLD)` reverts on all five and the
lending market prices every position through it. On Robinhood and Arc we own the
price feeds (self-hosted `PushablePriceFeeds`) and *could* publish a KLD price; on
Sepolia, Base and BSC there is no KLD feed to register and no pushable oracle
deployed. Registering our own price as collateral-grade is a much bigger decision
than opening a pool, and it is out of scope here.

---

## 2. Every route, one by one

Section 3 says what order to work in. This section says what each route *is*:
the assets, the calls, the arguments, and what has to be true before the first
call can succeed. Four fields each.

- **Needs** — the precondition. A route whose need is unmet does not fail
  gracefully; it reverts.
- **Calls** — the transactions in order, with the arguments as they reach the
  contract, and who signs each one.
- **Where** — which of the five chains this can run on today.
- **Proves** — what a green run establishes, and what it does not.

Routes are numbered in dependency order. Route 2 cannot run before route 1,
because a swap needs a pool; routes 5–7 cannot run before route 4, because a
loan needs collateral; routes 9 and 10 are a chain of their own.

### 2.1 The three wallets

| | who | how it is obtained | what it does here |
| --- | --- | --- | --- |
| **L** | the deployer `0x28b7…8955` | `DEPLOYER_PRIVATE_KEY` | owns every mock mint, holds 995M KLD per chain, holds kfUSD's `MINTER_ROLE`, owns all nine existing V3 positions, and is the **lender** |
| **B** | the counterparty | `keccak256("kaleido-testnet-counterparty-v1:" + DEPLOYER_PRIVATE_KEY)`, or `COUNTERPARTY_PRIVATE_KEY` if set | the **borrower**. A lender and a borrower cannot be the same address (`Protocol__CantFundSelf`, `Protocol__OwnerCreatedListing`) |
| **F** | a fresh wallet | any empty MetaMask account | the faucet route, and only that. Its whole value is holding nothing |

B's derived key is as public as the deployer key. Fine on these testnets, never
on mainnet. Set `COUNTERPARTY_PRIVATE_KEY` to a wallet you actually hold if you
want to open `/borrow` in a browser as the borrower.

### 2.2 The coverage matrix — every asset against every product, on every chain

This is the table the whole plan turns on, and it cannot be read off a deployment
record. Whether a product accepts an asset lives in six unrelated places, each
with its own gate and its own setter: the diamond's collateral array, its loanable
array, the oracle on top of both, kfUSD's `supportedCollaterals`, kafUSD's
`supportedAssets`, the vault's `supportedTokens`, and the faucet's own asset list
with a per-asset drip that can be zero while the asset is still listed.

So each product was asked directly. `scripts/survey-assets.js` — read-only, signs
nothing — measured all five chains on **2026-08-28**:

```bash
cd smart-contract && npx hardhat run scripts/survey-assets.js --network sepolia
```

`Y` = accepted. `—` = not accepted. `rev` = registered but the oracle reverts, so
it is accepted and unusable, which from the UI is indistinguishable from
unregistered. Faucet column is the drip; **bold** marks a drip larger than the
faucet's own stock, which fails on the first claim.

**Sepolia 11155111** — gas 20.27 ETH, book already has 3 requests / 1 listing

| asset | dp | L holds | collat | loan | oracle | kfUSD | kafUSD | stake | faucet |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| NATIVE | 18 | 20.27 | Y | — | $2491.68 | — | — | — | 0.02 |
| WETH | 18 | 0.002 | Y | Y | $2491.68 | — | — | — | 0.02 |
| USDC mock | 6 | 23,460 | Y | Y | $0.999974 | Y | Y | — | 10,000 |
| USDT | 6 | 999.6M | — | — | rev | Y | Y | — | 10,000 |
| USDe | 18 | 999.6M | — | — | rev | Y | Y | — | 10,000 |
| KLD | 18 | 995M | — | — | rev | — | — | **Y** | 1,000 |
| stKLD | 18 | 0 | — | — | rev | — | — | — | — |
| kfUSD | 18 | 0 | — | — | rev | — | Y | — | — |
| kafUSD | 18 | 0 | — | — | rev | — | — | — | — |
| USDC Circle | 6 | 0 | Y | Y | $0.999974 | Y | Y | — | listed-0 |

**Base Sepolia 84532** — gas 39.41 ETH, book empty

| asset | dp | L holds | collat | loan | oracle | kfUSD | kafUSD | stake | faucet |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| NATIVE | 18 | 39.41 | Y | — | $2485.21 | — | — | — | 0.01 |
| WETH | 18 | **0** | Y | Y | $2485.21 | — | — | — | 0.02 |
| USDC mock | 6 | 23,460 | Y | Y | $0.999845 | Y | Y | — | 10,000 |
| USDT | 6 | 999.8M | **Y** | **Y** | $1.000110 | Y | Y | — | 10,000 |
| USDe | 18 | 999.8M | — | — | rev | Y | Y | — | 10,000 |
| KLD | 18 | 995M | — | — | rev | — | — | Y | 1,000 |
| kfUSD | 18 | 0 | — | — | rev | — | Y | — | — |
| USDC Circle | 6 | 0 | Y | Y | $0.999845 | Y | Y | — | listed-0 |

**BSC testnet 97** — gas **0.00145 BNB, cannot sign anything**

| asset | dp | L holds | collat | loan | oracle | kfUSD | kafUSD | stake | faucet |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| NATIVE | 18 | 0.0014 | Y | — | $704.644265 | — | — | — | **not listed** |
| WBNB | 18 | 0 | Y | Y | $704.644265 | — | — | — | **5.0 / stock 0.28** |
| USDC | 6 | 623,460 | Y | Y | $1.000000 | Y | Y | — | 10,000 |
| USDT | 6 | 999.8M | Y | Y | $0.999935 | Y | Y | — | 10,000 |
| USDe | 18 | 999.8M | — | — | rev | Y | Y | — | 10,000 |
| KLD | 18 | 995M | — | — | rev | — | — | Y | 1,000 |
| kfUSD | 18 | 0 | — | — | rev | — | Y | — | — |

**Robinhood 46630** — gas **0.00155, cannot sign anything**; every feed reverts

| asset | dp | L holds | collat | loan | oracle | kfUSD | kafUSD | stake | faucet |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| NATIVE | 18 | 0.0016 | Y | — | rev | — | — | — | **not listed** |
| WETH | 18 | 0 | Y | Y | rev | — | — | — | **1.0 / stock 0.50** |
| USDC | 6 | 623,460 | Y | Y | rev | Y | Y | — | 10,000 |
| USDT | 6 | 999.8M | — | — | rev | Y | Y | — | 10,000 |
| USDe | 18 | 999.8M | — | — | rev | Y | Y | — | 10,000 |
| KLD | 18 | 995M | — | — | rev | — | — | Y | 1,000 |
| kfUSD | 18 | 0 | — | — | rev | — | Y | — | — |

**Arc 5042002** — gas 0.43 (the gas token *is* USDC); every feed reverts; **zero
V3 pools of any pair at any tier**

| asset | dp | L holds | collat | loan | oracle | kfUSD | kafUSD | stake | faucet |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| NATIVE | 18 | 0.4290 | Y | — | rev | — | — | — | **not listed** |
| WUSDC | 18 | 0 | Y | Y | rev | — | — | — | **100 / stock 8.69** |
| USDC `0x3600…0000` | 6 | 0.4290 | — | — | rev | Y | Y | — | **100 / stock 8.69** |
| USDT | 6 | 1.000B | — | — | rev | Y | Y | — | 10,000 |
| USDe | 18 | 1.000B | — | — | rev | Y | Y | — | 10,000 |
| KLD | 18 | 995M | — | — | rev | — | — | Y | 1,000 |
| kfUSD | 18 | 0 | — | — | rev | — | Y | — | — |
| **EURC** `0x89B5…D72a` | 6 | 10.0 | — | — | rev | — | — | — | 1.0 |
| **cirBTC** `0xf0C4…32BF` | 8 | 0 | — | — | rev | — | — | — | **0.001 / stock 0** |

#### What the matrix says that no per-product plan would have

- **Staking is single-asset by construction, and now proven on-chain.**
  `supportedTokens` is true for KLD and false for every other asset including
  stKLD, on all five chains. `KLDVaultV2.setSupportedToken` requires
  `_token == IStKLD(stKLD).kldToken()` (`KLDVaultV2.sol:99`), so there is no
  "stake a different asset" case to test — the absence is the design.
- **The stablecoins are the only genuinely multi-asset products, and they work on
  all five chains** — including the three whose oracles are dead. kfUSD accepts
  3–4 collaterals per chain and kafUSD 4–5 lock assets, and **neither consults an
  oracle** (2.11). So the stablecoin routes are the one place where "same product,
  different assets, every chain" runs today.
- **USDe is lending-registered on no chain**, while every chain's faucet drips
  10,000 of it and both stablecoins accept it. It is the clearest case of an asset
  that is fully alive in one product and absent from another.
- **USDT is lending-registered on Base and BSC only** — not Sepolia, not
  Robinhood, not Arc. Four chains running "the same" lending market do not have
  the same assets in it.
- **NATIVE is collateral-only on all five.** No chain lets you borrow the native
  asset, which is why every loan below is denominated in an ERC20.
- **The faucet cannot bootstrap a fresh wallet on BSC, Robinhood or Arc.** None of
  the three lists the native asset at all, so a new wallet there has no way to get
  gas and every other drip is unreachable. On top of that, all three have a
  wrapped-native drip larger than the faucet's stock of it (5.0 vs 0.28, 1.0 vs
  0.50, 100 vs 8.69), and Arc's cirBTC drip is backed by zero balance — four
  drips that are guaranteed to fail on first claim.
- **Arc carries two assets nothing in the app or the registry names**: EURC (6dp,
  Circle's euro stable) and cirBTC (8dp). Both are in the faucet. EURC is the
  only non-USD asset anywhere in the protocol and cirBTC the only 8-decimal one —
  which makes them the two most interesting decimals/quote-currency test cases we
  have, and neither is registered with any product.
- **The V2 factory is deployed on all five chains, holds zero pairs, and no app
  surface references `v2Router` outside the registry files.** Measured, so
  "unused" is a fact rather than an assumption: there is no V2 product to test.
- **BSC's BNB feed is intermittent, not dead.** It reverted earlier on 2026-08-28
  and then answered `$704.644265` on three consecutive reads about 45s apart. So
  BSC lending is not blocked on the oracle the way Robinhood and Arc are — it is
  blocked on gas. Re-read the feed immediately before the run rather than trusting
  either measurement.
- **Arc's lending market cannot be exercised at all.** Its one loanable asset is
  WUSDC, whose only funding route is wrapping the gas token, of which L holds
  0.43 — below `MIN_LOAN_AMOUNT` ($10) whatever the oracle does. Registering USDT
  there is `addLoanableToken`, which is **irreversible** and needs your go.

#### The test-case count that follows

| product | cases | derivation |
| --- | --- | --- |
| Swap | 6 today, 16 after 2.3 | pairs with a pool × direction |
| Positions | 9 today, 15 after 2.3 | one collect+decrease per position pair |
| Lending | 5 | Sepolia ×1, Base ×3 (WETH, USDT, USDC loans), BSC ×2 — none on Robinhood or Arc |
| Staking | 5 | KLD only, once per chain |
| kfUSD | 18 mints + 18 redeems | 4 collaterals on Sepolia/Base, 3 on BSC/Robinhood/Arc |
| kafUSD | 23 locks | 5 assets on Sepolia/Base, 4 on BSC/Robinhood/Arc |
| Faucet | 6 assets on Sepolia, 6 on Base, 4 usable each on BSC/Robinhood/Arc | |
| Agent | 25 prompts × the chains each is possible on | 2.14 |

Gas gates most of it: **only Sepolia and Base can sign anything today.**

### 2.3 Route 1 · Create the pool — the only route with no prerequisite

**Needs** nothing but gas and the quote asset. Nothing else in this section can
start until it is done.

**The pairs — five pools, one per chain, and no others.** The nine existing
stable pools are reused by routes 2 and 3, never re-seeded.

| chain | new pool | fee | KLD side (desired) | quote side (desired) | quote asset, and why |
| --- | --- | --- | --- | --- | --- |
| Sepolia | KLD/USDC | 3000 | 3,333,333.33 | 100,000 USDC | mock USDC, public `mint` — L holds 23,460 and the script mints the rest |
| Base Sepolia | KLD/USDC | 3000 | 3,333,333.33 | 100,000 USDC | same |
| BSC testnet | KLD/USDC | 3000 | 3,333,333.33 | 100,000 USDC | same; L already holds 623,460 |
| Robinhood | KLD/USDC | 3000 | 3,333,333.33 | 100,000 USDC | same |
| Arc | **KLD/USDT** | 3000 | 3,333,333.33 | 100,000 USDT | Arc's `usdc` is the gas-token predeploy at 6dp (1.2). USDT is deployer-owned, 1B, same 6 decimals |

The desired amounts are `USD=50000` **twice over**: `seed-v3-pool.js:417` requires
`amount0 * 2` because both positions are sized with the full desired amount.
Actual consumption is lower — a full-range position takes what the ratio allows —
and is printed from the `IncreaseLiquidity` event, which is the number to record.

**Calls, per chain, all signed by L:**

| # | call | contract | notes |
| --- | --- | --- | --- |
| 1 | `mint(L, short)` | quote token | only if short. Public on the USDC mock, `onlyOwner` on USDT. Skipped on Arc for USDC by design |
| 2 | `approve(NPM, MaxUint256)` ×2 | KLD, quote | one per side |
| 3 | `createAndInitializePoolIfNecessary(token0, token1, 3000, sqrtPriceX96)` | NonfungiblePositionManager | **the irreversible one.** `sqrtPriceX96` from `encodeSqrtRatioX96(amount1, amount0)` in BigInt |
| 4 | `mint({token0, token1, 3000, -887220, 887220, amount0, amount1, 0, 0, L, deadline})` | NPM | full range — the floor under every later quote |
| 5 | `mint({…, align(liveTick) ± 180, …})` | NPM | the ±2% band, centred on the pool's *live* tick, not on our own price |

`token0`/`token1` are ordered by address, so which of KLD and the quote is
token0 differs per chain and the tick's sign flips with it. The script prints
both orderings and the resulting tick; 1.7 has the numbers to check them against.

**Where** all five. **Proves** the factory, the init-code hash and the position
manager on each chain — for Arc, that is the *first* V3 transaction of any kind.

**Arc needs a second pool, and it is not a KLD one.** Arc has **zero pools of any
pair at any tier** (measured: 0 of 45 pair-tier combinations), so a KLD pool alone
would leave the DEX with exactly one market and no way to test a swap between two
assets we did not just create. The fix is one more pool, **USDT/USDe at 3000** —
both are deployer-owned mints with 1B supply on Arc, so it can be seeded without
touching the gas token. USDC is not an option there: it *is* the gas token
predeploy and L holds 0.43 of it.

### 2.4 Route 2 · Swap

**Needs** route 1 for anything involving KLD. A pool at the tier being quoted:
the app's swap screen quotes **only 3000** (`swap/page.tsx:18`) and only
single-hop; the agent scans all of `FEE_TIERS` and takes the deepest fill
(`build.ts:533`).

**Calls** (per swap, signer = whoever trades — L for the scripted pass):

1. `approve(tokenIn, v3Router, MaxUint256)` — skipped if the allowance is already there.
2. `quoteExactInputSingle(tokenIn, tokenOut, fee, amountIn, 0)` — an `eth_call`
   against a function that reverts with the answer, never a transaction.
3. `exactInputSingle({tokenIn, tokenOut, fee, recipient, deadline, amountIn, amountOutMinimum, 0})`
   with `amountOutMinimum = quoted × (10000 − 50) / 10000`. Never zero: on a pool
   this is the first trade against, a bad quote is exactly what we want to catch.

**The swaps, concretely — 18 of them.** Ten prove the new market, eight prove the
markets that have existed since 2026-08-23 and have never been traded:

| # | chain | swap | why this size |
| --- | --- | --- | --- |
| 1–2 | each of Sepolia/Base/BSC/Robinhood | 500 USDC → KLD, then 10,000 KLD → USDC | ≈16,667 KLD in, ≈$300 out. Both directions so the tick crosses each way and the band position accrues fees on both sides |
| 9–10 | Arc | 500 USDT → KLD, 10,000 KLD → USDT | same, on the one chain whose quote asset differs |
| 11–14 | Sepolia/Base/BSC/Robinhood | 2,500 USDC → USDT @3000 | first ever trade on `deployment-pool-*-USDT-USDC-3000` |
| 15–18 | Sepolia/Base/BSC/Robinhood | 2,500 USDC → USDe @3000 | first ever trade on the USDe pools |

```bash
cd smart-contract && IN=usdc OUT=kld AMOUNT=500 FEE=3000 npx hardhat run scripts/swap-v3.js --network sepolia
```

**What is routable today, before route 1** — the honest answer to "there can't be
a swap if there's no pool":

| chain | pools that exist | reachable from `/trade/swap` | reachable from the agent |
| --- | --- | --- | --- |
| Sepolia | USDT/USDC @3000, USDC/USDe @3000, USDT/USDe @**500** | the two 3000 pools | all three |
| Base Sepolia | USDT/USDC @3000, USDe/USDC @3000 | both | both |
| BSC testnet | USDT/USDC @3000, USDe/USDC @3000 | both | both |
| Robinhood | USDT/USDC @3000, USDe/USDC @3000 | both | both |
| Arc | **none** | nothing | nothing |

Sepolia's USDT/USDe pool sits at fee 500 and is therefore invisible to the swap
page while the agent can trade it. Not a KLD problem, but it is the reason a "no
route" message on that one pair is expected rather than a bug.

**Where** four chains today for stables; all five after route 1. **Proves** the
quoter and the router agree — the printed `quote error` is that agreement — and
that `poolInitCodeHash` is right on each chain, which nothing has tested.

### 2.5 Route 3 · Positions: collect and decrease

**Needs** route 2 to have traded *through the band*, or `collect` returns zero,
which is indistinguishable from a broken call.

**The positions.** All are L's, all on the NonfungiblePositionManager:

| chain | pool | token ids |
| --- | --- | --- |
| Sepolia | USDT/USDe @500 · USDC/USDT @3000 · USDC/USDe @3000 | 1–2 (unrecorded) · 3–4 · 5–6 |
| Base Sepolia | USDT/USDC @3000 · USDe/USDC @3000 | 1–2 · 3–4 |
| BSC testnet | USDT/USDC @3000 · USDe/USDC @3000 | 1–2 · 3–4 |
| Robinhood | USDT/USDC @3000 · USDe/USDC @3000 | 1–2 · 3–4 |
| Arc | — | none until route 1 |

Route 1 adds two more per chain, and prints their ids.

**Calls** (L): `positions(tokenId)` to read `tokensOwed0/1` →
`collect({tokenId, recipient: L, amount0Max: 2^128−1, amount1Max: 2^128−1})` →
`decreaseLiquidity({tokenId, liquidity: L/10, amount0Min: 0, amount1Min: 0, deadline})`
→ `collect` again, because `decreaseLiquidity` credits the released principal to
the position rather than paying it out.

Take a tenth of the liquidity, not all of it: the band position is the depth
behind route 2, and a full withdrawal would leave the market thinner than the
day it opened.

**Where** all five after route 2. **Proves** `collectPoolFees` and
`decreasePoolLiquidity` — two agent verbs and two `/pool` buttons that have never
been called. **Does not prove** anything about a position that is out of range;
the full-range one will report fees too, and that is the point of having it.

### 2.6 Route 4 · Lending, leg 1: collateral

**Needs** an oracle that answers for the collateral asset (2.2), and B funded
with gas plus the collateral itself.

**Calls** (B): `depositCollateral(0x…0001, collateralRaw, {value: collateralRaw})`
for native, or `approve(diamond)` then `depositCollateral(token, amount)` for an
ERC20. Then read `getAccountCollateralValue(B)` and `getHealthFactor(B)`.

`COLLATERAL_USD=400` by default, so ≈0.16 ETH on Sepolia or Base at $2,500.

**Per chain, the collateral and loan assets that actually work — every combination
the matrix allows, not one per chain:**

| chain | collateral | loan currency | cases | note |
| --- | --- | --- | --- | --- |
| Sepolia | NATIVE $400 | WETH | 1 | `seed-lending.js` defaults. USDC is loanable too, but it is also collateral, and `Protocol__CannotBorrowCollateralAsset` only bites per-borrower — a borrower who posts only native may borrow USDC, so this is 2 cases if the deposit is native-only |
| Base Sepolia | NATIVE $400 | WETH, USDT, USDC | 3 | the widest lending surface on any chain; three separate loans against one native deposit |
| BSC testnet | NATIVE $400 | WBNB, USDC, USDT | 3 | **corrected**: BNB and WBNB price at $704.644265 now, so the native-collateral default works. Blocked on gas, not the oracle |
| Robinhood | — | — | 0 | every feed reverts |
| Arc | — | — | 0 | feeds revert **and** no loanable asset can reach $10 (2.2) |

`seed-lending.js` runs as written on all three of the chains that can price
anything, because in each case native collateral is the working path. The
`COLLATERAL=<key>` ERC20 switch is still worth having — Base could then post USDT
collateral and borrow WETH, which is the only way to exercise a 6-decimal
collateral against an 18-decimal loan — but it is no longer a blocker.

Collateral and loan asset must differ (`Protocol__CannotBorrowCollateralAsset`),
which is why native-collateral/WETH-loan is legal: the sentinel `address(1)` and
WETH are different storage keys even though they are the same underlying asset.

`withdrawCollateral(token, uint128 amount)` belongs to this route but runs **last**,
in 2.9 — it is the only call that checks the health factor on the way down.

### 2.7 Route 5 · Lending, leg 2: the listing route (lender posts first)

This is `/borrow`'s order book: L offers, B draws.

**Needs** route 4 for B's collateral, and L holding the loan currency — which on
Sepolia and Base means wrapping native into WETH, since every wrapped native
reads 0 and has no mint (0.2).

**Calls, in order:**

| # | signer | call | arguments as sent |
| --- | --- | --- | --- |
| 1 | L | `deposit()` on WETH | only the shortfall, `{value: short}` |
| 2 | L | `approve(diamond, MaxUint256)` | loan currency |
| 3 | L | `createLoanListing(amount, min, max, returnDate, interest, currency)` | `$300` worth, `min = $30` (half a draw), `max = $300`, `now + 60 days`, `500` bps = 5.00% APR |
| 4 | B | `requestLoanFromListing(listingId, amount)` | `$60` worth → **request #A, born SERVICED** |

**End state:** listing #N open with $240 of $300 left, bounds intact; request #A
serviced with L as lender. That partial draw is deliberate — a listing that is
still open after being used is the state the UI has never rendered.

**Where** Sepolia and Base today; BSC after the change in 2.6. **Proves** the
listing side of the book, `min_amount ≤ draw ≤ max_amount`, and that
`Protocol__OwnerCreatedListing` keeps L from drawing on its own offer.

### 2.8 Route 6 · Lending, leg 3: the request route (borrower posts first)

The mirror image, and the route the agent's `borrow` verb builds.

| # | signer | call | arguments as sent |
| --- | --- | --- | --- |
| 5 | B | `createLendingRequest(amount, interest, returnDate, currency)` | `$60` worth, `800` bps = 8.00%, `now + 30 days` → **request #B, OPEN** |
| 6 | L | `serviceRequest(requestB, currency)` | → #B SERVICED |
| 7 | B | `createLendingRequest(…, 1200, now + 45 days, …)` | → **request #C, left OPEN on purpose** |
| 8 | L | `transfer(B, interest × 1.1)` | B received exactly `amount` on each loan and owes `totalRepayment`, so it is short by the interest and nothing else |

Request #C is the standing target for the UI's and the agent's `fillRequest`. Do
not service it in the script.

The guards on step 5, all of them live (`ProtocolFacet.sol:195–235`):

- the loan currency must not be one of B's deposited collateral assets;
- `_returnDate > block.timestamp + 1 days`;
- the loan's USD value ≥ `MIN_LOAN_AMOUNT` ($10);
- B's collateral > 0;
- `totalLoanCollected + loanUsd < collateralValue × 75 / 100`.

$400 of collateral therefore allows $300 of debt, and 2 × $60 = $120 sits well
inside it — which is why both loans fit and why the health factor stays high.

### 2.9 Route 7 · Lending, leg 4: repay, close, withdraw — and the one we will not run

**Needs** routes 5 and 6, and step 8's interest transfer.

| # | signer | call | why in this order |
| --- | --- | --- | --- |
| 1 | B | `approve(currency, diamond, MaxUint256)` | `repayLoan` pulls |
| 2 | B | `repayLoan(A, half)` | the partial branch |
| 3 | B | `repayLoan(A, remainder)` | the closing branch |
| 4 | B | `repayLoan(B, totalRepayment)` | full repayment in one call |
| 5 | B | `closeRequest(C)` | terminal — nothing can service #C afterwards |
| 6 | L | `closeListingAd(N)` | terminal — returns the undrawn $240 to L |
| 7 | B | `withdrawCollateral(NATIVE, amount)` | only once the debt is 0, so the health check passes |

**`liquidateUserRequest` is deliberately not in this plan.** The maximum health
headroom is `LIQUIDATION_THRESHOLD / COLLATERALIZATION_RATIO = 80/75 = 1.0667`, so
a liquidation needs the collateral asset to fall about 6% against the loan asset
while the oracle keeps answering. The only place we could arrange that is
Robinhood, whose feeds we push ourselves — and moving a price to manufacture a
liquidation is indistinguishable from breaking the oracle. It stays covered by
`fork-verify-health-factor.js` against a fork.

### 2.10 Route 8 · Staking — starts the first seven-day clock

**Needs** KLD in the signer's hands. L has 995M per chain; F gets 1,000 from the
faucet, which is the more honest test.

**Calls** (one signer, in one run):

| # | call | contract | note |
| --- | --- | --- | --- |
| 1 | `approve(kldVault, amount)` | KLD | |
| 2 | `deposit(kld, 100_000e18)` | KLDVaultV2 | 100,000 KLD ≈ $3,000 at the new pool price. Two arguments — the vault reads stKLD from its own storage |
| 3 | `getTotalPooledKld()`, `getTotalStakers()`, `stKLD.balanceOf(signer)` | reads | the first stake mints shares 1:1; record it, because every later rate depends on this being right |
| 4 | `harvestYield(kld)` | KLDVaultV2 | may legitimately return zero on day 0 — record *which*, so a zero on day 7 means something |
| 5 | `requestWithdrawal()` | KLDVaultV2 | starts `WITHDRAWAL_WAITING_PERIOD = 7 days` |
| 6 | `hasWithdrawalRequest(signer)`, `getWithdrawalTimeLeft(signer)` | reads | this is the state `/stake` renders as a pending withdrawal |
| 7 | `cancelWithdrawalRequest()` | KLDVaultV2 | the verb nobody would think to test |
| 8 | `requestWithdrawal()` again | KLDVaultV2 | leave this one running |
| 9 | *day 7* `withdraw(kld, amount)` | KLDVaultV2 | `CooldownNotPassed()` before then |

**Where** all five — each testnet is its own KLD home, so each has its own vault
and its own exchange rate. **Proves** the whole `/stake` lifecycle, which is the
one product where the UI has more verbs than the agent does.

### 2.11 Route 9 · kfUSD mint and redeem — and who is allowed to

**Needs** a supported collateral — and `MINTER_ROLE`. Measured support, per chain:

| chain | kfUSD accepts | cases |
| --- | --- | --- |
| Sepolia | USDC mock, USDT, USDe, USDC Circle | 4 |
| Base Sepolia | USDC mock, USDT, USDe, USDC Circle | 4 |
| BSC testnet | USDC, USDT, USDe | 3 |
| Robinhood | USDC, USDT, USDe | 3 |
| Arc | USDC (gas predeploy), USDT, USDe | 3 |

**kfUSD consults no oracle, anywhere in mint or redeem.** That is the single most
consequential thing in this section, and it has three consequences:

1. **The stablecoin is exercisable on all five chains, including the three whose
   lending oracles are dead.** USDe can be minted against on every chain even
   though it is lending-registered on none. This is the one product where "same
   workflow, different assets, every chain" runs today.
2. **The `MINTER_ROLE` gate is load-bearing, not an oversight.** `mint(_to,
   _amount, _collateralToken, _collateralAmount)` takes the kfUSD amount and the
   collateral amount as *independent* arguments and checks no relationship between
   them (`kfUSD.sol:157–237`). A permissionless version of this function would let
   anyone call `mint(self, 1e30, USDC, 1)` and walk away with 10^12 kfUSD for one
   unit of dust. So the earlier reading in this plan was wrong: the collateral
   transfer is **not** its own authorisation, because the caller chooses both
   sides. The role has to stay until the ratio is enforced somewhere.
3. **The fix therefore has a shape.** Either (a) a gateway contract that holds
   `MINTER_ROLE`, prices the collateral through the diamond oracle and computes
   `_amount` itself — which the UI then calls; or (b) price the collateral inside
   `mint` and drop the role. (b) is cleaner and re-couples the stablecoin to the
   oracle, which would immediately un-exercise it on the three chains where the
   oracle is dead. (a) keeps that independence. Either way it is your decision, and
   until it is made **only the deployer can mint kfUSD** — `/stable`'s mint form and
   the agent's `mintStable` both send the connected wallet, so both revert for
   every other address.

**A real defect in the reads, found by running the numbers with mixed decimals.**
`getTotalCollateralValue()` sums `collateralBalances` across assets in their own
raw units (`kfUSD.sol:413–419`), so it adds a 6-decimal USDC balance to an
18-decimal USDe balance as if they were the same scale, and `getBackingRatio()`
then divides that total by an 18-decimal `totalSupply()`. Mint 1,000 kfUSD against
1,000 USDC and the ratio reads `1e6` — effectively zero — against a true 1:1
backing; mint against USDe and it reads `1e18`, correct only because USDe happens
to be 18dp. It is a view, nothing internal consumes it, and **the app avoids it
entirely**: `useStablecoin.ts:711–714` reads each collateral balance separately,
formats each with its own decimals and sums at par, which is right. So no user sees
a wrong number today — but the on-chain getter is wrong for any integrator, and it
only shows up when the collateral is not 18 decimals. Worth fixing; not urgent.

**Calls, per collateral asset** (L, since only L can):

| # | call | arguments | result |
| --- | --- | --- | --- |
| 1 | `collateral.approve(kfUSD, amount)` | scaled to the collateral's own decimals — 1000e6 for USDC/USDT, 1000e18 for USDe | |
| 2 | `kfUSD.mint(L, 1000e18, collateral, collateralAmount)` | to, kfUSD amount, collateral, collateral amount | 999.5 kfUSD to L; `mintFee` 5 bps minted to the contract, `totalMinted` counts the gross 1,000 |
| 3 | `getBalances(collateral)`, `getFeeTreasury()`, `totalMinted` | reads | `deploymentRatio` splits idle/deployed and auto-deploys to the vault if enabled — read before and after so the split is visible. **Skip `getBackingRatio()`**, per the defect above |
| 4 | `kfUSD.approve(kfUSD, 200e18)` | kfUSD approving **itself** | it `transferFrom`s the caller's own balance before burning |
| 5 | `kfUSD.redeem(200e18, collateral)` | | ≈199.9 collateral back at 5 bps, scaled down by `10**(18-collateralDecimals)`. Minimum redemption `1e15`; redemption draws `idleBalances`, so a high `deploymentRatio` can make a redeem revert with collateral still on the books |

Run mint+redeem once per supported collateral per chain — that is where the
decimal scaling in `redeem` (`kfUSD.sol:298–314`) is actually tested, and it is
the branch that differs between a 6dp and an 18dp asset.

Redeem a separate slice from the one route 10 locks, so the round trip is proven
without unwinding the lock.

**Where** all five (kfUSD is deployed everywhere; the collateral assets exist
everywhere). **Proves** the mint/redeem maths, the fee accounting and the
collateral split.

### 2.12 Route 10 · kafUSD lock → cooldown → complete — the second seven-day clock

**Needs** the asset being locked. Measured `getSupportedAssets()`, per chain:

| chain | kafUSD accepts | cases |
| --- | --- | --- |
| Sepolia | USDC mock, USDT, USDe, **kfUSD**, USDC Circle | 5 |
| Base Sepolia | USDC mock, USDT, USDe, **kfUSD**, USDC Circle | 5 |
| BSC testnet | USDC, USDT, USDe, **kfUSD** | 4 |
| Robinhood | USDC, USDT, USDe, **kfUSD** | 4 |
| Arc | USDC (gas predeploy), USDT, USDe, **kfUSD** | 4 |

So kafUSD is the widest asset surface in the protocol — 23 lock cases across five
chains — and like kfUSD it consults no oracle, so all 23 are live today. Lock is
1:1 in the asset's own units, which means locking 500 USDC (6dp) and 500 USDe
(18dp) both mint 500 kafUSD: `lockAssets` scales by decimals, and running both
per chain is how that scaling gets tested.

One asymmetry to respect: `completeWithdrawal(asset)` pays out of
`assetLockBalances[user][asset]`, and the agent's `completeWithdrawal` verb only
ever builds a kfUSD payout (`build.ts` refuses anything else with an explanatory
message). So a lock in USDT is completable by script and by the UI but **not** by
the agent. Lock kfUSD for the agent-path test and the other assets for the
contract-path test.

| # | call | arguments | note |
| --- | --- | --- | --- |
| 1 | `asset.approve(kafUSD, amount)` | the asset's own decimals | |
| 2 | `kafUSD.lockAssets(asset, amount)` | | kafUSD minted 1:1; `lockTimestamps[user]` reset to now |
| 3 | `getUserAssetBalance(L, asset)`, `totalAssetsLocked` | reads | |
| 4 | `YieldTreasury.claimYield(asset)` and `claimAndCompound(asset)` | | both may return zero on day 0. Record which |
| 5 | `kafUSD.requestWithdrawal(amount)` | | starts `cooldownPeriod = 7 days` — one clock per user, not per asset |
| 6 | `getWithdrawalTime(L)` | read | seconds left; this is what `/stable` renders |
| 7 | *day 7* `kafUSD.completeWithdrawal(asset)` | | pays out in that asset; for kfUSD, route 9 step 5 then turns it back into collateral |

Because the cooldown is **one clock per user rather than per asset**, locking four
assets and calling `requestWithdrawal` once does not queue four withdrawals — step 5
names an amount, not an asset, and step 7 chooses the asset at payout. Lock all the
assets first, then start the clock once.

Do **not** lower `cooldownPeriod` to make step 7 arrive sooner. It is an owner
call and it would change the deployed product's behaviour to suit the test. Start
the clock on day 0 instead and let the rest of the plan run inside the week.

### 2.13 Route 11 · Faucet, as a new wallet

**Needs** F to hold nothing — including gas, which is itself the first claim. And
that is where three of the five chains fail before the route starts.

**Calls** (F): `claim(token)` per asset, or `claimMany([tokens])` in one
transaction. There is deliberately no `claimAll()`.

Measured drips, cooldown 3600s per asset. **Bold** = the drip exceeds the faucet's
own stock of that asset, so the first claim reverts:

| asset | Sepolia | Base | BSC | Robinhood | Arc |
| --- | --- | --- | --- | --- | --- |
| NATIVE | 0.02 | 0.01 | **not listed** | **not listed** | **not listed** |
| wrapped native | 0.02 (stock 15) | 0.02 (stock 20) | **5.0 / 0.28** | **1.0 / 0.50** | **100 / 8.69** |
| USDC | 10,000 | 10,000 | 10,000 | 10,000 | **100 / 8.69** |
| USDT | 10,000 | 10,000 | 10,000 | 10,000 | 10,000 |
| USDe | 10,000 | 10,000 | 10,000 | 10,000 | 10,000 |
| KLD | 1,000 | 1,000 | 1,000 | 1,000 | 1,000 |
| USDC Circle | **listed, drip 0, paused** | **listed, drip 0, paused** | — | — | — |
| EURC | — | — | — | — | 1.0 (stock 10) |
| cirBTC | — | — | — | — | **0.001 / stock 0** |

Two findings the per-chain view makes unavoidable:

- **A fresh wallet cannot be bootstrapped on BSC, Robinhood or Arc.** None of the
  three lists the native asset, so F has no way to obtain gas and therefore cannot
  claim anything else either. Route 11 is a two-chain route until a native drip is
  added to those three faucets — and on Arc the native asset *is* USDC, which is
  listed with a drip of 100 against a stock of 8.69, so even the ERC20 path there
  pays out at most once.
- **Four drips are guaranteed to fail on first claim** — every wrapped native
  except Sepolia's and Base's, plus Arc's cirBTC at zero stock. That is not a
  faucet bug: `claim` reverts when the contract cannot pay, which is correct. It
  is a funding gap, and it is only visible by comparing drip against stock, which
  is why both are in the table.
- The **paused Circle USDC** slot on Sepolia and Base is the opposite case — the
  faucet has no remove, so the asset stays listed with a drip of 0 forever. The
  `/faucet` UI hides it and a claim on it *must* fail. Confirming that failure is
  the test.

**Where** Sepolia and Base fully; the other three not at all. No script exists and
none should be written: the point of this route is the browser path a new user
takes, so do it at `/faucet`.

### 2.14 Route 12 · The agent, prompt by prompt

The path is: model → `fromToolCall.ts` → `buildIntents` (`build.ts`) →
`auditPlan` (`auditor.ts`) → a resolver in `definitions.ts` signs. 24 execute
tools and 6 reads (`toolCatalog.ts`).

**Three of those resolvers could not have worked, and were fixed in this
session.** Every hand-written signature in `definitions.ts` was checked against
the compiled artifacts by selector; three disagreed, and a wrong signature is not
cosmetic — it hashes to a different selector, so the call reaches a contract that
has no such function:

| resolver | was | is | effect before the fix |
| --- | --- | --- | --- |
| `stake` | `deposit(address,address,uint256)` | `deposit(address,uint256)` | every agent-driven stake reverted; `useStake.ts:86` was right because it reads the generated ABI |
| `withdrawCollateral` | `withdrawCollateral(address,uint256)` | `(address,uint128)` | diamond `FunctionNotFound` |
| `createLendingRequest` | `createLendingRequest(uint256,…)` | `(uint128,…)` | diamond `FunctionNotFound` |

All 25 hand-written declarations now match their artifacts. That check is worth
re-running whenever a facet's signature changes.

**The prompts to type, and what each must produce:**

| prompt | tool | what gets signed | precondition |
| --- | --- | --- | --- |
| "what's in my portfolio" | `getPortfolio` | nothing | — |
| "what chains do you support" | `getChains` | nothing | — |
| "price of KLD" | `getPrice` | nothing | **answers "unpriced"** — KLD/stKLD are in `UNPRICED` (1.8a) |
| "quote 500 USDC to KLD" | `getQuote` | nothing | route 1 |
| "swap 500 USDC for KLD" | `swap` | `approve` + `exactInputSingle` at the deepest tier | route 1 |
| "stake 1000 KLD" | `stake` | `approve` + `KLDVaultV2.deposit` | the fix above |
| "deposit 0.1 ETH as collateral" | `deposit` | `depositCollateral` | 2.2 oracle |
| "borrow 50 WETH for 30 days at 8%" | `borrow` | `createLendingRequest` | route 4 + the fix above |
| "offer 100 WETH to lend" | `lend` | `createLoanListing` | L's WETH |
| "borrow 50 from listing 1" | `takeListing` | `approve` + `requestLoanFromListing` | route 5 |
| "fund request 3" | `fillRequest` | `approve` + `serviceRequest` | request #C left open (2.8) |
| "repay my loan" | `repay` | `approve` + `repayLoan` | routes 5–6 |
| "cancel request 3" | `cancel` | `closeRequest` / `closeListingAd` | terminal — run last |
| "mint 100 kfUSD with USDC" | `mint` | `approve` + `kfUSD.mint` | `MINTER_ROLE` (2.11) |
| "redeem 100 kfUSD for USDC" | `redeem` | `kfUSD.approve(kfUSD)` + `redeem` | route 9 |
| "lock 100 kfUSD" | `lock` | `approve` + `lockAssets` | route 9 |
| "unlock 100 kafUSD" | `unlock` | `requestWithdrawal` — starts the clock, pays nothing | route 10 |
| "complete my withdrawal" | `completeWithdrawal` | `completeWithdrawal(kfUSD)` | day 7 |
| "claim my yield" | `claimYield` | `YieldTreasury.claimYield` | route 10 |
| "collect fees on position 4" | `collectFees` | `NPM.collect` | route 2 traded first |
| "remove half of position 4" | `removePosition` | `NPM.decreaseLiquidity` | route 3 |
| "add liquidity to KLD/USDC" | `provideLiquidity` | `NPM.mint` | route 1 |
| "claim test tokens" | `claimTestTokens` | `Faucet.claim` | route 11 |
| "send 10 USDC to 0x…" | `send` | a bare `transfer` | — |
| "bridge 10 USDC to Base" | `bridge` | — | **not exercisable: LI.FI indexes none of these five chains** |

The agent's swap is single-hop by construction, like the page's:
`build.ts` emits one `exactInputSingle` at the winning tier.
`useV3SwapRouter.ts` does carry a multi-hop `encodePath`, but nothing on either
path calls it — so a pair with no direct pool has no route, however well it could
be bridged through USDC.

**`grantAgentPermission`, with values.** Signed against the diamond's
`AgentPermissionFacet`:

```
grantAgentPermission(
  agent,                    // the delegate's address
  100e18,                   // maxNotionalPerAction — USD, 1e18-scaled
  500e18,                   // maxNotionalPerEpoch
  86400,                    // epochDurationSec — one day
  now + 7 days,             // expiryUnix
  2000,                     // maxInterestBps — 20%
  14000,                    // minHealthFactorBps — 1.40, NOT a percent
  13,                       // allowedActions bitmask
  [WETH, USDC]              // tokens
)
```

`allowedActions` flags, from `LibAgentPermission.sol:21–26`: BORROW 1, LEND 2,
REPAY 4, DEPOSIT_COLLATERAL 8, WITHDRAW_COLLATERAL 16, CLOSE 32. So 13 =
borrow + repay + deposit collateral, which is enough for one delegated borrow and
its repayment and nothing else. `allowedActions == 0` reverts
`Protocol__InvalidPermission`.

Then one delegated action end to end, and `liveActions.check.ts` per chain — it
reads, plans and audits against the live chain and **never signs**, so it is the
cheapest check in the plan and should run after every phase.

### 2.15 Route 13 · Transfer

`send` is the one verb that calls nothing of ours: native leaves as a bare value
transfer, an ERC20 as `transfer(to, amount)`. `receive` builds no transaction at
all by design — `build.ts` returns `error: "receive"` and the page shows a panel.
Do a $1 transfer last, as the check that the signing path itself is sound
independent of every contract above.

### 2.16 The dependency graph, and what is out of reach today

```
route 1 pool ──> route 2 swap ──> route 3 collect ──> decrease
oracle ──> route 4 collateral ──> route 5 listing ──┐
                               └─> route 6 request ─┴─> route 7 repay/close/withdraw
KLD ──> route 8 stake ─────────────────(7 days)────> withdraw
USDC ──> route 9 kfUSD ──> route 10 kafUSD ────(7 days)────> complete
route 11 faucet ──> everything above, as a fresh wallet
routes 1–11 ──> route 12 agent (the same routes, through the audited path)
```

Out of reach today, and each for a stated reason rather than for want of trying:

| what | why | whose call |
| --- | --- | --- |
| **Everything on BSC, Robinhood and Arc** | the deployer holds 0.0014 BNB, 0.0016 and 0.43 — below one transaction's cost. This gates every route on three of five chains, whatever else is true of them | fund the deployer |
| Lending on Robinhood | every feed reverts; the keeper is inert until it merges to main | run the keeper by hand, or merge |
| Lending on Arc | feeds revert **and** the only loanable asset can't reach $10 | needs an irreversible `addLoanableToken` |
| Lending USDe anywhere | registered as neither collateral nor loanable on any chain, though both stablecoins accept it | irreversible registration |
| Lending USDT on Sepolia, Robinhood, Arc | registered on Base and BSC only | same |
| Faucet as a fresh wallet on BSC, Robinhood, Arc | no native drip listed, so F cannot obtain gas to claim anything | add a native drip |
| The four underfunded drips (2.13) | drip exceeds the faucet's stock | plain transfer to the faucet |
| kfUSD mint by anyone but the deployer | `MINTER_ROLE`, and the gate is load-bearing because mint takes no oracle (2.11) | contract decision |
| EURC and cirBTC on Arc | in the faucet, registered with no product — no lending, no stablecoin, no pool | they are the only non-USD and only 8-decimal assets we have; registering one would be the most interesting decimals test in the protocol |
| Any V2 route | factory deployed on all five, zero pairs, no app surface references it | there is no V2 product |
| A KLD price anywhere in the UI | `UNPRICED` by design pre-TGE | 1.8a |
| The agent's bridge | LI.FI indexes none of these chains | mainnet corridor only |
| Liquidation | needs a ~6% adverse move with a live oracle | fork test only (2.9) |
| Sepolia's USDT/USDe pool from the swap page | it is at fee 500 and the page pins 3000 | known limitation (1.3) |

**What that leaves runnable today: Sepolia and Base.** Between them they cover
every product — pool, swap, positions, all four lending combinations, staking,
kfUSD across four collaterals, kafUSD across five assets, the faucet as a fresh
wallet, and the whole agent surface. The three gas-starved chains add chain
coverage, not product coverage, with two exceptions: BSC is the only chain with a
non-ETH native asset priced ($704.64 BNB), and Arc is the only chain with a
non-USD asset (EURC) and an 8-decimal one (cirBTC).

---

## 3. Exercising every product

### 3.1 The inventory

The agent's intent union is the honest list of every write verb the protocol has —
28 kinds in `src/lib/v2/intents/types.ts`. Grouped, with what exists to drive them:

| product | verbs | harness | ever run? |
| --- | --- | --- | --- |
| Faucet | `claimTestTokens`, `claimAllTestTokens` | none (UI, or a new script) | funded on all 5, never claimed |
| DEX V3 swap | `swap` (+ `approve`) | `swap-v3.js` | stable pairs on 4 chains |
| DEX V3 positions | `mintPoolPosition`, `collectPoolFees`, `decreasePoolLiquidity` | `seed-v3-pool.js` mints; `list-positions.js` reads | never collected, never decreased |
| Lending — collateral | `depositCollateral`, `withdrawCollateral` | `seed-lending.js` | Sepolia only |
| Lending — book | `createLendingRequest`, `createLoanListing`, `borrowFromListing`, `fillRequest`, `repayLoan`, `closeListing`, `closeRequest` | `seed-lending.js` | Sepolia only |
| kfUSD | `mintStable`, `redeemStable` | **none** | supply 0 |
| kafUSD | `lockStable`, `requestStableWithdrawal`, `completeStableWithdrawal`, `claimStableYield`, `compoundStableYield` | **none** | supply 0 |
| Staking | `stake` (+ UI-only `requestWithdrawal`, `withdrawStake`, `cancelWithdrawalRequest`) | **none** | stKLD supply 0 |
| Agent | `grantAgentPermission`, plus the whole plan→audit→sign path | `liveActions.check.ts` (reads/plans only, never signs) | Sepolia only, pinned `CHAIN = 11155111` |
| Bridge | `bridge` | `route.check.ts` under `BRIDGE_LIVE=1` | mainnet corridors only — see 3.5 |
| Transfer | `transfer` | none | trivial, do it last |

Two asymmetries worth noticing while doing this: the UI has the full staking
lifecycle and the agent has only `stake`; the agent has `claimAllTestTokens` and
the faucet has never been claimed once.

### 3.2 Two seven-day clocks — start them on day 0

- `KLDVaultV2.sol:54` — `WITHDRAWAL_WAITING_PERIOD = 7 days`
- `kafUSD.sol:51` — `cooldownPeriod = 7 days`

So `withdrawStake` and `completeStableWithdrawal` cannot be tested for a week
after their request legs, and there are two ways to shorten that. Setting
`cooldownPeriod` down on kafUSD is an owner call and would make the withdrawal
path testable in minutes; the vault's is a `constant` and cannot be changed
without a redeploy. Do **not** lower kafUSD's cooldown to make a test convenient —
it changes the deployed product's behaviour to suit the test. Start both clocks
first instead, and let the rest of the plan run inside the week.

### 3.3 Phase order

Each phase depends on the one above it. Per chain unless stated.

**P0 — unblock.** Top up BSC/Arc/Robinhood gas (0.1). Refresh the Robinhood and
Arc oracles and re-measure through the diamond (0.3). Confirm KLD's registry keys
are committed if any UI checking is planned (0.5).

**P1 — the pool.** Section 1, five commands, then `survey-state.js`.

**P2 — trade it.** Both directions, so the tick crosses each way and the in-range
position accrues fees on both sides:

```bash
cd smart-contract && IN=usdc OUT=kld AMOUNT=500 FEE=3000 npx hardhat run scripts/swap-v3.js --network sepolia
cd smart-contract && IN=kld OUT=usdc AMOUNT=10000 FEE=3000 npx hardhat run scripts/swap-v3.js --network sepolia
```

10,000 KLD ≈ $300 and 500 USDC ≈ 16,667 KLD; against $100k of depth both move the
tick a little and neither is a whale. Watch the printed `quote error` — that is the
quoter and the router agreeing, which is what makes the swap page trustworthy.

**P3 — positions.** `list-positions.js` to see the two ids, then collect and
decrease (new script, 2.4). Collect *after* P2 or it returns zero, which is
indistinguishable from broken.

**P4 — start the staking clock.** approve → `stake` → `requestWithdrawal` →
`cancelWithdrawalRequest` → `requestWithdrawal` again, all in one run. The cancel
is worth doing before the final request precisely because it is the verb nobody
would think to test.

**P5 — start the kafUSD clock.** `mintStable` → `lockStable` →
`requestStableWithdrawal`, plus `claimStableYield`/`compoundStableYield` (both may
legitimately return zero on day 0 — record which, so a zero on day 7 means
something). `redeemStable` on a separate slice of kfUSD so the mint/redeem round
trip is proven without unwinding the locked position.

**P6 — the lending book**, on the four chains that have none:

```bash
cd smart-contract && npx hardhat run scripts/seed-lending.js --network baseTestnet
```

then `bscTestnet`, and Robinhood/Arc **only once their oracles answer** (0.3).
Two things to know before running it: it needs a second wallet, and it derives one
deterministically from the deployer key and funds it — that derived key is exactly
as public as the deployer key, which is fine on these testnets and must never
touch mainnet. Set `COUNTERPARTY_PRIVATE_KEY` to a wallet you hold if you want to
open `/borrow` as the borrower.

**P7 — faucet and agent.** Claim from the faucet as a *fresh* wallet, not the
deployer: the deployer already holds 995M KLD and a claim proves nothing about the
path a new user takes. Then `liveActions.check.ts` per chain (3.4), and
`grantAgentPermission` + one delegated action end to end.

**P8 — day 7.** `withdrawStake` and `completeStableWithdrawal`, plus
`claimStableYield` again to see whether a week accrued anything.

### 3.4 What needs writing

Three scripts, each following the repo's one-job/long-header pattern:

- **`scripts/exercise-staking.js`** — P4 and the day-7 leg. Reads `kldVault`,
  `kld`, `stKLD` from the registry; asserts the exchange rate before and after so
  a stake that mints the wrong number of shares is caught here rather than in the
  UI. Also the natural place to assert what the multichain note flags as an open
  gap: a satellite chain should not be able to issue, and today nothing checks it.
- **`scripts/exercise-stablecoin.js`** — P5 and the day-7 leg, kfUSD and kafUSD.
- **`scripts/exercise-positions.js`** — `collect` and `decreaseLiquidity` for a
  token id. `list-positions.js` already carries the `collect` ABI and only reads;
  this is its writing half.

Three smaller changes:

- **`scripts/seed-lending.js` needs an ERC20-collateral path.** It posts collateral
  as `depositCollateral(NATIVE, amount, {value: amount})` and prices the loan
  through `wrappedNative` — and on BSC both of those feeds revert (2.2), so the
  script cannot run there at all even though USDC and USDT both price fine. A
  `COLLATERAL=<registry key>` env switch that approves and deposits an ERC20
  instead is the whole change; the rest of the sequence is asset-agnostic. Until
  it exists, BSC lending is blocked on tooling rather than on the chain.
- `src/lib/ai/liveActions.check.ts` pins `const CHAIN = 11155111`. Take it from
  the environment so the same harness runs against all five. It signs nothing, so
  this is the cheapest per-chain check in the plan and should run after every
  phase.
- No faucet-claim script exists. Claim through the UI instead — see 3.6.

### 3.5 What cannot be exercised on testnet

- **The agent's bridge.** LI.FI does not index any of these five chains, so
  `resolveBridgeRoute` has no aggregator quote to return. The ERC20 path is
  exercisable only on a mainnet corridor, and offline it is covered by
  `route.check.ts` (23 assertions, plus a live pair under `BRIDGE_LIVE=1`). The
  canonical Sepolia→Base path is native-only by corridor fact and has already been
  run for real.
- **Referral registration.** The endpoint returns 503 by design since the env-var
  fix; nothing to test until that is deliberately re-enabled.

Say both out loud in whatever report comes out of this, rather than letting them
read as untested. 2.16 has the full list, including the four lending markets that
are blocked and the reason each is blocked.

### 3.6 Do it through the UI where the UI is the product

Scripts prove the contracts answer. They do not prove the app can reach them, and
the app is what ships. After each phase, one pass on the surface that phase
touched: `/trade/swap` for a KLD quote and a real swap, `/pool/new` for a minted
position, `/borrow` for the seeded book (as the borrower wallet, which is why
`COUNTERPARTY_PRIVATE_KEY` is worth setting), `/stake` for the stake and the
7-day pending-withdrawal state, `/stable` for both stablecoins, the faucet for a
fresh wallet's first claim, and the agent for one delegated action.

`/portfolio` is the one screen that reads all of them at once, and after this plan
runs it should show a nonzero row for every product on every chain. That is the
single best end-state check, and today it is empty by construction.

---

## 4. Order of operations, compressed

| when | what |
| --- | --- |
| before anything | P0: gas on BSC/Arc/Robinhood, oracles on Robinhood/Arc, KLD registry keys committed |
| day 0, first | P1 pool ×5 → P4 staking clock → P5 kafUSD clock |
| day 0, then | P2 swaps → P3 positions → P6 lending → P7 faucet + agent |
| day 7 | P8 `withdrawStake`, `completeStableWithdrawal`, yield re-check |
| after | UI pass per 3.6, then decide 1.8a (KLD's displayed price) |

The reason the two clocks come immediately after the pool rather than in verb
order is that everything else fits inside their week, and they do not.

---

## 5. What needs a go from you

Every command in sections 1–3 signs with the deployer key and spends real testnet
funds. Specifically:

- **five pool creations** (~$100k notional each in mock assets, minted where the
  mock allows it);
- **eighteen swaps** — ten on the new KLD pools, and eight that are the first
  trades ever made on the nine stable pools (2.4);
- **`seed-lending.js` on four new chains**, which funds a deterministically-derived
  counterparty wallet from the deployer;
- **first-ever mints** of stKLD, kfUSD and kafUSD;
- **three new scripts** to write before P3–P5 can run.

Three decisions are yours, not a script's, and section 2 is where each one surfaced:

- **`kfUSD.mint` is `MINTER_ROLE`-gated and the deployer holds it alone** (2.11).
  Every other wallet's mint reverts, on `/stable` and through the agent alike. Make
  it permissionless or grant the role to a gateway — either is a contract change.
- **USDe is registered as neither collateral nor loanable on any chain** (2.2), so
  it has no lending route despite the faucet handing out 10,000 of it.
- **Arc's lending market cannot be exercised at all** (2.2) — its one loanable
  asset is WUSDC, whose only funding route is 0.43 of gas token, below the $10
  minimum. Both fixes need `addLoanableToken`, which is **irreversible**.

None of it touches the scripts on the do-not-re-run list
(`switch-usdc-to-mock.js`, `topup-faucet.js`, `deploy-faucet.js`,
`register-tokens.js`), and nothing here redeploys a contract. The one irreversible
step in the plan as written is opening the pools themselves: a V3 pool cannot be
un-created, and its opening price is set once.

---

## 6. What actually happened — run 2026-08-28

Written after the fact, from the run logs, not from this plan's own predictions.
Where a result differs from what section 2 expected, the difference is the entry.

### 6.1 The one-line answer

**All 13 routes closed on the two chains that can sign — Sepolia and Base
Sepolia.** Three chains could not be run at all, for the reason 2.16 already gave:
the deployer holds less native currency than one transaction costs. That is a
funding fact, not a protocol fact, and no route was skipped for any other reason.

Two clocks are ticking and cannot be closed before **2026-09-04**: the staking
withdrawal and the kafUSD cooldown, both 168h, both armed on both chains.

### 6.2 Route by route

| route | Sepolia | Base Sepolia | reproduction |
| --- | --- | --- | --- |
| 1 · pool | ✅ KLD pool opened | ✅ KLD pool opened | `seed-v3-pool.js` |
| 2 · swap | ✅ | ✅ | `pool-trades.js` |
| 3 · positions | ✅ collect + decrease | ✅ | `exercise-position.js` |
| 4–7 · lending | ✅ all four combinations | ✅ | `exercise-lending.js` |
| 8 · staking | ✅ staked, clock armed | ✅ | `exercise-staking.js` |
| 9 · kfUSD | ✅ mint + redeem | ✅ | `exercise-kfusd.js` |
| 10 · kafUSD | ✅ locked, cooldown armed | ✅ | `exercise-kafusd.js` |
| 11 · faucet | ✅ 6/7 assets, guard named | ✅ 6/7 | `exercise-faucet.js` |
| 12 · agent | ✅ 70 passed, 0 failed | ✅ 63 passed, 0 failed, 1 skipped | `liveActions.check.ts` |
| 13 · transfer | ✅ 6 passed, 0 failed | ✅ | `exercise-transfer.js` |

### 6.3 The KLD pools, as opened

Two of the five in 1.6, because three chains have no gas. Both at **$0.03**, both
fee 3000, both with a full-range and a ±2% position:

| chain | pool | tick at open | positions |
| --- | --- | --- | --- |
| Sepolia | `0x04EfB41F6aCeCB6B1eB46be75A929cD5b42dC1e4` (USDC/KLD) | `311391` | #7 full, #8 ±2% |
| Base Sepolia | `0x32C3E8E8F6620d0D6716F656aa7C92BE87B7E180` (KLD/USDC) | `-311392` | #5 full, #6 ±2% |

The tick's sign flips between them because token ordering does: KLD is token1 on
Sepolia and token0 on Base. Same price, mirrored — worth stating because a reader
comparing the two records would otherwise read it as a bug.

Nine stable pools were already open from 2026-08-27 (three on Sepolia, two each on
Base, BSC and Robinhood). BSC's and Robinhood's exist *because* they were opened
before those chains ran out of gas, which is also what spent it.

### 6.4 Three findings the run produced

**a. Pyth's Hermes now requires authentication, and it had taken every USD figure
down with it.** `hermes.pyth.network` answers `401 unauthorized` on both the
deprecated path this repo called and the current `/v2/updates/price/latest`, from
Pyth's own app tier rather than an edge block — so it is a policy change, not an
outage that passes. Control: CoinGecko answered 200 from the same shell. The
2026-08-24 pool record in this directory still carries live `hermes` quotes, which
dates the break to between then and 2026-08-28.

`src/lib/points/prices.ts` was the single source behind the agent's spend caps,
`/api/market/overview`, `/api/prices/spot`, the leaderboard and points accrual. A
CoinGecko fallback now sits behind Pyth, reached only when Pyth throws, so a
healthy run still reports `source: "pyth"`. Coverage is total rather than partial:
CoinGecko's allowlist is exactly the five `PYTH_FEEDS` keys. **Yours to decide:**
buy a Pyth key, or promote CoinGecko to primary. The on-chain oracles are
unaffected — those are the diamond's own feeds.

**b. A price outage did not degrade the agent, it blanked it.** `fetchPyth` throws
on a non-ok status, and the throw propagated through `valueOf` → the auditor's
`defaultPricer` → `auditPlan`, so the agent returned no plan, no verdict and no
prose — on every product, including verbs that need no price at all. Fixed in
`auditor.ts`: an unreachable source is now distinguished from an asset that has no
market. The first **blocks** the step, because a spend cap that cannot be checked
is not a cap that held; the second passes with a note, because KLD pre-TGE can
never be measured against a USD cap and never will be. Five assertions cover the
split, including a control; the suite is 134 passed, 0 failed.

**c. The faucet's refusal would not name its guard**, printing a bare "execution
reverted" where the whole assertion is *which* guard fired. The cause was not the
one it looked like: the node does return revert data. Under `hardhat run` the
in-process provider throws its own error object first, so ethers never wraps it
and `e.revert` is undefined regardless of what came back. Decoding `e.data`
against the faucet's own interface fixes it — both chains now print
`KaleidoTokenFaucet_CooldownNotOver (decoded from 0x650980c5)`, corroborated
independently by `claimableAt` reading 1.00h from state.

### 6.5 Two things that are correct but look wrong

- **Base's agent run has 7 fewer assertions than Sepolia's** (63 vs 70). Verified
  rather than assumed: nine pool-dependent cases on each side, and exactly three
  invert. Base has no USDT/USDe pool, so those three cases assert one refusal each
  where Sepolia builds a plan and asserts three things. Plus one skip. The harness
  is following each chain's own book, which is what making `CHAIN` dynamic was for.
- **The faucet lists USDC twice and one of them pays nothing.** That is Circle's
  real USDC, neutralised at drip 0 when the mock took over, and it cannot be
  unlisted. `useFaucet.ts` already hides a paused row when a live one of the same
  symbol exists, refuses the claim client-side with a specific message, and renders
  "Paused" otherwise — so it never reaches a user as a failed claim.

### 6.6 Left open

- **`deployment-lending-baseTestnet.json` records only the USDT book.** The second
  Base seed overwrote the file, so the WETH book's ids are no longer in the record.
  They are still on chain, and `exercise-lending.js` reads the book directly rather
  than the record, which is why nothing downstream broke. Worth regenerating.
- **The day-7 legs**, from 2026-09-04: `WITHDRAW=1` on `exercise-staking.js` and
  `WITHDRAW=1 REQUEST=kfUSD` on `exercise-kafusd.js`, each on both chains.
- **Everything in 5 and 2.16 that needs your go** is unchanged by this run — no
  `addLoanableToken` was called, so USDe still has no lending route and Arc's
  market is still unreachable.
- **BSC, Robinhood and Arc need funding** before any of this can be repeated there.
  They would add chain coverage, not product coverage, with the two exceptions 2.16
  names: BSC's non-ETH native and Arc's 8-decimal assets.
