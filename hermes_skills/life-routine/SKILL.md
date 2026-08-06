---
name: life-routine
description: "Operate Kay's daily life/project memory loop using life_archive, Linear, Slack, Notion, and Google context."
version: 0.1.0
author: Ultimate Hermes
metadata:
  hermes:
    tags: [daily-routine, memory, projects, linear, notion, google, evidence]
---

# Life Routine

Use this skill when the user asks for a daily brief, end-of-day review, weekly
review, project status, troubleshooting history, evidence timeline, or old
decision recall.

Core rule:

```text
Supabase Postgres is the durable source of truth.
Linear, Notion, Slack, Google Calendar, Google Drive, and Gmail are external
surfaces or source inventories.
```

## Memory Transport

Choose exactly one write path for each conversation:

1. On the primary Hermes gateway, use native `life_archive` tools when its
   `LIFE_ARCHIVE_DATABASE_URL` points to the shared Supabase database.
2. On another device or an untrusted runtime, use the remote Ultimate Hermes
   MCP tools: `recall_events`, `project_status`, `timeline`, `capture_event`,
   and `link_source`.
3. Never capture the same event through both native `life_capture` and remote
   `capture_event`. Supabase is shared, so dual writes create duplicate memory.
4. Never distribute the Supabase database password to Codex, Claude, or a
   secondary Hermes runtime. Give those clients only the HTTPS MCP URL and API
   token.

## Always Do

Before answering questions about past work, documents, incidents, disputes,
decisions, or project history, use the active transport's equivalent tools:

1. Call `life_recall` or `recall_events` with the user's topic.
2. If project-specific, call `life_project_status` or `project_status`.
3. If chronology matters, call `life_timeline` or `timeline`.
4. State which facts are recalled, inferred, imported, or missing.
5. Save new durable decisions with `life_capture` or `capture_event`, using
   only the selected write path.

Do not store raw secrets. Do not give legal advice; in legal-sensitive mode,
organize evidence, dates, sources, and uncertainties.

## External Write Policy

Default to read/import mode for Linear, Notion, Google Workspace, Slack files,
and email.

Do not create, update, move, delete, send, share, upload, comment, or otherwise
write to external systems unless Kay explicitly asks for that exact write in
the current conversation. Before performing the write, restate the target
system, object, and irreversible effects, then wait for explicit confirmation.

Legal-sensitive or confidential records must not be written to Linear, Notion,
Google, Slack, or email unless Kay explicitly approves that specific export.

## Calendar Source Policy

For any schedule/calendar question, including Korean phrases such as `일정`,
`이번주 일정`, `오늘 일정`, `내일 일정`, `미팅`, `회의`, `약속`, or `deadline`,
use Google Calendar through the Google Workspace API script.

Default calendar command:

```bash
/Users/kay/.hermes/hermes-agent/venv/bin/python /Users/kay/.hermes/hermes-agent/skills/productivity/google-workspace/scripts/google_api.py calendar list --start <ISO_START> --end <ISO_END>
```

Rules:

1. Treat Google Calendar API as Kay's canonical schedule source.
2. Use timezone `Asia/Seoul` when calculating date ranges.
3. For "이번주", use Monday 00:00 through Sunday 23:59:59 in `Asia/Seoul`.
4. Do not open macOS Calendar, Apple Calendar, Chrome, browser tabs, or
   `calendar.google.com` for schedule lookup unless Kay explicitly asks to
   inspect the UI.
5. If the Google Calendar API fails, report that the API check failed and ask
   Kay to reconnect Google. Do not fall back to GUI/browser calendar access.

## Morning Brief

Goal: tell the user what matters today.

Steps:

1. Recall active projects and recent blockers with `life_project_status`.
2. Use Linear MCP for active issues once Linear OAuth is connected.
3. Use Google Calendar once connected for today's meetings/deadlines.
4. Produce:
   - today's fixed commitments
   - highest-leverage project work
   - blockers needing external action
   - documents/evidence needing capture
   - suggested first action
5. Capture any new user decisions or corrections with `life_capture`.

## End-Of-Day Review

Goal: prevent today's context from being lost.

Ask only for missing facts if needed. Otherwise infer from the conversation and
save:

- completed work
- decisions made
- blockers
- tickets or documents touched
- troubleshooting outcomes
- follow-ups for tomorrow
- legal-sensitive/evidence-sensitive events

Use `life_capture` for durable events. Use `life_link_source` when the user
mentions a file, URL, issue, email, calendar event, or document.

## Weekly Review

Goal: consolidate the archive and improve planning.

Steps:

1. Use `life_timeline` for each active project.
2. Identify repeated blockers, stale decisions, unlinked sources, and missing
   external references.
3. Suggest Linear cleanup for active execution only.
4. Suggest Notion pages for human-readable summaries only.
5. Capture the weekly summary as a `project_update` event.

## Troubleshooting Recall

When the user asks "what happened last time this broke":

1. Call `life_recall` with the exact error/service/topic.
2. Prefer incidents with sources and high confidence.
3. Return:
   - symptoms
   - root cause
   - attempted fixes
   - final fix
   - commands or files if recorded
   - confidence and gaps

## Evidence Timeline

For disputes, contracts, compensation, founder/company conflict, or legal-
sensitive matters:

1. Call `life_timeline` with sensitivity `legal_sensitive` if applicable.
2. Separate facts from interpretations.
3. Include dates, source URIs, external IDs, and missing evidence.
4. Avoid legal conclusions.
5. Capture new evidence notes as `legal` or `incident` with
   `sensitivity=legal_sensitive`.
