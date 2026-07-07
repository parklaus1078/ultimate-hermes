# Hermes Agent Implementation Plan

Status: superseded by `docs/hermes-native-pivot-plan.md`
Last updated: 2026-07-06
Primary audience: AI coding agents and human maintainers
Related docs:
- `docs/hermes-agent-report.html`
- `docs/hermes-agent-architecture.html`
- `docs/hermes-native-pivot-plan.md`

> Pivot note: this document describes the earlier standalone-app direction.
> The implementation target has changed to extending the existing Nous
> Research Hermes Agent installation via a native memory provider, native MCP,
> gateway, kanban, and skills. Use `docs/hermes-native-pivot-plan.md` as the
> source of truth for future implementation.

## 0. Objective

Build Hermes Agent as a personal daily-life memory assistant.

Hermes must preserve and recall:
- project schedules, tickets, decisions, blockers, and history
- documents, papers, contracts, emails, screenshots, troubleshooting notes, and evidence
- decisions about career, purchases, legal-sensitive issues, and technical direction
- enough timeline and source context to reconstruct old events as if they happened recently

Hermes is not just a Notion or Linear bot. Hermes owns the long-term memory ledger. SaaS products are external views or specialized inventories.

## 1. Source Of Truth

The source of truth is the Hermes local event ledger.

```text
Hermes Ledger = canonical append-only history
Linear = project execution and ticket surface
Notion = document, decision, incident, and evidence inventory
Search Index = recall layer
Raw Evidence Store = original source preservation
```

Implementation rule:
- Never depend on Notion or Linear as the only copy of important memory.
- Every imported or generated record must have a Hermes ID.
- Every external object should store or reference the Hermes ID when possible.
- Deletion must be represented as an event, not physical removal, unless the user explicitly requests a destructive operation.

## 2. Recommended Initial Stack

Use this as the default implementation path unless the repo later establishes a different stack.

```text
Runtime: Node.js + TypeScript
Package manager: pnpm
CLI framework: Commander or Clipanion
Database: PostgreSQL
ORM/query: Drizzle
Keyword search: PostgreSQL full text search (`tsvector`, `tsquery`, GIN indexes) + `pg_trgm` for Korean/fuzzy matching
Semantic search: pgvector for long-term memory recall after local capture and keyword search work
External APIs: Notion REST API, Linear GraphQL API
Secret storage: macOS Keychain references, not raw secrets in DB
Testing: Vitest
Formatting/linting: Prettier + ESLint
```

Rationale:
- Linear has a TypeScript SDK and GraphQL API.
- Notion has a mature JavaScript SDK and REST API.
- PostgreSQL is a better long-term fit for Hermes because event history, JSON metadata, relational integrity, keyword search, and vector search can live in one database.
- Drizzle keeps the schema explicit and TypeScript-friendly while still letting Hermes use native PostgreSQL features.
- PostgreSQL full-text search plus `pg_trgm` gives exact and fuzzy recall. `pgvector` adds semantic recall for older memories where the user remembers meaning but not exact words.
- macOS Keychain is the required local secret boundary for API tokens. Hermes stores only keychain service/account references.

### 2.1 Secret Storage

Use macOS Keychain as the only approved secret store for local Hermes credentials.

Rules:
- Do not store API tokens, OAuth refresh tokens, database passwords, or webhook signing secrets in the Hermes database.
- Do not store raw secrets in config files, logs, approval payloads, audit records, or Notion pages.
- Store stable references such as `service=hermes-linear` and `account=default`.
- The Hermes DB may store the reference name, provider, creation date, and rotation metadata.
- The `Security & Privacy Officer` profile owns secret access policy.

Required implementation:
- Add a `SecretStore` interface.
- Add a macOS Keychain implementation.
- In tests, use an in-memory fake secret store.
- Any command that prints config must redact secret values and show references only.

## 3. Non-Negotiable System Rules

These rules apply to every profile, adapter, CLI command, and background job.

