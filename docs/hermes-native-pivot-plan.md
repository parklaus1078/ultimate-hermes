# Hermes Native Pivot Plan

Status: draft
Last updated: 2026-07-06
Primary audience: AI coding agents and human maintainers
Supersedes: `docs/hermes-implementation-plan.md` as the implementation direction

## 0. Pivot Summary

The previous implementation direction treated this repository as a standalone
Hermes-like app. That is not the right product shape.

The correct direction is to extend the existing Nous Research Hermes Agent
already installed on this machine:

- Existing Hermes Agent repo: `/Users/kay/.hermes/hermes-agent`
- Active Hermes home: `/Users/kay/.hermes`
- Gateway service: `/Users/kay/Library/LaunchAgents/ai.hermes.gateway.plist`
- User plugin directory: `/Users/kay/.hermes/plugins`

This project should become a native Hermes extension package and local
Postgres-backed memory backend, not a separate assistant app.

The standalone TypeScript code in this repository may remain as a prototype
or reference implementation, but the production path must integrate through
Hermes Agent's existing:

- gateway adapters
- memory provider interface
- native MCP client
- skills
- kanban board and dispatcher
- config and restart lifecycle

## 1. Current Machine State

Discovered state as of 2026-07-06:

- Hermes gateway is installed through launchd.
- `HERMES_HOME` is `/Users/kay/.hermes`.
- Telegram DM has been discovered in `channel_directory.json`.
- Slack is not configured on this machine yet.
- No MCP servers are currently configured.
- Built-in memory is active, but no external memory provider is active.
- `/Users/kay/.hermes/plugins` exists but is empty.
- Hermes kanban exists, current board is `default`, and the board is empty.
- Linear is present in Hermes' optional MCP catalog at
  `/Users/kay/.hermes/hermes-agent/optional-mcps/linear/manifest.yaml`.

Implication:

The first real setup milestone is not "build another app". It is:

1. Add a user-installed Hermes memory provider.
2. Activate it via `memory.provider`.
3. Configure native Hermes MCP for Linear.
4. Reuse Hermes gateway, kanban, skills, and sessions.

## 1.1 Reset Policy

The existing Hermes setup and config may be rebuilt from scratch.

The only user-required invariants are:

- keep Codex as the main model/provider path
- use Slack as the gateway platform

Everything else is disposable unless it becomes useful during implementation:

- existing Hermes profiles
- current kanban boards/tasks
- Telegram gateway state
- current built-in memory contents
- current skills enablement
- current MCP configuration
- previous local plugin state

Implementation rule:

Before overwriting or deleting existing Hermes config, create a timestamped
backup under `/Users/kay/.hermes/backups/` or this repository's ignored local
backup area. The user has allowed a reset, but backups make failed setup
recoverable without preserving old behavior as a constraint.

Target rebuilt Hermes state:

```text
main model/provider: Codex
gateway: Slack
memory provider: life_archive
MCP: Linear first, other SaaS later
kanban: clean board, recreated as needed
```

If Slack is not currently configured, treat Slack setup as a required
reconstruction task rather than a blocker.

## 2. Target Product Shape

Hermes should become a daily-life operating memory for one user.

It should preserve and recall:

- project schedules, tickets, blockers, decisions, and history
- documents, papers, contracts, screenshots, emails, troubleshooting notes,
  and evidence
- career, purchase, research, legal-sensitive, and technical decisions
- enough timeline and source context to reconstruct old events accurately

Hermes Agent remains the human interface. The new backend gives Hermes durable
memory and history recall.

```text
User
  -> Hermes gateway / CLI / Telegram / Slack
  -> Hermes Agent core
  -> MemoryManager
  -> life_archive MemoryProvider
  -> Postgres + pgvector

Hermes Agent
  -> Native MCP client
  -> Linear MCP / future SaaS MCPs

Hermes Agent
  -> Kanban board
  -> worker profiles / dispatcher
```

## 3. Design Decision

Recommended implementation path:

```text
Hermes native Python memory provider + Dockerized Postgres
```

Do not make the standalone Node server the main integration point.

Allowed reuse from this repository:

- Docker Compose Postgres setup
- schema ideas
- event ledger concepts
- approval queue concepts
- Linear/Notion/Google adapter learnings
- README setup notes

But the runtime integration should be Python because Hermes Agent loads memory
providers from Python modules in:

