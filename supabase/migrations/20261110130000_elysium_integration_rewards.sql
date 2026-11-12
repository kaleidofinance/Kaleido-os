begin;

alter table public.waitlist
  add column if not exists x_elysium_integration_at timestamptz,
  add column if not exists x_elysium_integration_comment_at timestamptz;

comment on column public.waitlist.x_elysium_integration_at is
  'Attested like + repost of the Elysium Mainnet post; +300 kPoint; first 300 wallets.';
comment on column public.waitlist.x_elysium_integration_comment_at is
  'Attested comment on the Elysium Mainnet post; +300 kPoint; first 300 wallets.';

create index if not exists waitlist_elysium_integration_idx
  on public.waitlist (x_elysium_integration_at)
  where x_elysium_integration_at is not null;
create index if not exists waitlist_elysium_integration_comment_idx
  on public.waitlist (x_elysium_integration_comment_at)
  where x_elysium_integration_comment_at is not null;

-- Extend the existing atomic claim function without changing historical task data.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('public.claim_capped_x_task(text,text,integer)'::regprocedure);
  if position('x_elysium_integration_at' in definition) = 0 then
    definition := replace(
      definition,
      quote_literal('x_luca_model_integration_comment_at'),
      quote_literal('x_luca_model_integration_comment_at') || ', ' ||
        quote_literal('x_elysium_integration_at') || ', ' ||
        quote_literal('x_elysium_integration_comment_at')
    );
    execute definition;
  end if;
end;
$$;

-- Include the new counts in the wallet facts response without rebuilding the
-- existing materialized-view schema.
do $$
declare
  definition text;
  updated_definition text;
begin
  definition := pg_get_functiondef(
    'public.reward_wallet_facts(text)'::regprocedure
  );
  if position('''elysiumIntegration''' in definition) = 0 then
    updated_definition := replace(
      definition,
      '''lucaModelIntegrationComment'', (select count(*) from public.waitlist where x_luca_model_integration_comment_at is not null)',
      '''lucaModelIntegrationComment'', (select count(*) from public.waitlist where x_luca_model_integration_comment_at is not null),
      ''elysiumIntegration'', (select count(*) from public.waitlist where x_elysium_integration_at is not null),
      ''elysiumIntegrationComment'', (select count(*) from public.waitlist where x_elysium_integration_comment_at is not null)'
    );
    if updated_definition = definition then
      raise exception 'Could not extend reward_wallet_facts with Elysium task counts';
    end if;
    execute updated_definition;
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
