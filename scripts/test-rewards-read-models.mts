/** Run with tsx and the path to an installed @electric-sql/pglite entry point. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  eligibleTaskPoints,
  X_TASK_COLUMNS,
  X_TASK_POINTS,
} from "../src/lib/waitlist/eligible";
import { readRewardFacts } from "../src/lib/waitlist/readFacts";

const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const migration = await readFile(
  new URL(
    "../supabase/migrations/20261025180027_rewards_read_snapshots.sql",
    import.meta.url,
  ),
  "utf8",
);
const timestamps = [
  ...new Set([
    ...Object.values(X_TASK_COLUMNS),
    "arc_mainnet_tx_at",
    "agent_tx_at",
    "bridge_tx_at",
  ]),
];
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create table public.waitlist (
    wallet text primary key, ref_code text unique not null, referred_by text,
    welcome_points numeric not null default 100, activated_at timestamptz,
    x_user_id text, x_handle text, ${timestamps.map((c) => `${c} timestamptz`).join(",")}
  );
  create table public.point_seasons (id int primary key, disclosure text, public_rank_limit int);
  create table public.point_balances (
    wallet text, season int, total numeric default 0, time_points numeric default 0,
    action_points numeric default 0, bonus_points numeric default 0, sybil_flag text,
    primary key(wallet,season)
  );
  create table public.point_actions (
    id bigserial primary key, wallet text, source_slug text, season int, points numeric,
    usd_value numeric default 0, tx_hash text, chain_id int, multiplier_applied numeric,
    is_agent_initiated boolean, occurred_at timestamptz, unique(chain_id,tx_hash)
  );
  create table public.swap_volume (wallet text, usd_value numeric);
  create table public.point_snapshots (
    wallet text, chain_id int, source_slug text, taken_at timestamptz, usd_value numeric
  );
  create function public.test_materialize() returns trigger language plpgsql as $$
  begin
    insert into public.point_balances(wallet,season,total,action_points)
    values(new.wallet,new.season,new.points,new.points)
    on conflict(wallet,season) do update set total=point_balances.total+new.points,
      action_points=point_balances.action_points+new.points;
    return new;
  end; $$;
  create trigger test_materialize after insert on public.point_actions
  for each row execute function public.test_materialize();
  insert into public.point_seasons values (1,'full',1000000),(0,'rank_only',1);
  grant select,insert,update on all tables in schema public to service_role;
  grant usage on all sequences in schema public to service_role;
  insert into public.waitlist(wallet,ref_code,activated_at,x_user_id,x_linked_at,agent_tx_at)
  values ('alice','ref-a',now(),'alice-x',now()-interval '6 hours',now());
  insert into public.waitlist(wallet,ref_code,referred_by,activated_at,x_user_id)
  values ('bob','ref-b','ref-a',null,'bob-x'),
    ('charlie','ref-c','ref-a',now(),'charlie-x'),
    ('unlinked','ref-d','ref-a',now(),null);
  insert into public.swap_volume values ('alice',100);
  insert into public.point_actions(wallet,source_slug,season,points,tx_hash,chain_id)
  values ('alice','waitlist',1,100,'initial',5042),('overpaid','waitlist',1,9999,'overpaid',5042);
  insert into public.waitlist(wallet,ref_code,activated_at) values ('overpaid','overpaid',now());
  insert into public.point_balances(wallet,season,total) values ('tie-a',0,100),('tie-b',0,100),('hidden',0,1);
`);

// Exercise every task value against the TypeScript source of truth, including
// retired tasks, five-hour holds, each volume tier, and pending wallets.
const expected = new Map<string, number>();
let index = 0;
for (const [key, column] of Object.entries(X_TASK_COLUMNS)) {
  const wallet = `task-${key.toLowerCase()}`;
  const volume = [0, 10, 50, 100, 300][index++ % 5];
  await db.query(
    `insert into public.waitlist(wallet,ref_code,activated_at,${column})
    values ($1,$1,now(),now()-interval '6 hours')`,
    [wallet],
  );
  if (volume)
    await db.query("insert into public.swap_volume values($1,$2)", [
      wallet,
      volume,
    ]);
  expected.set(
    wallet,
    eligibleTaskPoints({
      row: {
        welcome_points: 100,
        [column]: new Date(Date.now() - 6 * 3600000).toISOString(),
      },
      referrals: 0,
      swapVolumeUsd: volume,
      now: Date.now(),
    }),
  );
  assert.ok(X_TASK_POINTS[key as keyof typeof X_TASK_POINTS] > 0);
}
await db.exec(`
  insert into public.waitlist(wallet,ref_code,activated_at,x_robinhood_integration_at)
  values ('held','held',now(),now()), ('pending','pending',null,now()-interval '6 hours');
  insert into public.point_snapshots values
    ('alice',1,'collateral_idle',now()-interval '1 day',500),
    ('alice',1,'collateral_idle',now(),0);
`);

// pg_cron is tested on the live Supabase instance; embedded Postgres exercises
// the actual migration SQL and refresh/reconciliation functions without it.
if (process.argv.includes("--staged")) {
  const bootstrap = migration.split("-- Existing consumers")[0]
    .replace(/;\ncreate unique index/g, "\nwith no data;\ncreate unique index") + "commit;";
  assert.equal((bootstrap.match(/with no data/g) ?? []).length, 4);
  await db.exec(bootstrap);
  for (const view of ["referrals", "task_volume", "metadata", "board"])
    await db.exec(`refresh materialized view kaleido_rewards_private.${view}`);
}
await db.exec(migration.replace(/-- SCHEDULER:[\s\S]*?-- END SCHEDULER/, ""));
const one = async (sql: string, params: unknown[] = []) =>
  (await db.query(sql, params)).rows[0] as any;
assert.deepEqual(
  await one(
    "select referrals,active_referrals,pending_referrals,rank from public.waitlist_leaderboard where wallet='alice'",
  ),
  { referrals: 2, active_referrals: 1, pending_referrals: 1, rank: 1 },
);
assert.equal(
  Number(
    (
      await one(
        "select collateral_usd from public.wallet_task_volume where wallet='alice'",
      )
    ).collateral_usd,
  ),
  0,
);

const before = Number(
  (await one("select count(*) from public.point_actions")).count,
);
const firstRead = (
  await one("select public.reward_wallet_facts('ALICE') as facts")
).facts;
assert.equal(firstRead.row.wallet, "alice");
assert.equal(firstRead.season1.total, 100);
assert.equal(firstRead.referral.active_referrals, 1);
assert.equal(
  Number((await one("select count(*) from public.point_actions")).count),
  before,
  "GET facts cannot award points",
);
assert.equal(
  (await one("select public.reward_wallet_facts('absent') as facts")).facts,
  null,
);

await db.exec("select kaleido_rewards_private.refresh_read_models()");
for (const [wallet, points] of expected) {
  const row = await one(
    "select total from public.point_balances where wallet=$1 and season=1",
    [wallet],
  );
  assert.equal(
    Number(row.total),
    points,
    `${wallet} must match eligibleTaskPoints()`,
  );
}
assert.equal(
  Number(
    (
      await one(
        "select total from public.point_balances where wallet='alice' and season=1",
      )
    ).total,
  ),
  1750,
);
assert.equal(
  Number(
    (
      await one(
        "select total from public.point_balances where wallet='overpaid' and season=1",
      )
    ).total,
  ),
  9999,
  "no clawback",
);
assert.equal(
  Number(
    (
      await one(
        "select total from public.point_balances where wallet='held' and season=1",
      )
    ).total,
  ),
  100,
  "task hold enforced",
);
assert.equal(
  (await db.query("select * from public.point_balances where wallet='pending'"))
    .rows.length,
  0,
  "inactive wallet cannot mint points",
);
const once = Number(
  (await one("select count(*) from public.point_actions")).count,
);
await db.exec(
  "select public.reward_reconcile_waitlist(); select public.reward_reconcile_waitlist();",
);
assert.equal(
  Number((await one("select count(*) from public.point_actions")).count),
  once,
  "retries are idempotent",
);

const tied = (
  await db.query(
    "select wallet,rank,total,time_points from public.reward_board_rows where season=0 order by position",
  )
).rows;
assert.equal(Number(tied[0].rank), 1);
assert.equal(Number(tied[1].rank), 1);
assert.equal(tied[0].total, null);
assert.equal(tied[0].time_points, null);
assert.equal(tied[2].rank, null, "rank limit enforced");
await db.exec(
  "update public.point_seasons set disclosure='rank_only',public_rank_limit=1 where id=1",
);
assert.equal(
  (await one("select total from public.point_leaderboard where wallet='alice'"))
    .total,
  null,
  "new disclosure applies without refreshing",
);
await db.exec(
  "update public.point_balances set sybil_flag='flagged' where wallet='alice'",
);
assert.equal(
  (
    await db.query(
      "select * from public.point_leaderboard where wallet='alice'",
    )
  ).rows.length,
  0,
  "new flag applies without refreshing",
);
await db.exec("set role anon");
await db.query("select * from public.point_leaderboard limit 1");
await assert.rejects(db.query("select * from kaleido_rewards_private.board"));
await assert.rejects(db.query("select public.reward_wallet_facts('alice')"));
await assert.rejects(db.query("select public.reward_reconcile_waitlist()"));
await db.exec("reset role");
await db.exec("set role service_role");
assert.ok(
  (await one("select public.reward_wallet_facts('alice') as facts")).facts,
);
await db.query("select * from public.reward_board_rows limit 1");
await db.query("select public.reward_reconcile_waitlist()");
await db.exec("reset role");

// Reproduce the reported scale in real Postgres, then exercise indexed reads.
await db.exec(`insert into public.waitlist(wallet,ref_code)
  select 'signup-'||n, 'signup-'||n from generate_series(1,90000) n;
  select kaleido_rewards_private.refresh_read_models();`);
const started = performance.now();
for (let i = 0; i < 20; i++)
  await db.query("select public.reward_wallet_facts('alice')");
console.log(
  `90k-wallet database: 20 Rewards reads in ${Math.round(performance.now() - started)}ms`,
);
assert.equal(
  Number((await one("select count(*) from public.waitlist_leaderboard")).count),
  90000 + expected.size + 7,
);

const failedClient = {
  rpc: () => ({
    abortSignal: async () => ({ data: null, error: { message: "timeout" } }),
  }),
};
await assert.rejects(
  readRewardFacts(failedClient as never, "alice"),
  /Could not read rewards/,
);
await db.close();
console.log(
  "PASS: task parity, holds, activation gate, no clawbacks, idempotency, masking, flags, permissions, read-only loading and 90k-wallet reads",
);