```text
/Users/kay/.hermes/plugins/<provider_name>/
```

Hermes discovers a provider when `__init__.py` implements or registers a
`MemoryProvider`.

## 4. New Component: `life_archive` Memory Provider

Install path:

```text
/Users/kay/.hermes/plugins/life_archive/
```

Required files:

```text
life_archive/
  __init__.py
  plugin.yaml
  db.py
  schema.sql
  retrieval.py
  tools.py
  extractors.py
  secrets.py
  README.md
```

Minimum `plugin.yaml`:

```yaml
name: life_archive
version: 0.1.0
description: "Postgres + pgvector long-term life archive for Hermes Agent."
pip_dependencies:
  - psycopg[binary]>=3
  - pgvector>=0.3
hooks:
  - on_session_end
```

The provider must implement the Hermes `MemoryProvider` contract:

- `name`: return `life_archive`
- `is_available`: check Postgres DSN and required tables
- `initialize`: connect to Postgres and set session/platform/user scope
- `system_prompt_block`: explain available archive tools and recall policy
- `prefetch`: recall relevant memory before each turn
- `queue_prefetch`: warm the next-turn recall cache
- `sync_turn`: append completed conversation turns
- `on_session_end`: extract durable facts, decisions, and timeline records
- `get_tool_schemas`: expose archive tools to the model
- `handle_tool_call`: dispatch tool calls
- `shutdown`: close DB connections

## 5. Provider Tools

Expose a small, stable tool surface. Avoid tool bloat.

### `life_capture`

Purpose: Save a durable event, decision, source, or note.

Use cases:

- "Remember this project decision."
- "This troubleshooting step worked."
- "This may matter later for legal evidence."
- "This paper influenced my direction."

Actions:

- `event`
- `decision`
- `source`
- `incident`
- `project_update`

### `life_recall`

Purpose: Retrieve relevant history from Postgres using hybrid search.

Inputs:

- natural language query
- optional type filter
- optional project/entity filter
- optional date range
- optional sensitivity filter

Retrieval order:

1. Exact identifiers and external refs
2. Postgres full-text search
3. `pg_trgm` fuzzy search
4. pgvector semantic search
5. rerank by recency, confidence, source quality, and user confirmations

### `life_timeline`

Purpose: Reconstruct what happened over time.

Use cases:

- project history
- legal-sensitive issue timeline
- troubleshooting chronology
- career decision history

### `life_link_source`

Purpose: Attach raw evidence to an event.

Source kinds:

- file
- URL
- email
- calendar event
- Linear issue
- Notion page
- Google Drive file
- manual note

### `life_project_status`

Purpose: Summarize current and historical state of a project.

Should include:

- active tickets
- recent decisions
- blockers
- pending external writes
- relevant past context
- open questions

## 6. Database Architecture

Use Dockerized Postgres with `pgvector`.

Recommended container:

```text
ultimate-hermes-postgres
```

Recommended database:

```text
hermes
```

Required extensions:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

Core tables:

```text
life_events
life_sources
life_entities
life_event_entities
life_external_refs
life_embeddings
life_project_snapshots
life_approval_queue
life_audit_log
life_recall_hits
```

Key rules:

- Postgres is the durable source of truth.
- Linear and Notion are external surfaces, not the only copy.
- Important history is append-first.
- Deletions are represented as tombstone events unless explicitly purged.
- Every record has source, confidence, sensitivity, and provenance fields.

Embedding model policy:

- pgvector must be enabled from the start.
- Embeddings can be generated lazily.
- Keyword search must work even when embeddings are absent.
- Semantic recall should not replace source-based recall.

## 7. Secret Storage

The target secret policy remains:

```text
No raw secret in DB, logs, markdown memory, Notion, or committed files.
```

Preferred local boundary:

```text
macOS Keychain
```

Provider behavior:

- Store only service/account references in config or DB.
- Read secrets at runtime.
- Redact secrets in all tool outputs.
- Use an in-memory fake secret store in tests.

Hermes-native exception:

- Linear MCP OAuth should use Hermes' native MCP OAuth storage.
- The `life_archive` provider should not duplicate Linear OAuth tokens.
- It may store Linear external IDs and URLs as non-secret references.

## 8. SaaS Integration Strategy

### Linear

Use Hermes native MCP, not a custom Linear SDK first.

Setup target:

```bash
hermes mcp install linear
hermes mcp login linear
hermes mcp configure linear
/restart
```

