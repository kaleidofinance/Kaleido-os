# Operating Luca

The runbook for the AI agent behind `/api/chat`. In the shape of
`KEEPER_SCHEDULING.md`: what arms it, how to check it, the failure signatures,
and the two levers.

## What arms Luca

Luca answers a turn only when a **model provider key** is configured; everything
else degrades rather than stopping.

| Env var | What it does | Unset |
| --- | --- | --- |
| `AGENTROUTER_API_KEY` / `GEMINI_API_KEY` / `AI_GATEWAY_API_KEY` | The model backends, in `getProviderChain` order. At least one is required to reason. | No provider → open questions fail; direct commands still work. |
| `AI_PROVIDER` | Forces the default backend (e.g. `gateway`). | First configured key wins. |
| `SUPABASE_SERVICE_ROLE_KEY` | Lets the quota counter and the turn log write. | Quota **fails open** (unbounded spend) and no turns are logged — both only visible in `metered:false` below. |
| `CRON_SECRET` | Guards `/api/health/agent` and the keeper/health routes. | The health endpoint refuses (503). |

`NEXT_PUBLIC_*` are build-time inlined — a change needs a redeploy to reach the
live site.

## Check it: `/api/health/agent`

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" https://kaleidofi.xyz/api/health/agent
```

```jsonc
{
  "ok": true,                       // providers configured AND quota metered
  "providers": { "primary": "ai-gateway", "chain": ["ai-gateway","gemini"], "count": 2 },
  "metered": true,                  // the quota counter is running
  "globalQuota": { "used": 312, "cap": 2000, "remaining": 1688, "throttledAt": null },
  "lastGoodTurnAt": "2026-09-14T09:41:03Z",
  "window1h": { "total": 84, "failures": 1, "failureRate": 0.012 },
  "checkedAt": "…"
}
```

Read-only; spends no gas and no quota. Point a Cloudflare Worker at it every
~15 min (the pattern the keeper and health-watch routes already use) and alert
on **`ok:false` or a non-200**, plus a soft alert on a rising `window1h.failureRate`.

## The three failure signatures

1. **`providers.count: 0`** — a key is missing or was rotated/deleted. This is
   *not* a provider outage; it is config, and it is the case that used to look
   identical to one. Fix: restore the key in Vercel and redeploy.
2. **`metered: false`** — `SUPABASE_SERVICE_ROLE_KEY` is missing, so the quota
   counter is off and provider spend is unbounded. Fix: set the key. Loud,
   because a fail-open ceiling is the expensive kind of quiet.
3. **`lastGoodTurnAt` stale (or `window1h.failureRate` high)** — a provider is
   failing. Read the turn log to see which and how (below). Failover means a
   healthy chain survives one backend down, so a *rising* rate with `ok:true` is
   the real signal.

## Read the turn log

`agent_turns` (service-role only) has one row per turn. From the SQL editor:

```sql
-- last hour, by outcome and provider
select status, provider, count(*), round(avg(latency_ms)) ms
from agent_turns where created_at > now() - interval '1 hour'
group by status, provider order by count desc;

-- did failover fire, and from what
select provider, count(*) from agent_turns
where failed_over and created_at > now() - interval '1 day' group by provider;
```

`status` is one of `ok | refused | provider_error | provider_blocked |
quota_exhausted | global_quota_exhausted | quota_anonymous`. No user text is
stored — only the shape of the turn and a short address hash.

## The two levers

- **Per-wallet cap** `AGENT_DAILY_MODEL_REQUESTS` (default 25). Lower it to slow
  one identity down. Safe to change.
- **Deployment cap** `AGENT_GLOBAL_DAILY_MODEL_REQUESTS` (default 2000). This is
  the only thing bounding total provider spend against a script rotating
  addresses. **Never raise it casually** — a `throttledAt` stamp means real users
  were turned away, i.e. the cap is too low for genuine demand, which is a
  different decision from widening the door for an abuser.

## Applying the schema

`agent_turns` needs the migration applied before it logs:

```bash
cd smart-contract  # or the repo's supabase workspace
supabase db push
npm run verify:schema   # confirms agent_turns + agent_questions + kld_candles
```

Until it is applied, `logAgentTurn` inserts fail into a logged no-op — safe, but
`lastGoodTurnAt`/`window1h` stay null on the health endpoint.
