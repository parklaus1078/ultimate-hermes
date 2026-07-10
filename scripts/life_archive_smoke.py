#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, "/Users/kay/.hermes/hermes-agent")

from hermes_plugins.life_archive import LifeArchiveMemoryProvider


def main() -> int:
    provider = LifeArchiveMemoryProvider(
        {
            "database_url": "postgres://hermes:hermes@127.0.0.1:55432/hermes",
            "prefetch_limit": 3,
            "recall_limit": 5,
            "auto_capture_turns": False,
        }
    )
    if not provider.is_available():
        print("life_archive unavailable: install psycopg[binary] in the Hermes venv", file=sys.stderr)
        return 2
    provider.initialize("smoke-session", platform="cli", agent_identity="smoke")
    capture = provider.handle_tool_call(
        "life_capture",
        {
            "action": "decision",
            "title": "life_archive smoke test decision",
            "summary": "Smoke test verifies capture and recall through the native Hermes provider.",
            "body": "This record can be deleted later; it proves Postgres and provider wiring work.",
            "project": "ultimate-hermes",
            "confidence": "human_confirmed",
        },
    )
    print(capture)
    recall = provider.handle_tool_call("life_recall", {"query": "smoke test decision", "limit": 3})
    print(recall)
    parsed = json.loads(recall)
    provider.shutdown()
    return 0 if parsed.get("count", 0) >= 1 else 1


if __name__ == "__main__":
    raise SystemExit(main())

