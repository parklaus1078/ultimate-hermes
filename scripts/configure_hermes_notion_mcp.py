#!/usr/bin/env python3
"""Configure official Notion remote MCP for Hermes default/profile configs."""

from __future__ import annotations

import os
import shutil
from datetime import datetime, timezone
from pathlib import Path

import yaml


NOTION_MCP = {
    "url": "https://mcp.notion.com/mcp",
    "auth": "oauth",
    "timeout": 180,
    "connect_timeout": 60,
}


def hermes_homes() -> list[Path]:
    root = Path(os.environ.get("HERMES_ROOT", Path.home() / ".hermes")).expanduser()
    homes = [root]
    profiles = root / "profiles"
    if profiles.is_dir():
        homes.extend(child for child in sorted(profiles.iterdir()) if child.is_dir())
    return homes


def update_config(home: Path) -> str:
    config_path = home / "config.yaml"
    if not config_path.exists():
        return f"skipped: {config_path} (missing)"

    backup_dir = home / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    shutil.copy2(config_path, backup_dir / f"config-before-notion-mcp-{stamp}.yaml")

    config = yaml.safe_load(config_path.read_text(encoding="utf-8-sig")) or {}
    servers = config.setdefault("mcp_servers", {})
    before = servers.get("notion")
    servers["notion"] = {**NOTION_MCP, **(before or {})}
    servers["notion"]["url"] = NOTION_MCP["url"]
    servers["notion"]["auth"] = NOTION_MCP["auth"]

    config_path.write_text(
        yaml.safe_dump(config, sort_keys=False, allow_unicode=True),
        encoding="utf-8",
    )
    return f"updated: {config_path}"


def main() -> int:
    for home in hermes_homes():
        print(update_config(home))
    print()
    print("Next: run `hermes mcp login notion` in an interactive terminal.")
    print("Then verify with `hermes mcp test notion` and restart the gateway.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