1. Raw before summary.
   Store original source references, files, URLs, IDs, timestamps, and hashes before LLM summaries.

2. Append first.
   Do not mutate history silently. Important changes create new events.

3. External write requires approval.
   Creating or modifying Linear issues, Notion pages, comments, calendar events, or GitHub objects must pass a policy gate.

4. No raw secret persistence.
   Store secret references only, such as macOS Keychain service/account names.

5. Legal-sensitive mode is evidence mode.
   Hermes may organize facts, timestamps, source files, and timelines. Hermes must not present itself as legal counsel.

6. Recall must expose uncertainty.
   Distinguish `human_confirmed`, `imported`, and `agent_inferred` records.

7. Every agent action is auditable.
   Record profile name, command, inputs, output references, and external writes.

## 4. Core Concepts

### 4.1 Event

The smallest durable memory unit.

```ts
type EventType =
  | "project"
  | "ticket"
  | "document"
  | "decision"
  | "incident"
  | "legal"
  | "career"
  | "purchase"
  | "research"
  | "communication"
  | "system";

type Sensitivity =
  | "public"
  | "personal"
  | "confidential"
  | "legal_sensitive";

type Confidence =
  | "human_confirmed"
  | "imported"
  | "agent_inferred";

type HermesEvent = {
  id: string;
  timestamp: string;
  type: EventType;
  sensitivity: Sensitivity;
  title: string;
  summary?: string;
  body?: string;
  confidence: Confidence;
  createdByProfile: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
};
```

### 4.2 Source

A raw input attached to an event.

```ts
type SourceKind =
  | "file"
  | "url"
  | "email"
  | "linear_issue"
  | "notion_page"
  | "github_commit"
  | "github_pr"
  | "calendar_event"
  | "manual_note";

type HermesSource = {
  id: string;
  eventId: string;
  kind: SourceKind;
  sourceUri: string;
  externalId?: string;
  sha256?: string;
  capturedAt: string;
  metadataJson?: string;
};
```

### 4.3 Entity

People, organizations, projects, documents, tickets, and decisions are entities linked through events.

```ts
type EntityType =
  | "person"
  | "organization"
  | "project"
  | "ticket"
  | "document"
  | "decision"
  | "incident"
  | "evidence"
  | "repository"
  | "service";

type HermesEntity = {
  id: string;
  type: EntityType;
  name: string;
  aliases?: string[];
  sensitivity: Sensitivity;
};
```

### 4.4 External Reference

Maps Hermes objects to SaaS objects.

```ts
type ExternalSystem =
  | "linear"
  | "notion"
  | "google_calendar"
  | "gmail"
  | "google_drive"
  | "github";

type ExternalRef = {
  id: string;
  hermesObjectType: "event" | "entity" | "source";
  hermesObjectId: string;
  system: ExternalSystem;
  externalId: string;
  externalUrl?: string;
  syncDirection: "imported" | "exported" | "bidirectional";
  lastSyncedAt?: string;
};
```

## 5. Agent Profiles

Implement profiles as role configurations, not separate applications.

Each profile must define:
- name
- purpose
- allowed read scopes
- allowed write scopes
- default output type
- approval requirements

### 5.1 Profile Registry

```ts
type AgentProfile = {
  id: string;
  name: string;
  purpose: string;
  canRead: string[];
  canWrite: string[];
  requiresApprovalFor: string[];
  defaultSensitivity: Sensitivity;
};
```

### 5.2 Required Profiles

