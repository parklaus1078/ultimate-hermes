# life_archive

`life_archive` is a Hermes Agent memory provider that stores durable personal
and project history in the shared Ultimate Hermes Postgres database with
`pg_trgm` and `pgvector` enabled. Production should use the same Supabase
database as the remote MCP service; local Docker Postgres remains the fallback.

It is intended to be installed into:

```text
$HOME/.hermes/plugins/life_archive
```

Required runtime dependency in the Hermes venv:

```bash
"$HOME/.hermes/hermes-agent/venv/bin/python" -m pip install -r requirements-life-archive.txt
```

The local-development default is:

```text
postgres://hermes:hermes@127.0.0.1:55432/hermes
```

For production, store the Supabase session-pooler URL in
`~/.hermes/.env` as `LIFE_ARCHIVE_DATABASE_URL`. The provider gives this
environment variable precedence over config, so the DB password does not need
to be duplicated in `config.yaml`.

Non-secret provider options in `~/.hermes/config.yaml`:

```yaml
memory:
  provider: life_archive
plugins:
  life_archive:
    prefetch_limit: 5
    recall_limit: 10
    auto_capture_turns: true
    embedding:
      provider: openai
      model: text-embedding-3-small
      dimensions: 1536
      keychain_service: hermes-embedding
      keychain_account: default
      semantic_recall_enabled: true
```

Tools exposed to Hermes:

- `life_capture`
- `life_recall`
- `life_timeline`
- `life_link_source`
- `life_project_status`

Semantic recall requires embeddings in `life_embeddings` and an embedding API
key in macOS Keychain:

```bash
"$HOME/.hermes/hermes-agent/venv/bin/python" scripts/set_macos_keychain_secret.py hermes-embedding default
"$HOME/.hermes/hermes-agent/venv/bin/python" scripts/backfill_life_embeddings.py --source-system llm_wiki
```

Do not enable native auto-capture and remote MCP `capture_event` for the same
Hermes conversation. Both paths write to the same `life_events` table.
