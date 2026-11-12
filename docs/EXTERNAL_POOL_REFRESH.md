# External pool refresh

The external-pool registry is a reviewed research inventory, not a live route
cache. The refresh path probes executable Kyber routes, fetches dated metrics
where an authoritative source exists, and produces a report. It never edits the
registry automatically.

## What is scanned

- Arc (`5042`), Robinhood (`4663`), BSC (`56`) and Elysium (`99901`)
- The conservative core pairs in `src/lib/market/externalPoolScanPairs.ts`
- Kyber route legs, including nested meta-pool responses
- GeckoTerminal metrics for Arc, Robinhood, BSC and Elysium (`elysium` slug)

Elysium pool observations are approved only when the route is executable and
GeckoTerminal returns dated reserve/volume data. A route's output is not TVL
evidence. Provider rate limits are retried with a bounded backoff; a pool stays
rejected if metrics remain unavailable.

Uniswap v4 observations use their 32-byte `PoolId` as the inventory key. It is
not truncated into a 20-byte explorer address; the pool remains swap-linkable
through its token pair while its metrics are read by the same PoolId.

## Review flow

1. Arm `EXTERNAL_POOL_REFRESH_SECRET` on the Hostinger application.
2. Arm the Cloudflare worker with the same secret:

   `npx wrangler secret put EXTERNAL_POOL_REFRESH_SECRET --config scripts/external-pools-cron/wrangler.toml`

3. Run the worker or call the protected `POST /api/pools/external/refresh`.
4. Review `approved`, `rejected`, `failures`, and `warnings` in the report.
5. Promote only reviewed entries into `src/lib/market/externalPoolRegistry.ts` in a
   normal pull request, including provider, route-probe, and metric timestamps.

The separate `GET /api/pools/external/status` endpoint returns `503` when the
checked-in registry is past its refresh window. The daily worker logs that state
and fails the scheduled invocation, making stale inventory visible in the
Cloudflare trigger history instead of silently serving it forever.
