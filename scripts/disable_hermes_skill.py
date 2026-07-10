#!/usr/bin/env python3
"""Disable a Hermes skill in the default profile and all local profiles."""

from __future__ import annotations

import os
import sys
from pathlib import Path


def hermes_roots() -> list[Path]:
    root = Path(os.environ.get("HERMES_ROOT", Path.home() / ".hermes")).expanduser()
    roots = [root]
    profiles = root / "profiles"
    if profiles.is_dir():
        roots.extend(child for child in sorted(profiles.iterdir()) if child.is_dir())
    return roots


def disable_with_hermes_config(home: Path, skill_name: str) -> bool:
    os.environ["HERMES_HOME"] = str(home)

    from hermes_cli.config import load_config
    from hermes_cli.skills_config import save_disabled_skills

    config = load_config()
    disabled = set(config.get("skills", {}).get("disabled", []))
    before = set(disabled)
    disabled.add(skill_name)
    save_disabled_skills(config, disabled)
    return disabled != before


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: disable_hermes_skill.py SKILL_NAME", file=sys.stderr)
        return 2

    agent_root = Path.home() / ".hermes" / "hermes-agent"
    sys.path.insert(0, str(agent_root))

    skill_name = sys.argv[1]
    for home in hermes_roots():
        config_path = home / "config.yaml"
        if not config_path.exists():
            print(f"skipped: {home} (missing config.yaml)")
            continue
        changed = disable_with_hermes_config(home, skill_name)
        status = "disabled" if changed else "already disabled"
        print(f"{status}: {skill_name} in {config_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
