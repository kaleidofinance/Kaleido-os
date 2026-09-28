# Arc Mainnet Contract Deploy — Pre/Post Checklist

The purpose of this file is one thing: **no contract goes to Arc mainnet until every hole
below is checked, and none is announced until the post-deploy verification passes.** Past
mainnet deploys were redone multiple times because a hole was found *after* going live. Each
item here is a hole that has actually bitten this project or a class of it. Work top to
bottom; do not skip because it "looks fine."

> Scope: this covers deploying the protocol contracts (lending diamond, staking vault +
> stKLD, kfUSD/kafUSD + YieldTreasury, DEX V3/V2, oracle wrapper) to Arc mainnet (chainId
> **5042**, native gas = USDC, 18-dec; `0x3600…` is the 6-dec ERC20 alias — never register
> both). It does **not** cover the swap/bridge integrations, which are already live.

---

## 0. Before you touch mainnet — parity on testnet

- [ ] The exact commit you will deploy is deployed and **green on Arc Testnet (5042002)** first —
      same constructor args, same wiring, same order. Mainnet is not the place to discover a
      constructor takes the args in a different order.
- [ ] `cd smart-contract && npx hardhat compile` is clean (no warnings you have not read).
- [ ] Scoped tests pass for what you are deploying: KLD + staking + faucet = **84/0** is the
      known-good baseline; the full suite has **20 pre-existing failures (166/20)** that are
      NOT yours — confirm your diff does not add to them.
- [ ] Constructor args are re-derived from the `.sol` source + generated ABI, not copied from a
      previous chain's deploy script. **tsc/typecheck passing is not behaviour** — read the
      constructor.

## 1. The specific bugs that caused past redeploys — confirm each is absent

- [ ] **Vault → treasury pointer.** Every staking vault before #48 pointed at the pre-#48
      treasury and *never accrued*. Confirm the vault's treasury address is the one you are
      deploying now, not a constant carried from an old script. The vault's stKLD is
      **immutable (constructor-only)** — a wrong pointer means a redeploy, not a setter.
- [ ] **YieldTreasury over-entitlement.** `userRewardDebt` was never initialised → holders were
      over-entitled **55×** → PANIC 17 on claim. Confirm the init path sets every holder's
      reward debt before the treasury can pay out.
- [ ] **Idle-collateral / borrow accounting.** Confirm `collateral_idle` is only collateral NOT
      backing a live loan, and health-factor floors match `Constant.sol` (liquidation at 1.0,
      not a stale value).
- [ ] **Oracle wiring per chain.** Arc **mainnet** uses **Chainlink push feeds** through
      `AggregatorPriceOracle` (`oracleKind` = aggregator-v3) — NOT Pyth. (Arc *testnet* runs the
      same oracle path on our own `PushablePriceFeed`s since 2026-09-28 — Chainlink has no Arc
      testnet feeds.) Pyth is deployed on Arc mainnet but no feed has ever been pushed to it, and
      relaying needs a paid Hermes key. Confirm `getFeedMaxAge` is **per-feed**, never the
      global 300s. A converting points season must never read a testnet-chain price.
- [ ] **Fee receivers / ownership.** Every `setFeeVault`, `setSwapRouter`, `setBps`,
      `setLiquidityBps`, `YIELDSOURCE_ROLE` grant is applied and points at the **mainnet**
      wallet, not a testnet leftover. Ownership stays with the deployer only if that is the
      intended custody model for mainnet (it was for testnet — decide explicitly here).

## 2. Registry + init — the DEX and diamond gotchas

- [ ] **`poolInitCodeHash`** matches the compiled periphery bytecode. This is the highest-risk
      DEX field: a wrong hash makes `pairFor` derive addresses for pools that don't exist, and
      there is no revert — swaps just route to nothing. Re-derive it from the actual deployed
      bytecode, do not trust a docs value.
- [ ] Diamond is deployed as a **set**, in order: `DiamondInit` → facets (`ProtocolFacet`,
      `AgentPermissionFacet`, `OwnershipFacet`, loupe/cut) → `diamondCut` → wiring. A facet
      missing from the cut is a silent "function not found on ABI" at call time.
- [ ] ABIs consumed by the app come from `artifacts/`, regenerated this deploy — **never**
      hand-edited `src/abi/`. `protocolErrors.ts` union ABI is current (so reverts decode to
      friendly names, e.g. `0xd4030a2a = NoCollateralDeposited`).
- [ ] `src/constants/deployments.generated.ts` is regenerated (not hand-edited) and committed;
      `chains.ts` / `registry.ts` carry the new mainnet addresses; `native-alias` tag is on
      `0x3600…` and **only** it (USDC not double-listed).

