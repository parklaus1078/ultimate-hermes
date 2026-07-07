#!/usr/bin/env bash
set -euo pipefail

HERMES_ROOT="${HERMES_ROOT:-$HOME/.hermes}"

chmod_if_exists() {
  local mode="$1"
  local path="$2"
  if [[ -e "$path" ]]; then
    chmod "$mode" "$path"
    echo "chmod $mode $path"
  fi
}

chmod_if_exists 700 "$HERMES_ROOT"
chmod_if_exists 600 "$HERMES_ROOT/.env"
chmod_if_exists 600 "$HERMES_ROOT/config.yaml"
chmod_if_exists 600 "$HERMES_ROOT/google_token.json"
chmod_if_exists 600 "$HERMES_ROOT/google_client_secret.json"
chmod_if_exists 600 "$HERMES_ROOT/state.db"
chmod_if_exists 600 "$HERMES_ROOT/state.db-shm"
chmod_if_exists 600 "$HERMES_ROOT/state.db-wal"
chmod_if_exists 600 "$HERMES_ROOT/kanban.db"
chmod_if_exists 600 "$HERMES_ROOT/kanban.db-shm"
chmod_if_exists 600 "$HERMES_ROOT/kanban.db-wal"
chmod_if_exists 700 "$HERMES_ROOT/mcp-tokens"

if [[ -d "$HERMES_ROOT/mcp-tokens" ]]; then
  find "$HERMES_ROOT/mcp-tokens" -type f -exec chmod 600 {} +
fi

if [[ -d "$HERMES_ROOT/profiles" ]]; then
  find "$HERMES_ROOT/profiles" -name config.yaml -type f -exec chmod 600 {} +
  find "$HERMES_ROOT/profiles" -name SOUL.md -type f -exec chmod 600 {} +
fi
