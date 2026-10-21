# Multi-chain interface implementation map

Agreed product direction: 21 October 2026.

## Scope model

The header reports the connected wallet network. Browsing another network never switches the wallet. Public market pages default to all supported mainnets; Swap defaults to the connected supported network, or Arc when disconnected. A transaction belongs to one explicit chain and venue.

Use three distinct scopes:

- Browse scope: all networks or one network; stored in the page URL.
- Wallet network: actual connected network, displayed by the existing header selector.
- Action chain: immutable chain of the selected market, pool, token, or position. Request a wallet switch only when the user proceeds with that action.

Testnets remain behind the existing toggle. URL parameters cannot bypass that gate. Unsupported chains get an explicit unavailable state.

## Page map

| Surface | Default and controls | Cards and rows | Action behavior |
| --- | --- | --- | --- |
| `/trade/swap` | One market network selected inside the form | Tokens and balances on that network; venue, route, output, slippage and minimum received | Connect, switch if needed, approve then swap on the selected network |
| `/trade/limit` | One market network selected inside the form | Pair and orders on that network; show settlement availability | Only offer orders supported by the deployed settlement contract and configured keeper/router |
| `/trade/agent` | Wallet network as initial context; explicit chain on every proposed action | Answers state their network scope; transaction review names target chain and venue | Resolve each action's chain from its plan, never infer from the last browsed page |
| `/borrow`, `/lend` | All mainnets; chain and asset filters | Chain badge per offer/request; headline counts and book value match selected scope | Select a row and retain its chain through review, switching and submission |
| `/mylends`, `/myloans` | All mainnets for connected account; chain filter | Positions grouped by network; collateral, debt and health shown per network | Close, fund, repay and withdraw against that position's chain |
| `/pool` | All mainnets; All / Kaleido / External plus chain and venue filters | Pair, network, venue, pool version, TVL, 24h volume, fees and supported actions | Swap opens the pair on its network; Add liquidity appears only for supported deposit integrations |
| `/pool/positions` | All mainnets for connected account; chain filter | Positions grouped by chain and venue | Increase, remove and collect on the position's chain and manager |
| `/pool/new` | One network; pair prefilled when opened from a row | Only contracts/assets supported by the chosen deposit integration | Review and switch before submitting |
| `/analytics` | All mainnets; network filter | Kaleido activity, lending metrics, and external market coverage in distinct groups | Reporting only; filter never switches wallet |

An empty market displays zero only after a successful read. Unavailable data displays an em dash; partial totals identify missing chains. Keep the previous successful snapshot on refresh failure and mark it stale.

## Existing implementation and changes

| Area | Existing source | Required change |
| --- | --- | --- |
| Wallet network | `src/components/v2/NetworkSelector.tsx`, `src/hooks/v2/useWalletV2.ts` | Retain wallet network semantics; avoid reusing wallet switching for browse filters |
| Token identity | `src/constants/registry.ts`, `src/constants/tokens.ts` | Preserve `(chainId,address)` everywhere, including URL prefill and cached quotes |
| Swap | `src/app/(app)/trade/swap/page.tsx` | Reuse token-owned `swapChainId`; add explicit form network selection and validated pair prefill; invalidate quote and approvals on pair/chain/account change |
| Aggregator swaps | `src/lib/swap/kyberswap.ts`, `src/lib/v2/intents/build.ts` | Robinhood chain mapping exists; verify native ETH value handling, live build and simulation before claiming execution works |
| Lending book | `src/components/v2/LendingDataContext.tsx`, `src/components/v2/BorrowBookView.tsx`, `src/hooks/useDataFilterPanel.ts` | Reuse current cross-chain book, filters, form chain and row switching; expose active scope clearly and persist filters in URL |
| Lending headline | `src/hooks/market/useMarketStats.ts`, `src/app/api/market/overview/route.ts` | Replace fixed read-chain totals with per-chain books; return breakdown, scope, coverage and failures; use identical scope for header and table |
| Lending positions | `src/hooks/useBorrowPositionsAcrossChains.ts`, `src/hooks/useLenderPositionsAcrossChains.ts` | Reuse portfolio readers; preserve per-chain failure state instead of treating failed reads as empty positions; connect personal lending tabs to grouped results |
| Kaleido pools | `src/app/(app)/pool/page.tsx`, `src/hooks/dex/usePoolData.ts`, `src/hooks/dex/useV3Pools.ts` | Retain current cross-chain discovery and badges; share selected filters with the header totals |
| External pools | `src/lib/market/externalPools.ts` | Normalize chain, venue, pool ID, token addresses, metrics and coverage; add deadlines, cache, in-flight deduplication, stale handling and runtime validation |
| Pool positions | `src/app/(app)/pool/positions/page.tsx`, `src/hooks/dex/useV3Positions.ts` | Current position path uses active chain; add bounded per-chain reads and chain-specific manager/action dependencies |
| Analytics | `src/lib/analytics/overview.ts`, `src/app/(app)/analytics/page.tsx` | Add scope to API/query key and metrics; display source coverage/time; distinguish fetched-at from upstream observation time |

