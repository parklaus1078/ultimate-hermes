from __future__ import annotations

import re
from typing import Any


_DURABLE_PATTERNS = [
    re.compile(r"\bremember\b|\bdecided\b|\bagreed\b|\bchose\b|\bblocked\b|\bincident\b|\broot cause\b", re.I),
    re.compile(r"기억|결정|합의|선택|블로커|막힘|장애|원인|분쟁|법적", re.I),
]


def should_capture_turn(text: str) -> bool:
    if not text or len(text.strip()) < 12:
        return False
    return any(pattern.search(text) for pattern in _DURABLE_PATTERNS)


def infer_event_type(text: str) -> str:
    lowered = text.lower()
    if "legal" in lowered or "dispute" in lowered or "법적" in text or "분쟁" in text:
        return "legal"
    if "incident" in lowered or "root cause" in lowered or "장애" in text or "원인" in text:
        return "incident"
    if "decided" in lowered or "agreed" in lowered or "결정" in text or "합의" in text:
        return "decision"
    if "project" in lowered or "프로젝트" in text:
        return "project_update"
    return "communication"


def infer_sensitivity(text: str) -> str:
    lowered = text.lower()
    if "legal" in lowered or "dispute" in lowered or "contract" in lowered or "법적" in text or "분쟁" in text:
        return "legal_sensitive"
    if "confidential" in lowered or "secret" in lowered or "비밀" in text:
        return "confidential"
    return "personal"


def summarize_text(text: str, *, limit: int = 240) -> str:
    compact = re.sub(r"\s+", " ", text).strip()
    if len(compact) <= limit:
        return compact
    return compact[: limit - 12].rstrip() + " [truncated]"


def extract_session_events(messages: list[dict[str, Any]], *, max_events: int = 12) -> list[dict[str, str]]:
    captures: list[dict[str, str]] = []
    for msg in messages:
        if msg.get("role") != "user":
            continue
        content = msg.get("content", "")
        if not isinstance(content, str):
            continue
        if not should_capture_turn(content):
            continue
        captures.append(
            {
                "type": infer_event_type(content),
                "sensitivity": infer_sensitivity(content),
                "title": summarize_text(content, limit=120),
                "summary": summarize_text(content),
                "body": content[:8000],
            }
        )
        if len(captures) >= max_events:
            break
    return captures

