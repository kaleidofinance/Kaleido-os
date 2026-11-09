# Luca protocol coverage and future integration plan

For the broader product vision, online research, durable strategies, contract development and launchpad creation, use the [full agent implementation plan](./LUCA_FULL_AGENT_IMPLEMENTATION_PLAN.md). This document retains the protocol-coverage checklist and historical gap snapshot; revalidate those observations against current source before implementation.

**Status:** proposal and implementation checklist, 9 November 2026. Existing code and local uncommitted changes are not evidence of production deployment or live transaction acceptance. This plan extends [LUCA_AGENT_HARNESS.md](./LUCA_AGENT_HARNESS.md) and reconciles its target architecture with [MULTICHAIN_INTERFACE_MAP.md](./MULTICHAIN_INTERFACE_MAP.md). The current product decision is that testnet mode and mainnet mode are exclusive; browse scope, connected wallet chain, and action chain remain distinct within the selected mode.

## Outcome

Luca should answer with current, scoped evidence about Kaleido's supported products and help users prepare supported actions on each chain. A model may interpret a request and propose a plan; canonical code resolves assets, routes and contracts, validates the plan, simulates when possible, and leaves signing to the user. An unsupported, failed, stale, or partial read must be reported as such, never as a confirmed zero or a completed transaction.

## Verified starting points and gaps

- The tool catalog contains reads for balances, lending, positions, pools, orders, prices, points, swap and bridge routes, alongside action proposals. A declared tool does not establish that its full user flow works on every chain.
- The cloud swap read currently checks native/venue paths and then KyberSwap as a fallback. The planner has a separate KyberSwap/Fly.trade/LI.FI resolver. Quote, review and execution can therefore describe different routes. Peach and Argus are launchpad integrations, not general-purpose aggregators.
- The cloud balance reader has a fixed chain list that omits Arc mainnet and Elysium testnet; an RPC failure may be represented as zero. Other portfolio readers have different coverage.
- Many read tools use the connected chain and do not expose a validated target-chain argument. A walletless fallback can select a configured read chain. Static product facts and documentation may drift from current deployments and capability state.
- Protocol analytics and external pool coverage do not have a complete equivalent in Luca's tools; LP position details and fee coverage are incomplete. Points have their own off-chain data source and must not be presented as on-chain balances.
- The checkout contains uncommitted testnet-mode and chain-context work. Review and test it as part of implementation; do not assume it is deployed. Do not overwrite other work in the shared checkout.

## Target design

### 1. One explicit turn context

At the start of every turn construct and validate a context containing: wallet address and connection state; current wallet chain ID; selected mainnet/testnet mode; optional browse scope; explicit user-requested target chain; current request ID; and a versioned capability snapshot. Recompute it on every turn and invalidate pending quotes or plans when account, chain, mode, asset, amount or relevant settings change.

An explicitly named chain wins for the requested read or action after validation; otherwise use the connected chain. Cross-chain questions carry an explicit set or an 'all in active mode' scope. If no chain can be resolved, ask or provide a clearly labelled public cross-chain answer. Do not substitute a default chain and describe it as the user's wallet chain. Keep mainnet and testnet scope separate, while allowing a clearly labelled answer to an explicit question about the other mode without changing wallet or action scope.

### 2. Capability catalog and integration contracts

Build a typed, server-owned capability catalog from canonical chain metadata, registered contract addresses, asset registrations, configured providers, and operational readiness. Track each product independently: discovery/read support; quote support; plan construction; audit; simulation; signing/execution; and any required keeper, indexer, oracle or liquidity. Distinguish `available`, `unavailable`, `not configured`, `degraded`, and `unknown`; include provenance and observation time where dynamic. A registry entry or a token list is not proof of live liquidity, deployed bytecode, keeper health or execution.

Use this same catalog to drive Luca's tool availability, response context, UI gates and integration tests. Do not embed deployment addresses or mutable launch dates in prompts. Curated conceptual explanations may remain static, with a review owner and date; live capabilities, balances, rates and metrics must come from the relevant structured source.

### 3. One tool and turn pipeline

Create a typed registry describing each tool's input schema, chain scope, capability requirements, timeout, output schema and read/proposal classification. The turn coordinator selects an answer, read, clarification or action proposal. The local parser handles high-confidence explicit commands and narrow deterministic questions; the on-device classifier supplies a non-authoritative hint; the cloud model reasons and requests validated tools. No classifier, FAQ, fallback provider or legacy engine bypasses chain validation, plan building, audit or simulation.

Reads return structured `ok`, `partial`, `unavailable` or `unsupported` results, with chain, source, observation time and coverage. A failed RPC is never zero. Parallelize independent reads with bounded concurrency, timeouts and cancellation; preserve successful chains if another fails. Use cache keys including network mode, chain, account, asset identity and source as relevant. Never use stale data to approve or sign an action.

