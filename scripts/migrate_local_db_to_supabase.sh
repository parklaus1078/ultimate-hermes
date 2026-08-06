#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

usage() {
  cat <<'EOF'
Migrate the current Ultimate Hermes Docker Postgres data to an empty Supabase database.

Required environment:
  SUPABASE_DATABASE_URL             Runtime/session-pooler Postgres URL.

Optional environment:
  SUPABASE_MIGRATION_DATABASE_URL   Direct or session-pooler migration URL.
  HERMES_TARGET_DOCKER_DATABASE_URL Override target URL used by pg_dump's
                                    Docker container. Intended for local
                                    migration rehearsals only.
  HERMES_SOURCE_CONTAINER           Default: ultimate-hermes-postgres
  HERMES_SOURCE_DB_USER             Default: hermes
  HERMES_SOURCE_DB_NAME             Default: hermes
  HERMES_MIGRATION_REPORT_DIR       Default: ./migration-reports

Options:
  --dry-run         Check connectivity and print source counts/checksums only.
  --allow-nonempty  Attempt restore even when target application tables contain rows.
  --keep-dump       Keep the temporary custom-format dump and print its path.
  -h, --help        Show this help.
EOF
}

dry_run=false
allow_nonempty=false
keep_dump=false
while (($#)); do
  case "$1" in
    --dry-run) dry_run=true ;;
    --allow-nonempty) allow_nonempty=true ;;
    --keep-dump) keep_dump=true ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

: "${SUPABASE_DATABASE_URL:?Set SUPABASE_DATABASE_URL to the Supabase runtime/session-pooler Postgres URL.}"

source_container="${HERMES_SOURCE_CONTAINER:-ultimate-hermes-postgres}"
source_user="${HERMES_SOURCE_DB_USER:-hermes}"
source_database="${HERMES_SOURCE_DB_NAME:-hermes}"
target_database_url="${SUPABASE_MIGRATION_DATABASE_URL:-$SUPABASE_DATABASE_URL}"
docker_target_database_url="${HERMES_TARGET_DOCKER_DATABASE_URL:-$target_database_url}"
report_root="${HERMES_MIGRATION_REPORT_DIR:-$PWD/migration-reports}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
temporary_dir="$(mktemp -d "${TMPDIR:-/tmp}/ultimate-hermes-migrate.XXXXXX")"
chmod 700 "$temporary_dir"
dump_file="$temporary_dir/ultimate-hermes.dump"
source_manifest="$temporary_dir/source-manifest.tsv"
target_manifest_before="$temporary_dir/target-manifest-before.tsv"
target_manifest_after="$temporary_dir/target-manifest-after.tsv"

cleanup() {
  if $keep_dump && [[ -f "$dump_file" ]]; then
    chmod 600 "$dump_file"
    echo "Kept private dump at: $dump_file"
    return
  fi
  case "$temporary_dir" in
    "${TMPDIR:-/tmp}"/ultimate-hermes-migrate.*|/tmp/ultimate-hermes-migrate.*) rm -rf "$temporary_dir" ;;
    *) echo "Refusing to remove unexpected temporary path: $temporary_dir" >&2 ;;
  esac
}
trap cleanup EXIT

for command_name in docker npm awk diff; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Missing required command: $command_name" >&2
    exit 1
  }
done

if [[ "$(docker inspect -f '{{.State.Running}}' "$source_container" 2>/dev/null || true)" != "true" ]]; then
  echo "Source container is not running: $source_container" >&2
  echo "Start it with: docker compose up -d postgres" >&2
  exit 1
fi

# This is an integrity fingerprint, not a password hash. Excluding the generated
# search_vector keeps the manifest stable across compatible Postgres versions.
read -r -d '' manifest_sql <<'SQL' || true
create temporary table ultimate_hermes_migration_manifest (
  table_name text primary key,
  row_count bigint not null,
  content_checksum text not null
);

do $manifest$
declare
  table_name text;
  application_tables constant text[] := array[
    'agent_runs',
    'approval_requests',
    'embeddings',
    'entities',
    'event_entities',
    'events',
    'external_refs',
    'life_approval_queue',
    'life_audit_log',
    'life_embeddings',
    'life_entities',
    'life_event_entities',
    'life_events',
    'life_external_refs',
    'life_project_snapshots',
    'life_recall_hits',
    'life_sources',
    'sources',
    'sync_state'
  ];
