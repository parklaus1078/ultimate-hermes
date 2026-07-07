# Hermes Phase 7 Runbook

Status: implemented locally where credentials are not required
Last updated: 2026-07-06

## Implemented

- Docker Postgres with `pgvector` image.
- Native Hermes memory provider: `life_archive`.
- Provider installed path: `/Users/kay/.hermes/plugins/life_archive`.
- Provider active in Hermes config: `memory.provider: life_archive`.
- Postgres schema for:
  - `life_events`
  - `life_sources`
  - `life_entities`
  - `life_external_refs`
  - `life_embeddings`
  - `life_project_snapshots`
  - `life_approval_queue`
  - `life_audit_log`
  - `life_recall_hits`
- Provider tools:
  - `life_capture`
  - `life_recall`
  - `life_timeline`
  - `life_link_source`
  - `life_project_status`
- Linear MCP server entry in Hermes config.
- Daily routine skill source: `hermes_skills/life-routine`.
- Native Hermes role profiles:
  - `chief_of_staff`
  - `capture_router`
  - `project_operator`
  - `archivist`
  - `evidence_curator`
  - `research_librarian`
  - `troubleshooting_scribe`
  - `integration_clerk`
  - `security_officer`
- README setup flow for waking up and connecting credentials.

## Verified

Commands run:

```bash
python3 -m unittest discover -s tests/life_archive
npm run typecheck
npm test
/Users/kay/.hermes/hermes-agent/venv/bin/python scripts/life_archive_smoke.py
/Users/kay/.local/bin/hermes memory status
/Users/kay/.local/bin/hermes mcp list
```

Results:

- Python provider unit tests passed.
- TypeScript typecheck passed.
- Node/Vitest tests passed.
- Smoke test captured and recalled a Postgres event.
- Hermes memory status shows `life_archive` active.
- `chief_of_staff memory status` and `archivist memory status` show
  `life_archive` installed and active.
- Hermes MCP list shows `linear` enabled, pending OAuth login.
- `launchctl list` shows `ai.hermes.gateway` with a live PID, and
  `/Users/kay/.hermes/gateway.pid` points to a running gateway process.

## Known Remaining User Actions

These cannot be completed without your credentials or interactive browser
approval.

### Slack Gateway

Status checked on 2026-07-06:

- Gateway process is running through launchctl.
- Slack Socket Mode connects.
- Manifest was regenerated to `/Users/kay/.hermes/slack-manifest.json`.
- Manifest validation succeeded.
- Manifest update succeeded for Slack app `A0BC04LECEP`.
- Current blocker: `SLACK_BOT_TOKEN` is not a `xoxb-...` Bot User OAuth Token.
  It is an app-configuration token, so Slack reports missing scopes for
  channel reads and message sends.

Required Slack app scopes are in the generated manifest. Important bot scopes:

```text
app_mentions:read
assistant:write
channels:history
channels:read
chat:write
commands
files:read
files:write
groups:history
groups:read
im:history
im:read
im:write
users:read
```

Fix:

1. Open `https://api.slack.com/apps/A0BC04LECEP`.
2. Go to **OAuth & Permissions**.
3. Click **Reinstall to Workspace**.
4. Copy **Bot User OAuth Token**. It must start with `xoxb-`.
5. Update Hermes `.env`:

```bash
python3 scripts/set_hermes_env_secret.py SLACK_BOT_TOKEN --must-start xoxb-
```

6. Restart:

```bash
hermes gateway restart
tail -n 80 /Users/kay/.hermes/logs/gateway.log
```

Expected verification:

- no fresh `missing_scope` lines in `gateway.log`
- Slack DM or mention gets a Hermes response

If gateway setup needs to be rebuilt, rerun:

```bash
hermes gateway setup
```

Choose Slack and provide the `xoxb-...` bot token and existing `xapp-...` app
token. If `hermes gateway status` reports "not loaded" while Slack still works,
trust `launchctl list | rg ai.hermes.gateway`, `/Users/kay/.hermes/gateway.pid`,
and `/Users/kay/.hermes/logs/gateway.log` as the lower-level checks.

### Linear OAuth

Run:

```bash
hermes mcp login linear
hermes mcp configure linear
hermes gateway restart
```

Current note:

The Linear MCP config is installed. Gateway logs correctly warn that Linear
OAuth has not been completed in an interactive browser session yet.

### Notion

Current state:

- Hermes has a Notion skill installed.
- Official remote Notion MCP is configured as `notion`:
  `https://mcp.notion.com/mcp`.
- Notion MCP still needs first-time OAuth from an interactive Terminal:
  `hermes mcp login notion`.
- The repository has a macOS Keychain-backed Notion adapter for connectivity
  checks and starter database creation.
