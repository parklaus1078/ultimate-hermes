do $$
declare
  table_name text;
  application_tables constant text[] := array[
    'schema_migrations',
    'life_schema_migrations',
    'events',
    'sources',
    'entities',
    'event_entities',
    'external_refs',
    'agent_runs',
    'approval_requests',
    'embeddings',
    'sync_state',
    'life_events',
    'life_sources',
    'life_entities',
    'life_event_entities',
    'life_external_refs',
    'life_embeddings',
    'life_project_snapshots',
    'life_approval_queue',
    'life_audit_log',
    'life_recall_hits'
  ];
begin
  foreach table_name in array application_tables loop
    if to_regclass(format('public.%I', table_name)) is null then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', table_name);

    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all privileges on table public.%I from anon', table_name);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all privileges on table public.%I from authenticated', table_name);
    end if;
  end loop;
end
$$;
