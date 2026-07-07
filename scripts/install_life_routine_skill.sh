#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$ROOT_DIR/hermes_skills/life-routine"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
DEST_DIR="$HERMES_HOME/skills/productivity/life-routine"
BACKUP_DIR="$HERMES_HOME/backups"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

if [[ ! -d "$SRC_DIR" ]]; then
  echo "life-routine skill source not found: $SRC_DIR" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR" "$(dirname "$DEST_DIR")"

if [[ -e "$DEST_DIR" ]]; then
  mv "$DEST_DIR" "$BACKUP_DIR/life-routine-skill-$STAMP"
fi

mkdir -p "$DEST_DIR"
cp -R "$SRC_DIR"/. "$DEST_DIR"/

echo "Installed life-routine skill to $DEST_DIR"