All providers and legacy paths converge on the existing deterministic proposal-to-plan builder and auditor. Simulate the exact plan where supported; an unavailable simulation is explicitly unverified, not a pass. Revalidate chain, amount, route, spender, expiry, allowance, wallet and slippage at review/signing. A declined network switch or signature ends without submission. Track transaction and bridge status from real receipts/provider status, not from a proposed plan.

### 4. Shared quote and launchpad services

One quote contract serves swap UI and Luca read/plan flows. Compare eligible native Kaleido routes and enabled external aggregators using the same input token addresses, chain, amount, fees and quote time. Normalize output units, execution target, allowance spender, minimum received, expiry, fees, route and source. Rank only comparable executable quotes, state partial-provider failures, and re-quote before execution. A read-only indicative quote that lacks the wallet context required for executable calldata must be labelled and never presented as a guaranteed executable best route.

Provide distinct adapters and discovery rules for Argus and Peach launch tokens. Preserve token identity as `(chainId, address)`, launchpad source and trading-card metadata. Verify the launchpad's actual tradability and route, without asserting every launch has liquidity or mixing launchpad and aggregator categories. A pasted contract must fail clearly if metadata, verification or a safe route cannot be established.

## Product coverage to implement and verify

| Product | Reads and answers | Actions and required checks |
| --- | --- | --- |
| Wallet and portfolio | Current chain; balances by chain and asset; priced/unpriced coverage; collateral, debt, LP and vault positions with partial failures. | Send only to an explicitly supplied address; preserve target chain and wallet confirmation. |
| Swaps | Pair support, current route, quote and minimum; registered and eligible contract-address assets; route source and provider coverage. | Same canonical route service as the UI; validate spender, native value, slippage and fresh quote. |
| Bridges | Source and destination, asset, provider, fees, amount received, route status and partial/unavailable results. | Verify supported corridor and source-chain balance; preserve action chain, recipient and minimum; observe arrival. |
| Lending and borrowing | Markets, rates and terms; collateral, debt, health, borrow capacity and lender positions per chain. | Deposit, withdraw, lend, borrow, fill, repay and cancel through the correct chain's Diamond and registered assets; simulate and avoid cross-chain collateral assumptions. |
| Liquidity | Native and tracked external pools, TVL/volume/fees with source and time; user's positions, ranges, amounts and claimable fees where supported. | Create, add, increase, remove and collect only for a supported manager and venue; external pool visibility does not imply deposit support. |
| Limits | Per-chain orders, status, expiry and fill conditions. | Create/cancel only where settlement, routing and keeper are available; distinguish signed order from on-chain execution. |
| Staking and stablecoin | Per-chain availability, holdings, vault value, cooldown and withdrawal state. | Stake/unstake or mint/redeem/lock/unlock only for deployed, configured capabilities. |
| Rewards and leaderboard | Current season, earned/available/pending points, tasks, referrals and rank or masked percentile from authoritative endpoints. | Offer only supported claim/check-in/task flows; avoid exact-count queries on the hot path; do not infer task completion. |
| Analytics | Kaleido native plus verified aggregator-routed activity and protocol revenue, with chain, period, source and completeness; external venue metrics separately. | Read-only; never present an upstream venue's total volume as Kaleido volume. |
| Testnet faucet | Supported assets, availability and cooldown on the selected testnet. | Use the registered faucet and preserve wallet and chain; no faucet on mainnet. |
| Agent permissions | Current mandate, expiry, allowance and revocation state, scoped to the deployed contract and chain. | Grant/revoke only on explicit user request, within contract-supported actions and with wallet approval. |

## Delivery phases

