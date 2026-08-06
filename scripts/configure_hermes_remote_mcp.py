#!/usr/bin/env python3
"""Configure Ultimate Hermes remote MCP in Nous Research Hermes Agent."""

from __future__ import annotations

import argparse
import getpass
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import yaml

from set_hermes_env_secret import update_env


SERVER_NAME = "ultimate-hermes"
TOKEN_ENV_KEY = "MCP_ULTIMATE_HERMES_API_KEY"


def validate_url(value: str, allow_http_localhost: bool) -> str:
    url = value.strip().rstrip("/")
    parsed = urlparse(url)
    if parsed.scheme == "https" and parsed.netloc:
        return url
    if allow_http_localhost and parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost", "::1"}:
        return url
    raise ValueError("MCP URL must use HTTPS. Use --allow-http-localhost only for local development.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default=os.environ.get("ULTIMATE_HERMES_MCP_URL", ""))
    parser.add_argument("--allow-http-localhost", action="store_true")
    args = parser.parse_args()

    if not args.url:
        raise SystemExit("Pass --url https://YOUR-HOST/mcp or set ULTIMATE_HERMES_MCP_URL.")
    try:
        url = validate_url(args.url, args.allow_http_localhost)
    except ValueError as error:
        raise SystemExit(str(error)) from error
    if not url.endswith("/mcp"):
        url += "/mcp"

    token = os.environ.get("ULTIMATE_HERMES_API_TOKEN", "").strip()
    if not token:
        token = getpass.getpass("Ultimate Hermes API token: ").strip()
    if not token or any(character in token for character in "\r\n"):
        raise SystemExit("A non-empty single-line API token is required.")

    hermes_home = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes")).expanduser()
    config_path = hermes_home / "config.yaml"
    env_path = hermes_home / ".env"
    backup_dir = hermes_home / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup_dir.chmod(0o700)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    config = {}
    if config_path.exists():
        shutil.copy2(config_path, backup_dir / f"config-{stamp}.yaml")
        config = yaml.safe_load(config_path.read_text(encoding="utf-8-sig")) or {}

    update_env(env_path, TOKEN_ENV_KEY, token)
    servers = config.setdefault("mcp_servers", {})
    servers[SERVER_NAME] = {
        "url": url,
        "headers": {"Authorization": f"Bearer ${{{TOKEN_ENV_KEY}}}"},
        "timeout": 180,
        "connect_timeout": 60,
        "enabled": True,
    }
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(yaml.safe_dump(config, sort_keys=False, allow_unicode=True), encoding="utf-8")
    config_path.chmod(0o600)

    print(f"Configured {SERVER_NAME} at {url}")
    print(f"Updated {config_path} and stored the token in {env_path} without printing it.")
    print(f"Next: hermes mcp test {SERVER_NAME}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
