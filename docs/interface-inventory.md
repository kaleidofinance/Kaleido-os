# Interface inventory — what exists, what displays, what doesn't

Measured 2026-08-18 against the working tree, Abstract testnet (chain 11124,
`https://api.testnet.abs.xyz`), and a live dev server.

The premise of this audit was "no contract is deployed, we are only working on
the UI." That is true of the _current source_ and true of the `DEPLOYMENTS`
registry, but **it is not true of the chain** — an older deployment exists and
almost all of it is live. The gap between those two facts is what decides
whether a page shows a real figure, a dash, or a fabricated zero, so it is
recorded here first.

## How each column was established

Three separate methods, because none of them answers the others' question.

- **Renders** — HTTP probe via `scripts/audit-routes.sh`. A status code alone is
  not enough: Next's dev server returns 200 for a page whose client tree throws.
  So each probe also greps for the `kaleido-v2` wrapper that `(app)/layout.tsx`
  emits; present means the layout _and_ page tree both rendered server-side.
- **Has code on chain** — `eth_getCode` via `scripts/audit-onchain.mjs`. The only
  answer that isn't a guess.
- **Actually answers** — `eth_call` through the generated ABI. Separate from the
  above because an address can hold code and still lack the selector the UI
  calls; that is drift, and it looks identical to a healthy contract until asked.

Anything not established by one of those three is marked **unverified** rather
than inferred.

## 1. The finding that matters most

`useGetValueAndHealth.ts:256` calls `getAllCollateralToken()` on the contract at
`NEXT_PUBLIC_KALEIDO_DIAMOND_ADDRESS` (`0x7286F270…07B2`), **which has no code**.
Verified by `eth_call` through `src/abi/ProtocolFacet.json`:

```
DEAD (env diamond)     THREW: could not decode result data
LIVE (env protocol)    returned 0 item(s)  []
```

It throws rather than returning empty, and that distinction is the whole bug.
The call sits unguarded inside the `try` at :241 whose `catch` is at :527, so the
throw **skips lines 257–526 — 270 lines of per-user reads** — and lands in a
catch that zeroes them:

| Set by the catch at :527                           | Consequence                                         |
| -------------------------------------------------- | --------------------------------------------------- |
| `userstKldBalance`, `userKLDdeposit` = `"0"`       | `/stake` shows your stake as 0                      |
| `timeLeft` = 0, `hasWithdrawalRequest` = false     | Unstake gating is wrong                             |
| `collateralVal`, `AVA`–`AVA3`, `data2`–`data5` = 0 | `/portfolio`, `/borrow` collateral and health blank |
| `data` = null                                      | —                                                   |
| **`etherPrice` = 0, `USDCPrice` = 0**              | **Fabricated prices, not dashes**                   |

This fires for **every connected wallet, every time** — it is not an edge case.
Downstream consumers, all confirmed by call site:

- `useStakeV2.ts:89` — `userstKldBalance`, `timeLeft`, `hasWithdrawalRequest`
- `usePortfolio.ts:141` — `collateralVal`, `AVA`–`AVA5`, `data`, `data2`
- `useBorrowV2.ts:131` — `collateralVal`, `AVA`–`AVA5`, `data2`
- `useDataFilterPanel.ts:37`, `EnhancedCardlayout.tsx:58`,
  `useCreateLendingRequest.ts:38`, `useCreateLoanListing.ts:43` — `etherPrice`,
  `usdcPrice`

The zeroed prices are the worst part, because they violate the repo's own
"nulls, not zeroes" rule (`DASH` in `src/lib/format/figures.ts`). A price of 0
renders as a confident `$0.00` where a dash would have said "not known".

**Not affected:** the protocol-wide staking totals (`totalPooledKLD` :175,
`totalShares` :191, `totalStakers` :203). They are written by a separate,
wallet-free effect at :155, and the catch deliberately leaves them alone — its
comment explains why, and that reasoning is correct. So `/stake` shows real
protocol figures beside a zeroed personal one.