1. **Baseline and inventory.** Freeze current behavior with a capability matrix for Arc, Robinhood and BSC mainnets, plus every registered testnet including Elysium. Map each product to contracts, providers, read source, actions, health dependencies, UI and Luca tools. Record unknowns separately. Identify current Hostinger commit and configuration without exposing secrets. Acceptance: each claim is linked to code or verified operational evidence and every unavailable capability is labelled.
2. **Context and isolation.** Implement the turn context and exclusive mode handling throughout local, cloud, cache and API paths. Add explicit chain arguments where relevant and eliminate silent default-chain reads. Fix cross-chain balance indexing and preserve per-chain errors. Acceptance: named-chain, connected-chain, walletless and chain-switch scenarios produce the correct scope; RPC failures cannot be reported as zero.
3. **Capability and knowledge source.** Derive availability from the shared catalog and remove mutable claims from hardcoded prompts/FAQ. Include actual deployment state and source freshness, not merely intended deployment. Acceptance: changing a registry capability updates tool policy and UI behavior without editing separate prompt inventories; partial deployments such as Elysium do not imply all products are active.
4. **Unify routing.** Make read and plan paths use shared quote logic for native routes and supported aggregators; implement separate launchpad adapters. Preserve existing route safety checks and avoid asserting support when a provider fails. Acceptance: identical inputs produce comparable route decisions across Luca and Swap, with re-quote and explicit coverage. Test Peach and Argus address-to-card-to-plan separately.
5. **Complete product reads.** Add structured portfolio, positions, rewards and protocol analytics coverage using their authoritative app services. Define per-chain provenance, time windows and partial results. Acceptance: representative answers match the relevant app endpoint or contract at a recorded time, and missing sources are disclosed.
6. **Harden orchestration.** Extract a single turn coordinator and tool registry as described in the harness proposal; converge provider and legacy paths on the same builder, audit and simulation. Add bounded provider failover, cancellation, per-tool latency and privacy-safe traces. Acceptance: local, cloud, streaming and fallback paths cannot bypass the transaction pipeline or claim a transaction happened without a receipt.
7. **Release and observe.** Run deterministic tests, integration checks and desktop/mobile browser journeys for each supported product and network mode. Compare the merged GitHub commit with the Hostinger deployment, check live health and public endpoints, and perform authorized non-destructive live quote/read smoke tests. Record deployment ID, test evidence and any unverified transaction paths. Roll back using the documented Hostinger procedure if a release fails its gates.

## Onboarding a future chain or integration

1. Register verified chain ID, environment, RPCs, explorer, native currency, assets and deployment addresses; verify deployed bytecode and contract ownership separately. Define testnet/mainnet pairing without assuming equivalent contracts.
2. Declare each capability and its dependencies: contract, oracle/feed, indexed assets, liquidity, provider support, keeper, backend configuration and status monitoring. No capability is marked executable on registry presence alone.
3. Add typed read and quote adapters with explicit network and token identity. Validate external responses and targets against reviewed allowlists; configure timeouts, failure behavior, observability and secret handling on Hostinger.
4. Implement action build, audit, simulation and wallet-switch behavior. Require explicit provider/corridor support; aggregator chain coverage alone does not prove a token, pool or route works. Treat launchpads as their own integration class.
5. Add fixture-based contract tests, failure/timeout tests and a chain-by-product acceptance matrix; test native and ERC-20 assets, decimals, missing liquidity, stale quotes and mode changes. Run authorized real-provider quote and testnet transaction checks, recording hashes and outcomes. Mainnet transaction tests require an appropriately funded and authorized wallet and must not be inferred from simulations.
6. Release behind the established network/capability gate, deploy the same GitHub commit to Hostinger, verify live version, endpoints and browser flows, then update product facts and announcements from verified capabilities.

## Required acceptance scenarios

- Ask “what chain are we on?” after switching Arc → Elysium → Robinhood; Luca names the current wallet chain each time and does not reuse history. Disconnected or unknown chains are never guessed.
- Ask for BSC balance while connected to Arc, and for all testnet balances in testnet mode. Results state scope and coverage; an unavailable RPC appears as unavailable, never zero.
- Ask for a swap quote and then request the trade for the same amount. Luca and the UI use the same route policy; the reviewed transaction is re-quoted and names its actual venue, amount, fees and minimum.
- Paste an Argus token and a Peach token; check source, metadata, quote, card and supported plan. Failed or unsupported launches cannot become signable actions.
- Ask for a loan, pool, LP position and limit order on each deployed chain; missing contracts or keepers produce an honest unsupported/degraded response, without falling back to another chain.
- Compare analytics and rewards answers with authoritative endpoints, including partial results and current timestamps. Test a failed indexer, failed RPC, provider timeout and stale cache.
- Switch network or wallet after a quote, cancel signing, and reject a malicious or unknown tool proposal. No stale plan can be submitted and no transaction is reported complete without a receipt.
- Verify model-provider fallback, latency, structured tool responses, accessibility and desktop/mobile chat behavior. Keep logs free of keys, signatures, raw balances and transaction calldata.

## Release evidence and remaining decisions

For each phase retain a short matrix: chain, environment, product, read/quote/build/audit/simulate/execute status, test method, timestamp, source and failure/unknown. Separate code tests, live reads, browser acceptance and actual signed transactions. Production readiness is per capability, not a single claim that Luca supports every product on every chain.

Decisions to resolve during implementation: canonical source and ownership for analytics/rewards freshness; which external liquidity venues support LP management; per-provider timeout and ranking policy; exact scope of authenticated wallet identity; and Hostinger health/deployment verification. Do not invent missing contract addresses, provider coverage or business rules to fill these gaps.
