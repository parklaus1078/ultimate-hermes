#!/usr/bin/env python3
from __future__ import annotations

import os
import shutil
from datetime import datetime, timezone
from pathlib import Path

import yaml


def main() -> int:
    hermes_home = Path(os.environ.get("HERMES_HOME", str(Path.home() / ".hermes"))).expanduser()
    config_path = hermes_home / "config.yaml"
    backup_dir = hermes_home / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    config = {}
    if config_path.exists():
        shutil.copy2(config_path, backup_dir / f"config-{stamp}.yaml")
        config = yaml.safe_load(config_path.read_text(encoding="utf-8-sig")) or {}

    config.setdefault("model", {})
    config["model"].setdefault("provider", "openai-codex")
    config["model"].setdefault("default", "gpt-5.5")

    config.setdefault("memory", {})
    config["memory"]["memory_enabled"] = True
    config["memory"]["user_profile_enabled"] = True
    config["memory"]["provider"] = "life_archive"

    config.setdefault("plugins", {})
    config["plugins"]["life_archive"] = {
        "database_url": os.environ.get(
            "LIFE_ARCHIVE_DATABASE_URL",
            "postgres://hermes:hermes@127.0.0.1:55432/hermes",
        ),
        "prefetch_limit": 5,
        "recall_limit": 10,
        "auto_capture_turns": True,
        "embedding": {
            "provider": "openai",
            "model": "text-embedding-3-small",
            "dimensions": 1536,
            "keychain_service": "hermes-embedding",
            "keychain_account": "default",
            "semantic_recall_enabled": True,
        },
    }

    config.setdefault("mcp_servers", {})
    config["mcp_servers"].setdefault(
        "linear",
        {
            "url": "https://mcp.linear.app/mcp",
            "auth": "oauth",
            "timeout": 180,
            "connect_timeout": 60,
        },
    )
    config["mcp_servers"].setdefault(
        "notion",
        {
            "url": "https://mcp.notion.com/mcp",
            "auth": "oauth",
            "timeout": 180,
            "connect_timeout": 60,
        },
    )

    # Keep Slack as the intended gateway platform without inventing tokens.
    config.setdefault("slack", {})
    config["slack"].setdefault("require_mention", True)
    config.setdefault("platform_toolsets", {})
    config["platform_toolsets"].setdefault("slack", ["hermes-slack"])

    config_path.write_text(yaml.safe_dump(config, sort_keys=False, allow_unicode=True), encoding="utf-8")
    print(f"Updated {config_path}")
    print(f"Backup directory: {backup_dir}")
    print("Next: install Slack credentials with `hermes gateway setup`, Linear OAuth with `hermes mcp login linear`, and Notion OAuth with `hermes mcp login notion`.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
