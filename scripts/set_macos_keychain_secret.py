#!/usr/bin/env python3
"""Store one secret in macOS Keychain without echoing it."""

from __future__ import annotations

import argparse
import getpass
import os
import platform
import subprocess


def main() -> int:
    parser = argparse.ArgumentParser(description="Store a generic password in macOS Keychain.")
    parser.add_argument("service", help="Keychain service name, for example hermes-notion")
    parser.add_argument("account", help="Keychain account name, for example default")
    args = parser.parse_args()

    if platform.system() != "Darwin":
        raise SystemExit("macOS Keychain is only available on Darwin/macOS.")

    value = getpass.getpass(f"{args.service}/{args.account}: ").strip()
    if not value:
        raise SystemExit("empty value rejected")

    try:
        subprocess.run(
            [
                "security",
                "add-generic-password",
                "-U",
                "-s",
                args.service,
                "-a",
                args.account,
                # With -w as the final option, security prompts for the password
                # and confirmation. Feed both through stdin so the secret is not
                # passed as a process argument.
                "-w",
            ],
            input=value + os.linesep + value + os.linesep,
            text=True,
            check=True,
        )
    except subprocess.CalledProcessError as error:
        raise SystemExit(
            "Failed to write macOS Keychain item. Run this script from a normal "
            "Terminal/iTerm session where macOS can prompt for Keychain access, "
            "or use scripts/set_hermes_env_secret.py NOTION_API_KEY as the fallback."
        ) from error
    subprocess.run(
        ["security", "find-generic-password", "-s", args.service, "-a", args.account],
        check=True,
        stdout=subprocess.DEVNULL,
    )
    print(f"Stored secret in macOS Keychain: service={args.service} account={args.account}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
