-- Durable task checkpoint table for Luca multi-step workflows (src/lib/ai/taskCheckpoint.ts).
-- Accessed exclusively by server-side service role (supabaseAdmin).

create table if not exists public.agent_tasks (
  idempotency_key text primary key,
  task_id text not null,
  revision integer not null default 0,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_agent_tasks_task_id
  on public.agent_tasks (task_id);

create index if not exists idx_agent_tasks_updated_at
  on public.agent_tasks (updated_at desc);

alter table public.agent_tasks enable row level security;