## 3. Deploy — one thing at a time, record everything

- [ ] Deploy **one product per transaction batch**, recording each address as it lands. Do not
      batch the whole protocol into one script whose failure leaves you guessing what deployed.
- [ ] The **zeroth tx cannot be gas-paid by the account itself** — the deployer must be
      pre-funded with Arc USDC (the gas token) before the first deploy.
- [ ] An RPC `ConnectTimeout` **may still have landed** — before re-sending any deploy tx, read
      chain state (`eth_getCode` at the expected address) to confirm it did not already deploy.
      A blind retry is how you get two of the same contract.

## 4. Post-deploy verification — MUST pass before announcing

- [ ] `npm run verify:pools` — the standing pool check (21/21). Any miss = do not announce.
- [ ] `npm run verify:schema` + `npm run verify:leaderboard` — the DB/route contract matches
      what the app queries.
- [ ] On-chain smoke reads via raw `fetch` + `ethers.Interface` (not just tsc): `getContracts(5042)`
      returns the new addresses; the oracle returns a fresh price for one feed; a `staticCall` of
      one real user action (e.g. a small borrow) does **not** revert at estimate.
- [ ] One real **end-to-end tx per product** from a funded test wallet on mainnet (a $1 borrow,
      a stake, a mint), confirmed on `arc-scan.org`, then unwound. Simulation is not landing.
- [ ] **Points chain enablement:** `point_chains` has `5042` `enabled: true, is_testnet: false`
      (already true). If the product is a `time` source (lend/stake/lp/vault/borrow/collateral),
      confirm its accrual collector exists **before** users can create positions, or the first
      days of activity go uncredited and cannot be reconstructed cleanly.
- [ ] Vercel env for prod carries any new address/receiver the server reads; redeploy so the
      serverless functions pick it up; prove it by grepping the served chunk, not by assuming.

## 5. Rollback / redeploy-avoidance

- [ ] If a hole is found post-deploy: **do not** silently redeploy over it. Snapshot state,
      pause if the contract allows it, re-verify, then migrate with a recorded plan
      (snapshot → pause → re-verify → fund → credit → finalize is the pattern that worked for
      the vault/treasury migration). Old contracts' funds may be **stranded forever** if there
      is no owner exit — confirm an exit path exists *before* you need it.
- [ ] Never run `supabase migration repair --status reverted` to "fix" history — it corrupts the
      shared migration history for every checkout.

## 6. Arc mainnet lending — decisions and runbook (planned 2026-09-27)

**Decided (owner, 2026-09-27):**

