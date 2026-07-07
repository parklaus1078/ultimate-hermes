#!/usr/bin/env python3
"""Install global Hermes operating policy blocks into SOUL.md files."""

from __future__ import annotations

import os
from pathlib import Path


BEGIN = "<!-- ultimate-hermes-calendar-policy:start -->"
END = "<!-- ultimate-hermes-calendar-policy:end -->"
SECURITY_BEGIN = "<!-- ultimate-hermes-security-policy:start -->"
SECURITY_END = "<!-- ultimate-hermes-security-policy:end -->"

POLICY = f"""{BEGIN}

Calendar and schedule source policy:
- For any schedule/calendar question, including Korean phrases such as "일정",
  "이번주 일정", "오늘 일정", "내일 일정", "미팅", "회의", "약속", or "deadline",
  use Google Calendar through the Google Workspace API script.
- Canonical command:
  `/Users/kay/.hermes/hermes-agent/venv/bin/python /Users/kay/.hermes/hermes-agent/skills/productivity/google-workspace/scripts/google_api.py calendar list --start <ISO_START> --end <ISO_END>`
- Use timezone `Asia/Seoul`. For "이번주", use Monday 00:00 through Sunday
  23:59:59 in Asia/Seoul.
- Do not open macOS Calendar, Apple Calendar, Chrome, browser tabs, or
  `calendar.google.com` for schedule lookup unless Kay explicitly asks to
  inspect the UI.
- If the Google Calendar API fails, report that the API check failed and ask
  Kay to reconnect Google. Do not fall back to GUI/browser calendar access.

{END}
"""

SECURITY_POLICY = f"""{SECURITY_BEGIN}

External write and sensitive-data policy:
- Default to read/import mode for Linear, Notion, Google Workspace, Slack
  files, and email.
- Do not create, update, move, delete, send, share, upload, comment, or
  otherwise write to external systems unless Kay explicitly asks for that exact
  write in the current conversation.
- Before any external write, restate the target system, target object, and
  irreversible effects, then wait for Kay's explicit confirmation.
- Legal-sensitive or confidential records must not be written to Linear,
  Notion, Google, Slack, or email unless Kay explicitly approves that specific
  export.
- Never store raw API tokens, OAuth tokens, passwords, card data, session
  cookies, or private keys in Postgres, Notion, Linear, Slack, logs, docs, or
  long-term memory.

{SECURITY_END}
"""


def replace_block(text: str, begin: str, end: str, block: str) -> str:
    if begin in text and end in text:
        before = text.split(begin, 1)[0].rstrip()
        after = text.split(end, 1)[1].lstrip()
        return f"{before}\n\n{block}\n{after}".rstrip() + "\n"
    return text.rstrip() + "\n\n" + block + "\n"


def managed_update(text: str) -> str:
    updated = replace_block(text, BEGIN, END, POLICY)
    return replace_block(updated, SECURITY_BEGIN, SECURITY_END, SECURITY_POLICY)


def soul_paths() -> list[Path]:
    root = Path(os.environ.get("HERMES_ROOT", Path.home() / ".hermes")).expanduser()
    paths = [root / "SOUL.md"]
    profiles = root / "profiles"
    if profiles.is_dir():
        for child in sorted(profiles.iterdir()):
            if child.is_dir():
                paths.append(child / "SOUL.md")
    return paths


def main() -> int:
    for path in soul_paths():
        if path.exists():
            original = path.read_text()
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            original = "# Hermes Agent Persona\n"
        updated = managed_update(original)
        if updated != original:
            path.write_text(updated)
            print(f"updated: {path}")
        else:
            print(f"unchanged: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
