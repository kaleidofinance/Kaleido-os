-- What people actually ask Luca, and which net answered.
--
-- WHY. The agent answers most sentences locally — a command grammar, a FAQ, and
-- since 2026-09-10 a docs index — and only what none of them can read reaches
-- the cloud model. Every local net was written from a corpus WE imagined, and
-- the corpus scores 95% against itself. Nothing recorded what testers really
-- type, so the next FAQ topic and the next docs paraphrase were guesses. This
-- table replaces the guess: the questions that still reach the model are next
-- week's local coverage, ranked by how often they were asked.
--
-- WHAT IS AND IS NOT STORED. The question text, which net answered (or that the
-- model did), the chain, and a short hash of the address — enough to count
-- distinct askers and repeat questions, not enough to name a wallet. No reply is
-- stored: the answer is derivable from the route, and a reply can carry a
-- position figure the question does not.
--
-- SERVICE-ROLE ONLY, in both directions. The browser never writes here — the
-- insert goes through /api/agent/log, which holds the service key — and nothing
-- reads it publicly. RLS is enabled with no policies, which under Postgres means
-- anon and authenticated see nothing and can write nothing; the service role
-- bypasses RLS and is the only caller.

create table if not exists public.agent_questions (
  id            bigint generated always as identity primary key,
  asked_at      timestamptz not null default now(),
  chain_id      int,
  -- "faq:<id>", "docs:<slug>", "command:<kind>", "asks:<slot>", or "model".
  route         text not null,
  question      text not null,
  -- First 16 hex chars of sha256(lowercase address). Null when no wallet.
  asker_hash    text,
  check (char_length(question) <= 500),
  check (char_length(route) <= 40)
);

-- The two reads this exists for: what reached the model recently, and how
-- often each distinct question was asked.
create index if not exists agent_questions_route_asked_at_idx
  on public.agent_questions (route, asked_at desc);
create index if not exists agent_questions_asked_at_idx
  on public.agent_questions (asked_at desc);

alter table public.agent_questions enable row level security;

revoke all on table public.agent_questions from public, anon, authenticated;