| | Choice | Reversible? |
|---|---|---|
| Borrowable | **native USDC** only (`NATIVE` = address(1), priced USDC) | **No** — a loanable token can never be removed |
| Collateral | **EURC** `0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1` (6dp), **cirBTC** `0x171A4217b86A807A64eB94757Db6849fb4bDbAA0` (8dp) — both Circle FiatToken (shared impl `0xc6061272…cf3c`) | Adding more is a setter; removing strands depositors |
| Never | `0x3600…` (same balance as native), `0x8c6c…` (reads "WETH", wraps USDC), third-party WETH, memes | Enforced by `scripts/libraries/chain-asset-rules.js` |
| Oracle | Chainlink: USDC/USD `0x84EA90AC…7905`, EURC/USD `0x361b95c1…Bf23`, BTC/USD (for cirBTC) `0xa109B535…03De`; bound **97,200s** each | Feeds: `AggregatorPriceOracle.setFeed` / `LendingAdminFacet.setTokenFeed` |
| Protocol fee | **500 bps** (5% of interest; Aave's USDC reserve factor is 10%) | `setBPS`, ≤ 2500 |
| Liquidation penalty | 640 bps (liquidator ~4.8%) | `setLiquidityBps` |
| Custody | **Deployer `0x0Ce7…51Bc` for now**, Safe later via two-step `transferOwnership` → `acceptOwnership` | Two-step: a wrong nominee is re-nominated |

Measured before deciding: KyberSwap sells of cirBTC lose 0.14% at $10k / 0.70% at $250k, EURC
0.03% / 0.45% — liquidations stay profitable well past $250k.

**Phase A hardening (contracts, must be in the deployed commit):** `Diamond.initialize` removed
(immutable, wrote one slot off); two-step ownership; `LendingAdminFacet` (pause that never
blocks repay/withdraw/liquidate, `setTokenFeed`); collateral valuation skips zero balances (one
stale feed no longer freezes everyone); `addLoanableToken` once-only, non-zero feed, cannot
overwrite a collateral feed; `MAX_FEED_PRICE_AGE` 90,000 → 108,000 (Arc's stable feeds post
only on the 24h heartbeat — walked gaps 86,404–86,487s left ~58 min under the old cap);
OpenZeppelin pinned to 5.4.0 and its ReentrancyGuard vendored as `LendingReentrancyGuard` (the storage layout depends on `_status` at slot 0 — a test reads slots 0 and 1 of a live diamond); `receive()` and `example()` removed from the Diamond (a plain USDC transfer now reverts instead of being stuck forever); depositing collateral is never paused (borrowers can defend positions) and only accepts collateral tokens (native USDC, loanable-only, is refused); a debt-free user can withdraw during an oracle outage; `setTokenFeed` proves the new feed prices in the same tx. Scripts refuse FEED_*/AGGREGATOR_*/FEED_MAX_AGE_*/ORACLE_BACKEND env overrides on mainnet and dry-run every registration before the first send. Independently reviewed 2026-09-27: no blockers.

**Known, not fixed in Phase A (facet-upgradeable later):** a USDC/USD answer older than its 97,200s bound blocks `repayLoan` for every borrower (the repay path prices the loan currency); the app's `src/abi/ProtocolFacet.json` and error catalogue need regenerating from artifacts (new errors: Protocol__Paused, Protocol__InvalidPriceFeed, OwnershipZeroAddress, OwnershipNotPendingOwner; new LendingAdminFacet ABI); `AggregatorPriceOracle.transferOwnership` is single-step — include it in the Safe handover; existing testnet diamonds lack LendingAdminFacet and two-step ownership until upgraded (Phase B).

**Before running anything below:** Phase B — rehearse the exact commands on an anvil fork of
Arc mainnet, then deploy the same commit on Arc Testnet (§0). Re-walk each Chainlink feed over
≥ 30 days and confirm 97,200s still covers the worst gap. Every command refuses to broadcast
on mainnet without `CONFIRM_MAINNET=5042` and prints its full plan first — read every row.

```bash
# 1. Oracle (maps the three feed ids to the Chainlink proxies in aggregator-feeds.js)
CONFIRM_MAINNET=5042 npx hardhat run scripts/deploy-oracle.js --network arcMainnet

# 2. Diamond + all five facets. Every money setting must be explicit on mainnet.
PYTH_PRICE_ORACLE=<oracle from step 1> KALEIDO_FEE_VAULT=0x0Ce7f8Aeaad60b9E19ACBe9803518182adC351Bc \
PROTOCOL_FEE_BPS=500 LIQUIDATION_PENALTY_BPS=640 PRICE_MAX_AGE_SECONDS=300 PRICE_MAX_CONF_BPS=100 \
CONFIRM_MAINNET=5042 npx hardhat run scripts/deploy.js --network arcMainnet

# 3. Assets — collateral first (the script orders it), then the permanent loanable.
COLLATERAL_TOKENS="EURC=0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1,CIRBTC=0x171A4217b86A807A64eB94757Db6849fb4bDbAA0" \
LOANABLE_TOKENS="NATIVE" NATIVE_FEED_SYMBOL=USDC \
CONFIRM_MAINNET=5042 npx hardhat run scripts/register-tokens.js --network arcMainnet

# 4. Read-only verification — must be all green before anything is announced.
npx hardhat run scripts/verify-diamond.js --network arcMainnet
```

(PowerShell: set each as `$env:NAME="value";` before the command.)

**Every money setting must be typed on the command line for the run.** `smart-contract/.env`
holds leftovers from testnet work (all six settings above, and `NATIVE_FEED_SYMBOL=BNB`); the
mainnet guard now refuses a setting that only came from `.env`.

### Phase B — rehearse on a fork of Arc mainnet (done 2026-09-28, repeat before the real run)

```bash
anvil --fork-url https://rpc.mainnet.arc.io --chain-id 5042 --port 8545
# fund anvil's public test account #0 (0xf39F…2266) with anvil_setBalance, then run
# steps 1–4 above with --network arcFork instead of arcMainnet, then:
npx hardhat run scripts/rehearse-lending-fork.js --network arcFork
# afterwards: delete smart-contract/deployment-*-arcFork.json — never gen:registry them
```

`arcFork` is hardwired to 127.0.0.1 and signs with anvil's public test key, never the deployer,
so a mistake cannot reach the real chain. The rehearsal refuses to run anywhere but anvil.

Result on real EURC / cirBTC / Chainlink: runbook steps 1–4 pass; a full loan (fee exactly 5% of
interest, lender withdraws the native-USDC repayment from the ledger), pause, a normal liquidation,
an over-collateralised liquidation, two-step ownership and the refusals all pass.

It found and we fixed: (1) the guard accepted `.env` leftovers as "explicit" (and `hardhat run`
executes in a child process, so the shell snapshot is passed down in `KALEIDO_SHELL_ENV_KEYS`);
(2) `verify-diamond` priced native USDC with `.env`'s stale BNB symbol; (3) **liquidation seized
only the loan's locked collateral** while eligibility used the whole account — an
over-collateralised borrower's lender recovered ≈ $7.00 of $10.50 and the liquidator nothing.
Liquidation now takes the shortfall from the borrower's free collateral (never another loan's
lock); on the fork the same case pays the lender ≈ $10.51, the liquidator and the fee vault.
ProtocolFacet is now **24,412 bytes (164 under EIP-170)** — the next facet change must reclaim
space first (e.g. string `require`s → custom errors).