## Reporting rules

- Kaleido pool TVL and fees describe Kaleido venues.
- External pool metrics describe tracked external markets. Kyber's ranked sample is not whole-chain TVL or volume. Display tracked sample size separately from upstream indexed pool count.
- Kaleido-routed volume includes verified trades initiated through Kaleido, regardless of execution venue. Never add the external venue's entire volume to this total.
- State the period for each metric: cumulative trading totals and rolling 24-hour pool volume are separate measures.
- Deduplicate pools by `(chainId,venue,poolId)`; a V4 pool ID may be 32 bytes and is not a contract address. Do not direct V4 IDs into V3 detail/deposit code.
- Nullable measurements remain nullable; `null` and empty strings must not coerce to measured zero.
- Never sum health factors or use cross-chain collateral to authorize borrowing. USD totals may aggregate only with explicit pricing coverage.
- API and client cache keys include scope, testnet mode and account where relevant. Use bounded requests, shared caching and hidden-tab polling pauses.

## Delivery order

1. Define and validate URL browse scope and shared chain-filter behavior. Retain existing styling and controls.
2. Make lending totals match the existing cross-chain book, with a per-chain breakdown and unavailable coverage.
3. Add the explicit Swap network control and pair prefill; verify native and ERC20 Robinhood quote/build/simulation paths.
4. Harden external pool data and integrate All / Kaleido / External into pool browsing. Keep unsupported liquidity actions hidden.
5. Extend position browsing across chains while retaining per-chain transaction dependencies and health.
6. Apply network filters and reporting rules to analytics, including verified routed volume accounting.
7. Run focused checks, production build and browser verification; retain local commits for the consolidated PR. Update Hostinger when deploying the approved release.

LI.FI and Relay bridge support must be checked per corridor. Same-chain swap support requires a dedicated quote/build integration and target validation; existing bridge support does not establish it. OrdersV2 deployment alone does not establish aggregator order fills: router permissions and keeper configuration require separate verification. Liquidity seeding, stablecoin mint/redeem, staking and ownership transfer remain deferred.

## Acceptance scenarios

- Connected to Arc: browse Robinhood pools and lending without wallet prompts; selecting an action requests Robinhood before signing.
- Disconnected: browse all public mainnet markets; an action opens Connect and retains the selected chain/pair.
- Change Swap chain: previous pair, quote and allowances cannot submit on the new chain.
- Open a pool's Swap action: correct chain and exact token addresses are prefilled; symbols alone cannot select assets.
- Filter lending to Robinhood: book, counts, currency scaling and headline totals agree; no Arc rows remain in scoped totals.
- One RPC fails: successful chains remain visible and totals expose incomplete coverage; failed positions never appear as paid off.
- External pools: sampled metrics stay labeled; deposit controls appear only where the matching integration exists.
- Same wallet on two chains: positions remain separate and each action uses its original contract manager/diamond.
- Turn testnets off: rows, filters, URL scope, summaries and action targets exclude testnets.
- Cancel wallet switching: preserve the intended action without submitting or silently replacing its chain.

This document maps the target behavior and source changes. It does not assert that the remaining changes or browser flows have been implemented or deployed.
