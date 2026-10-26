# Rewards and Leaderboard read models

The migration `20261025180027_rewards_read_snapshots.sql` must be applied before
deploying the accompanying application changes.

Previously Rewards recalculated a referral ranking across the whole waitlist,
counted each capped task separately, read volume, reconciled credits and then
loaded the settled balance. A database timeout could also be returned as an
empty leaderboard. Both production endpoints exceeded a 15-second probe during
the investigation; the Supabase logs recorded timeouts in the referral and
volume views as well as other database reads.

The migration stores referral ranks, task-volume totals, task counts and season
rankings in indexed materialized views in an unexposed private schema. One
`pg_cron` job refreshes them every minute. Refreshes use a transaction and an
advisory lock, so readers see a coherent previous or new snapshot. Readers keep
working during concurrent refreshes. Each job has a 45-second statement timeout.

Rewards reads live task timestamps and the current settled balance, together
with the shared aggregates, through one service-role-only, read-only RPC. It
never reconciles points while loading. A genuine missing wallet returns
`registered: false`; a database failure returns 503. Task claims still enforce
their caps against live data, rather than trusting cached display counts.

Leaderboard pages read indexed snapshot rows, cached for 60 seconds per page and
season with shared in-flight requests. Exact participant counts are calculated
by the scheduled refresh. Rows and personal standings use the same ranks,
including ties. Failed reads cannot overwrite a good cache with empty data.
The response reports the snapshot timestamp and marks snapshots older than
three minutes stale.

Public projections apply current season disclosure rules and current wallet
flags even between refreshes. Raw snapshots, Rewards facts and reconciliation
are inaccessible to anonymous and authenticated browser roles.

The scheduled refresh and activation job call the same reconciliation function.
It serializes reconciliation, credits only positive deltas, preserves activation
gates and five-hour task holds, and uses the existing per-eligible-total
idempotency keys. The SQL rules are checked against `eligibleTaskPoints()` for
every X task and volume tier. Existing ledger rows and completion timestamps
are retained.

## Verification

- `node --import tsx scripts/test-rewards-routes.mts` exercises the actual route
  handlers with a controlled database transport, including partial failures.
- `node --import tsx scripts/test-rewards-read-models.mts <pglite-entrypoint>`
  executes the actual migration and functions against embedded Postgres with
  90,000 test signups. Install `@electric-sql/pglite` in a temporary directory
  and pass its `dist/index.js`. The test excludes only the `pg_cron` scheduling
  section, which must be verified on Supabase.
  Add `--staged` to verify building the private views without data, filling each
  separately, and then applying the full migration over those prepared views.
- Run `npm run test:rewards`, `npm run test:xcap`, `npm run test:waitlistsync`,
  `npm run test:swapvol`, TypeScript checking and a production build.

After application, verify `cron.job` contains `kaleido-rewards-read-models` and
that `cron.job_run_details` records successful refreshes. Compare the public
board, a known wallet's facts and the latest metadata timestamp. Verify both
live endpoints and a real connected-wallet browser session after deployment.

The initial live application attempt failed before initializing the Supabase
migration history because the database connection timed out. The direct Data
API and CLI management query also timed out. Do not deploy the dependent app
changes until the migration has succeeded and the scheduled refresh is verified.

Further attempts reached SQL execution but hit statement timeouts at 60 and
120 seconds. A catalog read confirmed the new views and RPC were absent after
those rollbacks. The optimized referral aggregate groups only qualifying
referrals before joining wallets; bootstrap and refresh sessions use 32 MB
working memory to avoid disk sorting. Staged bootstrap attempts also failed to
establish a database connection. The live application has not been switched.