Still to do before mainnet: a ≥ 30-day walk of each Chainlink feed, and the app's ABI/error
regeneration. (Arc Testnet parity deploy: done 2026-09-28, see below.)

### Arc Testnet parity deploy (done 2026-09-28)

The mainnet runbook, same commit (`e6aac77` + scripts only), same order and money settings, on
Arc Testnet (5042002). One unavoidable difference: **Chainlink publishes no Arc testnet feeds**
(its directory lists `arc-mainnet` only; the three mainnet proxies have no code on 5042002), so
step 0 deploys our own `PushablePriceFeed`s (Chainlink `AggregatorV3` interface, seeded from
CoinGecko while Hermes 401s) and everything after it is the identical `aggregator-v3` path —
USDC / EURC / CIRBTC-on-BTC, 8 decimals, 97,200s bounds.

```bash
npx hardhat run scripts/deploy-pushable-feeds.js --network arcTestnet
npx hardhat run scripts/deploy-oracle.js --network arcTestnet
# then steps 2–4 of the runbook above with --network arcTestnet and the testnet tokens:
#   EURC 0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a, CIRBTC 0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF
PRICE_ORACLE=<oracle> PUSHER_ADDRESS=0xB37d079F6AccE50332043cf20e1f4FFD363799aE   npx hardhat run scripts/grant-pusher.js --network arcTestnet
KALEIDO_DIAMOND=<diamond> COLLATERAL=<EURC> COLLATERAL_AMOUNT=15000000 SMOKE_KEY_FILE=<outside repo>   npx hardhat run scripts/smoke-lending-live.js --network arcTestnet
```

Rehearsed first on an anvil fork of Arc testnet (`--network fork`; `rehearse-lending-fork.js` is
now chain-aware): runbook 0–4 green, flows A–E green. The rehearsal found one harness bug — a
liquidation estimated one block early drifted ~270 gas and died on EIP-2200's SSTORE sentry
(`ReentrancySentryOOG`, 351,105 limit vs 351,376 needed), so the rehearsal pads liquidation gas
×1.2 like any liquidator bot. Also fixed: `resolveSelfHosted` now ignores `pricefeeds-*fork*.json`
off a fork (a fork record carries the real chain id and would have been registered on the real
chain).

**Live result:** diamond `0x898e9774b58d23d2EFEF3eb940782d9Ee1a03fa3`, oracle
`0xB7E60c8fE8f7F86ee51F24426F4c75BaB44a6564`, feeds in `pricefeeds-arcTestnet.json` (owner
`0x0Ce7…`, keeper `0xB37d…` granted pusher). `verify-diamond` green (all 6 facets routed, three
prices fresh on per-feed 97,200s bounds). `smoke-lending-live.js` landed and unwound a real
10.5 USDC loan against 15 EURC: fee exactly 5% of interest to the vault, lender withdrew in native
USDC, collateral returned. The old Pyth-backed Arc testnet diamond `0x90a1…fa96` (empty, stale
feeds) is superseded in the registry, not destroyed.

**Keeping it live:** the app keeper (`src/lib/keeper/pushFeeds.ts`) prices from `PYTH_FEEDS`,
which has no EURC/BTC, and the Worker is scoped to 46630 — so these feeds are kept fresh by
`PUSH_ALL=1 npx hardhat run scripts/push-aggregator.js --network arcTestnet` inside 97,200s until
the keeper learns those symbols.

### The five existing testnet diamonds — upgrade in place (rehearsed 2026-09-28)