| Profile | Purpose | Key functions | Default permissions |
| --- | --- | --- | --- |
| Chief of Staff | Daily operation control | daily briefing, evening shutdown, missed follow-up detection | read ledger, Linear, Notion, Calendar |
| Capture Router | Fast capture and classification | ingest note/link/file, classify event, dedupe, route to profile | write ledger, write sources |
| Project Manager | Project execution memory | create/update project records, summarize blockers, recommend next tickets | read/write ledger, request Linear writes |
| Linear Sync Manager | Linear integration integrity | import issues/projects/comments, normalize webhooks, maintain ID map | read/write ledger, read/write Linear with approval |
| Archivist | Document inventory | ingest docs, create Notion inventory pages, connect docs to events | read/write ledger, request Notion writes |
| Historian | Timeline reconstruction | build chronological narratives, find gaps, connect events | read ledger/search only by default |
| Decision Analyst | Decision memory | create decision records, track tradeoffs, schedule review | write decision events |
| Troubleshooting Analyst | Incident/runbook memory | record symptoms, attempts, resolution, prevention | write incident events |
| Evidence Clerk | Legal-sensitive evidence organization | preserve source, hash files, build fact timeline, export evidence packet | no external write by default |
| Research Librarian | Research memory | ingest papers/articles, summarize claims, link to projects/decisions | write document/research events |
| Career Curator | Career artifact extraction | resume bullets, portfolio notes, interview stories | read completed project events, write career events |
| Security & Privacy Officer | Policy enforcement | sensitivity labels, approval checks, audit logs, redaction | policy gate authority |

## 6. SaaS Integration Requirements

### 6.1 Linear

Role:
- project execution and ticket history surface
- not the canonical store for all personal memory

Required capabilities:
- import teams, projects, issues, workflow states, labels, comments
- create selected issues from Hermes project/ticket events after approval
- update selected issue status, priority, due date, labels, and comments after approval
- receive webhooks and convert them into Hermes events
- store Hermes IDs in issue description or comments where appropriate

Linear features Hermes should use:
- Teams: map work areas or major project groups.
- Projects: represent active, execution-worthy projects only.
- Issues: represent concrete execution tasks, not every memory event.
- Workflow states: map `planned`, `active`, `blocked`, `review`, `done`, `archived`.
- Labels: encode project type, urgency, source, or Hermes-managed flags.
- Comments: append selected status notes and Hermes backlinks.
- Cycles: optional weekly/sprint planning view if it matches the user's routine.
- Webhooks: import issue/project/comment changes into Hermes.
- GraphQL queries/mutations: import data by default, write only after approval.

Linear features Hermes should not rely on for MVP:
- Linear Docs as the main knowledge archive. Notion and Hermes Ledger own that.
- Linear as raw evidence storage.
- Linear as life-event, legal-sensitive, research, or document memory.
- Linear AI/Agent automations, Insights, Asks, customer requests, and support integrations.
- File uploads, unless a small execution artifact is truly useful inside an issue.

Free plan constraint:
- Linear Free currently has a limited issue budget. Hermes must not mirror every captured task into Linear.
- Hermes should track all project/ticket history locally, then export only active, execution-worthy work to Linear.
- Small notes, life events, document captures, troubleshooting logs, decisions, legal-sensitive records, and archived project history stay in Hermes/Notion, not Linear.
- Add a local `linear_export_policy` so each ticket can be `local_only`, `linear_candidate`, or `linear_exported`.

Implementation notes:
- Use GraphQL API.
- Prefer webhook import over frequent polling.
- Use scheduled sync to repair missed webhook events.
- Store `linear.issueId`, `linear.identifier`, `linear.url`, `linear.updatedAt`.
- Track Linear issue budget locally if the API exposes enough count data; otherwise estimate from imported issues.
- Before creating Linear issues, show the user how many candidate issues would be created.

Acceptance criteria:
- Hermes can import all active Linear issues into local ledger.
- Hermes can create a Linear issue from a local ticket after explicit approval.
- Hermes can answer: "What changed in project X last week?"
- Hermes can keep unlimited local project history without consuming Linear issue slots.

### 6.2 Notion

Role:
- readable inventory for documents, decisions, incidents, evidence, people, organizations

Required databases:
- Documents
- Decisions
- Incidents
- Evidence
- People
- Organizations
- Projects

Required capabilities:
- create/update pages from Hermes records
- link Notion pages back to Hermes IDs
- import Notion page updates as events
- use Notion as a human-friendly view, not the only store

