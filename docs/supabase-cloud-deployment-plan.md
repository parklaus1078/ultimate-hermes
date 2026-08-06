# Ultimate Hermes Supabase + Remote MCP Plan

Status: implemented and locally verified; cloud activation awaits user credentials
Date: 2026-08-06
Target branch: `feat/add-on-hermes`

## Outcome

Run every agent as a replaceable runtime while keeping durable memory in one
Supabase Postgres database. Codex, Claude Code, and Hermes Agent should all be
able to retrieve and append the same Life Archive through one authenticated
HTTPS MCP/API service.

The finished system must provide:

1. Supabase Postgres as the durable source of truth.
2. `pg_trgm`, Postgres full-text search, and `pgvector` semantic recall.
3. A public HTTPS Streamable HTTP MCP endpoint with bearer authentication.
4. A container deployment that works on Render first and remains portable to
   Fly.io, Railway, Cloud Run, ECS, or Azure Container Apps.
5. Exact local-to-Supabase migration of existing application rows.
6. Short, secret-safe connection instructions for Codex, Claude Code, and
   Hermes Agent.
7. A README that is sufficient to provision, migrate, deploy, connect, test,
   and roll back the system.

## Current-State Evidence

Initial read-only inspection on 2026-08-06 found:

- Local database: PostgreSQL 16.14, pgvector 0.8.4, 26 MB.
- Canonical archive: `life_*` tables used by the Hermes memory provider.
- Remote TypeScript MCP: already queries `life_events` for its primary tools.
- Legacy TypeScript tables: still contain a small amount of data and must also
  migrate to satisfy the "as-is" data requirement.
- Current HTTP `/mcp`: hand-written JSON-RPC using protocol `2024-11-05`, not a
  standards-complete Streamable HTTP transport.
- Current server migrations create legacy tables but do not create `life_*`
  tables on a fresh database.
- Current server has unauthenticated legacy routes that are unsafe on a public
  deployment.

Exact non-migration row-count baseline:

| Table | Rows |
| --- | ---: |
| `life_events` | 822 |
| `life_external_refs` | 205 |
| `life_sources` | 243 |
| `life_recall_hits` | 3373 |
| `life_embeddings` | 0 |
| `events` | 4 |
| `embeddings` | 4 |
| `agent_runs` | 4 |
| all other application tables | 0 |

Migration completion is not proven unless every non-migration table has the
same exact source and target row count and canonical row-content checksum after
restore.

## Target Architecture

```text
Codex --------------------\
Claude Code ---------------+--> HTTPS /mcp --> Ultimate Hermes container
Hermes Agent remote MCP ---/                         |
                                                     +--> Supabase Postgres
Hermes primary gateway ------------------------------/    public.life_*
  (optional native life_archive DB connection)            + pg_trgm
                                                           + FTS
                                                           + pgvector
```

Ownership boundaries:

- Supabase Postgres owns durable memory and search indexes.
- The Ultimate Hermes service owns authentication, MCP protocol handling,
  validation, recall, and append-only memory writes.
- Agent runtimes own conversation, model choice, and tool orchestration only.
- Linear, Notion, Google, and Slack remain external execution/source surfaces;
  their durable summaries and references are captured in Life Archive.

## Deployment Decision

Use Render Blueprint + Docker as the default production path.

Reasons:

- The current application is a long-running Express process, not a static site.
- A persistent container is a natural fit for Streamable HTTP and a bounded
  Postgres connection pool.
- Render supports Dockerfiles, health checks, generated/secret environment
  variables, and repository-backed infrastructure configuration.
- The same Docker image remains portable; Render is not embedded in domain
  logic.

Do not use Netlify Functions as the primary deployment for this version. It is
possible to make MCP stateless on a function platform, but cold starts,
per-invocation Postgres connections, migration execution, and streaming
behavior add complexity without helping this personal single-tenant service.

## Implementation Work Packages

### WP1: Canonical Database and Supabase Safety

- Add the complete `life_*` schema to Node-managed migrations.
- Keep legacy schema migrations so existing legacy rows also have a target.
- Apply migrations under a Postgres advisory lock.
- Add bounded pool settings suitable for Supabase Supavisor session mode.
- Add a separate optional migration URL.
- Enable RLS and revoke Data API roles (`anon`, `authenticated`) when those
  Supabase roles exist. The MCP/API server remains the only public data path.
- Keep service credentials out of client configurations.

Acceptance evidence:

- Fresh Postgres contains both canonical and legacy schemas.
- `vector` and `pg_trgm` extensions exist.
- migration command is idempotent and safe under concurrent startup.

### WP2: Standards-Compliant Remote MCP

- Replace hand-written remote JSON-RPC transport with the official MCP
  TypeScript SDK.
- Use stateless Streamable HTTP at `POST /mcp`.
- Return `405` for unsupported `GET /mcp` and `DELETE /mcp` streams/sessions.
- Retain stdio MCP for local development through the official SDK transport.
- Register canonical Life Archive tools:
  `recent_events`, `recall_events`, `timeline`, `context_pack`,
  `project_status`, `memory_status`, `capture_event`, and `link_source`.