All five are owned by `0x28b7…8955`, the testnet deployer whose key was committed to the repo
(public). `scripts/upgrade-lending-hardening.js` upgrades each in ONE cut — ProtocolFacet
Replace, OwnershipFacet Replace + Add, LendingAdminFacet Add, Remove the dead `pyth()` /
`pythPriceOracle()` — proves every request, lock and participant balance is unchanged, then
nominates a new owner who accepts (two-step), taking ownership off the leaked key.

Rehearsed on anvil forks of all five (`FORK=1`, owner impersonated) plus
`scripts/smoke-upgraded-fork.js` (new owner pauses/unpauses; health factors read; a REAL overdue
loan from the existing book liquidated with a consistent ledger). Results: Sepolia 422 values /
67 requests, Base Sepolia 380 / 41, BSC 37 / 3, Robinhood and Arc testnet empty — all unchanged,
all handed to `0x0Ce7…`, all smoke tests pass. The real-network path (owner deploys + signs, tops
up the new owner's gas, new owner accepts) was rehearsed on an Arc testnet fork with a stand-in key.

Real run, per chain (smallest first: Robinhood → Arc → BSC → Base Sepolia → Sepolia):

```bash
KALEIDO_DIAMOND=<diamond> DRY_RUN=1 npx hardhat run scripts/upgrade-lending-hardening.js --network <net>
KALEIDO_DIAMOND=<diamond> OWNER_PRIVATE_KEY=<0x28b7 key> NEW_OWNER=0x0Ce7f8Aeaad60b9E19ACBe9803518182adC351Bc \
  ACCEPT=1 npx hardhat run scripts/upgrade-lending-hardening.js --network <net>
npx hardhat run scripts/verify-diamond.js --network <net>
```

---

- **2026-09-28 — the five testnet lending diamonds upgraded in place** with
  `upgrade-lending-hardening.js` (order Robinhood → Arc → BSC → Base Sepolia → Sepolia): every
  cut verified live, state unchanged (Sepolia 422 values / 67 requests, Base Sepolia 380 / 41,
  BSC 37 / 3, Robinhood + Arc empty), `verify-diamond` green on all five, ownership accepted by
  `0x0Ce7…51Bc`. The leaked `0x28b7…` key's native balances swept to `0x0Ce7…`. **Still owned by
  the leaked key on all five testnets:** faucet, kldVault, orders, lending `priceOracle`, mock
  USDT/USDe, v3Factory (owner); admin role on KLD, stKLD, kfUSD, kafUSD, YieldTreasury; ≈ 1B KLD
  and mock stables held per chain. The oracle is the urgent one — whoever holds that key can
  repoint lending prices.
- **2026-09-28 (later) — everything else the leaked key controlled moved to `0x0Ce7…51Bc`**, oracle
  first, with `migrate-leaked-key.mjs` driven by `survey-leaked-key.mjs` (every deployment record
  **plus every `CREATE` address from the key's 1,318 nonces** — the nonce walk found ~30 contracts no
  record names: old mocks, Robinhood mock stocks, four Robinhood contracts paying fees to the key).
  Fork-rehearsed on all five (second pass a no-op), then live: 534 steps — lending `priceOracle`
  and Robinhood's two `PushablePriceFeed`s (pusher revoked, keeper `0xB37d…` still a pusher), every
  `Ownable`/V3 `setOwner`/V2 `feeToSetter`/`feeTo`/`feeRecipient`, every AccessControl role
  (granted to `0x0Ce7`, renounced, admin last), the key's lending-ledger balance (Sepolia 0.145 WETH,
  Base 120.8 USDT), 48 V3 LP position NFTs, and every ERC20 balance (~1B KLD + ~1B mock USDT/USDe
  per chain, stKLD, kfUSD, kafUSD, mock USDC, WETH, EURC, cirBTC). A fresh post-survey of all five
  finds the key controls nothing, except the **Sepolia "USD Theters" mock `0xeAeE…f6a2` (nonce 25):
  immutable owner with `mint`, no transfer function — its mint right stays with the leaked key
  forever; it is in no Sepolia record or registry**. Residue: gas dust, and the key remains the
  *lender* on six old serviced loans (Sepolia #1 #2 #34, Base #1 #2 #3) — a repayment would credit
  its ledger, so re-run `survey-leaked-lending.mjs` and sweep if one is repaid. Arc mainnet was
  checked too: the key never transacted there (nonce 0) and owns nothing.
  Lesson: Arc testnet's RPC once answered real `hasRole` checks with revert-shaped errors, which
  read as "no role" and left three contracts' roles behind on the first pass — the survey now
  disables batching and only believes a revert that repeats; always post-survey, never trust the
  migration's own checks alone.

_Add a dated line here after each mainnet deploy: what shipped, the addresses, and which of the
above was the closest call. The next deploy reads this first._
