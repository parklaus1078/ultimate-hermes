#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_DIR/.env"
LOG_DIR="/Users/kay/.hermes/logs"

mkdir -p "$LOG_DIR"
cd "$REPO_DIR"

# Keep remote credentials local-only and out of git. .env is already ignored.
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"

if ! grep -q '^HERMES_API_TOKEN=' "$ENV_FILE"; then
  TOKEN="$(openssl rand -hex 32)"
  printf '\nHERMES_API_TOKEN=%s\n' "$TOKEN" >> "$ENV_FILE"
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

TAILSCALE_IP="$(tailscale ip -4 | head -n 1)"
if [[ -z "$TAILSCALE_IP" ]]; then
  echo "No Tailscale IPv4 address found. Is Tailscale running?" >&2
  exit 1
fi

export HERMES_HOST="$TAILSCALE_IP"
export HERMES_PORT="${HERMES_PORT:-8787}"
export HERMES_PUBLIC_BASE_URL="http://${TAILSCALE_IP}:${HERMES_PORT}"

exec npm start
