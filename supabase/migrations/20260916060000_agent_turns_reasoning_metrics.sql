-- Reasoning-cost columns for agent_turns — how hard a turn worked, not just how
-- it ended.
--
-- WHY. agent_turns (20260913000000) records the outcome of a turn but not its
-- cost: a two-word answer and a four-round, six-read cross-chain plan are the
-- same row. `rounds` and `read_count` are the two numbers that separate them, so
-- "are turns getting more expensive", "did a prompt change add a round", and
-- "which turns burn the read cap" become answerable. This is the measurement half
-- of the reasoning upgrade — the reason to add a reasoning channel is to see
-- whether it helps, and that needs a before/after this makes possible.
--
--  - rounds:     read-rounds the agent loop ran (0 for a direct answer with no
--                tool calls; MAX_READ_ROUNDS is the ceiling). One "round" is one
--                grounding pass — reads executed, results fed back, model asked
--                again — see runAgent in src/lib/ai/agent.ts.
--  - read_count: total read-tool calls that actually ran across every round
--                (the length of the turn's trace).
--
-- NULLABLE, NO BACKFILL. Rows written before this migration have neither, which
-- reads as "not measured" rather than a misleading zero. Same service-role-only,
-- RLS-on posture as the base table — nothing here changes who can read or write
-- it.

alter table public.agent_turns
  add column if not exists rounds      int,
  add column if not exists read_count  int;
