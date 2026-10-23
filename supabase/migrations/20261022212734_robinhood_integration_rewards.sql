begin;
alter table public.waitlist
  add column if not exists x_robinhood_integration_at timestamptz,
  add column if not exists x_robinhood_integration_comment_at timestamptz;

-- Extend the deployed atomic claim function without replacing other task rules.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('public.claim_capped_x_task(text,text,integer)'::regprocedure);
  if position('x_robinhood_integration_at' in definition) = 0 then
    if position(quote_literal('x_argus_integration_at') in definition) = 0 then
      raise exception 'Expected integration task allowlist missing';
    end if;
    definition := replace(definition, quote_literal('x_argus_integration_at'),
      quote_literal('x_argus_integration_at') || ', ' || quote_literal('x_robinhood_integration_at') || ', ' || quote_literal('x_robinhood_integration_comment_at'));
    execute definition;
  end if;
end;
$$;
notify pgrst, 'reload schema';
commit;