begin
  foreach table_name in array application_tables loop
    execute format(
      'insert into ultimate_hermes_migration_manifest
       select %L,
              count(*)::bigint,
              md5(coalesce(
                string_agg(
                  md5((to_jsonb(t) - ''search_vector'')::text),
                  '''' order by md5((to_jsonb(t) - ''search_vector'')::text)
                ),
                ''''
              ))
       from public.%I t',
      table_name,
      table_name
    );
  end loop;
end
$manifest$;

select table_name, row_count, content_checksum
from ultimate_hermes_migration_manifest
order by table_name;
SQL

source_integrity_manifest() {
  docker exec \
    -e PGTZ=UTC \
    "$source_container" psql \
    -U "$source_user" \
    -d "$source_database" \
    -v ON_ERROR_STOP=1 \
    -qAt -F '|' \
    -c "$manifest_sql"
}

target_integrity_manifest() {
  docker exec \
    -e PGTZ=UTC \
    -e ULTIMATE_HERMES_TARGET_DATABASE_URL="$docker_target_database_url" \
    -e ULTIMATE_HERMES_MANIFEST_SQL="$manifest_sql" \
    "$source_container" \
    sh -c 'psql "$ULTIMATE_HERMES_TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -qAt -F "|" -c "$ULTIMATE_HERMES_MANIFEST_SQL"'
}

echo "Reading source row counts and content checksums..."
source_integrity_manifest > "$source_manifest"
cat "$source_manifest"

echo "Checking target connectivity..."
docker exec \
  -e ULTIMATE_HERMES_TARGET_DATABASE_URL="$docker_target_database_url" \
  "$source_container" \
  sh -c 'psql "$ULTIMATE_HERMES_TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "select current_database(), current_setting('\''server_version'\''), current_user"' \
  >/dev/null

if $dry_run; then
  echo "Dry run complete. No target schema or data was changed."
  exit 0
fi

echo "Applying idempotent target schema migrations..."
HERMES_DATABASE_URL="$SUPABASE_DATABASE_URL" \
HERMES_MIGRATION_DATABASE_URL="$target_database_url" \
npm run db:migrate >/dev/null

target_integrity_manifest > "$target_manifest_before"
target_total="$(awk -F '|' '{ total += $2 } END { print total + 0 }' "$target_manifest_before")"
if [[ "$target_total" != "0" ]] && ! $allow_nonempty; then
  echo "Target contains $target_total application rows. Refusing to merge into a non-empty target." >&2
  echo "Use a fresh Supabase project, or inspect the target and rerun with --allow-nonempty only when duplicate-key behavior is understood." >&2
  exit 1
fi

echo "Creating a private custom-format data dump..."
docker exec "$source_container" pg_dump \
  -U "$source_user" \
  -d "$source_database" \
  --format=custom \
  --data-only \
  --no-owner \
  --no-privileges \
  --exclude-table=public.schema_migrations \
  --exclude-table=public.life_schema_migrations \
  > "$dump_file"
chmod 600 "$dump_file"

echo "Restoring data to Supabase in one transaction..."
docker exec -i \
  -e ULTIMATE_HERMES_TARGET_DATABASE_URL="$docker_target_database_url" \
  "$source_container" \
  sh -c 'pg_restore --dbname="$ULTIMATE_HERMES_TARGET_DATABASE_URL" --data-only --no-owner --no-privileges --exit-on-error --single-transaction' \
  < "$dump_file"

echo "Comparing exact source and target row counts and content checksums..."
target_integrity_manifest > "$target_manifest_after"
if ! diff -u "$source_manifest" "$target_manifest_after"; then
  echo "Migration integrity verification failed. The local source database was not modified." >&2
  exit 1
fi

report_dir="$report_root/$timestamp"
mkdir -p "$report_dir"
chmod 700 "$report_dir"
cp "$source_manifest" "$report_dir/source-manifest.tsv"
cp "$target_manifest_after" "$report_dir/target-manifest.tsv"
{
  echo "timestamp_utc=$timestamp"
  echo "source_container=$source_container"
  echo "source_database=$source_database"
  echo "verification=exact-row-count-and-content-checksum-match"
  echo "dump_sha256=$(shasum -a 256 "$dump_file" | awk '{print $1}')"
} > "$report_dir/migration-summary.txt"
chmod 600 "$report_dir"/*

echo "Migration verified. Exact row counts and content checksums match."
echo "Audit report: $report_dir"
