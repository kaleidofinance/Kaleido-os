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
- [ ] **Oracle wiring per chain.** Arc uses **Pyth**. Confirm the oracle wrapper is the Pyth
      variant, `oracleKind` is set, and `getFeedMaxAge` is **per-feed**, never the global 300s.
      A converting points season must never read a testnet-chain price. (Arc was previously
      blocked on Hermes 401 — confirm the feed source is reachable from prod before relying on
      it.)
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

---

_Add a dated line here after each mainnet deploy: what shipped, the addresses, and which of the
above was the closest call. The next deploy reads this first._
