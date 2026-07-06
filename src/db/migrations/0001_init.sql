create extension if not exists pg_trgm;
create extension if not exists vector;

create table if not exists schema_migrations (
  id text primary key,
  applied_at timestamptz not null default now()
);

create table if not exists events (
  id text primary key,
  occurred_at timestamptz not null,
  type text not null,
  sensitivity text not null,
  title text not null,
  summary text,
  body text,
  confidence text not null,
  created_by_profile text not null,
  search_vector tsvector generated always as (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(summary, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(body, '')), 'C')
  ) stored,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists events_search_idx on events using gin (search_vector);
create index if not exists events_title_trgm_idx on events using gin (title gin_trgm_ops);
create index if not exists events_summary_trgm_idx on events using gin (summary gin_trgm_ops);
create index if not exists events_occurred_at_idx on events (occurred_at);
create index if not exists events_type_idx on events (type);
create index if not exists events_sensitivity_idx on events (sensitivity);

create table if not exists sources (
  id text primary key,
  event_id text not null references events(id),
  kind text not null,
  source_uri text not null,
  external_id text,
  sha256 text,
  captured_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists sources_event_id_idx on sources (event_id);
create index if not exists sources_sha256_idx on sources (sha256);

create table if not exists entities (
  id text primary key,
  type text not null,
  name text not null,
  aliases jsonb not null default '[]'::jsonb,
  sensitivity text not null,
  search_vector tsvector generated always as (
    to_tsvector('simple', coalesce(name, ''))
  ) stored,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists entities_search_idx on entities using gin (search_vector);
create index if not exists entities_name_trgm_idx on entities using gin (name gin_trgm_ops);
create index if not exists entities_type_idx on entities (type);

create table if not exists event_entities (
  event_id text not null references events(id),
  entity_id text not null references entities(id),
  relation text not null,
  primary key (event_id, entity_id, relation)
);

create table if not exists external_refs (
  id text primary key,
  hermes_object_type text not null,
  hermes_object_id text not null,
  system text not null,
  external_id text not null,
  external_url text,
  sync_direction text not null,
  last_synced_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create unique index if not exists external_refs_system_external_id_idx
  on external_refs (system, external_id);
create index if not exists external_refs_hermes_object_idx
  on external_refs (hermes_object_type, hermes_object_id);

create table if not exists agent_runs (
  id text primary key,
  profile_id text not null,
  command text not null,
  input jsonb,
  output jsonb,
  created_event_ids jsonb not null default '[]'::jsonb,
  external_write_refs jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null
);

create table if not exists approval_requests (
  id text primary key,
  requested_by_profile text not null,
  action text not null,
  target_system text,
  payload jsonb not null,
  status text not null,
  requested_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists embeddings (
  id text primary key,
  hermes_object_type text not null,
  hermes_object_id text not null,
  embedding_model text not null,
  embedding vector(1536) not null,
  content_hash text not null,
  sensitivity text not null,
  created_at timestamptz not null default now(),
  unique (hermes_object_type, hermes_object_id, embedding_model, content_hash)
);

create index if not exists embeddings_vector_idx on embeddings
  using hnsw (embedding vector_cosine_ops);
create index if not exists embeddings_object_idx on embeddings (hermes_object_type, hermes_object_id);

create table if not exists sync_state (
  id text primary key,
  system text not null,
  cursor_value text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
