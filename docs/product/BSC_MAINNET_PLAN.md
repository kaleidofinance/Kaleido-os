# BNB Smart Chain: full Kaleido mainnet rollout

Planning date: 26 October 2026. Planning only; no broadcasts or deployments authorized by this document.

## Scope

Bring lending, Kaleido DEX infrastructure, Luca swap/bridge and portfolio reads, limit orders and keeper, token discovery, pool reporting, analytics, and rewards accounting to chain 56. Keep stablecoin mint/redeem, KLD/staking, liquidity seeding, and ownership transfer deferred. Reuse the Arc deployer/keeper wallet subject to an explicit live identity and BNB balance check. A Safe on another chain is not proof of a usable BSC Safe.

## Existing evidence and gaps

Inspected merged main commit 9e17051071a597d01d2d3d8168b38932a192ea77, rather than treating the current dirty worktree as deployed source.

- `src/constants/chains.ts` already defines BNB Smart Chain (56), BNB gas and BscScan; `smart-contract/hardhat.config.js` already has the `bsc` deployment target.
- `src/constants/registry.ts` already lists WBNB, Binance-Peg USDC/USDT (both configured with 18 decimals), and BTCB. These are candidates to verify, not approval for lending.
- Existing BSC deployment manifests found in this inspection are testnet manifests. Do not copy their contracts, feeds, mock tokens, or faucet configuration into mainnet.
- `src/lib/swap/kyberswap.ts` currently enables only 5042 and 4663. BSC needs an explicit chain slug, independently verified router and allowance targets, plus quote/build/simulation checks.
- `smart-contract/scripts/libraries/aggregator-feeds.js` contains BSC testnet configuration, but no chain-56 oracle backend entry was found in this inspection. Mainnet feeds need a reviewed table and live round validation.
- The Arc diamond manifest records ProtocolFacet upgrades and LendingAdminFacet. The final reference is the live Arc loupe, owner/configuration and verified implementation source; an early manifest alone is insufficient.
- `docs/product/MULTICHAIN_INTERFACE_MAP.md` is a useful reporting/action model, but its suggested second Swap network selector was superseded by the user's decision to retain the existing header selector.

## Delivery gates

| Gate | Work | Required evidence before proceeding |
| --- | --- | --- |
| 1. Inventory and asset policy | Read live Arc and Robinhood deployed components and facets; inventory BSC providers and token contracts | Component manifest with source/build settings, dependencies, owners, bytecode, token decimals and backing |
| 2. Configuration and rehearsal | Compile the approved mainnet implementations; configure BNB/WBNB, oracle feeds, risk parameters, fees and exact router targets; rehearse on a BSC fork | Passing lending/order/native/ERC20 lifecycle tests; correct V3 pool init hash; proposed addresses/constructor/configuration sheet |
| 3. Gas and deployment | Read deployer BNB balance and current fee estimates with reserve; deploy oracle, lending diamond/facets, approved DEX components and order settlement in dependency order | Verified chain ID, successful receipts, code/address manifest and explorer verification; registration/configuration read back after writes |
| 4. Trading and keeper | Wire approved KyberSwap routes and separately validated LI.FI/Relay routes; configure order router permissions and keeper | Quote to build to simulation; allowance spender and calldata target checks; native value, min output and deadlines checked; keeper can detect and simulate a fill |
| 5. Full application | Extend chain capabilities, token discovery, prices, balances, lending books/positions, pools, portfolio, Luca, order history and analytics | One chain identity retained through review/signing; no unsupported action controls; chain-scoped caches and partial failure states |
| 6. Accounting and release | Extend backend ingestion, points/volume attribution, notifications and monitoring; release Vercel and all Hostinger sites | Chain+transaction deduplication, reward policy explicitly configured, build and API checks, desktop/mobile connected-wallet verification and matching deployed commits |

Do not infer same-chain trading support from a provider's bridge chain list. Validate each supported corridor and pair independently. Do not set price-impact limits solely from symbol or advertised TVL; retain existing unsafe-quote rejection and pre-sign simulation for Swap, Limit and Luca alike.

## Initial assets and risk split

Start research with BNB/WBNB, USDT and USDC. Consider BTCB, FDUSD and USD1 after contract, backing, liquidity and oracle checks. Trading discovery may include more assets than lending accepts. Every lending asset needs its own approved feed, freshness bound and risk configuration; do not reuse an underlying USD feed as proof of a bridge peg or substitute an unrelated stablecoin feed.

Native BNB pays gas; WBNB is the wrapped ERC20 for router constructors. Read actual token decimals from chain; preserve the existing 18-decimal Binance-Peg token definitions only if independently verified. Token identity is chain plus address, never symbol alone. No new wrapped-native deployment where canonical WBNB satisfies required interfaces.

## Product behavior

- Keep the existing header network selector. Avoid adding another selector above Swap.
- Swap, Limit and Luca use chain 56 token amounts, prices, approvals and transaction value. Reserve BNB for gas and clear stale quotes after chain/account/pair changes.
- Lending and portfolio browse multiple chains, group positions by chain, and switch only when executing a selected action. Collateral and debt stay isolated per chain.
- Show only external pools available through integrated routing providers; apply the established unsafe-route checks. Hide external deposit controls without a supported deposit integration.
- Main pool and analytics summaries include BSC Kaleido activity while separating tracked external pool metrics. Never count an external DEX's entire volume as Kaleido volume; do not double count routed trades also recorded by native indexers.
- Use existing branded controls, paired token icons and USD denominations. Missing data remains unavailable rather than a measured zero.
- Limit-order exposure requires working settlement plus keeper/router wiring, not just a deployed order contract. Native BNB order behavior must be explicitly supported or require wrapping first.

## Release acceptance

Native/ERC20 swaps in both directions; token approval reset behavior; unsafe quotes rejected; native gas reserve; signed orders including EIP-712 chain ID, cancellation/expiry/fill; borrow/fund/repay/withdraw plus liquidation rehearsal; V3 create/address derivation and liquidity lifecycle on a fork; bridge status and destination asset; same wallet on three chains; network switch cancellation; one failed RPC; no seeded liquidity; rewards/analytics chain isolation; Vercel and Hostinger API reads.

Production transactions beyond protocol deployment/configuration, including test trades, deposits and liquidity funding, require an explicit spending scope. No gas amount, deployment cost or completion claim is final until measured.

## Next concrete step

Finish the source-cited network research in `BSC_NETWORK_RESEARCH.md`, then produce a read-only chain-56 preflight report covering deployer balance, canonical asset metadata, feed rounds, aggregator targets and the exact live Arc component inventory. Use that report to freeze the implementation and configuration before broadcasting.