Linear role:

- active project execution surface
- issue/project/comment operations
- selected active work only

Do not put the entire life archive into Linear. Linear free plan issue limits
make it unsuitable as the historical source of truth.

Provider responsibility:

- mirror Linear issue/project/comment references into Postgres
- record decisions and history in Postgres
- link Hermes kanban tasks to Linear issues when useful
- require approval for external writes

### Notion

Use Notion as readable inventory and document workspace.

Notion role:

- decision pages
- document index
- incident/evidence pages
- research notes
- project summaries

Postgres remains the source of truth.

Implementation options:

1. Native Hermes MCP if a reliable Notion MCP is installed.
2. Provider-local Notion adapter with Keychain token reference.
3. Reuse the existing TypeScript adapter as a temporary bridge.

Preferred long-term path is option 1 or 2.

### Google Calendar, Drive, Gmail

Use as imported context and source references.

Calendar:

- meetings
- deadlines
- routine reviews

Drive:

- document references
- file metadata
- raw evidence pointers

Gmail:

- communication history
- contractual or conflict evidence
- project decisions in email threads

Default mode must be read/import. External writes require approval.

### Slack

Slack should be configured through Hermes gateway setup, not through this
project's standalone server.

Expected behavior after Slack setup:

- same Hermes Agent
- same memory provider
- same kanban board
- same MCP tools
- same approval policy

## 9. Hermes Kanban Integration

Use Hermes kanban as the execution queue.

Do not replace it with a separate task board.

Recommended mapping:

```text
Hermes kanban task = local worker execution unit
Linear issue = external product/project issue
life_event = durable history record
```

When an agent works on a kanban task:

1. Worker receives task context from Hermes kanban.
2. `life_archive` recalls related project history.
3. Worker executes.
4. Worker records outcome via `life_capture`.
5. Optional Linear/Notion writes are approval-gated.
6. Completion is recorded in both kanban event stream and Postgres history.

## 10. Role Model

Do not create many isolated Hermes profiles first.

Hermes profiles are heavy isolation boundaries. Use them only when isolation is
needed. For this system, start with role prompts, skills, and kanban assignees.

Update on 2026-07-06:

The initial role list was promoted into real native Hermes profiles after the
user clarified that they expected those roles to appear as Hermes profiles.
Each profile is cloned from `default`, has the same main model/provider path,
and has `life_archive` installed.

Initial roles:

- `chief_of_staff`: daily routine, priorities, schedule, follow-up
- `project_operator`: Linear and kanban project tracking
- `archivist`: source capture, document inventory, provenance
- `evidence_curator`: legal-sensitive timelines and source preservation
- `research_librarian`: papers, notes, citations, research memory
- `troubleshooting_scribe`: incidents, root cause, fixes, runbooks
- `integration_clerk`: SaaS sync, webhook ingestion, external refs
- `security_officer`: secret policy, approval gates, sensitive data handling

Only promote a role into a real Hermes profile when it needs:

- different model/provider
- different tool permissions
- isolated memory/config
- different gateway identity
- independent kanban worker behavior

## 11. Implementation Phases

### Phase 0: Mark The Pivot

Deliverables:

- Add this document.
- Mark the old standalone plan as superseded.
- Keep existing standalone code untouched unless it blocks the pivot.
- Record that existing Hermes config may be reset, preserving only Codex as
  main model and Slack as gateway target.

Acceptance:

- A new AI agent can read this document and understand that native Hermes
  extension is the target.

### Phase 0.5: Rebuild Hermes Baseline

Deliverables:

- Back up existing `/Users/kay/.hermes` config/state before overwrite.
- Recreate minimal Hermes config with Codex as the main model/provider path.
- Configure Slack gateway as the primary messaging interface.
- Leave Telegram and old kanban/profile state behind unless needed for
  debugging.
- Confirm gateway restart path through launchd.

Acceptance:

- `hermes config` shows Codex as the active model/provider path.
- `hermes gateway status` or launchd logs show the gateway running.
- Slack is the intended configured platform.
- Old profiles/kanban state are not treated as migration requirements.

### Phase 1: Native Provider Scaffold

Deliverables:

- Create `/Users/kay/.hermes/plugins/life_archive`.
- Add `plugin.yaml`.
- Add minimal `MemoryProvider` implementation.
- Add `life_recall` tool returning a clear "not indexed yet" response.
- Add `life_capture` tool writing to Postgres.

