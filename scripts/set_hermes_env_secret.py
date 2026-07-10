#!/usr/bin/env python3
"""Safely update a single secret-like variable in ~/.hermes/.env."""

from __future__ import annotations

import argparse
import getpass
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path


ENV_KEY_RE = re.compile(r"^[A-Z_][A-Z0-9_]*$")


def hermes_home() -> Path:
    return Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes")).expanduser()


def dotenv_line(key: str, value: str) -> str:
    if "\n" in value or "\r" in value:
        raise ValueError("secret value must be a single line")
    return f"{key}={value}\n"


def update_env(path: Path, key: str, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = path.read_text().splitlines(keepends=True) if path.exists() else []

    new_line = dotenv_line(key, value)
    replaced = False
    updated: list[str] = []
    for line in lines:
        stripped = line.lstrip()
        if stripped.startswith(f"{key}=") and not stripped.startswith("#"):
            updated.append(new_line)
            replaced = True
        else:
            updated.append(line)

    if not replaced:
        if updated and not updated[-1].endswith("\n"):
            updated[-1] += "\n"
        updated.append(new_line)

    if path.exists():
        backup_dir = path.parent / "backups"
        backup_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        shutil.copy2(path, backup_dir / f".env.{stamp}.bak")

    path.write_text("".join(updated))
    path.chmod(0o600)


def main() -> int:
    parser = argparse.ArgumentParser(description="Set one variable in ~/.hermes/.env without printing the secret.")
    parser.add_argument("key", help="environment variable name, for example SLACK_BOT_TOKEN")
    parser.add_argument("--must-start", help="reject values that do not start with this prefix")
    parser.add_argument("--env-file", type=Path, help="override env file path")
    args = parser.parse_args()

    key = args.key.strip()
    if not ENV_KEY_RE.match(key):
        raise SystemExit(f"invalid env key: {key}")

    value = getpass.getpass(f"{key}: ").strip()
    if not value:
        raise SystemExit("empty value rejected")
    if args.must_start and not value.startswith(args.must_start):
        raise SystemExit(f"{key} must start with {args.must_start!r}")

    env_file = args.env_file.expanduser() if args.env_file else hermes_home() / ".env"
    update_env(env_file, key, value)
    print(f"Updated {env_file} ({key}); previous file was backed up if it existed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
