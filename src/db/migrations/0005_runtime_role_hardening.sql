do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'hermes_runtime') then
    create role hermes_runtime
      nologin
      nosuperuser
      nocreatedb
      nocreaterole
      noinherit
      noreplication
      nobypassrls;
  else
    alter role hermes_runtime
      nosuperuser
      nocreatedb
      nocreaterole
      noinherit
      noreplication
      nobypassrls;
  end if;
end
$$;

do $$
begin
  execute format('grant connect on database %I to hermes_runtime', current_database());
end
$$;

grant usage on schema public to hermes_runtime;

revoke all privileges on table
  public.schema_migrations,
  public.life_events,
  public.life_sources,
  public.life_external_refs,
  public.life_embeddings,
  public.life_project_snapshots,
  public.life_recall_hits
from hermes_runtime;

grant select on table
  public.schema_migrations,
  public.life_events,
  public.life_sources,
  public.life_external_refs,
  public.life_embeddings
to hermes_runtime;

grant insert on table
  public.life_events,
  public.life_sources,
  public.life_embeddings,
  public.life_recall_hits
to hermes_runtime;

grant update, delete on table public.life_embeddings to hermes_runtime;

alter table public.schema_migrations enable row level security;
alter table public.life_events enable row level security;
alter table public.life_sources enable row level security;
alter table public.life_external_refs enable row level security;
alter table public.life_embeddings enable row level security;
alter table public.life_recall_hits enable row level security;

drop policy if exists hermes_runtime_read_schema_version on public.schema_migrations;
create policy hermes_runtime_read_schema_version
  on public.schema_migrations for select
  to hermes_runtime
  using (true);

drop policy if exists hermes_runtime_read_events on public.life_events;
create policy hermes_runtime_read_events
  on public.life_events for select
  to hermes_runtime
  using (true);

drop policy if exists hermes_runtime_insert_events on public.life_events;
create policy hermes_runtime_insert_events
  on public.life_events for insert
  to hermes_runtime
  with check (true);

drop policy if exists hermes_runtime_read_sources on public.life_sources;
create policy hermes_runtime_read_sources
  on public.life_sources for select
  to hermes_runtime
  using (true);

drop policy if exists hermes_runtime_insert_sources on public.life_sources;
create policy hermes_runtime_insert_sources
  on public.life_sources for insert
  to hermes_runtime
  with check (true);

drop policy if exists hermes_runtime_read_external_refs on public.life_external_refs;
create policy hermes_runtime_read_external_refs
  on public.life_external_refs for select
  to hermes_runtime
  using (true);

drop policy if exists hermes_runtime_read_embeddings on public.life_embeddings;
create policy hermes_runtime_read_embeddings
  on public.life_embeddings for select
  to hermes_runtime
  using (true);

drop policy if exists hermes_runtime_insert_embeddings on public.life_embeddings;
create policy hermes_runtime_insert_embeddings
  on public.life_embeddings for insert
  to hermes_runtime
  with check (true);

drop policy if exists hermes_runtime_update_embeddings on public.life_embeddings;
create policy hermes_runtime_update_embeddings
  on public.life_embeddings for update
  to hermes_runtime
  using (true)
  with check (true);

drop policy if exists hermes_runtime_delete_embeddings on public.life_embeddings;
create policy hermes_runtime_delete_embeddings
  on public.life_embeddings for delete
  to hermes_runtime
  using (true);

drop policy if exists hermes_runtime_insert_recall_hits on public.life_recall_hits;
create policy hermes_runtime_insert_recall_hits
  on public.life_recall_hits for insert
  to hermes_runtime
  with check (true);