Acceptance criteria:
- Hermes can create a Notion document record for a captured PDF or URL.
- Hermes can create a decision page from a local decision event.
- Hermes can preserve local ledger data if Notion sync is disabled.

### 6.3 Calendar

Role:
- time anchor for meetings, deadlines, reviews, follow-ups

Required capabilities:
- import events for timeline reconstruction
- create follow-up reminders only after approval
- link calendar event IDs to Hermes events

MVP status:
- Phase 2, not Phase 1.

### 6.4 Email

Role:
- communication and evidence source

Required capabilities:
- import selected labeled threads only
- capture headers, timestamps, sender, recipients, subject, attachment refs
- avoid whole-inbox ingestion in MVP

MVP status:
- Phase 3, legal-sensitive/evidence mode.

### 6.5 GitHub

Role:
- code evidence and troubleshooting source

Required capabilities:
- link commits, PRs, issues, releases to Hermes events
- import commit hashes and PR URLs
- connect GitHub activity to Linear tickets

MVP status:
- Phase 2 or Phase 3.

## 7. Local Repository Shape

Recommended application structure:

```text
ultimate-hermes/
  docs/
    hermes-agent-report.html
    hermes-agent-architecture.html
    hermes-implementation-plan.md
  package.json
  pnpm-lock.yaml
  tsconfig.json
  src/
    cli/
      index.ts
      commands/
        capture.ts
        remember.ts
        timeline.ts
        status.ts
        review.ts
        sync.ts
    core/
      ids.ts
      time.ts
      policy.ts
      profiles.ts
      events.ts
      sources.ts
      entities.ts
    db/
      client.ts
      schema.ts
      migrations/
    adapters/
      linear/
        client.ts
        import.ts
        export.ts
        webhook.ts
        mapping.ts
      notion/
        client.ts
        databases.ts
        import.ts
        export.ts
        mapping.ts
    search/
      fts.ts
      recall.ts
      timeline.ts
    agents/
      chief-of-staff.ts
      capture-router.ts
      project-manager.ts
      archivist.ts
      historian.ts
      decision-analyst.ts
      troubleshooting-analyst.ts
      evidence-clerk.ts
      research-librarian.ts
      career-curator.ts
      security-privacy-officer.ts
    audit/
      audit-log.ts
    secrets/
      secret-store.ts
      keychain.ts
      memory-secret-store.ts
    config/
      env.ts
      paths.ts
  tests/
    unit/
    integration/
```

## 8. Database Schema MVP

Implement these tables first.

```sql
create extension if not exists pg_trgm;
create extension if not exists vector;

create table events (
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

create index events_search_idx on events using gin (search_vector);
create index events_title_trgm_idx on events using gin (title gin_trgm_ops);
create index events_summary_trgm_idx on events using gin (summary gin_trgm_ops);
create index events_occurred_at_idx on events (occurred_at);
create index events_type_idx on events (type);
create index events_sensitivity_idx on events (sensitivity);

create table sources (
  id text primary key,
  event_id text not null references events(id),
  kind text not null,
  source_uri text not null,
  external_id text,
  sha256 text,
  captured_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index sources_event_id_idx on sources (event_id);
create index sources_sha256_idx on sources (sha256);

create table entities (
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

create index entities_search_idx on entities using gin (search_vector);
create index entities_name_trgm_idx on entities using gin (name gin_trgm_ops);
create index entities_type_idx on entities (type);

create table event_entities (
  event_id text not null references events(id),
  entity_id text not null references entities(id),
  relation text not null,
  primary key (event_id, entity_id, relation)
);

create table external_refs (
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

create unique index external_refs_system_external_id_idx
  on external_refs (system, external_id);

create table agent_runs (
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

create table approval_requests (
  id text primary key,
  requested_by_profile text not null,
  action text not null,
  target_system text,
  payload jsonb not null,
  status text not null,
  requested_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table embeddings (
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

create index embeddings_vector_idx on embeddings
  using hnsw (embedding vector_cosine_ops);
```

