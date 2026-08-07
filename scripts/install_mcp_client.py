#!/usr/bin/env python3
"""One-command Ultimate Hermes client enrollment for Hermes Agent."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import secrets
import stat
import sys
import tempfile
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

import yaml

SERVER_NAME = "ultimate-hermes"
TOKEN_ENV_KEY = "MCP_ULTIMATE_HERMES_API_KEY"


def normalize_server(value: str) -> str:
    server = value.strip().rstrip("/")
    if server.endswith("/mcp"):
        server = server[:-4]
    parsed = urlparse(server)
    local = parsed.hostname in {"127.0.0.1", "localhost", "::1"}
    if parsed.scheme != "https" and not (parsed.scheme == "http" and local):
        raise ValueError("The server must use HTTPS (HTTP is allowed only for localhost).")
    return server


def request(
    url: str,
    *,
    method: str = "GET",
    token: str | None = None,
    body: dict | None = None,
    accept: str = "application/json",
) -> dict:
    headers = {"Accept": accept}
    data = None
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode("utf-8")
    response = urlopen(Request(url, method=method, headers=headers, data=data), timeout=30)
    payload = response.read()
    return json.loads(payload) if payload else {}


def atomic_write(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        os.fchmod(fd, stat.S_IRUSR | stat.S_IWUSR)
        with os.fdopen(fd, "wb") as handle:
            handle.write(content)
        os.replace(temp_name, path)
        path.chmod(0o600)
    except BaseException:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass
        raise


def restore(path: Path, content: bytes | None) -> None:
    if content is None:
        path.unlink(missing_ok=True)
    else:
        atomic_write(path, content)


def update_env(current: str, key: str, value: str) -> str:
    replacement = f"{key}={value}"
    lines = current.splitlines()
    for index, line in enumerate(lines):
        if line.startswith(f"{key}="):
            lines[index] = replacement
            break
    else:
        lines.append(replacement)
    return "\n".join(lines).strip() + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--server", required=True)
    parser.add_argument("--enrollment", required=True)
    parser.add_argument("--agent", choices=["hermes"], required=True)
    parser.add_argument("--name", required=True)
    args = parser.parse_args()
    if len(args.name) > 100:
        raise SystemExit("Device name must be at most 100 characters.")
    if not args.enrollment.startswith("uhe_") or len(args.enrollment) != 85:
        raise SystemExit("Invalid enrollment code format.")

    server = normalize_server(args.server)
    request(f"{server}/api/v1/health")
    key_id = secrets.token_hex(8)
    api_key = f"uhm_{key_id}_{secrets.token_hex(32)}"
    key_hash = hashlib.sha256(api_key.encode("utf-8")).hexdigest()

    hermes_home = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes")).expanduser()
    config_path = hermes_home / "config.yaml"
    env_path = hermes_home / ".env"
    config_before = config_path.read_bytes() if config_path.exists() else None
    env_before = env_path.read_bytes() if env_path.exists() else None
    config = yaml.safe_load(config_before.decode("utf-8-sig")) if config_before else {}
    config = config or {}
    config.setdefault("mcp_servers", {})[SERVER_NAME] = {
        "url": f"{server}/mcp",
        "headers": {"Authorization": f"Bearer ${{{TOKEN_ENV_KEY}}}"},
        "timeout": 180,
        "connect_timeout": 60,
        "enabled": True,
    }
    env_current = env_before.decode("utf-8") if env_before else ""
    atomic_write(config_path, yaml.safe_dump(config, sort_keys=False, allow_unicode=True).encode("utf-8"))
    atomic_write(env_path, update_env(env_current, TOKEN_ENV_KEY, api_key).encode("utf-8"))

    try:
        enrolled = request(
            f"{server}/api/v1/enrollments/exchange",
            method="POST",
            token=args.enrollment,
            body={"keyId": key_id, "keyHash": key_hash},
        )
    except BaseException:
        restore(config_path, config_before)
        restore(env_path, env_before)
        raise

    request(
        f"{server}/mcp",
        method="POST",
        token=api_key,
        accept="application/json, text/event-stream",
        body={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-03-26",
                "capabilities": {},
                "clientInfo": {"name": "ultimate-hermes-installer-hermes", "version": "1.0.0"},
            },
        },
    )

    label = enrolled.get("client", {}).get("label", f"{args.name}-hermes")
    print(f"Ultimate Hermes configured for Hermes on {args.name}.")
    print(f"Client: {label} ({key_id}); config: {config_path}; secret: {env_path}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except HTTPError as error:
        print(f"Ultimate Hermes installation failed: HTTP {error.code}. The enrollment may be expired or already used.", file=sys.stderr)
        raise SystemExit(1) from error
    except Exception as error:
        print(f"Ultimate Hermes installation failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