**The fix is not a one-line address swap.** `getProtocolContract` is already
constructed two lines above, at :254, and its address is live — but that live
build is an older one, missing `getListingId`, `getRequestId`, `getBPS` and
`getLiquidityBPS` (each reverts `"ProtocolFacet: fallback"`), and it reports 0
loanable assets and 0 collateral tokens. Repointing :256 stops the _cascade_;
each downstream call then needs its own guard, and the figures will still be
empty because the registry on that deployment is empty.

## 2. Pages — 22, plus 3 redirects

`—` in Renders means **not yet probed**; the dev server went down mid-audit.

| Route             | File / kind                 | Renders                  | Needs to show data                                                     |
| ----------------- | --------------------------- | ------------------------ | ---------------------------------------------------------------------- |
| `/`               | redirect, `next.config.mjs` | **307** ✓                | → `/trade`                                                             |
| `/explore`        | redirect, `next.config.mjs` | **308** ✓                | → `/leaderboard`                                                       |
| `/trade`          | 6 ln, server redirect       | **307** ✓                | → `/trade/agent`                                                       |
| `/trade/agent`    | 882 ln, client              | **200 layout-ok** (22s)  | `/api/chat` (AgentRouter **set**), 20 execute tools, `isDeployed()`    |
| `/trade/swap`     | 524 ln, client              | **200 layout-ok** (6s)   | V3 Router + Quoter (**live**)                                          |
| `/trade/limit`    | 123 ln, client              | **200 layout-ok** (19s)  | `ChartPanel` → `/api/prices`                                           |
| `/trade/buy`      | 131 ln, client              | **200 layout-ok** (3s)   | `/api/moonpay` — **keys empty, cannot sign**                           |
| `/trade/sell`     | 126 ln, client              | **timeout >300s**        | `/api/moonpay` — **keys empty**                                        |
| `/pool`           | 115 ln, client              | **200 layout-ok** (5s)   | `usePoolData` → V2/V3 factories (**live**)                             |
| `/pool/new`       | 474 ln, client              | **200 layout-ok** (56s)  | PositionManager, WETH (**live**)                                       |
| `/pool/positions` | 301 ln, client              | **200 layout-ok** (4s)   | `useV3Positions` → PositionManager (**live**)                          |
| `/borrow`         | 5 ln → `BorrowBookView`     | **timeout >300s**        | `/api/listings`, `/api/requests`, **dead diamond**                     |
| `/lend`           | 5 ln → `BorrowBookView`     | **timeout >300s**        | same                                                                   |
| `/loans`          | 5 ln, server redirect       | **timeout >300s**        | → `/myloans`                                                           |
| `/mylends`        | 7 ln → `BorrowBookView`     | **200 layout-ok** (240s) | as `/borrow`                                                           |
| `/myloans`        | 5 ln → `BorrowBookView`     | **200 layout-ok** (96s)  | as `/borrow`                                                           |
| `/stable`         | 5 ln, server redirect       | —                        | → `/stable/mint`                                                       |
| `/stable/mint`    | 164 ln, client              | —                        | kfUSD, kafUSD, YieldTreasury (**all live**)                            |
| `/stable/redeem`  | 181 ln, client              | —                        | same                                                                   |
| `/stable/earn`    | 349 ln, client              | —                        | same                                                                   |
| `/stake`          | 330 ln, client              | —                        | KLD vault + stKLD (**live**); **personal figures zeroed by §1**        |
| `/leaderboard`    | 410 ln, client              | —                        | `/api/leaderboard` + `/api/market/overview`; **2 migrations unpushed** |
| `/portfolio`      | 178 ln, client              | —                        | `usePortfolio` → **dead diamond** (§1)                                 |
| `/notifications`  | 211 ln, client              | —                        | `NotificationsContext`; **push unconfigured**                          |
| 404 fallback      | `not-found.tsx`             | —                        | —                                                                      |

