# Ultimate Hermes

This repository now targets a native extension of the existing Nous Research
Hermes Agent on this machine.

The implementation direction is:

```text
Existing Hermes Agent = user interface, gateway, tools, skills, kanban
life_archive provider = durable Postgres-backed long-term memory
Docker Postgres + pgvector = source of truth for history and recall
Linear MCP = active project execution surface
Slack gateway = primary messaging interface
```

The older Node/TypeScript app in `src/` is kept as a prototype/reference. The
main path is the Python Hermes memory provider in
`hermes_plugins/life_archive/`.

## Current Target

When setup is complete, Hermes should be able to answer questions like:

- What did I decide about this project?
- What happened last time this broke?
- What are the active blockers?
- Show the timeline for this dispute.
- What documents did I see related to this?

## Requirements

- Existing Hermes Agent at `/Users/kay/.hermes/hermes-agent`
- Docker Desktop
- Python 3.11 in the Hermes venv
- Slack credentials for Hermes gateway setup
- Linear account for native MCP OAuth
- Optional later: Notion and Google OAuth credentials

## Quick Start

Run these from this repository:

```bash
cd /Users/kay/Desktop/dev/projects/ultimate-hermes
```

### 1. Start Postgres

```bash
docker compose up -d postgres
```

This starts `ultimate-hermes-postgres` on local port `55432` with `pgvector`
available.

### 2. Install Python Dependency Into Hermes

```bash
/Users/kay/.hermes/hermes-agent/venv/bin/python -m pip install -r requirements-life-archive.txt
```

### 3. Install The Native Provider

```bash
bash scripts/install_life_archive.sh
bash scripts/install_life_routine_skill.sh
```

This copies:

```text
hermes_plugins/life_archive -> /Users/kay/.hermes/plugins/life_archive
hermes_skills/life-routine -> /Users/kay/.hermes/skills/productivity/life-routine
```

If an older installed copy exists, the script backs it up under
`/Users/kay/.hermes/backups/`.

### 4. Configure Hermes Native Baseline

```bash
/Users/kay/.hermes/hermes-agent/venv/bin/python scripts/configure_hermes_native.py
```

This backs up `/Users/kay/.hermes/config.yaml`, then sets:

- `memory.provider: life_archive`
- `plugins.life_archive.database_url`
- Linear and Notion native MCP config
- Codex as the main model/provider path if not already set
- Slack as the intended gateway platform without inventing Slack tokens

### 5. Create Native Hermes Role Profiles

```bash
scripts/create_hermes_life_profiles.sh
```

This creates native Hermes profiles cloned from `default`, installs
`life_archive` into each profile, and sets descriptions for kanban routing:

```text
chief_of_staff
capture_router
project_operator
archivist
evidence_curator
research_librarian
troubleshooting_scribe
integration_clerk
security_officer
```

The default profile remains the Slack gateway profile. The role profiles are
available as isolated Hermes workers through wrapper commands such as
`chief_of_staff`, `archivist`, and `project_operator`.

### 6. Install Daily Operating Policy

```bash
/Users/kay/.hermes/hermes-agent/venv/bin/python scripts/install_hermes_soul_policy.py
/Users/kay/.hermes/hermes-agent/venv/bin/python scripts/disable_hermes_skill.py apple-app-automation
```

This installs the global rule that schedule/calendar questions must use the
Google Workspace API and disables local macOS app automation so Hermes does not
open Apple Calendar for schedule recall.

### 7. Verify Provider Locally

```bash
/Users/kay/.hermes/hermes-agent/venv/bin/python scripts/life_archive_smoke.py
```

Expected result:

- one `life_capture` JSON result
- one `life_recall` JSON result with at least one match

### 8. Restart Hermes Gateway

```bash
hermes gateway restart
```

If the service command is unavailable, use:

```bash
launchctl kickstart -k gui/$(id -u)/ai.hermes.gateway
```

### 9. Check Hermes Memory

```bash
hermes memory status
```

Expected:

```text
Provider: life_archive
```

## Slack Gateway Setup

Slack must be configured through Hermes Agent, not through this repository's
standalone server.

Current local status, checked on 2026-07-06:

- Gateway process is running.
- Slack Socket Mode connects.
- Hermes Slack manifest was regenerated at `/Users/kay/.hermes/slack-manifest.json`,
  validated, and pushed to Slack app `A0BC04LECEP`.
- The remaining blocker is OAuth token state: `SLACK_BOT_TOKEN` is currently
  not a Bot User OAuth token. It must start with `xoxb-...`; the current token
  has only Slack app-configuration scopes, so Slack rejects `chat.postMessage`
  and channel reads with `missing_scope`.

Fix:

