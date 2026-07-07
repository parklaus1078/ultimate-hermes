from __future__ import annotations

import subprocess


def read_macos_keychain(service: str, account: str) -> str:
    if not service or not account:
        return ""
    try:
        result = subprocess.run(
            ["security", "find-generic-password", "-s", service, "-a", account, "-w"],
            check=False,
            capture_output=True,
            text=True,
            timeout=5,
        )
    except Exception:
        return ""
    if result.returncode != 0:
        return ""
    return result.stdout.strip()


def redact(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 8:
        return "<redacted>"
    return value[:3] + "<redacted>" + value[-3:]