**Nothing is orphaned.** All three index pages are deliberate redirects with
comments explaining the choice; there is no page unreachable from the nav.

### Delta since this table was measured (2026-08-24)

The table above is left as measured — its Renders column is probe data and
re-dating rows without re-probing them would turn measurement into inference.
Four pages have been **added** since, so the count is 26 and nothing in the
table has been removed:

| Route            | What changed                                                          |
| ---------------- | --------------------------------------------------------------------- |
| `/`              | **No longer a redirect.** Serves `(marketing)/page.tsx`, a real page.  |
| `/docs`          | New — the docs site, rendering `docs/` from this repo.                 |
| `/docs/[slug]`   | New — one route per entry in `(marketing)/docs/docs.ts`.               |
| `/pool/[address]`| New — the per-pool detail page.                                        |

`/` ceasing to be a 307 into the app is the one with consequences beyond its own
route, because two links were written on the assumption that `/` meant `/trade`:
`usePortfolio.ts`'s **critical liquidation alert** (and its mock mirror), which
was sending a user about to be liquidated to the marketing page instead of the
Repay button, and the nav logo, which had pointed at `/trade` to avoid a
redirect hop and now points at `/` as the ordinary convention. All three are
fixed. A sweep of every `href`, `href:` and `router.push` in `src` on 2026-08-24
found no other link resolving to a route that does not exist, with one dead-code
exception noted in §3 below.

**One page from the old design is genuinely gone: `/verify`.** See §3 — its three
API routes survive intact, so what was lost is the feature's only entry point,
not its backend. `/borrow-allocation` and the marketplace forms are deliberate
retirements (`BorrowModals.tsx:19`), and `/explore`, `/v2/*` and `/successful`
are recorded as redirects in `next.config.mjs`; the one loose end is
`useDataFilterPanel.ts:138`, which still pushes to `/borrow-allocation` from a
handler (`handleBorrowAllocation`, :126, returned :270) that has no callers.

**On the four timeouts.** These are very likely compile cost, not errors —
inference, not measurement. `/loans` is a 5-line `redirect()` that cannot fail at
runtime, yet it timed out, while its route-group siblings `/mylends` and
`/myloans` answered at 240s and 96s. The `(lending)` group is simply expensive to
compile, and the 300s ceiling is below it. They need a re-probe to confirm.

## 3. API routes — 16

