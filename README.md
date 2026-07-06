# Ultimate Hermes

Hermes is a local daily-life memory assistant for projects, documents, decisions, troubleshooting history, and legal-sensitive evidence timelines.

The important design rule is:

```text
Hermes Postgres ledger = source of truth
Linear = execution surface for selected active tickets
Notion = readable document / decision inventory
Google Calendar / Drive / Gmail = optional imported context
```

## What Works Now

- Dockerized PostgreSQL with `pgvector`
- Node/TypeScript CLI
- Dockerized HTTP server
- Append-first event ledger
- Source/document capture
- Audit log and approval queue tables
- PostgreSQL keyword/fuzzy recall
- `pgvector` semantic recall index
- macOS Keychain secret storage for host runs
- Environment secret fallback for full Docker app runs
- Linear import connector
- Notion connectivity and database setup connector
- Google OAuth URL/token flow plus Calendar/Drive/Gmail checks

## Requirements

- Node.js 22+
- npm
- Docker Desktop
- macOS if you want Keychain-backed secrets

This repo currently uses `npm`, not `pnpm`, because `pnpm` is not installed on this machine.

## Quick Start: Recommended Host App Mode

This is the recommended mode on macOS:

```text
Postgres runs in Docker.
Hermes CLI/server run on the host.
Secrets live in macOS Keychain.
```

1. Install dependencies:

```bash
npm install
```

2. Start Postgres:

```bash
docker compose up -d postgres
```

3. Build the app:

```bash
npm run build
```

4. Run migrations:

```bash
npm run db:migrate
```

5. Check setup:

```bash
npm run setup:check
```

6. Capture a test memory:

```bash
npm run cli -- capture "Hermes is ready. Postgres ledger is source of truth." --type decision
```

7. Generate embeddings:

```bash
npm run cli -- embeddings generate --limit 100
```

8. Recall it:

```bash
npm run cli -- remember "source of truth" --json
```

9. Start the server:

```bash
npm start
```

10. Check health:

```bash
curl http://127.0.0.1:8787/health
```

## Full Docker Mode

This runs both Postgres and the Hermes server in Docker:

```bash
docker compose --profile app up -d --build
curl http://127.0.0.1:8787/health
```

Important: a Linux Docker container cannot access macOS Keychain directly. For live SaaS integrations inside the app container, use environment secret variables or Docker secrets. For Keychain-backed SaaS credentials, run the CLI/server on the macOS host and keep only Postgres in Docker.

## Secret Storage

Host mode uses macOS Keychain automatically.

Set a secret:

```bash
npm run cli -- secrets set hermes-linear default "lin_api_key_here"
npm run cli -- secrets set hermes-notion default "secret_notion_key_here"
npm run cli -- secrets set hermes-google-client client-id "google_oauth_client_id"
npm run cli -- secrets set hermes-google-client client-secret "google_oauth_client_secret"
```

Show the environment variable name for Docker fallback:

```bash
npm run cli -- setup env-secret-name hermes-linear default
```

Example Docker fallback variable:

```bash
export HERMES_SECRET_HERMES_LINEAR_DEFAULT="lin_api_key_here"
```

Do not put API keys in the database, Notion, logs, or committed files.

## Linear Setup

Hermes uses Linear only for selected execution-worthy work. It does not mirror every memory event into Linear.

Current Linear usage:

- Read teams, issues, workflow states, labels, projects, comments
- Import active issue history into Hermes
- Webhook endpoint for Linear events: `POST /webhooks/linear`
- External writes are intended to go through approval

Store the Linear key:

```bash
npm run cli -- secrets set hermes-linear default "lin_api_key_here"
```

Check live setup:

```bash
npm run cli -- setup check --live
```

Import Linear issues:

```bash
npm run cli -- sync linear --limit 100
```

Linear Free currently has a 250 issue limit. Hermes local ledger is unlimited; only selected active execution tasks should become Linear issues.

## Notion Setup

1. Create a Notion integration.
2. Copy the integration secret.
3. Share the parent Notion page with that integration.
4. Store the secret:

```bash
npm run cli -- secrets set hermes-notion default "secret_notion_key_here"
```

Check connection:

```bash
npm run cli -- sync notion
```

Create basic Hermes databases under a parent page:

```bash
npm run cli -- sync notion-create-databases "<notion_parent_page_id>"
```

Notion is a readable inventory. Hermes Postgres remains the source of truth.

## Google Calendar / Drive / Gmail Setup

Google requires OAuth, not just an API key.

1. Create a Google Cloud OAuth client.
2. Add this redirect URI:

```text
http://127.0.0.1:8787/oauth/google/callback
```

3. Store client credentials:

```bash
npm run cli -- secrets set hermes-google-client client-id "google_oauth_client_id"
npm run cli -- secrets set hermes-google-client client-secret "google_oauth_client_secret"
```

4. Start the server:

```bash
npm start
```

5. Generate an auth URL:

```bash
npm run cli -- setup google-auth-url --redirect-uri "http://127.0.0.1:8787/oauth/google/callback"
```

6. Open the URL, approve access, and let the callback store the token.

7. Check Google APIs:

```bash
npm run cli -- sync google-calendar
npm run cli -- sync google-drive
npm run cli -- sync gmail
```

## Embedding / Semantic Recall

Hermes supports semantic recall with `pgvector`.

Default mode uses a deterministic local embedding provider. It is good for smoke tests and privacy-safe local operation, but it is not as semantically strong as a real embedding model.

To use an HTTP embedding provider:

```bash
export HERMES_EMBEDDING_PROVIDER=http
npm run cli -- secrets set hermes-embedding default "embedding_api_key_here"
npm run cli -- embeddings generate --limit 500
```

Legal-sensitive records are excluded from embedding generation by default.

## Common Commands

```bash
npm run cli -- capture "Met A about settlement issue. Need follow-up by Monday." --type legal --sensitivity legal_sensitive
npm run cli -- doc add ./contract.pdf --type document --sensitivity legal_sensitive
npm run cli -- remember "settlement follow-up" --json
npm run cli -- timeline "A settlement"
npm run cli -- review weekly
npm run cli -- status
npm run cli -- approvals list
npm run cli -- approvals approve APPROVAL_ID
npm run cli -- approvals execute APPROVAL_ID
npm run cli -- approvals reject APPROVAL_ID
```

## Verification Commands

These passed during implementation:

```bash
npm run typecheck
npm test
npm run build
docker compose up -d postgres
node dist/src/cli/index.js migrate
node dist/src/cli/index.js capture "Hermes smoke test memory..." --type decision
node dist/src/cli/index.js embeddings generate --limit 20
node dist/src/cli/index.js remember "execution surface source of truth" --json
docker compose --profile app up -d hermes
curl http://127.0.0.1:8787/health
```

## Current Caveats

- Live Notion, Linear, and Google integrations were not end-to-end verified because credentials are not present.
- Google OAuth needs user consent in a browser.
- The Docker app container cannot read macOS Keychain; use host mode for Keychain-backed live integrations.
- Docker app build needs Docker Hub access for the Node base image. During implementation, Docker Hub metadata fetch timed out while rebuilding the latest app image. Host mode with Dockerized Postgres was fully verified.
- `npm audit --omit=dev` passes with 0 vulnerabilities. Full dev dependency audit may still include toolchain-only advisories.