Acceptance:

```bash
hermes memory status
```

shows `life_archive` as available after config is updated.

### Phase 2: Postgres Schema And Migrations

Deliverables:

- Add SQL migrations in this repo.
- Ensure Docker Postgres starts with pgvector and pg_trgm.
- Add provider migration command or startup migration check.
- Add schema version table.

Acceptance:

- Migrations are idempotent.
- Empty DB can be initialized from scratch.
- Existing DB can be upgraded without data loss.

### Phase 3: Recall Pipeline

Deliverables:

- Implement keyword search.
- Implement trigram fuzzy search.
- Implement pgvector semantic search.
- Implement bounded `prefetch`.
- Implement recall result provenance.

Acceptance:

- A Hermes conversation can recall a captured event in a later session.
- Recall output includes source IDs and confidence.
- If embeddings are missing, keyword recall still works.

### Phase 4: Linear MCP Integration

Deliverables:

- Install/configure Linear MCP through Hermes native MCP.
- Document OAuth setup.
- Verify Linear MCP tools appear in Hermes.
- Add Postgres external ref mirror for Linear issue/project/comment IDs.
- Add approval policy for Linear writes.

Acceptance:

```bash
hermes mcp list
```

shows Linear configured, and a Hermes session can use Linear MCP tools after
restart.

### Phase 5: Notion Inventory

Deliverables:

- Decide Notion MCP vs provider-local adapter.
- Create Notion database/page mapping.
- Mirror only structured summaries and external refs to Notion.
- Keep raw source truth in Postgres/source store.

Acceptance:

- A captured decision can produce a Notion page reference.
- The Postgres event remains canonical.

### Phase 6: Google Context Import

Deliverables:

- Add read-only Calendar import.
- Add Drive metadata/source capture.
- Add Gmail thread source references.
- Add OAuth setup docs.

Acceptance:

- Imported Google records become `life_sources` and `life_external_refs`.
- Sensitive content is marked with sensitivity and provenance.

### Phase 7: Daily Routine Loop

Deliverables:

- Morning brief prompt.
- End-of-day review prompt.
- Weekly project/history consolidation.
- Legal-sensitive evidence review mode.
- README update for end-user setup.

Acceptance:

- The user can follow `README.md` and connect API/OAuth credentials.
- Hermes can answer:
  - "What did I decide about this project?"
  - "What happened last time this broke?"
  - "What are the active blockers?"
  - "Show the timeline for this dispute."
  - "What documents did I see related to this?"

## 12. Testing Strategy

Unit tests:

- schema migration idempotency
- query builder behavior
- tool argument validation
- redaction
- sensitivity/confidence defaults

Integration tests:

- provider loads through Hermes memory plugin discovery
- provider connects to local Postgres
- `life_capture` then `life_recall`
- `prefetch` returns bounded context
- missing DB degrades cleanly

Manual tests:

```bash
hermes memory status
hermes config set memory.provider life_archive
hermes gateway restart
hermes chat -q "Remember that Hermes native pivot uses life_archive."
hermes chat -q "What is the Hermes native pivot?"
```

External SaaS tests:

- Linear MCP login and tool discovery
- Notion connection with test parent page
- Google OAuth read-only checks

## 13. Operational Rules For Future Agents

When implementing this pivot:

1. Existing Hermes config may be reset after backup.
2. Preserve or recreate Codex as the main model/provider path.
3. Preserve or recreate Slack as the gateway platform.
4. Do not replace Hermes gateway.
5. Do not fork Hermes core unless a plugin/provider cannot solve it.
6. Prefer `/Users/kay/.hermes/plugins/life_archive` for runtime integration.
7. Keep Postgres in Docker.
8. Do not store raw secrets in repo, DB, logs, or docs.
9. Keep Linear as active execution surface only.
10. Keep Postgres as durable historical source of truth.
11. Use pgvector for long-term semantic recall.
12. Use Hermes native MCP for SaaS where possible.
13. Update README only after the provider path is actually runnable.

## 14. Immediate Next Step

Implement Phase 1.

Concrete next task:

```text
Create a minimal `life_archive` Hermes memory provider under
/Users/kay/.hermes/plugins/life_archive that can load in Hermes, connect to
the Docker Postgres database, and expose `life_capture` + `life_recall`.
```

Do not spend more time expanding the standalone app until the native provider
exists and is active.
