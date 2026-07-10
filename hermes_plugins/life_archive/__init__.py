"""Postgres-backed long-term life archive for Hermes Agent."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    from agent.memory_provider import MemoryProvider
except Exception:  # Allows local unit tests without importing Hermes.
    class MemoryProvider:  # type: ignore[no-redef]
        @property
        def name(self) -> str:
            raise NotImplementedError

from .db import LifeArchiveConfig, LifeArchiveDB, psycopg_available
from .embeddings import EmbeddingConfig, EmbeddingProvider, create_embedding_provider
from .extractors import extract_session_events, infer_event_type, infer_sensitivity, summarize_text
from .tools import TOOL_SCHEMAS

logger = logging.getLogger(__name__)


def _tool_error(message: str) -> str:
    return json.dumps({"success": False, "error": message}, ensure_ascii=False)


def _tool_ok(payload: dict[str, Any]) -> str:
    out = {"success": True}
    out.update(payload)
    return json.dumps(out, ensure_ascii=False, default=str)


def _load_plugin_config() -> dict[str, Any]:
    try:
        from hermes_constants import get_hermes_home
        import yaml

        config_path = get_hermes_home() / "config.yaml"
        if not config_path.exists():
            return {}
        raw = yaml.safe_load(config_path.read_text(encoding="utf-8-sig")) or {}
        return ((raw.get("plugins") or {}).get("life_archive") or {})
    except Exception:
        return {}


class LifeArchiveMemoryProvider(MemoryProvider):
    def __init__(self, config: dict[str, Any] | None = None):
        self._raw_config = config if config is not None else _load_plugin_config()
        self._config = LifeArchiveConfig.from_dict(self._raw_config)
        self._embedding_config = EmbeddingConfig.from_dict(self._raw_config)
        self._db: Optional[LifeArchiveDB] = None
        self._embedding_provider: Optional[EmbeddingProvider] = None
        self._session_id = ""
        self._platform = ""
        self._profile = "hermes"
        self._user_id = ""
        self._chat_id = ""
        self._last_prefetch: dict[str, str] = {}

    @property
    def name(self) -> str:
        return "life_archive"

    def is_available(self) -> bool:
        return psycopg_available()

    def initialize(self, session_id: str, **kwargs) -> None:
        self._session_id = session_id or ""
        self._platform = kwargs.get("platform", "") or "cli"
        self._profile = kwargs.get("agent_identity", "") or kwargs.get("profile", "") or "hermes"
        self._user_id = kwargs.get("user_id", "") or kwargs.get("user_id_alt", "") or ""
        self._chat_id = kwargs.get("chat_id", "") or ""

        self._db = LifeArchiveDB(self._config)
        schema_path = Path(__file__).with_name("schema.sql")
        self._db.apply_schema(schema_path)
        if self._embedding_config.semantic_recall_enabled:
            try:
                provider = create_embedding_provider(self._embedding_config)
                self._embedding_provider = provider if provider.is_configured() else None
            except Exception:
                logger.debug("life_archive embedding provider unavailable", exc_info=True)
                self._embedding_provider = None
        logger.info("life_archive initialized for session=%s platform=%s", self._session_id, self._platform)

    def system_prompt_block(self) -> str:
        status = "active" if self._db is not None else "configured"
        return (
            "# Life Archive Memory\n"
            f"Status: {status}. This is the durable Postgres/pgvector archive for the user's "
            "project history, decisions, documents, troubleshooting, legal-sensitive timelines, "
            "career/purchase/research choices, and daily routine.\n"
            "Use life_recall before answering questions about old work, documents, decisions, "
            "incidents, disputes, or project context. Use life_capture to save durable facts the "
            "user would expect to reconstruct later. Semantic pgvector recall is used when "
            "configured. Do not store raw secrets."
        )

    def prefetch(self, query: str, *, session_id: str = "") -> str:
        if not self._db or not query:
            return ""
        sid = session_id or self._session_id
        try:
            results = self._db.recall(
                query,
                limit=self._config.prefetch_limit,
                session_id=sid,
                query_embedding=self._query_embedding(query),
                embedding_model=self._embedding_provider.model if self._embedding_provider else "",
            )
        except Exception as exc:
            logger.debug("life_archive prefetch failed: %s", exc)
            return ""
        if not results:
            return ""
        lines = [
            "## Life Archive Recall",
            "[System note: recalled durable memory context, not new user input.]",
        ]
        for row in results:
            lines.append(
                f"- {row.get('occurred_at', '')} [{row.get('type')}/{row.get('confidence')}] "
                f"{row.get('title')} (id={row.get('id')}, score={float(row.get('score') or 0):.3f})"
            )
            summary = row.get("summary") or ""
            if summary:
                lines.append(f"  summary: {summary[:500]}")
        return "\n".join(lines)

    def queue_prefetch(self, query: str, *, session_id: str = "") -> None:
        if not self._db or not query:
            return
        sid = session_id or self._session_id
        try:
            self._last_prefetch[sid] = self.prefetch(query, session_id=sid)
        except Exception:
            logger.debug("life_archive queue_prefetch failed", exc_info=True)

    def sync_turn(
        self,
        user_content: str,
        assistant_content: str,
        *,
        session_id: str = "",
        messages: Optional[List[Dict[str, Any]]] = None,
    ) -> None:
        if not self._db or not self._config.auto_capture_turns:
            return
        user_text = (user_content or "").strip()
        assistant_text = (assistant_content or "").strip()
        if not user_text or not assistant_text:
            return
        # Keep every completed turn searchable, but compact. Detailed facts are
        # still captured explicitly through life_capture/on_session_end.
        try:
            self._db.capture_event(
                event_type="communication",
                title=summarize_text(user_text, limit=140),
                summary=summarize_text(user_text + "\n" + assistant_text, limit=500),
                body=f"USER:\n{user_text}\n\nASSISTANT:\n{assistant_text}",
                sensitivity=infer_sensitivity(user_text + "\n" + assistant_text),
                confidence="imported",
                created_by_profile=self._profile,
                session_id=session_id or self._session_id,
                platform=self._platform,
                source_kind="hermes_turn",
                metadata={
                    "user_id": self._user_id,
                    "chat_id": self._chat_id,
                    "auto_capture": True,
                },
            )
        except Exception:
            logger.debug("life_archive sync_turn failed", exc_info=True)

    def on_session_end(self, messages: List[Dict[str, Any]]) -> None:
        if not self._db or not messages:
            return
        for event in extract_session_events(messages):
            try:
                self._db.capture_event(
                    event_type=event["type"],
                    title=event["title"],
                    summary=event["summary"],
                    body=event["body"],
                    sensitivity=event["sensitivity"],
                    confidence="agent_inferred",
                    created_by_profile=self._profile,
                    session_id=self._session_id,
                    platform=self._platform,
                    source_kind="session_extraction",
                    metadata={"extractor": "life_archive.regex.v1"},
                )
            except Exception:
                logger.debug("life_archive session extraction failed", exc_info=True)

    def on_memory_write(self, action: str, target: str, content: str, metadata=None) -> None:
        if action != "add" or not self._db or not content:
            return
        try:
            self._db.capture_event(
                event_type="system" if target == "memory" else "decision",
                title=summarize_text(content, limit=120),
                summary=summarize_text(content, limit=500),
                body=content,
                sensitivity="personal",
                confidence="human_confirmed",
                created_by_profile=self._profile,
                session_id=self._session_id,
                platform=self._platform,
                source_kind="built_in_memory",
                metadata=metadata or {"target": target},
            )
        except Exception:
            logger.debug("life_archive memory mirror failed", exc_info=True)

    def get_tool_schemas(self) -> List[Dict[str, Any]]:
        return TOOL_SCHEMAS

    def handle_tool_call(self, tool_name: str, args: Dict[str, Any], **kwargs) -> str:
        if self._db is None:
            return _tool_error("life_archive is not initialized. Check Postgres and Hermes logs.")
        try:
            if tool_name == "life_capture":
                return self._handle_capture(args)
            if tool_name == "life_recall":
                return self._handle_recall(args)
            if tool_name == "life_timeline":
                return self._handle_timeline(args)
            if tool_name == "life_link_source":
                return self._handle_link_source(args)
            if tool_name == "life_project_status":
                return self._handle_project_status(args)
        except Exception as exc:
            return _tool_error(str(exc))
        return _tool_error(f"Unknown life_archive tool: {tool_name}")

    def shutdown(self) -> None:
        if self._db:
            try:
                self._db.close()
            except Exception:
                pass
        self._db = None

    def _handle_capture(self, args: Dict[str, Any]) -> str:
        action = args.get("action", "event")
        title = args.get("title", "")
        if not title:
            return _tool_error("title is required")
        project = args.get("project", "")
        metadata = {"project": project} if project else {}
        event = self._db.capture_event(
            event_type="decision" if action == "decision" else "incident" if action == "incident" else action,
            title=title,
            summary=args.get("summary", ""),
            body=args.get("body", ""),
            sensitivity=args.get("sensitivity") or infer_sensitivity("\n".join(str(args.get(k, "")) for k in ("title", "summary", "body"))),
            confidence=args.get("confidence", "agent_inferred"),
            created_by_profile=self._profile,
            session_id=self._session_id,
            platform=self._platform,
            source_kind="manual_note",
            occurred_at=args.get("occurred_at"),
            metadata=metadata,
        )
        source_uri = args.get("source_uri", "")
        if source_uri:
            self._db.link_source(event_id=event["id"], kind="manual_note", source_uri=source_uri, metadata={})
        if args.get("external_system") and args.get("external_id"):
            self._db.add_external_ref(
                hermes_object_type="event",
                hermes_object_id=event["id"],
                system=args["external_system"],
                external_id=args["external_id"],
                external_url=args.get("external_url", ""),
                sync_direction="imported",
            )
        return _tool_ok({"event": event})

    def _handle_recall(self, args: Dict[str, Any]) -> str:
        results = self._db.recall(
            args.get("query", ""),
            event_type=args.get("type", ""),
            sensitivity=args.get("sensitivity", ""),
            project=args.get("project", ""),
            limit=int(args.get("limit", self._config.recall_limit) or self._config.recall_limit),
            session_id=self._session_id,
            query_embedding=self._query_embedding(args.get("query", "")),
            embedding_model=self._embedding_provider.model if self._embedding_provider else "",
        )
        return _tool_ok({"results": results, "count": len(results)})

    def _handle_timeline(self, args: Dict[str, Any]) -> str:
        results = self._db.timeline(
            topic=args.get("topic", ""),
            project=args.get("project", ""),
            limit=int(args.get("limit", 50) or 50),
        )
        return _tool_ok({"events": results, "count": len(results)})

    def _handle_link_source(self, args: Dict[str, Any]) -> str:
        source = self._db.link_source(
            event_id=args["event_id"],
            kind=args["kind"],
            source_uri=args["source_uri"],
            external_id=args.get("external_id", ""),
            sha256=args.get("sha256", ""),
            metadata={},
        )
        return _tool_ok({"source": source})

    def _handle_project_status(self, args: Dict[str, Any]) -> str:
        status = self._db.project_status(
            project=args.get("project", ""),
            limit=int(args.get("limit", 20) or 20),
        )
        return _tool_ok({"status": status})

    def _query_embedding(self, query: str) -> list[float] | None:
        if not self._embedding_provider or not query:
            return None
        try:
            return self._embedding_provider.embed_one(query)
        except Exception:
            logger.debug("life_archive query embedding failed", exc_info=True)
            return None


def register(ctx) -> None:
    ctx.register_memory_provider(LifeArchiveMemoryProvider())