| Route                   | Callers in `src`                     | Config state                                                                |
| ----------------------- | ------------------------------------ | --------------------------------------------------------------------------- |
| `/api/chat`             | 8                                    | ✓ AgentRouter key + model set                                               |
| `/api/leaderboard`      | 5                                    | ✓ service-role key set; **`point_leaderboard` needs 2 unpushed migrations** |
| `/api/leaderboard/me`   | 3                                    | ✓ same                                                                      |
| `/api/listings`         | 4                                    | ✓ `kaleido_listings`                                                        |
| `/api/requests`         | 3                                    | ✓ `kaleido_requests`                                                        |
| `/api/market/overview`  | 4                                    | ✓ both tables + kfUSD read                                                  |
| `/api/prices`           | 5                                    | ✓ CoinGecko key optional by design, absent, degrades cleanly                |
| `/api/prices/spot`      | 1                                    | ✓                                                                           |
| `/api/referral`         | 2                                    | ⚠ `PRIVATE_KEY` set, but signs against the **dead diamond**                 |
| `/api/moonpay`          | 2                                    | ✗ `MOONPAY_SECRET_KEY` and `NEXT_PUBLIC_MOONPAY_API_KEY` **both empty**     |
| `/api/push/send`        | 1                                    | ✗ all 4 VAPID vars absent → returns 503 with a reason                       |
| `/api/push/subscribe`   | 1                                    | ✗ same                                                                      |
| `/api/push/unsubscribe` | 1                                    | ✗ same                                                                      |
| `/api/auth/twitter`     | **0**                                | ✗ `NEXT_PUBLIC_TWITTER_CLIENT_ID` empty                                     |
| `/api/auth/callback`    | **0** (reached only by X's redirect) | ✗ see below                                                                 |
| `/api/auth/user`        | 1 (only `auth/callback`)             | —                                                                           |

None probed live yet — the dev server is down. Config state above is from `.env`
key presence (names verified against `envVars.ts`) and each route's own guard.

The push routes degrade well: 503 with `"VAPID keys are not configured."` rather
than a crash. `/api/prices` treats its key as optional and works without it.

**The Twitter trio is unreachable dead surface.** Zero UI callers, no link
anywhere, and the `/verify` page it used to land on is gone (the comment at
`auth/callback/route.ts:119-121` says so). It is three files and 174 lines
reachable only by pasting a URL.

**Security defect in that same file — FIXED 2026-08-24.** As measured,
`auth/callback/route.ts:74` built the OAuth2 Basic auth header from
`envVars.twitterApiKey`, which was `process.env.NEXT_PUBLIC_TWITTER_KEY`. Next
inlines every `NEXT_PUBLIC_` variable into the browser bundle, so **configuring
this feature would have shipped the X client secret to every visitor.** Nothing
leaked, only because the var was empty. Now a server-only
`TWITTER_CLIENT_SECRET` read through `process.env` at the route, as
`/api/referral` already does for `PRIVATE_KEY`; `twitterApiKey` is gone from
`envVars.ts` and a note there records why, matching the one above the signing
key. The client ID and redirect URI stay public — neither is secret, both travel
in the authorize URL in the clear. `.env.example` carries the rename and tells a
deployment that already set the public variable to regenerate the value.

## 4. On-chain reality

Every address the UI can reach, checked with `eth_getCode`:

| Source                               | Result                                                        |
| ------------------------------------ | ------------------------------------------------------------- |
| `constants/utils/addresses.ts` (17)  | **16 live**; only LINK `0xE4aB69C0…` has no code              |
| `STABLE_CONTRACTS` (registry.ts:623) | **all live** — USDC, USDT, USDe, kfUSD, kafUSD, YieldTreasury |
| env vars (6)                         | **5 live**; `NEXT_PUBLIC_KALEIDO_DIAMOND_ADDRESS` **no code** |

**Two contracts are configured twice, at different live addresses.** This is
harder to catch than a dead address, because liveness tells you nothing about
which one is correct:

| Contract      | In use                                      | Also declared                                            |
| ------------- | ------------------------------------------- | -------------------------------------------------------- |
| YieldTreasury | `0x9977ac5F…` (registry, 24544 b)           | `0xcB3D0069…` (addresses.ts:26, 38304 b)                 |
| KLD Vault     | `0xf77AA35D…` (`LEGACY_CONTRACTS`, 16224 b) | `0xb6fb7fd0…` (`NEXT_PUBLIC_KLD_VAULT_ADDRESS`, 14752 b) |

The YieldTreasury pair is already documented at `registry.ts:617-621` and
resolved in favour of the hook's value. **The KLD Vault pair is not documented
and not resolved** — the byte counts differ, so they are different builds, and
`getKLDVaultContract` (14 call sites) uses the env var while `LEGACY_CONTRACTS`
declares the other.

### The two KLD vaults implement disjoint halves of one ABI

`eth_call` on each selector in `src/abi/KLDVaultAbi.json`, against both
addresses. Neither deployment implements the committed ABI; the ABI is a union
of the two, and no single address answers every read the app makes:

| Selector                      | `0xb6fb7fd0…` (env var, in use) | `0xf77AA35D…` (`LEGACY_CONTRACTS`) |
| ----------------------------- | ------------------------------- | ---------------------------------- |
| `getTotalPooledKld(KLD)`      | **424,016,717 KLD**             | 0                                  |
| `getTotalStakers()`           | **4143**                        | revert                             |
| `getWithdrawalTimeLeft(addr)` | **answers**                     | revert                             |
| `stKLD()`                     | revert                          | **`0x4BC3d728…`**                  |
| `supportedTokens(KLD)`        | revert                          | **true**                           |
| `yieldTreasury()`             | revert                          | **`0xcB3D0069…`**                  |
| `hasWithdrawalRequest(addr)`  | revert                          | revert                             |
| `WITHDRAWAL_WAITING_PERIOD()` | 1209600 (14 d)                  | 604800 (7 d)                       |

Consequences visible in the UI today, none of them fixable from the front end:

- `/stake` shows real protocol figures (424M pooled, 4143 stakers) because those
  reads land on the env-var vault.
- **No per-user stake can be shown.** The env-var vault cannot name its stKLD
  token, so `resolveStKldAddress` falls back to the `stKLD_ADDRESS` constant —
  which is live, and is exactly the token the _other_ vault names — but
  `stKLD.totalSupply()` is **0**, so `balanceOf` is 0 for every account. The
  vault records 424M pooled KLD and has minted no stKLD against it.
- `hasWithdrawalRequest` exists in neither build, so `/stake`'s Unstake gate can
  only ever read `false`.
- The two builds disagree on the cooldown, 14 days versus 7.

### One token's decimals disagreed with the chain

`decimals()` on every token the app declares, versus the declared value:
USDC 6/6, USDT 6/6, USDe 18/18, kfUSD 18/18, kafUSD 18/18, KLD 18/18,
stKLD 18/18 — and **USDR: on-chain 6, declared 18**, in seven places. Corrected
in `registry.ts`, `formatTokenDecimals.ts`, `getUsdcBalance.ts`,
`omniChainBalances.ts`, `bridgeQuotes.ts`, `useCreateLendingRequest.ts` and
`useCreateLoanListing.ts`. It was a factor of 1e12 on borrow and listing
calldata, and on every displayed USDR balance and debt.

**`isDeployed()` is consulted by 1 of 22 pages.** `DEPLOYMENTS`
(`registry.ts:143-146`) is empty, so it returns false for every chain — but only
`trade/agent/page.tsx` asks. Every other page reads a hardcoded constant and
calls it directly. The deployment gate the codebase documents is not enforced
across the UI.

## 5. Supabase surface

Five tables are touched from `src`, all through API routes rather than the
browser:

| Table                | Reads |
| -------------------- | ----- |
| `push_subscriptions` | 4     |
| `point_leaderboard`  | 4     |
| `kaleido_requests`   | 4     |
| `point_seasons`      | 3     |
| `kaleido_listings`   | 3     |

`point_balances` is service-role-only and correctly has no client reads.

## 6. Still unverified

Honest list of what this audit did **not** establish.

1. **9 routes never probed** — `/stable`, `/stable/mint`, `/stable/redeem`,
   `/stable/earn`, `/stake`, `/leaderboard`, `/portfolio`, `/notifications`, and
   the 404 control. The dev server stopped listening on port 3000 mid-run
   (`curl` exit 7, not a timeout), so these are unknown, not broken.
2. **4 timeouts unresolved** — `/trade/sell`, `/borrow`, `/lend`, `/loans`.
3. **No API route probed live.** Section 3 is config-state and code reading.
4. **`/leaderboard` cannot show real standings yet** — it needs
   `20260817000000_leaderboard_disclosure.sql` and
   `20260818000000_season0_participation_seed.sql` pushed. Neither can be applied
   locally.
5. **MoonPay signature never verified** against the sandbox — flagged in the
   route's own header at `moonpay/route.ts:20-24`.

To close 1–3: restart the dev server, then run `scripts/audit-routes.sh` with
nothing else competing for CPU. Cold compiles here cost minutes (`/trade` once
took 282s to serve a _redirect_), so the probe must run alone — running RPC
probes alongside it is what produced the false timeouts in the first place.

## 7. Filling the interface — the demo fixtures

Sections 1–4 explain why almost every product surface renders empty: the
registry is empty, so `getContracts(chainId)` returns `{}` and each protocol read
comes back null. That is honest, and it is also the reason this audit could only
verify half of what it set out to. **An empty table is indistinguishable from a
broken one.** A page that renders 200 with the `kaleido-v2` wrapper present has
proved its server tree; it has not proved that its rows, sort, badges, empty
state, modals or number formatting work, because none of them ever ran.

`src/lib/mock` closes that gap. Set `NEXT_PUBLIC_MOCK_DATA=1` (documented in
`.env.example`) and every read below serves a fixture instead:

| Surface                            | Seam                                                | Fixture                                  |
| ---------------------------------- | --------------------------------------------------- | ---------------------------------------- |
| `/pool` (all pools)                | `usePoolData`                                       | `MOCK_POOLS`                             |
| `/pool/positions`                  | `useV3Positions`                                    | `MOCK_V3_POSITIONS`                      |
| `/stake`                           | `useStakeV2`                                        | `MOCK_STAKE`                             |
| `/stable` + mint/redeem/earn       | `useStablecoin` (all five fetchers)                 | `MOCK_STABLE_*`                          |
| `/borrow`, `/lend`, owner filter   | `useFetchRequestsWithCursor`, `…ListingsWithCursor` | `mockRequests`, `mockListings`           |
| `/borrow` loans + collateral panel | `useBorrowV2`                                       | `MOCK_LOANS`, `MOCK_COLLATERAL`          |
| `/portfolio`                       | `usePortfolio`                                      | `MOCK_PORTFOLIO`                         |
| every gated surface                | `useChainGate`                                      | reports ready instead of the empty state |

Four properties are what make this safe to have in the tree at all:

1. **Reads only.** Writes are untouched — `stake()`, `mintKfUSD()`, `repay()`,
   `collectFees()` all still resolve the real contract, so pressing a button in
   demo mode produces the real resolver's real failure. "Is the integration
   wired" is the question the audit is asking, so it must not be mocked away.
2. **The wallet guards that exist are kept.** `useStablecoin`, `useV3Positions`
   and `usePortfolio` each guard on the connected address, and their seams sit
   _after_ that guard, so a visitor with no wallet still sees the true empty
   state — and, because `address` is undefined during the server pass, fixtures
   cannot render into the HTML and mismatch on hydration. `useChainGate` likewise
   still reports `disconnected` and `unknown-chain` honestly; only its
   `undeployed` branch steps aside. The two synchronous spreads (`useStakeV2`,
   `useBorrowV2`) and the two public books apply with or without a wallet — they
   are constants, so they are hydration-safe, and populating `/stake` and
   `/borrow` without first connecting is useful while auditing. That is a
   difference from the live app, and the flag is the only thing keeping it out of
   production.
3. **Clock-free.** No fixture calls `Date.now()`. Several render inside
   server-rendered trees, and a clock-derived duration differs between the server
   pass and hydration.
4. **Unlabelled, deliberately.** There is no demo banner and no "this is sample
   data" note anywhere. The app has to read as the finished product — no surface
   is allowed to announce a pre-release state — so the whole burden of not
   shipping these numbers rests on the flag being unset (which is the default,
   and what `.env.example` ships) and on the removal step below. Do not
   compensate by adding a note to a page.

**Removal is a deletion, not a refactor.** Unset the flag (that alone disables
everything; the flag defaults to off), then `rm -rf src/lib/mock` and
`npx tsc --noEmit` — the compiler names all eight importing files, because nothing
in the module is reached through a dynamic lookup. Each error clears by deleting
one `if (MOCK_DATA)` block or one spread. Verified: `grep -rn "lib/mock\|MOCK_DATA" src/`
returns nothing outside `src/lib/mock` that is not an import, a comment, or
guarded by `MOCK_DATA`.

Not covered by the fixtures, and still unverifiable without a deployment or a
migration: swap quotes, the order book and limit orders, and `/leaderboard`
(database-backed — it needs the two migrations in section 6, not this flag).
