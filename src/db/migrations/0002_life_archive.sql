create extension if not exists pg_trgm;
create extension if not exists vector;

create table if not exists life_schema_migrations (
  id text primary key,
  applied_at timestamptz not null default now()
);

create table if not exists life_events (
  id text primary key,
  occurred_at timestamptz not null default now(),
  type text not null,
  sensitivity text not null default 'personal',
  title text not null,
  summary text,
  body text,
  confidence text not null default 'agent_inferred',
  created_by_profile text not null default 'hermes',
  session_id text,
  platform text,
  source_kind text not null default 'manual_note',
  metadata jsonb not null default '{}'::jsonb,
  search_vector tsvector generated always as (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(summary, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(body, '')), 'C')
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists life_events_search_idx on life_events using gin (search_vector);
create index if not exists life_events_title_trgm_idx on life_events using gin (title gin_trgm_ops);
create index if not exists life_events_summary_trgm_idx on life_events using gin (summary gin_trgm_ops);
create index if not exists life_events_occurred_at_idx on life_events (occurred_at desc);
create index if not exists life_events_type_idx on life_events (type);
create index if not exists life_events_sensitivity_idx on life_events (sensitivity);
create index if not exists life_events_session_idx on life_events (session_id);

create table if not exists life_sources (
  id text primary key,
  event_id text not null references life_events(id) on delete cascade,
  kind text not null,
  source_uri text not null,
  external_id text,
  sha256 text,
  captured_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists life_sources_event_id_idx on life_sources (event_id);
create index if not exists life_sources_sha256_idx on life_sources (sha256);
create index if not exists life_sources_external_idx on life_sources (kind, external_id);

create table if not exists life_entities (
  id text primary key,
  type text not null,
  name text not null,
  aliases jsonb not null default '[]'::jsonb,
  sensitivity text not null default 'personal',
  metadata jsonb not null default '{}'::jsonb,
  search_vector tsvector generated always as (
    to_tsvector('simple', coalesce(name, ''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists life_entities_search_idx on life_entities using gin (search_vector);
create index if not exists life_entities_name_trgm_idx on life_entities using gin (name gin_trgm_ops);
create index if not exists life_entities_type_idx on life_entities (type);

create table if not exists life_event_entities (
  event_id text not null references life_events(id) on delete cascade,
  entity_id text not null references life_entities(id) on delete cascade,
  relation text not null default 'related',
  primary key (event_id, entity_id, relation)
);

create table if not exists life_external_refs (
  id text primary key,
  hermes_object_type text not null,
  hermes_object_id text not null,
  system text not null,
  external_id text not null,
  external_url text,
  sync_direction text not null default 'imported',
  last_synced_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists life_external_refs_system_external_id_idx
  on life_external_refs (system, external_id);
create index if not exists life_external_refs_hermes_object_idx
  on life_external_refs (hermes_object_type, hermes_object_id);

create table if not exists life_embeddings (
  id text primary key,
  hermes_object_type text not null,
  hermes_object_id text not null,
  embedding_model text not null,
  embedding vector(1536) not null,
  content_hash text not null,
  sensitivity text not null default 'personal',
  created_at timestamptz not null default now(),
  unique (hermes_object_type, hermes_object_id, embedding_model, content_hash)
);

create index if not exists life_embeddings_vector_idx on life_embeddings
  using hnsw (embedding vector_cosine_ops);
create index if not exists life_embeddings_object_idx
  on life_embeddings (hermes_object_type, hermes_object_id);

create table if not exists life_project_snapshots (
  id text primary key,
  project_key text not null,
  title text not null,
  summary text not null,
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists life_project_snapshots_project_idx
  on life_project_snapshots (project_key, created_at desc);

create table if not exists life_approval_queue (
  id text primary key,
  requested_by_profile text not null,
  action text not null,
  target_system text,
  payload jsonb not null,
  status text not null default 'pending',
  requested_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists life_approval_queue_status_idx
  on life_approval_queue (status, requested_at desc);

create table if not exists life_audit_log (
  id text primary key,
  profile text not null,
  action text not null,
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists life_recall_hits (
  id text primary key,
  query text not null,
  event_id text not null references life_events(id) on delete cascade,
  match_kind text not null,
  score double precision not null,
  session_id text,
  created_at timestamptz not null default now()
);

create index if not exists life_recall_hits_query_idx
  on life_recall_hits (created_at desc);

insert into life_schema_migrations (id)
values ('0001_life_archive_init')
on conflict (id) do nothing;
