#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$ROOT_DIR/hermes_plugins/life_archive"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
DEST_DIR="$HERMES_HOME/plugins/life_archive"
BACKUP_DIR="$HERMES_HOME/backups"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

if [[ ! -d "$SRC_DIR" ]]; then
  echo "life_archive source not found: $SRC_DIR" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR" "$HERMES_HOME/plugins"

if [[ -e "$DEST_DIR" ]]; then
  mv "$DEST_DIR" "$BACKUP_DIR/life_archive-$STAMP"
fi

mkdir -p "$DEST_DIR"
cp -R "$SRC_DIR"/. "$DEST_DIR"/

echo "Installed life_archive to $DEST_DIR"