Search:
- Use PostgreSQL full-text search with generated `tsvector` columns and GIN indexes.
- Use `pg_trgm` indexes for Korean, fuzzy, and partial-string matching.
- Start with the `simple` text search configuration because Hermes data will mix Korean and English. Revisit Korean-specific tokenization, PGroonga, or an external search engine later if recall quality is poor.
- Use `pgvector` for semantic recall after local capture and keyword recall work.
- Treat embeddings as derived indexes, not source of truth. They can be deleted and regenerated from events/sources.
- Do not generate embeddings for `legal_sensitive` records unless the user explicitly enables it.
- Keep exact keyword search available even after semantic search exists.

## 9. CLI Commands

Implement CLI commands in this order.

### 9.1 `hermes capture`

Purpose:
- fast manual memory capture

Examples:

```bash
hermes capture "오늘 대표와 정산 이슈를 통화함. 다음 주 월요일까지 자료 보내기로 함."
hermes capture --type decision "Linear는 프로젝트 실행, Notion은 문서 inventory로 사용한다."
hermes capture --sensitivity legal_sensitive "A사 정산 관련 분쟁 가능성이 있음."
```

Acceptance criteria:
- Creates one event.
- Applies default profile `capture-router`.
- Supports `type`, `sensitivity`, `project`, `source-url`, and `tags`.
- Adds an agent run audit record.

### 9.2 `hermes doc add`

Purpose:
- ingest local file or URL as a source

Examples:

```bash
hermes doc add ./paper.pdf --type research
hermes doc add ./contract.pdf --sensitivity legal_sensitive
hermes doc add https://example.com/post --type document
```

Acceptance criteria:
- Creates event and source.
- Computes SHA-256 for local files.
- Does not move or delete the original file unless explicitly configured.

### 9.3 `hermes remember`

Purpose:
- recall relevant historical records

Example:

```bash
hermes remember "예전에 Vercel 배포 에러 어떻게 해결했지?"
```

Acceptance criteria:
- Searches local FTS.
- Returns matching events with timestamps, title, summary, source refs, confidence.
- Does not hallucinate missing records. If no record exists, say no matching record found.

### 9.4 `hermes timeline`

Purpose:
- reconstruct chronological history for a topic, person, organization, project, or legal-sensitive issue

Example:

```bash
hermes timeline "A사 정산 이슈"
```

Acceptance criteria:
- Returns ordered events.
- Includes source references.
- Marks gaps and inferred links separately.

### 9.5 `hermes status`

Purpose:
- show current active projects, tickets, blockers, and follow-ups

Example:

```bash
hermes status --all-projects
```

Acceptance criteria:
- Reads local ledger first.
- Includes Linear data only if sync is configured.
- Shows stale projects and blocked items.

### 9.6 `hermes sync linear`

Purpose:
- import/export Linear data

Acceptance criteria:
- Import can run without external writes.
- Export creates approval request before writing.
- Maintains `external_refs`.

### 9.7 `hermes sync notion`

Purpose:
- sync Hermes records with Notion inventory pages

Acceptance criteria:
- Can create required Notion database schema after approval.
- Can export selected event/document/decision records after approval.
- Can import page updates as local events.

### 9.8 `hermes review weekly`

Purpose:
- weekly review generation

Acceptance criteria:
- Summarizes completed, active, blocked, and stale items.
- Lists decisions made this week.
- Lists documents captured this week.
- Suggests next week priorities.
- Writes the review as an event.

## 10. Implementation Phases

### Phase 0: Repo Bootstrap

Goal:
- create the application skeleton and test harness

Tasks:
- HERMES-0001: create `package.json`, `tsconfig.json`, lint/test scripts
- HERMES-0002: create `src/` directory layout
- HERMES-0003: create config loader for paths and env
- HERMES-0004: create ID generator
- HERMES-0005: create test setup
- HERMES-0006: create `SecretStore` interface and in-memory fake for tests

Done when:
- `pnpm test` runs
- `pnpm typecheck` runs
- empty CLI can print help

