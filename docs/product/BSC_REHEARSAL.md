# BSC build and fork rehearsal

Completed 26 October 2026. All transactions were on localhost Anvil, chain ID 56, forked from BSC. No mainnet transactions or deployments.

## Source and build verification

Built clean merged source commit `9e17051071a597d01d2d3d8168b38932a192ea77` in sibling `merge-rewards/smart-contract`. Used the primary checkout's installed dependency directory through a local junction because this task's smart-contract dependency directory is incomplete. Solidity source was not edited to make the compiler pass. Compilation completed for **274 files**, targets Istanbul/Paris.

The recorded checks compare compiled runtime with live Arc code after removing Solidity CBOR metadata and masking compiler-declared immutable/link ranges. All **13** matched: Diamond, six facets, AggregatorPriceOracle, OrdersV2, V3 factory, router, position manager and quoter. Exact Arc addresses, compiler versions, normalization counts and outcomes are in `BSC_REHEARSAL.json`. This is runtime parity for those components, not a proof that every historic source file or deployment script matches.

Deployment artifacts checked for those targets remain below EIP-170's runtime size limit. V3 NFT descriptor/library deployments also succeeded with Anvil's normal contract-size checks. V3 pool creation-code hash matches the periphery source constant and a newly created pool accepts a swap callback.

## Configuration rehearsed

- Canonical WBNB and native label BNB.
- Chainlink traditional BNB/USD, USDC/USD and USDT/USD feeds; oracle reads on the real BSC fork.
- Per-feed age bounds proposed and exercised: BNB 120s; stablecoins 1,200s. These are engineering candidates based on the published heartbeats, not a final asset-risk approval.
- Arc-equivalent protocol fee 500bps of interest, liquidation penalty 640bps, global age 300s and confidence bound 100bps. Aggregator confidence is zero; the confidence bound is therefore inactive for these feeds.
- OrdersV2, zero filler fee, exact Kyber V2 target allowlisted.
- For exercise coverage, native BNB, WBNB, USDC and USDT were registered as collateral and loanable assets, collateral first. This broad rehearsal registration is **not the final production lending admission policy**.
- Fee vault was a local test account. The actual production vault still needs explicit selection and BSC verification. Ownership transfer remains deferred.

Candidate settings: `smart-contract/config/bsc-mainnet.candidate.json`.

## Fork scenarios passed

1. Deploy/configure oracle, complete V3 stack, OrdersV2, diamond and facets.
2. Wrap real native BNB into real WBNB; approve/deposit collateral; borrow native BNB; lender services request; repay; lender withdraws; borrower recovers collateral.
3. Deploy and initialize a Kaleido V3 pool; mint an LP NFT using real WBNB and USDT; swap; execute a chain-56 signed OrdersV2 fill through that router; remove liquidity and collect.
4. Verify OrdersV2 EIP-712 domain chain ID is 56 and read back per-feed bounds.

USDT test funds were injected into the real token's balance mapping on the local fork, with `balanceOf` verification. Test liquidity and the initialization price were artificial test fixtures and do not establish market depth, safe prices or a production LP plan. The script checks `anvil_nodeInfo`, a fork URL, localhost-only connection and chain 56 before any send. It resets only that local fork. One-second block timestamps keep historical fork feeds from aging during script execution; this is not a test of future oracle availability.

The completed run used Blast's public BSC endpoint for the upstream fork and Cancun execution rules. PublicNode refused archive storage; BNB dataseed returned missing-trie errors; dRPC rate-limited fork initialization. A production archival RPC is still needed for repeatable CI/indexing. This local EVM rehearsal does not reproduce BSC consensus/system processing or guarantee exact future live gas costs.

## Focused contract checks

**201 passing**, using Hardhat's local network and compiled artifacts:

`LendingHardening`, `LendingInterestCap`, `FeedMaxAge`, `AggregatorPriceOracle`, `AgentPermission`, `KaleidoOrders`, `KaleidoOrdersV2.aggregator`.

These cover stale-feed behavior, liquidation/accounting, principal-plus-interest borrowing limits, delegation bounds, signatures, cancellation/expiry and aggregator min-output enforcement. They complement the BSC fork scenarios; they are not browser or live-provider execution proof.

## Gas funding

| Measurement | Result |
| --- | --- |
| Rehearsed deployment plus configuration gas | 35,823,955 |
| Observed live gas price | 0.05 gwei |
| Estimated cost at that price | 0.00179119775 BNB |
| With 50% gas reserve | 0.002686796625 BNB |
| Live deployment wallet balance | 0.008989968228597829 BNB |

The observed balance covers this rehearsed transaction set with the stated reserve. Scenario trades/liquidity, future configuration changes, ongoing keeper gas and future fee changes are excluded. Refresh price, balance and transaction estimates immediately before any approved broadcast.

## Still required for launch

- Freeze production collateral/loanable admission, fee vault, keeper identity and oracle freshness policy; validate pegged asset backing/controls independently of underlying USD feeds.
- Wire chain 56 into reviewed deploy-script feed tables and token aliases; the candidate file is not automatically consumed by the existing deploy commands.
- Build and simulate live Kyber calldata in both directions, including native value/refunds, allowance spender, recipient and minimum output. Test actual LI.FI and Relay corridors separately.
- Configure/verify keeper fills with real aggregator build responses, chain-56 signatures and endpoint authentication.
- Add mainnet deployment manifests only after actual deployment. Then regenerate registry, enable app capabilities, run chain-isolated pricing/rewards/analytics checks and desktop/mobile wallet flows, and deploy Vercel plus all Hostinger sites.

No mainnet broadcast is part of this report. Liquidity seeding, mint/redeem, KLD staking and ownership transfer remain deferred.