- Support optional semantic recall against `life_embeddings`.
- Skip automatic embeddings for `legal_sensitive` events.

Acceptance evidence:

- Codex/Claude/Hermes-compatible initialization and `tools/list` succeed.
- tool calls reach `life_*`, not the legacy `events` table.
- stdio framing/handshake succeeds through the SDK.

### WP3: Public-Server Hardening

- Require bearer authentication for MCP and private API routes.
- Compare bearer tokens in constant time.
- Reject browser `Origin` values unless explicitly allowlisted.
- Disable legacy HTTP routes by default.
- Separate liveness (`/api/v1/health`) from DB readiness
  (`/api/v1/ready`).
- Avoid returning internal database errors to unauthenticated callers.
- Run the production image as a non-root user.

Acceptance evidence:

- no token: `401`;
- wrong origin: `403`;
- valid token + initialize: `200`;
- readiness fails when the canonical table is unavailable.

### WP4: Exact Data Migration

- Add a migration script using PostgreSQL native `pg_dump`/`pg_restore` from
  the existing Docker Postgres container.
- Apply target schema before restoring data.
- Refuse a non-empty target by default.
- Exclude only migration bookkeeping rows from the data archive.
- Store any temporary dump in a mode-700 temporary directory and remove it on
  exit.
- Compare exact source/target row counts and canonical row-content checksums
  for every application table.
- Emit machine-readable source/target integrity manifests for audit.

Acceptance evidence:

- source and target row-count/content-checksum manifests are identical;
- canonical baseline includes 822 `life_events`, 205 external refs, 243
  sources, and 3373 recall hits unless the local source changes before the
  actual migration run;
- a target recall query returns a known migrated event.

### WP5: Deploy and Client Connection UX

- Add `render.yaml` for one-dashboard-flow deployment.
- Add `.env.example` with runtime and migration variables but no values.
- Add checked-in client templates for Codex, Claude Code, and Hermes Agent.
- Add a helper that safely configures Hermes remote MCP without placing the
  token in shell history.
- Document the primary Hermes native-provider path and the remote-MCP fallback
  without double-writing the same turn.

Acceptance evidence:

- Docker image builds.
- container starts using `PORT` and `0.0.0.0` in production.
- config examples contain environment placeholders, never real credentials.

### WP6: Documentation and Verification

- Rewrite README around the cloud architecture, not the superseded local-only
  path.
- Include project status, setup, migration, deploy, client configuration,
  smoke tests, security model, operations, rollback, and troubleshooting.
- Run unit tests, Python provider tests, typecheck, build, Docker build, and a
  local Streamable HTTP smoke test.

## Migration Procedure

1. Create a Supabase project in the desired region.
2. Copy two connection strings from Supabase:
   - session pooler URL for the persistent Render runtime;
   - direct or session pooler URL for migration operations.
3. Run target migrations.
4. Confirm target application tables are empty.
5. Dump all local `public` application data except migration bookkeeping.
6. Restore into Supabase in one transaction.
7. Compare exact per-table row counts and content checksums.
8. Deploy the MCP/API service against Supabase.
9. Verify health, readiness, initialize, tools/list, recall, and a reversible
   test capture.
10. Point agents at the cloud endpoint.
11. Keep local Postgres unchanged until cloud operation is verified.

## Rollback

- Do not delete or overwrite the local Docker volume during migration.
- If cloud verification fails, point Hermes back to the local DSN and point
  Codex/Claude back to the prior Tailscale endpoint.
- Fix the target, re-run migration only after clearing/recreating the target
  application data through an explicitly destructive operator action.
- Rotate `HERMES_API_TOKEN` if it is ever pasted into logs, chat, or git.

## Repository Readiness Gate

Verified on 2026-08-06:

- [x] Fresh database migration creates canonical `life_*` tables.
- [x] Hardening enables RLS and revokes table privileges from simulated
      Supabase `anon` and `authenticated` roles.
- [x] Official Streamable HTTP initialize, tools/list, and tool calls pass.
- [x] All private routes require bearer auth.
- [x] A full isolated migration rehearsal produced identical source/target row
      count and content-checksum manifests for all 19 application tables.
- [x] Render configuration is committed and the production Docker image builds.
- [x] Codex and Claude configuration generation was verified in isolated config
      directories; Hermes connected and discovered all eight tools.
- [x] README uses the cloud path as primary, contains no real secret, and keeps
      Tailscale only as a generic fallback document.
- [x] Node tests, Python tests, typecheck, build, npm audit, container smoke,
      and migration smoke checks pass.

## Credential-Gated Activation Gate

These operator steps cannot be executed without the user's Supabase and Render
projects. They are intentionally documented rather than simulated:

- [ ] Create/select the production Supabase project.
- [ ] Run the verified migration script against its session-pooler URL and
      retain the generated exact-count report.
- [ ] Deploy the pushed repository through the Render Blueprint.
- [ ] Run health, readiness, MCP initialize, recall, and capture checks against
      the public HTTPS endpoint.
- [ ] Point production Codex, Claude, and Hermes runtimes at that endpoint.