### Phase 1: Local Ledger MVP

Goal:
- persist events, sources, entities, external refs, agent runs, approvals

Tasks:
- HERMES-0101: implement PostgreSQL client
- HERMES-0102: implement Drizzle migrations
- HERMES-0103: implement schema from section 8
- HERMES-0104: implement event repository
- HERMES-0105: implement source repository
- HERMES-0106: implement audit log repository
- HERMES-0107: implement policy gate skeleton
- HERMES-0108: implement macOS Keychain secret store

Done when:
- tests can create/read/archive events
- creating an event writes an agent run
- no command physically deletes event history

### Phase 2: Capture And Recall

Goal:
- make Hermes useful without SaaS integrations

Tasks:
- HERMES-0201: implement `hermes capture`
- HERMES-0202: implement `hermes doc add`
- HERMES-0203: implement SHA-256 hashing for local files
- HERMES-0204: implement PostgreSQL full-text search
- HERMES-0205: implement `hermes remember`
- HERMES-0206: implement `hermes timeline`
- HERMES-0207: implement `hermes review weekly`

Done when:
- user can capture notes and documents locally
- user can search old records
- user can generate a weekly review from local data

### Phase 3: Semantic Recall

Goal:
- make long-term memory recall work when the user remembers meaning, context, or a partial description rather than exact words

Tasks:
- HERMES-0301: add embedding provider abstraction
- HERMES-0302: implement pgvector migration and embedding repository
- HERMES-0303: implement privacy controls for embedding generation
- HERMES-0304: generate embeddings for eligible event and source summaries
- HERMES-0305: implement hybrid keyword + vector search
- HERMES-0306: implement context pack builder for LLM calls
- HERMES-0307: update `hermes remember` to show exact, fuzzy, and semantic matches separately

Done when:
- Hermes can find relevant old records without exact keyword overlap
- exact keyword search remains available and clearly labeled
- `legal_sensitive` records are excluded from embedding generation unless explicitly enabled
- embeddings can be deleted and regenerated from ledger data

### Phase 4: Notion Inventory

Goal:
- create human-readable document and decision inventory

Tasks:
- HERMES-0401: implement Notion client
- HERMES-0402: define Notion database schemas
- HERMES-0403: implement database setup command with approval
- HERMES-0404: export document records to Notion
- HERMES-0405: export decision records to Notion
- HERMES-0406: import Notion page updates as events
- HERMES-0407: maintain external ref mapping

Done when:
- a captured document can become a Notion page
- a decision event can become a Notion decision record
- Hermes still works if Notion is unavailable

### Phase 5: Linear Project Memory

Goal:
- manage detailed project and ticket history

Tasks:
- HERMES-0501: implement Linear GraphQL client
- HERMES-0502: import teams, projects, issues, workflow states
- HERMES-0503: map Linear issues to Hermes entities/events
- HERMES-0504: implement `hermes sync linear --import`
- HERMES-0505: implement approved Linear issue creation
- HERMES-0506: implement approved Linear issue update
- HERMES-0507: implement Linear webhook receiver if local server is available

Done when:
- Hermes can reconstruct ticket history from Linear imports
- Hermes can create/update a Linear issue only after approval
- local ledger contains imported Linear changes as events

### Phase 6: Daily Life Operations

Goal:
- turn records into daily operational support

Tasks:
- HERMES-0601: implement `hermes status`
- HERMES-0602: implement daily briefing
- HERMES-0603: implement evening shutdown
- HERMES-0604: identify stale projects
- HERMES-0605: identify blocked tickets
- HERMES-0606: identify follow-ups from captured records

Done when:
- Hermes can answer "what should I look at today?"
- Hermes can answer "what am I neglecting?"
- Hermes can summarize current active life/project state

### Phase 7: Evidence Mode

Goal:
- handle legal-sensitive and dispute-sensitive histories safely

