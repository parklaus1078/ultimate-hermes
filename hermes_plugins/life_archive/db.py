from __future__ import annotations

import hashlib
import json
import os
import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Optional

try:
    import psycopg
    from psycopg.rows import dict_row
    from psycopg.types.json import Json
except Exception:  # pragma: no cover - exercised in Hermes env checks
    psycopg = None
    dict_row = None
    Json = None


DEFAULT_DSN = "postgres://hermes:hermes@127.0.0.1:55432/hermes"
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
VALID_SENSITIVITY = {"public", "personal", "confidential", "legal_sensitive"}
VALID_CONFIDENCE = {"human_confirmed", "imported", "agent_inferred"}


def psycopg_available() -> bool:
    return psycopg is not None


def make_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def normalize_text(value: Any, *, limit: int = 20000) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if len(text) > limit:
        return text[:limit] + "\n[truncated]"
    return text


def stable_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def vector_literal(vector: list[float]) -> str:
    return "[" + ",".join(f"{value:.8f}" if isinstance(value, (int, float)) else "0" for value in vector) + "]"


def _json(value: Any) -> Any:
    return Json(value if value is not None else {}) if Json is not None else value


def _clean_type(value: str | None, default: str = "event") -> str:
    raw = (value or default).strip().lower()
    return raw if raw in VALID_EVENT_TYPES else default


def _clean_sensitivity(value: str | None) -> str:
    raw = (value or "personal").strip().lower()
    return raw if raw in VALID_SENSITIVITY else "personal"


def _clean_confidence(value: str | None) -> str:
    raw = (value or "agent_inferred").strip().lower()
    return raw if raw in VALID_CONFIDENCE else "agent_inferred"


def _parse_datetime(value: str | None) -> datetime:
    if not value:
        return utc_now()
    try:
        normalized = value.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed
    except Exception:
        return utc_now()