- The repository adapter also accepts `NOTION_API_KEY` or `NOTION_API_TOKEN`
  from `/Users/kay/.hermes/.env` or the process environment.

MCP connect:

```bash
hermes mcp login notion
hermes mcp test notion
hermes gateway restart
```

The remote Notion MCP uses user OAuth and caches tokens under
`/Users/kay/.hermes/mcp-tokens`. It does not reuse the local Notion integration
token from Keychain.

Local adapter connect:

1. Create a Notion integration at `https://www.notion.so/my-integrations`.
2. Copy the API key, usually `ntn_...` or `secret_...`.
3. Share the target parent page/database with the integration.
4. Store the token:

```bash
npm run build
python3 scripts/set_macos_keychain_secret.py hermes-notion default
```

The script uses a hidden Python prompt and passes the token to macOS Keychain
through stdin, so the token is not written to shell history or passed as a
process argument. It also verifies that the item exists immediately after
storing it.

5. Verify:

```bash
npm run cli -- sync notion
```

6. Optional starter databases:

```bash
npm run cli -- sync notion-create-databases NOTION_PARENT_PAGE_ID
```

If databases appear in Notion but the repo reports missing credentials, the
write likely used a transient shell token or another tool's credential store.
Persist the token to Keychain or `/Users/kay/.hermes/.env`.

### Google Calendar, Drive, Gmail

Current state:

- Hermes has the bundled `google-workspace` skill installed.
- The skill uses `/Users/kay/.hermes/google_client_secret.json` and
  `/Users/kay/.hermes/google_token.json`.

Connect:

```bash
scripts/google_workspace_setup.sh --check
```

Do not install `hermes skills search google-workspace` community results for
this setup. Use the bundled Nous Research skill already present at
`/Users/kay/.hermes/hermes-agent/skills/productivity/google-workspace`.

If it is not authenticated:

1. Create/select a Google Cloud project.
2. Enable Gmail API, Google Calendar API, Google Drive API, Google Docs API,
   Google Sheets API, and People API.
3. Create an OAuth 2.0 Client ID with application type **Desktop app**.
4. Add your Google account as a test user if the OAuth app is in Testing.
5. Download the client JSON.
6. Run:

```bash
scripts/google_workspace_setup.sh --client-secret /path/to/client_secret.json
scripts/google_workspace_setup.sh --auth-url
```

7. Open the printed URL, approve, copy the full redirected URL from the browser
   address bar, then run:

```bash
scripts/google_workspace_setup.sh --auth-code "PASTE_FULL_REDIRECT_URL_OR_CODE"
scripts/google_workspace_setup.sh --check
```

Privacy note: this bundled setup script currently requests broad Workspace
scopes, including Gmail send/modify, Calendar, Drive, Docs, Sheets, and
Contacts read. For strict read/import-only operation, do not approve the OAuth
screen until scopes are narrowed or a dedicated Google account is used.

Default operating mode should remain read/import. Calendar event writes, Drive
shares, Gmail sends, and Notion writes should be explicitly approved before
execution.

Schedule source policy:

- Calendar/schedule questions must use the Google Workspace API script, not
  browser UI, Chrome, macOS Calendar, or Apple Calendar.
- Canonical command:

```bash
/Users/kay/.hermes/hermes-agent/venv/bin/python /Users/kay/.hermes/hermes-agent/skills/productivity/google-workspace/scripts/google_api.py calendar list --start <ISO_START> --end <ISO_END>
```

- Use `Asia/Seoul`; for "이번주", query Monday 00:00 through Sunday 23:59:59.
- If the API fails, report the API failure instead of falling back to a GUI.
- `apple-app-automation` is disabled in the default Hermes profile and all
  life profiles to prevent local Calendar.app routing for schedule recall.

## Daily Use After Credentials

In Slack, ask:

```text
/hermes /life-routine Give me my morning brief.
```

End of day:

```text
Run end-of-day review. Capture durable decisions, blockers, troubleshooting outcomes, documents touched, and follow-ups.
```

Weekly:

```text
Run weekly review across active projects. Build timelines, repeated blockers, missing sources, and Linear cleanup suggestions.
```

Evidence:

```text
Build an evidence timeline for <topic>. Separate facts, sources, interpretations, and missing evidence.
```

## Operational Notes

- Postgres is the source of truth.
- Linear is only the active execution surface.
- Notion is readable inventory, not canonical memory.
- Legal-sensitive mode is evidence organization, not legal advice.
- Raw secrets must stay out of DB, logs, docs, Notion, and memory.
- Docker Postgres and the optional legacy Node server should bind only to
  `127.0.0.1`.
- Run `scripts/harden_hermes_permissions.sh` after credential setup or profile
  regeneration.
- External writes to Linear, Notion, Google, Slack files, and email require
  explicit current conversation approval.
