begin;

-- The initial Elysium migration checked for the new column name anywhere in
-- the function definition. That can be true before the taskCounts JSON keys
-- are present, leaving the shared rewards snapshot without the new cap counts.
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