1. Open `https://api.slack.com/apps/A0BC04LECEP`.
2. Go to **OAuth & Permissions**.
3. Click **Reinstall to Workspace** after the manifest update.
4. Copy **Bot User OAuth Token**. It must start with `xoxb-`.
5. Update Hermes `.env` without printing the token:

```bash
python3 scripts/set_hermes_env_secret.py SLACK_BOT_TOKEN --must-start xoxb-
```

Keep `SLACK_APP_TOKEN` as the `xapp-...` Socket Mode token. If you ever replace
it, the app-level token needs `connections:write`.

Restart and verify:

```bash
hermes gateway restart
tail -n 80 /Users/kay/.hermes/logs/gateway.log
```

Expected: no new `missing_scope` errors, and Slack DMs or mentions receive a
Hermes response. If needed, rerun the interactive gateway setup:

```bash
hermes gateway setup
```

Choose Slack and provide the same `xoxb-...` bot token and `xapp-...` app token.

## Linear MCP Setup

Linear should use Hermes native MCP.

The config script adds this server entry:

```yaml
mcp_servers:
  linear:
    url: https://mcp.linear.app/mcp
    auth: oauth
```

Then run:

```bash
hermes mcp login linear
hermes mcp configure linear
hermes gateway restart
```

Linear is only the active execution surface. The durable historical record
stays in Postgres through `life_archive`.

## Notion And Google

Current intended roles:

- Notion: readable decision/document/incident inventory
- Google Calendar: meetings and deadlines
- Google Drive: document/source references
- Gmail: communication/source references

Default mode should be read/import. External writes should require approval.

### Notion

Hermes has both paths configured:

- Official remote Notion MCP at `https://mcp.notion.com/mcp` for live Notion
  access inside Hermes sessions.
- Local repository adapter for connectivity checks and starter database
  creation.

These use different auth stores. The remote MCP uses Notion OAuth cached by
Hermes under `~/.hermes/mcp-tokens`; the local adapter uses the integration
token below.

Finish Notion MCP OAuth from a normal interactive Terminal:

```bash
hermes mcp login notion
hermes mcp test notion
hermes gateway restart
```

The local adapter checks credentials in this order:

1. macOS Keychain `service=hermes-notion`, `account=default`
2. `NOTION_API_KEY`
3. `NOTION_API_TOKEN`

The Node CLI also loads `/Users/kay/.hermes/.env`, matching the Hermes skill
location.

1. Create an integration at `https://www.notion.so/my-integrations`.
2. Copy the integration secret. It usually starts with `ntn_` or `secret_`.
3. Share the target parent page with the integration in Notion:
   page menu `...` -> `Connect to` -> your integration.
4. Store the token in macOS Keychain:

```bash
npm run build
python3 scripts/set_macos_keychain_secret.py hermes-notion default
```

The script uses a hidden Python prompt and passes the token to macOS Keychain
through stdin, so the token is not written to shell history or passed as a
process argument. It also verifies that the item exists immediately after
storing it.

5. Check connectivity:

```bash
npm run cli -- sync notion
```

6. Optional: create the starter Hermes inventory databases under a parent page:

```bash
npm run cli -- sync notion-create-databases NOTION_PARENT_PAGE_ID
```

Use Notion as the readable inventory. The canonical durable memory stays in
Postgres through `life_archive`.

If Notion pages/databases appear in the browser but `npm run cli -- sync notion`
reports "missing", the token was probably used from a one-off shell environment
or a different tool. Persist it to one of the locations above.

### Google Calendar, Drive, Gmail

Hermes has a bundled `google-workspace` skill with its own OAuth setup script.
Use this for the native Hermes runtime:

```bash
scripts/google_workspace_setup.sh --check
```

Do not install random `hermes skills search google-workspace` results for this
setup. The search results are community skills; this repository uses the local
bundled Nous Research skill already present under
`/Users/kay/.hermes/hermes-agent/skills/productivity/google-workspace`.

If not authenticated:

1. Create/select a Google Cloud project:
   `https://console.cloud.google.com/projectselector2/home/dashboard`
2. Enable the APIs you need:
   Gmail API, Google Calendar API, Google Drive API, Google Docs API,
   Google Sheets API, and People API.
3. Create an OAuth 2.0 Client ID at
   `https://console.cloud.google.com/apis/credentials`.
4. Application type: **Desktop app**.
5. If the app is in Testing, add your Google account as a test user at
   `https://console.cloud.google.com/auth/audience`.
6. Download the OAuth client JSON.
7. Store it and generate an auth URL:

```bash
scripts/google_workspace_setup.sh --client-secret /path/to/client_secret.json
scripts/google_workspace_setup.sh --auth-url
```

8. Open the printed URL, approve, then copy the full redirected URL from the
   browser address bar. The browser may fail on `http://localhost:1`; that is
   expected.
9. Exchange it:

