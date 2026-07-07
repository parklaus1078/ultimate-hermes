#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import yaml
except Exception:  # pragma: no cover - yaml is present in Hermes, fallback below.
    yaml = None

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from hermes_plugins.life_archive.db import (  # noqa: E402
    DEFAULT_DSN,
    LifeArchiveConfig,
    LifeArchiveDB,
    normalize_text,
    psycopg_available,
)

VALID_EVENT_TYPES = {
    "project",
    "ticket",
    "document",
    "decision",
    "incident",
    "legal",
    "career",
    "purchase",
    "research",
    "communication",
    "system",
    "source",
    "project_update",
}


@dataclass(frozen=True)
class ImportRecord:
    path: Path
    relative_path: str
    external_id: str
    event_id: str
    source_id: str
    ref_id: str
    title: str
    event_type: str
    summary: str
    body: str
    occurred_at: datetime
    sha256: str
    metadata: dict[str, Any]


def run_git(repo: Path, *args: str, default: str = "") -> str:
    try:
        result = subprocess.run(
            ["git", "-C", str(repo), *args],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    except Exception:
        return default
    return result.stdout.strip()


def stable_id(prefix: str, value: str) -> str:
    return f"{prefix}_{hashlib.sha1(value.encode('utf-8')).hexdigest()[:32]}"


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def split_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    if not text.startswith("---\n"):
        return {}, text
    end = text.find("\n---\n", 4)
    if end == -1:
        return {}, text
    raw = text[4:end]
    body = text[end + 5 :]
    if yaml is not None:
        try:
            parsed = yaml.safe_load(raw) or {}
            return parsed if isinstance(parsed, dict) else {}, body
        except Exception:
            return parse_frontmatter_fallback(raw), body
    return parse_frontmatter_fallback(raw), body


def parse_frontmatter_fallback(raw: str) -> dict[str, Any]:
    parsed: dict[str, Any] = {}
    for line in raw.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if value.startswith("[") and value.endswith("]"):
            value = [item.strip().strip('"').strip("'") for item in value[1:-1].split(",") if item.strip()]
        parsed[key] = value
    return parsed


def markdown_title(relative_path: str, metadata: dict[str, Any], body: str) -> str:
    title = metadata.get("title")
    if title:
        return normalize_text(title, limit=500)
    for line in body.splitlines():
        match = re.match(r"^#\s+(.+?)\s*$", line)
        if match:
            return normalize_text(match.group(1), limit=500)
    return Path(relative_path).stem.replace("-", " ").replace("_", " ").title()


def clean_tags(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return [item.strip() for item in re.split(r"[, ]+", str(value).strip("[]")) if item.strip()]


def infer_event_type(relative_path: str, metadata: dict[str, Any], title: str) -> str:
    raw_type = str(metadata.get("type") or "").strip().lower()
    if raw_type in VALID_EVENT_TYPES:
        return raw_type
    tags = {tag.lower() for tag in clean_tags(metadata.get("tags"))}
    lower_path = relative_path.lower()
    lower_title = title.lower()
    if "legal" in tags or "dispute" in tags:
        return "legal"
    if {"career", "resume", "star"} & tags or "career" in lower_path or "career" in lower_title:
        return "career"
    if "decision" in tags or "/decisions/" in lower_path:
        return "decision"
    if {"research", "benchmark", "phash", "entity-resolution", "computer-vision"} & tags:
        return "research"
    if "/entities/" in lower_path:
        return "source"
    return "document"


def parse_date(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = str(value).strip().strip('"').strip("'")
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%Y/%m/%d"):
        try:
            return datetime.strptime(text[:10], fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def infer_occurred_at(repo: Path, relative_path: str, metadata: dict[str, Any]) -> datetime:
    for key in ("updated", "created", "date", "review_on"):
        parsed = parse_date(metadata.get(key))
        if parsed is not None:
            return parsed
    git_date = run_git(repo, "log", "-1", "--format=%cI", "--", relative_path)
    parsed = parse_date(git_date)
    if parsed is not None:
        return parsed
    return datetime.fromtimestamp((repo / relative_path).stat().st_mtime, timezone.utc)


def plain_summary(text: str, *, limit: int = 900) -> str:
    lines: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            if lines:
                break
            continue
        if stripped.startswith(("---", "# ", "## ", "|", "<!DOCTYPE", "<html", "<head", "<meta")):
            continue
        lines.append(stripped.lstrip("> ").strip())
        if len(" ".join(lines)) >= limit:
            break
    return normalize_text(" ".join(lines), limit=limit)


def build_record(repo: Path, branch: str, commit: str, path: Path, project: str, workstream: str) -> ImportRecord:
    relative_path = path.relative_to(repo).as_posix()
    text = path.read_text(encoding="utf-8", errors="replace")
    metadata, body_without_frontmatter = split_frontmatter(text)
    title = markdown_title(relative_path, metadata, body_without_frontmatter)
    event_type = infer_event_type(relative_path, metadata, title)
    occurred_at = infer_occurred_at(repo, relative_path, metadata)
    digest = sha256_text(text)
    external_id = f"{branch}:{relative_path}"
    tags = clean_tags(metadata.get("tags"))
    source_url = f"https://github.com/parklaus1078/llm_wiki/blob/{commit}/{relative_path}"
    record_metadata = {
        "project": project,
        "workstream": workstream,
        "source_system": "llm_wiki",
        "llm_wiki_branch": branch,
        "llm_wiki_commit": commit,
        "llm_wiki_path": relative_path,
        "llm_wiki_url": source_url,
        "frontmatter": metadata,
        "tags": tags,
        "content_sha256": digest,
    }
    return ImportRecord(
        path=path,
        relative_path=relative_path,
        external_id=external_id,
        event_id=stable_id("life_evt_llmwiki", external_id),
        source_id=stable_id("life_src_llmwiki", external_id),
        ref_id=stable_id("life_ref_llmwiki", external_id),
        title=title,
        event_type=event_type,
        summary=plain_summary(body_without_frontmatter or text),
        body=normalize_text(text, limit=100000),
        occurred_at=occurred_at,
        sha256=digest,
        metadata=record_metadata,
    )


def collect_records(repo: Path, branch: str, project: str, workstream: str) -> list[ImportRecord]:
    commit = run_git(repo, "rev-parse", "HEAD")
    if not commit:
        raise RuntimeError(f"not a git repository: {repo}")
    root = repo / "kay_second_brain"
    if not root.exists():
        raise RuntimeError(f"missing kay_second_brain directory: {root}")
    paths = sorted(
        path
        for path in root.rglob("*")
        if path.suffix.lower() in {".md", ".html"}
        and "wiki/_templates/" not in path.relative_to(repo).as_posix()
    )
    return [build_record(repo, branch, commit, path, project, workstream) for path in paths]


def apply_records(records: list[ImportRecord], database_url: str, *, sensitivity: str) -> None:
    if not psycopg_available():
        raise RuntimeError("psycopg is not installed. Use the Hermes venv or install requirements-life-archive.txt.")
    db = LifeArchiveDB(LifeArchiveConfig(database_url=database_url))
    db.apply_schema(ROOT / "hermes_plugins/life_archive/schema.sql")
    assert db.conn is not None
    with db.conn.transaction():
        for record in records:
            db.conn.execute(
                """
                INSERT INTO life_events (
                  id, occurred_at, type, sensitivity, title, summary, body,
                  confidence, created_by_profile, session_id, platform, source_kind,
                  metadata, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, 'imported', 'llm_wiki_importer',
                        NULL, 'llm_wiki', 'llm_wiki_file', %s, now())
                ON CONFLICT (id)
                DO UPDATE SET
                  occurred_at = excluded.occurred_at,
                  type = excluded.type,
                  sensitivity = excluded.sensitivity,
                  title = excluded.title,
                  summary = excluded.summary,
                  body = excluded.body,
                  confidence = excluded.confidence,
                  created_by_profile = excluded.created_by_profile,
                  platform = excluded.platform,
                  source_kind = excluded.source_kind,
                  metadata = excluded.metadata,
                  updated_at = now(),
                  archived_at = NULL
                """,
                (
                    record.event_id,
                    record.occurred_at,
                    record.event_type,
                    sensitivity,
                    record.title,
                    record.summary or None,
                    record.body,
                    json.dumps(record.metadata, ensure_ascii=False, default=str),
                ),
            )
            db.conn.execute(
                """
                INSERT INTO life_sources (id, event_id, kind, source_uri, external_id, sha256, metadata)
                VALUES (%s, %s, 'llm_wiki_file', %s, %s, %s, %s)
                ON CONFLICT (id)
                DO UPDATE SET
                  event_id = excluded.event_id,
                  source_uri = excluded.source_uri,
                  external_id = excluded.external_id,
                  sha256 = excluded.sha256,
                  metadata = excluded.metadata
                """,
                (
                    record.source_id,
                    record.event_id,
                    str(record.path),
                    record.external_id,
                    record.sha256,
                    json.dumps({"relative_path": record.relative_path}, ensure_ascii=False, default=str),
                ),
            )
            db.conn.execute(
                """
                INSERT INTO life_external_refs (
                  id, hermes_object_type, hermes_object_id, system, external_id,
                  external_url, sync_direction, last_synced_at, metadata
                )
                VALUES (%s, 'event', %s, 'llm_wiki', %s, %s, 'imported', now(), %s)
                ON CONFLICT (system, external_id)
                DO UPDATE SET
                  hermes_object_id = excluded.hermes_object_id,
                  external_url = excluded.external_url,
                  sync_direction = excluded.sync_direction,
                  last_synced_at = now(),
                  metadata = excluded.metadata
                """,
                (
                    record.ref_id,
                    record.event_id,
                    record.external_id,
                    record.metadata["llm_wiki_url"],
                    json.dumps(
                        {
                            "branch": record.metadata["llm_wiki_branch"],
                            "commit": record.metadata["llm_wiki_commit"],
                            "path": record.relative_path,
                            "sha256": record.sha256,
                        },
                        ensure_ascii=False,
                        default=str,
                    ),
                ),
            )
    db.conn.commit()
    db.close()


def print_plan(records: list[ImportRecord]) -> None:
    counts: dict[str, int] = {}
    for record in records:
        counts[record.event_type] = counts.get(record.event_type, 0) + 1
    print(f"records: {len(records)}")
    print("types:", ", ".join(f"{key}={counts[key]}" for key in sorted(counts)))
    for record in records:
        print(f"- [{record.event_type}] {record.relative_path} -> {record.title}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Import llm_wiki branch contents into life_archive long-term memory.")
    parser.add_argument("--repo", default="/Users/kay/Desktop/dev/projects/llm_wiki")
    parser.add_argument("--branch", default="")
    parser.add_argument("--project", default="hired_work")
    parser.add_argument("--workstream", default="VALQ Art-Data")
    parser.add_argument("--database-url", default=os.environ.get("LIFE_ARCHIVE_DATABASE_URL") or DEFAULT_DSN)
    parser.add_argument("--sensitivity", choices=["personal", "confidential", "legal_sensitive"], default="confidential")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    repo = Path(args.repo).expanduser().resolve()
    branch = args.branch or run_git(repo, "branch", "--show-current", default="unknown")
    records = collect_records(repo, branch, args.project, args.workstream)
    print_plan(records)
    if args.dry_run:
        return 0
    apply_records(records, args.database_url, sensitivity=args.sensitivity)
    print(f"imported/upserted {len(records)} records into life_archive")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
