-- Phase-1 Materializer — the function that turns the two append-only source
-- ledgers (point_epochs, point_actions) into the one table the UI reads
-- (point_balances). Spec: docs/points-system.md §11 (§11a status: this is the
-- "Materializer", the ❌ that §11e schedules as the "Now" build).
--
-- WHAT IT IS
--
-- point_balances is a MATERIALIZED total: time_points + action_points +
-- bonus_points, with a CHECK (point_balances_total_sums, added in
-- 20260818000000) that ties total to those three components and is evaluated at
-- the END of each statement. Until now the only writer was the Season 0
-- participation seed, which wrote bonus_points directly. Nothing recomputed
-- time_points/action_points from the source ledgers, so a wallet could have
-- point_actions rows (e.g. an activated waitlist credit, season 1) and still
-- read 0 on the board. This file is that missing recompute.
--
-- DESIGN — RECOMPUTE FROM SOURCE, PRESERVE THE HUMAN-OWNED FIELDS
--
--   time_points   := Σ point_epochs.points  for (wallet, season)
--   action_points := Σ point_actions.points for (wallet, season)
--   bonus_points  := preserved (Season 0 participation; never derived here)
--   total         := time_points + action_points + bonus_points  (one statement)
--   sybil_flag    := preserved (a human investigation finding; a recompute has
--                    no business overturning it — same reasoning as the seed)
--   activated_at  := preserved
--
-- Recompute-from-source (not increment) so the function is idempotent and
-- self-healing: a compensating epoch/action row, a re-run, or a replayed
-- backfill all converge to the same balance rather than double-counting. This
-- mirrors the Season 0 seed's own "re-running converges rather than
-- accumulating" contract.
--
-- The whole balance is written in ONE upsert because point_balances_total_sums
-- is a statement-end CHECK: you cannot set the components in one statement and
-- total in the next, even inside a transaction (see 20260818000000's header).
--
-- §11b GUARD — never fold testnet points into a converting season. Points
-- earned on a testnet cost nothing to mint; point_conversion_violations is the
-- pre-freeze safety-net view, and this is the write-time twin: if a season has
-- converts_to_tokens = true, the materializer refuses to sum any contributing
-- row from an is_testnet chain and raises, rather than quietly minting free
-- allocation. Today both seasons are converts_to_tokens = false, so the guard's
-- leak-scan never runs (one PK lookup short-circuits it); it arms itself the
-- moment a season is flipped to convert.

-- ---------------------------------------------------------------------------
-- The recompute
-- ---------------------------------------------------------------------------

create or replace function public.materialize_point_balance(
  p_wallet text,
  p_season int
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_time     numeric;
  v_action   numeric;
  v_converts boolean;
  v_leak     int;
begin
  select converts_to_tokens into v_converts
    from public.point_seasons where id = p_season;

  -- §11b: a converting season must never contain testnet-chain points.
  if coalesce(v_converts, false) then
    select count(*) into v_leak
    from (
      select e.chain_id from public.point_epochs  e
        where e.wallet = p_wallet and e.season = p_season
      union all
      select a.chain_id from public.point_actions a
        where a.wallet = p_wallet and a.season = p_season
    ) src
    join public.point_chains c on c.chain_id = src.chain_id
    where c.is_testnet;
    if v_leak > 0 then
      raise exception
        'materialize_point_balance: % testnet-chain point row(s) for wallet % in converting season % — refusing to fold free testnet points into a claimable allocation (see docs/points-system.md §11b)',
        v_leak, p_wallet, p_season;
    end if;
  end if;

  select coalesce(sum(points), 0) into v_time
    from public.point_epochs  where wallet = p_wallet and season = p_season;
  select coalesce(sum(points), 0) into v_action
    from public.point_actions where wallet = p_wallet and season = p_season;

  -- One atomic upsert (statement-end CHECK). On insert a fresh row has no
  -- bonus/flag/activation; on conflict those three are left untouched and total
  -- is rebuilt from the row's own preserved bonus_points plus the fresh sums.
  insert into public.point_balances
    (wallet, season, time_points, action_points, bonus_points, total, updated_at)
  values
    (p_wallet, p_season, v_time, v_action, 0, v_time + v_action, now())
  on conflict (wallet, season) do update
    set time_points   = excluded.time_points,
        action_points = excluded.action_points,
        total         = point_balances.bonus_points
                      + excluded.time_points
                      + excluded.action_points,
        updated_at    = now();
  -- bonus_points, sybil_flag, activated_at: deliberately NOT in the SET list.
end;
$$;

comment on function public.materialize_point_balance(text, int) is
  'Recompute point_balances(wallet,season) from point_epochs + point_actions, preserving bonus_points/sybil_flag/activated_at. Idempotent. Refuses testnet points in a converting season (§11b). Phase-1 materializer, docs/points-system.md §11.';

-- ---------------------------------------------------------------------------
-- Triggers — keep the balance live as source rows land
-- ---------------------------------------------------------------------------

-- Both source tables are append-only by design (a mistake is a compensating
-- row, never an edit), so AFTER INSERT FOR EACH ROW is the whole story. A
-- multi-row insert for one wallet re-materializes that wallet once per row —
-- correct because the recompute is idempotent, and cheap at Phase-1 volume;
-- the indexer (Phases 4/5) can switch to a statement-level trigger with
-- transition tables if per-row ever becomes hot.

create or replace function public.trg_materialize_from_action()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.materialize_point_balance(new.wallet, new.season);
  return null; -- AFTER trigger: return value is ignored
end;
$$;

create or replace function public.trg_materialize_from_epoch()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.materialize_point_balance(new.wallet, new.season);
  return null;
end;
$$;

drop trigger if exists point_actions_materialize on public.point_actions;
create trigger point_actions_materialize
  after insert on public.point_actions
  for each row execute function public.trg_materialize_from_action();

drop trigger if exists point_epochs_materialize on public.point_epochs;
create trigger point_epochs_materialize
  after insert on public.point_epochs
  for each row execute function public.trg_materialize_from_epoch();

-- ---------------------------------------------------------------------------
-- Backfill — materialize every (wallet, season) that already has source rows
-- ---------------------------------------------------------------------------

-- Safe for the Season 0 seed: those rows carry bonus_points but have no epochs
-- or actions, so they are not in this set and are never touched. Any that were
-- would still be preserved (their sums are 0, bonus is kept). Today, with the
-- indexer not live and activation inert (CRON_SECRET unset), this is typically
-- a no-op; it exists so that whenever source rows land before the triggers do
-- — a manual insert, a replayed migration — the board still reflects them.
do $$
declare
  r record;
begin
  for r in
    select wallet, season from public.point_actions
    union
    select wallet, season from public.point_epochs
  loop
    perform public.materialize_point_balance(r.wallet, r.season);
  end loop;
end;
$$;