Tasks:
- HERMES-0701: implement legal-sensitive sensitivity handling
- HERMES-0702: implement evidence packet export
- HERMES-0703: add source hash verification command
- HERMES-0704: build timeline with facts vs assumptions separated
- HERMES-0705: block external sync for legal-sensitive records by default

Done when:
- Hermes can create an evidence timeline without legal advice language
- evidence export includes source refs, hashes, timestamps, and gaps
- external writes require explicit approval

## 11. Approval Policy

Actions that must require approval:
- create/update/delete external SaaS objects
- export legal-sensitive or confidential records
- read from paths outside allowed archive roots
- access email threads
- access calendar data
- create public links
- delete local files
- modify project repositories

Actions that may be allowed by default:
- create local event
- create local source record
- read local Hermes DB
- search local Hermes DB
- create local weekly review event

Actions forbidden by default:
- store raw API keys in DB
- read `.env` files from unrelated projects
- send confidential/legal-sensitive content to external LLMs
- physically delete raw evidence

## 12. Testing Strategy

### Unit tests

Required:
- ID generation
- event repository
- source hashing
- policy gate decisions
- FTS search behavior
- pgvector embedding repository behavior
- hybrid recall ranking behavior
- embedding exclusion for `legal_sensitive` records
- timeline ordering
- external ref mapping

### Integration tests

Required:
- PostgreSQL migration from empty DB
- capture command creates event and agent run
- doc add command creates source and hash
- remember command returns deterministic results
- approval request blocks external write

### Contract tests

Required when SaaS adapters are implemented:
- Notion payload builder from Hermes document
- Linear issue creation payload builder
- Linear webhook normalization
- external ref persistence

Do not call live SaaS APIs in normal tests. Use fixtures and mocked clients. Live API smoke tests should be opt-in.

## 13. Agent-Friendly Work Order

If an AI coding agent is asked to implement Hermes, follow this order:

1. Read `docs/hermes-implementation-plan.md`.
2. Read `docs/hermes-agent-architecture.html`.
3. Check existing repo files with `rg --files`.
4. Implement the smallest incomplete phase.
5. Add or update tests for that phase.
6. Run typecheck and tests.
7. Report:
   - files changed
   - commands run
   - tests passed/failed
   - next incomplete task ID

Do not skip directly to SaaS integration before the local ledger and capture commands exist.

## 14. MVP Definition

The first local MVP is complete when Hermes can do all of the following locally:

- capture a note as an event
- add a document or URL as a source
- hash local files
- search old records by keyword
- generate a timeline for a topic
- generate a weekly review
- maintain audit logs
- block external writes behind approval
- import from Linear or Notion in read-only mode

The long-term memory MVP is complete when Hermes also supports:

- pgvector embeddings for eligible events and sources
- hybrid recall across exact keyword, fuzzy text, and semantic similarity
- recall results that explain why each record matched
- privacy controls that exclude `legal_sensitive` records from embedding generation by default
- embedding regeneration from the canonical ledger

SaaS export is useful, but it is not required for the first useful Hermes. Semantic recall is required for the long-term memory version of Hermes.

## 15. Example End-To-End Scenario

Input:

```bash
hermes capture --type legal --sensitivity legal_sensitive \
  "A사 대표와 정산 관련 통화. 7월 12일까지 세부 자료를 보내기로 함."
```

Expected system behavior:

1. Capture Router creates a local event.
2. Security & Privacy Officer assigns `legal_sensitive`.
3. Event Ledger stores the event.
4. Audit log stores the command and profile.
5. No Notion, Linear, email, or calendar write happens without approval.
6. Later, `hermes timeline "A사 정산"` can retrieve this event.

Input:

```bash
hermes ticket create --project "Ultimate Hermes" --title "Implement local ledger MVP"
```

Expected system behavior:

1. Project Manager creates local project/ticket event.
2. Policy Gate asks for approval before Linear issue creation.
3. If approved, Linear Sync Manager creates issue.
4. External ref maps Hermes event to Linear issue.
5. Weekly review can include this ticket and its status.
