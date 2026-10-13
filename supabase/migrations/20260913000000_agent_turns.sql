-- One row per model turn — the durable record Luca did not have.
--
-- WHY. Everything about a turn that reached the cloud model went to console or
-- nowhere: which provider answered, whether it failed over from the first, how
-- long it took, whether the auditor passed the plan, and how it ended. So
-- "how many turns failed in the last hour", "which provider is serving", "did
-- failover fire today" were unanswerable, and the team would learn of a Luca
-- outage from users. This table is the answer to all three.
--
-- SEPARATE FROM agent_questions on purpose. That table is product analytics —
-- what people ask, to grow the local nets — and stores the question text. This
-- one is operations — how the service behaved — and stores no text a user typed,
-- only the shape of the turn. Different retention, different readers, different
-- risk, so different tables.
--
-- WHAT IS NOT STORED. No question, no reply, no plan detail — only a short hash
-- of the address (to count distinct users and rate of failure per wallet without
-- naming one), and the machine facts of the turn. `error` is a truncated class,
-- never a raw exception or user data.
--
-- SERVICE-ROLE ONLY. Written server-side from /api/chat, read by /api/health/
-- agent and ops queries. RLS on with no policies: anon and authenticated see and
-- write nothing; the service role bypasses RLS and is the only caller.

create table if not exists public.agent_turns (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  chain_id      int,
  -- First 16 hex chars of sha256(lowercase address). Null when no wallet.
  asker_hash    text,
  -- The provider that actually answered (e.g. "ai-gateway", "gemini",
  -- "agentrouter") and the model id it used.
  provider      text,
  model         text,
  -- ok | refused | provider_error | provider_blocked | quota_exhausted |
  -- global_quota_exhausted | blocked_by_safety_check
  status        text not null,
  latency_ms    int,
  -- True when the primary provider failed and a backend further down the chain
  -- answered — the outage signal that used to be invisible.
  failed_over   boolean,
  -- Steps the auditor passed to the user to sign (0 for a plain answer), and
  -- whether the auditor passed the plan (null when there was no plan to audit).
  plan_steps    int,
  audit_ok      boolean,
  stream        boolean,
  -- A short error class for a failed turn, never a raw message. Null on success.
  error         text,
  check (char_length(status) <= 40),
  check (error is null or char_length(error) <= 200)
);

-- The reads this exists for: recent failures, and per-provider volume/health.
create index if not exists agent_turns_created_at_idx
  on public.agent_turns (created_at desc);
create index if not exists agent_turns_status_created_at_idx
  on public.agent_turns (status, created_at desc);

alter table public.agent_turns enable row level security;

revoke all on table public.agent_turns from public, anon, authenticated;