def _row_to_public(row: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in row.items():
        if isinstance(value, datetime):
            out[key] = value.isoformat()
        else:
            out[key] = value
    return out


@dataclass
class LifeArchiveConfig:
    database_url: str = DEFAULT_DSN
    schema_path: Path | None = None
    prefetch_limit: int = 5
    recall_limit: int = 10
    auto_capture_turns: bool = True

    @classmethod
    def from_dict(cls, config: dict[str, Any] | None) -> "LifeArchiveConfig":
        cfg = config or {}
        database_url = (
            os.environ.get("LIFE_ARCHIVE_DATABASE_URL")
            or os.environ.get("HERMES_DATABASE_URL")
            or str(cfg.get("database_url") or cfg.get("dsn") or DEFAULT_DSN)
        )
        return cls(
            database_url=database_url,
            prefetch_limit=int(cfg.get("prefetch_limit", 5) or 5),
            recall_limit=int(cfg.get("recall_limit", 10) or 10),
            auto_capture_turns=bool(cfg.get("auto_capture_turns", True)),
        )


class LifeArchiveDB:
    def __init__(self, config: LifeArchiveConfig):
        if psycopg is None:
            raise RuntimeError("psycopg is not installed. Install with: pip install 'psycopg[binary]>=3.1'")
        self.config = config
        self.conn = None

    def connect(self) -> None:
        if self.conn is not None:
            return
        self.conn = psycopg.connect(self.config.database_url, row_factory=dict_row)
        self.conn.execute("select 1")

    def close(self) -> None:
        if self.conn is not None:
            self.conn.close()
            self.conn = None

    def apply_schema(self, schema_path: Path) -> None:
        self.connect()
        sql = schema_path.read_text(encoding="utf-8")
        with self.conn.transaction():
            self.conn.execute(sql)

    def capture_event(
        self,
        *,
        event_type: str,
        title: str,
        summary: str = "",
        body: str = "",
        sensitivity: str = "personal",
        confidence: str = "agent_inferred",
        created_by_profile: str = "hermes",
        session_id: str = "",
        platform: str = "",
        source_kind: str = "manual_note",
        occurred_at: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        self.connect()
        event_id = make_id("life_evt")
        title = normalize_text(title, limit=500)
        if not title:
            raise ValueError("title is required")
        row = self.conn.execute(
            """
            INSERT INTO life_events (
              id, occurred_at, type, sensitivity, title, summary, body,
              confidence, created_by_profile, session_id, platform, source_kind,
              metadata
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
            """,
            (
                event_id,
                _parse_datetime(occurred_at),
                _clean_type(event_type),
                _clean_sensitivity(sensitivity),
                title,
                normalize_text(summary, limit=4000) or None,
                normalize_text(body),
                _clean_confidence(confidence),
                created_by_profile or "hermes",
                session_id or None,
                platform or None,
                source_kind or "manual_note",
                _json(metadata or {}),
            ),
        ).fetchone()
        self.conn.commit()
        return _row_to_public(row)

    def link_source(
        self,
        *,
        event_id: str,
        kind: str,
        source_uri: str,
        external_id: str = "",
        sha256: str = "",
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        self.connect()
        source_id = make_id("life_src")
        row = self.conn.execute(
            """
            INSERT INTO life_sources (
              id, event_id, kind, source_uri, external_id, sha256, metadata
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING *
            """,
            (
                source_id,
                event_id,
                kind or "manual_note",
                source_uri,
                external_id or None,
                sha256 or None,
                _json(metadata or {}),
            ),
        ).fetchone()
        self.conn.commit()
        return _row_to_public(row)

    def add_external_ref(
        self,
        *,
        hermes_object_type: str,
        hermes_object_id: str,
        system: str,
        external_id: str,
        external_url: str = "",
        sync_direction: str = "imported",
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        self.connect()
        ref_id = make_id("life_ref")
        row = self.conn.execute(
            """
            INSERT INTO life_external_refs (
              id, hermes_object_type, hermes_object_id, system, external_id,
              external_url, sync_direction, last_synced_at, metadata
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, now(), %s)
            ON CONFLICT (system, external_id)
            DO UPDATE SET
              hermes_object_type = excluded.hermes_object_type,
              hermes_object_id = excluded.hermes_object_id,
              external_url = excluded.external_url,
              sync_direction = excluded.sync_direction,
              last_synced_at = now(),
              metadata = excluded.metadata
            RETURNING *
            """,
            (
                ref_id,
                hermes_object_type,
                hermes_object_id,
                system,
                external_id,
                external_url or None,
                sync_direction,
                _json(metadata or {}),
            ),
        ).fetchone()
        self.conn.commit()
        return _row_to_public(row)

    def fetch_events_for_embedding(
        self,
        *,
        limit: int = 500,
        project: str = "",
        source_system: str = "",
        branch: str = "",
        include_legal: bool = False,
    ) -> list[dict[str, Any]]:
        self.connect()
        filters = ["archived_at IS NULL"]
        params: list[Any] = []
        if not include_legal:
            filters.append("sensitivity <> 'legal_sensitive'")
        if project:
            filters.append("metadata->>'project' = %s")
            params.append(project)
        if source_system:
            filters.append("metadata->>'source_system' = %s")
            params.append(source_system)
        if branch:
            filters.append("metadata->>'llm_wiki_branch' = %s")
            params.append(branch)
        params.append(limit)
        rows = self.conn.execute(
            f"""
            SELECT id, occurred_at, type, sensitivity, title, summary, body,
                   confidence, created_by_profile, source_kind, metadata
            FROM life_events
            WHERE {" AND ".join(filters)}
            ORDER BY occurred_at DESC, created_at DESC
            LIMIT %s
            """,
            params,
        ).fetchall()
        return [_row_to_public(row) for row in rows]

    def embedding_exists(self, *, event_id: str, embedding_model: str, content_hash: str) -> bool:
        self.connect()
        row = self.conn.execute(
            """
            SELECT 1
            FROM life_embeddings
            WHERE hermes_object_type = 'event'
              AND hermes_object_id = %s
              AND embedding_model = %s
              AND content_hash = %s
            LIMIT 1
            """,
            (event_id, embedding_model, content_hash),
        ).fetchone()
        return bool(row)

    def upsert_event_embedding(
        self,
        *,
        event_id: str,
        embedding_model: str,
        embedding: list[float],
        content_hash: str,
        sensitivity: str = "personal",
    ) -> dict[str, Any]:
        self.connect()
        embedding_id = make_id("life_emb")
        row = self.conn.execute(
            """
            INSERT INTO life_embeddings (
              id, hermes_object_type, hermes_object_id, embedding_model,
              embedding, content_hash, sensitivity
            )
            VALUES (%s, 'event', %s, %s, %s::vector, %s, %s)
            ON CONFLICT (hermes_object_type, hermes_object_id, embedding_model, content_hash)
            DO UPDATE SET
              embedding = excluded.embedding,
              sensitivity = excluded.sensitivity,
              created_at = now()
            RETURNING *
            """,
            (
                embedding_id,
                event_id,
                embedding_model,
                vector_literal(embedding),
                content_hash,
                _clean_sensitivity(sensitivity),
            ),
        ).fetchone()
        self.conn.execute(
            """
            DELETE FROM life_embeddings
            WHERE hermes_object_type = 'event'
              AND hermes_object_id = %s
              AND embedding_model = %s
              AND content_hash <> %s
            """,
            (event_id, embedding_model, content_hash),
        )
        self.conn.commit()
        return _row_to_public(row)

    def semantic_search(
        self,
        *,
        embedding: list[float],
        embedding_model: str,
        event_type: str = "",
        sensitivity: str = "",
        project: str = "",
        limit: int = 10,
    ) -> list[dict[str, Any]]:
        self.connect()
        filters = [
            "e.archived_at IS NULL",
            "emb.hermes_object_type = 'event'",
            "emb.embedding_model = %s",
        ]
        filter_params: list[Any] = [embedding_model]
        if event_type:
            filters.append("e.type = %s")
            filter_params.append(_clean_type(event_type, event_type))
        if sensitivity:
            filters.append("e.sensitivity = %s")
            filter_params.append(_clean_sensitivity(sensitivity))
        if project:
            filters.append(
                "(e.metadata->>'project' ILIKE %s OR e.title ILIKE %s OR coalesce(e.summary, '') ILIKE %s)"
            )
            needle = f"%{project}%"
            filter_params.extend([needle, needle, needle])
        query_vector = vector_literal(embedding)
        params = [query_vector] + filter_params + [query_vector, limit]
        rows = self.conn.execute(
            f"""
            SELECT e.*,
                   (1 - (emb.embedding <=> %s::vector))::double precision AS score,
                   'semantic' AS match_kind
            FROM life_embeddings emb
            JOIN life_events e ON e.id = emb.hermes_object_id
            WHERE {" AND ".join(filters)}
            ORDER BY emb.embedding <=> %s::vector
            LIMIT %s
            """,
            params,
        ).fetchall()
        return [_row_to_public(row) for row in rows]

    def recall(
        self,
        query: str,
        *,
        event_type: str = "",
        sensitivity: str = "",
        project: str = "",
        limit: int = 10,
        session_id: str = "",
        query_embedding: list[float] | None = None,
        embedding_model: str = "",
    ) -> list[dict[str, Any]]:
        self.connect()
        query = normalize_text(query, limit=1000)
        if not query and not project:
            rows = self.conn.execute(
                """
                SELECT e.*, 0.1::double precision AS score, 'recent' AS match_kind
                FROM life_events e
                WHERE e.archived_at IS NULL
                ORDER BY e.occurred_at DESC
                LIMIT %s
                """,
                (limit,),
            ).fetchall()
            return [_row_to_public(row) for row in rows]

        params: list[Any] = [query, query, query]
        filters = ["e.archived_at IS NULL"]
        if event_type:
            filters.append("e.type = %s")
            params.append(_clean_type(event_type, event_type))
        if sensitivity:
            filters.append("e.sensitivity = %s")
            params.append(_clean_sensitivity(sensitivity))
        if project:
            filters.append(
                "(e.metadata->>'project' ILIKE %s OR e.title ILIKE %s OR coalesce(e.summary, '') ILIKE %s)"
            )
            needle = f"%{project}%"
            params.extend([needle, needle, needle])
        params.append(limit)
        where = " AND ".join(filters)
        sql = f"""
            WITH q AS (SELECT plainto_tsquery('simple', %s) AS tsq)
            SELECT e.*,
                   greatest(
                     coalesce(ts_rank_cd(e.search_vector, q.tsq), 0),
                     similarity(e.title, %s),
                     similarity(coalesce(e.summary, ''), %s)
                   )::double precision AS score,
                   CASE WHEN e.search_vector @@ q.tsq THEN 'keyword' ELSE 'fuzzy' END AS match_kind
            FROM life_events e, q
            WHERE {where}
              AND (
                e.search_vector @@ q.tsq
                OR similarity(e.title, %s) > 0.12
                OR similarity(coalesce(e.summary, ''), %s) > 0.12
                OR e.title ILIKE ('%%' || %s || '%%')
                OR coalesce(e.summary, '') ILIKE ('%%' || %s || '%%')
                OR coalesce(e.body, '') ILIKE ('%%' || %s || '%%')
              )
            ORDER BY score DESC, e.occurred_at DESC
            LIMIT %s
        """
        # The SQL uses the query five more times after the filter params.
        params = [query, query, query] + params[3:-1] + [query, query, query, query, query, limit]
        rows = self.conn.execute(sql, params).fetchall()
        public_rows = [_row_to_public(row) for row in rows]
        if query_embedding is not None and embedding_model:
            semantic_rows = self.semantic_search(
                embedding=query_embedding,
                embedding_model=embedding_model,
                event_type=event_type,
                sensitivity=sensitivity,
                project=project,
                limit=limit,
            )
            public_rows = self._merge_recall_rows(public_rows, semantic_rows, limit=limit)
        self.record_recall_hits(query=query, rows=public_rows, session_id=session_id)
        return public_rows

    def _merge_recall_rows(
        self,
        primary_rows: list[dict[str, Any]],
        semantic_rows: list[dict[str, Any]],
        *,
        limit: int,
    ) -> list[dict[str, Any]]:
        merged: dict[str, dict[str, Any]] = {}
        for row in primary_rows:
            merged[str(row["id"])] = row
        for row in semantic_rows:
            event_id = str(row["id"])
            existing = merged.get(event_id)
            if existing is None:
                merged[event_id] = row
                continue
            existing_score = float(existing.get("score") or 0)
            semantic_score = float(row.get("score") or 0)
            existing["score"] = max(existing_score, semantic_score)
            match_kind = str(existing.get("match_kind") or "")
            if "semantic" not in match_kind:
                existing["match_kind"] = f"{match_kind}+semantic" if match_kind else "semantic"
        return sorted(
            merged.values(),
            key=lambda row: (float(row.get("score") or 0), str(row.get("occurred_at") or "")),
            reverse=True,
        )[:limit]

    def timeline(self, *, topic: str = "", project: str = "", limit: int = 50) -> list[dict[str, Any]]:
        query = topic or project
        results = self.recall(query, project=project, limit=limit) if query else self.recall("", limit=limit)
        return sorted(results, key=lambda row: str(row.get("occurred_at") or ""))

    def project_status(self, *, project: str, limit: int = 20) -> dict[str, Any]:
        events = self.recall(project, project=project, limit=limit)
        by_type: dict[str, int] = {}
        for event in events:
            by_type[event.get("type", "event")] = by_type.get(event.get("type", "event"), 0) + 1
        blockers = [
            event for event in events
            if re.search(r"\b(blocked|blocker|waiting|막힘|블로커|대기)\b", json.dumps(event, ensure_ascii=False), re.I)
        ]
        return {
            "project": project,
            "event_count": len(events),
            "counts_by_type": by_type,
            "recent_events": events[:limit],
            "possible_blockers": blockers[:5],
        }

    def record_recall_hits(self, *, query: str, rows: Iterable[dict[str, Any]], session_id: str = "") -> None:
        self.connect()
        for row in rows:
            self.conn.execute(
                """
                INSERT INTO life_recall_hits (id, query, event_id, match_kind, score, session_id)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (
                    make_id("life_hit"),
                    query,
                    row.get("id"),
                    row.get("match_kind", "unknown"),
                    float(row.get("score") or 0),
                    session_id or None,
                ),
            )
        self.conn.commit()
