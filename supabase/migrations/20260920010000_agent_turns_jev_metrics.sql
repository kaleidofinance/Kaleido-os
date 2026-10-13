-- Operational Jev rollout metrics. These are machine facts only: no prompt,
-- response, or plan detail is stored.

alter table public.agent_turns
  add column if not exists jev_route text,
  add column if not exists jev_confidence numeric,
  add column if not exists jev_normalizer_skipped boolean;

alter table public.agent_turns
  drop constraint if exists agent_turns_jev_route_check;

alter table public.agent_turns
  add constraint agent_turns_jev_route_check
  check (
    jev_route is null or
    jev_route in ('transaction_plan', 'read_only', 'faq', 'clarification', 'full_reasoning')
  );

create index if not exists agent_turns_jev_route_created_at_idx
  on public.agent_turns (jev_route, created_at desc);
