#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from hermes_plugins.life_archive.db import DEFAULT_DSN, LifeArchiveConfig, LifeArchiveDB  # noqa: E402
from hermes_plugins.life_archive.embeddings import (  # noqa: E402
    DEFAULT_EMBEDDING_DIMENSIONS,
    DEFAULT_EMBEDDING_MODEL,
    EmbeddingConfig,
    create_embedding_provider,
    event_embedding_text,
    stable_hash,
)


@dataclass
class WorkItem:
    event: dict
    text: str
    content_hash: str


def chunks(items: list[WorkItem], size: int) -> list[list[WorkItem]]:
    return [items[index : index + size] for index in range(0, len(items), size)]


def build_work(
    db: LifeArchiveDB,
    events: list[dict],
    *,
    model: str,
    max_chars: int,
    force: bool,
) -> tuple[list[WorkItem], int]:
    work: list[WorkItem] = []
    skipped = 0
    for event in events:
        text = event_embedding_text(event, max_chars=max_chars)
        content_hash = stable_hash(text)
        if not force and db.embedding_exists(
            event_id=event["id"],
            embedding_model=model,
            content_hash=content_hash,
        ):
            skipped += 1
            continue
        work.append(WorkItem(event=event, text=text, content_hash=content_hash))
    return work, skipped


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill life_archive pgvector embeddings for eligible events.")
    parser.add_argument("--database-url", default=os.environ.get("LIFE_ARCHIVE_DATABASE_URL") or DEFAULT_DSN)
    parser.add_argument("--provider", choices=["openai", "local_hash"], default=os.environ.get("LIFE_ARCHIVE_EMBEDDING_PROVIDER") or "openai")
    parser.add_argument("--model", default=os.environ.get("LIFE_ARCHIVE_EMBEDDING_MODEL") or DEFAULT_EMBEDDING_MODEL)
    parser.add_argument("--dimensions", type=int, default=int(os.environ.get("LIFE_ARCHIVE_EMBEDDING_DIMENSIONS") or DEFAULT_EMBEDDING_DIMENSIONS))
    parser.add_argument("--project", default="", help="Optional metadata->>'project' filter, e.g. general or hired_work.")
    parser.add_argument("--source-system", default="", help="Optional metadata->>'source_system' filter, e.g. llm_wiki.")
    parser.add_argument("--branch", default="", help="Optional metadata->>'llm_wiki_branch' filter.")
    parser.add_argument("--limit", type=int, default=1000)
    parser.add_argument("--batch-size", type=int, default=int(os.environ.get("LIFE_ARCHIVE_EMBEDDING_BATCH_SIZE") or 64))
    parser.add_argument("--max-chars", type=int, default=int(os.environ.get("LIFE_ARCHIVE_EMBEDDING_MAX_CHARS") or 20000))
    parser.add_argument("--include-legal", action="store_true", help="Include legal_sensitive records. Default excludes them.")
    parser.add_argument("--force", action="store_true", help="Regenerate even when the current content_hash already exists.")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    embedding_config = EmbeddingConfig(
        provider=args.provider,
        model=args.model,
        dimensions=args.dimensions,
        batch_size=args.batch_size,
        max_chars=args.max_chars,
    )
    provider = create_embedding_provider(embedding_config)
    db = LifeArchiveDB(LifeArchiveConfig(database_url=args.database_url))
    db.apply_schema(ROOT / "hermes_plugins/life_archive/schema.sql")
    events = db.fetch_events_for_embedding(
        limit=args.limit,
        project=args.project,
        source_system=args.source_system,
        branch=args.branch,
        include_legal=args.include_legal,
    )
    work, skipped = build_work(
        db,
        events,
        model=provider.model,
        max_chars=args.max_chars,
        force=args.force,
    )

    print(f"eligible_events={len(events)}")
    print(f"already_current={skipped}")
    print(f"to_embed={len(work)}")
    print(f"provider={args.provider}")
    print(f"model={provider.model}")
    print(f"dimensions={provider.dimensions}")
    if args.project:
        print(f"project={args.project}")
    if args.source_system:
        print(f"source_system={args.source_system}")
    if args.branch:
        print(f"branch={args.branch}")
    if not args.include_legal:
        print("legal_sensitive=excluded")
    if args.dry_run:
        db.close()
        return 0
    if not work:
        db.close()
        return 0
    if not provider.is_configured():
        db.close()
        raise SystemExit(
            "Embedding provider is not configured. For OpenAI embeddings, store the key with:\n"
            "/Users/kay/.hermes/hermes-agent/venv/bin/python scripts/set_macos_keychain_secret.py hermes-embedding default"
        )

    embedded = 0
    for batch in chunks(work, max(1, args.batch_size)):
        vectors = provider.embed_many([item.text for item in batch])
        for item, vector in zip(batch, vectors):
            db.upsert_event_embedding(
                event_id=item.event["id"],
                embedding_model=provider.model,
                embedding=vector,
                content_hash=item.content_hash,
                sensitivity=item.event.get("sensitivity") or "personal",
            )
            embedded += 1
        print(f"embedded={embedded}/{len(work)}")
    db.close()
    print(f"done embedded={embedded} skipped={skipped}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
