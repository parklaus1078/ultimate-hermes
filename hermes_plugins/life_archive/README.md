# life_archive

`life_archive` is a Hermes Agent memory provider that stores durable personal
and project history in local Postgres with `pg_trgm` and `pgvector` enabled.

It is intended to be installed into:

```text
/Users/kay/.hermes/plugins/life_archive
```

Required runtime dependency in the Hermes venv:

```bash
/Users/kay/.hermes/hermes-agent/venv/bin/python -m pip install "psycopg[binary]>=3.1"
```

Default database URL:

```text
postgres://hermes:hermes@127.0.0.1:55432/hermes
```

Config override in `/Users/kay/.hermes/config.yaml`:

```yaml
memory:
  provider: life_archive
plugins:
  life_archive:
    database_url: postgres://hermes:hermes@127.0.0.1:55432/hermes
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
/Users/kay/.hermes/hermes-agent/venv/bin/python scripts/set_macos_keychain_secret.py hermes-embedding default
/Users/kay/.hermes/hermes-agent/venv/bin/python scripts/backfill_life_embeddings.py --source-system llm_wiki
```