```bash
scripts/google_workspace_setup.sh --auth-code "PASTE_FULL_REDIRECT_URL_OR_CODE"
scripts/google_workspace_setup.sh --check
```

The Hermes skill stores tokens at `/Users/kay/.hermes/google_token.json` and
refreshes them automatically.

Schedule/calendar questions must use the Google Workspace API script, not
browser UI, Chrome, macOS Calendar, or Apple Calendar:

```bash
/Users/kay/.hermes/hermes-agent/venv/bin/python /Users/kay/.hermes/hermes-agent/skills/productivity/google-workspace/scripts/google_api.py calendar list --start <ISO_START> --end <ISO_END>
```

Use `Asia/Seoul` for date ranges. For "이번주", query Monday 00:00 through
Sunday 23:59:59. If the API fails, Hermes should report the API failure instead
of falling back to a GUI calendar.

Privacy note: this bundled setup script currently requests broad Workspace
scopes, including Gmail send/modify, Calendar, Drive, Docs, Sheets, and
Contacts read. For a strict read/import-only setup, do not approve the OAuth
screen until the scopes are narrowed or you use a dedicated Google account.

## Provider Tools

`life_archive` exposes these Hermes tools:

- `life_capture`: save durable events, decisions, incidents, research notes,
  legal-sensitive evidence notes, and project updates
- `life_recall`: keyword/fuzzy recall from Postgres, plus semantic pgvector
  recall when embeddings are configured
- `life_timeline`: chronological reconstruction
- `life_link_source`: attach raw source references
- `life_project_status`: summarize recent project history and blockers

Postgres has `pgvector` enabled from the start. Keyword and fuzzy recall work
without embeddings; semantic embeddings can be added later without changing
the provider contract.

## Semantic Embeddings

`life_archive` can store semantic recall vectors in `life_embeddings`. The
default provider is OpenAI embeddings with `text-embedding-3-small`
(`1536` dimensions), which matches the current pgvector schema.

Store the embedding API key in macOS Keychain:

```bash
/Users/kay/.hermes/hermes-agent/venv/bin/python scripts/set_macos_keychain_secret.py hermes-embedding default
```

Preview eligible records without calling the embedding API:

```bash
/Users/kay/.hermes/hermes-agent/venv/bin/python scripts/backfill_life_embeddings.py --source-system llm_wiki --dry-run
```

Backfill imported `llm_wiki` memories:

```bash
/Users/kay/.hermes/hermes-agent/venv/bin/python scripts/backfill_life_embeddings.py --source-system llm_wiki
```

By default, `legal_sensitive` records are excluded. To embed them anyway, pass
`--include-legal` only after explicitly deciding that the legal-sensitive text
may be sent to the embedding provider.

Useful verification query:

```sql
select embedding_model, count(*)
from life_embeddings
group by embedding_model
order by embedding_model;
```

## Tests

Provider unit tests:

```bash
python3 -m unittest discover -s tests/life_archive
```

Node prototype tests:

```bash
npm test
npm run typecheck
```

Provider smoke test against Docker Postgres:

```bash
/Users/kay/.hermes/hermes-agent/venv/bin/python scripts/life_archive_smoke.py
```

## Legacy Node Prototype

The Node app still supports:

- Dockerized HTTP server
- TypeScript CLI
- append-first ledger
- initial Linear/Notion/Google adapter experiments

It is not the main Hermes integration path anymore.

Useful legacy commands:

```bash
npm install
npm run build
npm run db:migrate
npm run cli -- capture "test memory" --type decision
npm run cli -- remember "test memory"
```

## Docs

- Native pivot plan: `docs/hermes-native-pivot-plan.md`
- Earlier standalone plan, now superseded: `docs/hermes-implementation-plan.md`
- Architecture HTML: `docs/hermes-agent-architecture.html`
- Phase 7 runbook: `docs/hermes-phase7-runbook.md`

## Safety Rules

- Do not store raw API tokens in Postgres, Notion, logs, memory files, or git.
- Back up `/Users/kay/.hermes/config.yaml` before overwriting it.
- Postgres is the durable source of truth.
- Linear is for selected active tickets only.
- Legal-sensitive records are evidence timelines, not legal advice.
- Docker ports are bound to `127.0.0.1`; do not expose Postgres or the legacy
  Node server on `0.0.0.0`.
- Run `scripts/harden_hermes_permissions.sh` after credential setup or profile
  regeneration to keep tokens, Google OAuth files, state DBs, and profile
  configs at `600`/`700`.
- Linear, Notion, Google, Slack file, and email writes require explicit current
  conversation approval before execution.
- For a stronger local DB posture, set `HERMES_POSTGRES_PASSWORD` before first
  `docker compose up`; existing Docker volumes keep the password they were
  initialized with.
