CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS life_schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS life_events (
  id text PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  type text NOT NULL,
  sensitivity text NOT NULL DEFAULT 'personal',
  title text NOT NULL,
  summary text,
  body text,
  confidence text NOT NULL DEFAULT 'agent_inferred',
  created_by_profile text NOT NULL DEFAULT 'hermes',
  session_id text,
  platform text,
  source_kind text NOT NULL DEFAULT 'manual_note',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(summary, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(body, '')), 'C')
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE INDEX IF NOT EXISTS life_events_search_idx ON life_events USING gin (search_vector);
CREATE INDEX IF NOT EXISTS life_events_title_trgm_idx ON life_events USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS life_events_summary_trgm_idx ON life_events USING gin (summary gin_trgm_ops);
CREATE INDEX IF NOT EXISTS life_events_occurred_at_idx ON life_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS life_events_type_idx ON life_events (type);
CREATE INDEX IF NOT EXISTS life_events_sensitivity_idx ON life_events (sensitivity);
CREATE INDEX IF NOT EXISTS life_events_session_idx ON life_events (session_id);

CREATE TABLE IF NOT EXISTS life_sources (
  id text PRIMARY KEY,
  event_id text NOT NULL REFERENCES life_events(id) ON DELETE CASCADE,
  kind text NOT NULL,
  source_uri text NOT NULL,
  external_id text,
  sha256 text,
  captured_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS life_sources_event_id_idx ON life_sources (event_id);
CREATE INDEX IF NOT EXISTS life_sources_sha256_idx ON life_sources (sha256);
CREATE INDEX IF NOT EXISTS life_sources_external_idx ON life_sources (kind, external_id);

CREATE TABLE IF NOT EXISTS life_entities (
  id text PRIMARY KEY,
  type text NOT NULL,
  name text NOT NULL,
  aliases jsonb NOT NULL DEFAULT '[]'::jsonb,
  sensitivity text NOT NULL DEFAULT 'personal',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(name, ''))
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS life_entities_search_idx ON life_entities USING gin (search_vector);
CREATE INDEX IF NOT EXISTS life_entities_name_trgm_idx ON life_entities USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS life_entities_type_idx ON life_entities (type);

CREATE TABLE IF NOT EXISTS life_event_entities (
  event_id text NOT NULL REFERENCES life_events(id) ON DELETE CASCADE,
  entity_id text NOT NULL REFERENCES life_entities(id) ON DELETE CASCADE,
  relation text NOT NULL DEFAULT 'related',
  PRIMARY KEY (event_id, entity_id, relation)
);

CREATE TABLE IF NOT EXISTS life_external_refs (
  id text PRIMARY KEY,
  hermes_object_type text NOT NULL,
  hermes_object_id text NOT NULL,
  system text NOT NULL,
  external_id text NOT NULL,
  external_url text,
  sync_direction text NOT NULL DEFAULT 'imported',
  last_synced_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS life_external_refs_system_external_id_idx
  ON life_external_refs (system, external_id);
CREATE INDEX IF NOT EXISTS life_external_refs_hermes_object_idx
  ON life_external_refs (hermes_object_type, hermes_object_id);

CREATE TABLE IF NOT EXISTS life_embeddings (
  id text PRIMARY KEY,
  hermes_object_type text NOT NULL,
  hermes_object_id text NOT NULL,
  embedding_model text NOT NULL,
  embedding vector(1536) NOT NULL,
  content_hash text NOT NULL,
  sensitivity text NOT NULL DEFAULT 'personal',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hermes_object_type, hermes_object_id, embedding_model, content_hash)
);

CREATE INDEX IF NOT EXISTS life_embeddings_vector_idx ON life_embeddings
  USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS life_embeddings_object_idx
  ON life_embeddings (hermes_object_type, hermes_object_id);

CREATE TABLE IF NOT EXISTS life_project_snapshots (
  id text PRIMARY KEY,
  project_key text NOT NULL,
  title text NOT NULL,
  summary text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS life_project_snapshots_project_idx
  ON life_project_snapshots (project_key, created_at DESC);

CREATE TABLE IF NOT EXISTS life_approval_queue (
  id text PRIMARY KEY,
  requested_by_profile text NOT NULL,
  action text NOT NULL,
  target_system text,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  requested_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS life_approval_queue_status_idx
  ON life_approval_queue (status, requested_at DESC);

CREATE TABLE IF NOT EXISTS life_audit_log (
  id text PRIMARY KEY,
  profile text NOT NULL,
  action text NOT NULL,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS life_recall_hits (
  id text PRIMARY KEY,
  query text NOT NULL,
  event_id text NOT NULL REFERENCES life_events(id) ON DELETE CASCADE,
  match_kind text NOT NULL,
  score double precision NOT NULL,
  session_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS life_recall_hits_query_idx
  ON life_recall_hits (created_at DESC);

INSERT INTO life_schema_migrations (id)
VALUES ('0001_life_archive_init')
ON CONFLICT (id) DO NOTHING;

