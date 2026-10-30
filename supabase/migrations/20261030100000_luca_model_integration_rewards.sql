begin;

alter table public.waitlist
  add column if not exists x_luca_model_integration_at timestamptz,
  add column if not exists x_luca_model_integration_comment_at timestamptz;

comment on column public.waitlist.x_luca_model_integration_at is
  'Attested like + repost of the Luca local-browser-model post; +300 kPoint; first 300 wallets.';
comment on column public.waitlist.x_luca_model_integration_comment_at is
  'Attested comment on the Luca local-browser-model post; +300 kPoint; first 300 wallets.';

create index if not exists waitlist_luca_model_integration_idx
  on public.waitlist (x_luca_model_integration_at)
  where x_luca_model_integration_at is not null;
create index if not exists waitlist_luca_model_integration_comment_idx
  on public.waitlist (x_luca_model_integration_comment_at)
  where x_luca_model_integration_comment_at is not null;

-- Extend the existing atomic claim function without changing historical task data.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('public.claim_capped_x_task(text,text,integer)'::regprocedure);
  if position('x_luca_model_integration_at' in definition) = 0 then
    definition := replace(
      definition,
      quote_literal('x_robinhood_integration_comment_at'),
      quote_literal('x_robinhood_integration_comment_at') || ', ' ||
        quote_literal('x_luca_model_integration_at') || ', ' ||
        quote_literal('x_luca_model_integration_comment_at')
    );
    execute definition;
  end if;
end;
$$;

-- Keep the read-model task counts current after every scheduled refresh.
do $$
declare definition text;
begin
  definition := pg_get_functiondef(
    'kaleido_rewards_private.refresh_read_models()'::regprocedure
  );
  if position('x_luca_model_integration_at' in definition) = 0 then
    definition := replace(
      definition,
      'refresh materialized view concurrently kaleido_rewards_private.metadata;',
      'refresh materialized view concurrently kaleido_rewards_private.metadata;
  update kaleido_rewards_private.metadata
  set task_counts = task_counts || jsonb_build_object(
    ''lucaModelIntegration'', (select count(*) from public.waitlist where x_luca_model_integration_at is not null),
    ''lucaModelIntegrationComment'', (select count(*) from public.waitlist where x_luca_model_integration_comment_at is not null)
  )
  where id = 1;'
    );
    execute definition;
  end if;
end;
$$;

update kaleido_rewards_private.metadata
set task_counts = task_counts || jsonb_build_object(
  'lucaModelIntegration', (select count(*) from public.waitlist where x_luca_model_integration_at is not null),
  'lucaModelIntegrationComment', (select count(*) from public.waitlist where x_luca_model_integration_comment_at is not null)
)
where id = 1;

notify pgrst, 'reload schema';
commit;
