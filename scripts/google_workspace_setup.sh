#!/usr/bin/env bash
set -euo pipefail

HERMES_PYTHON="/Users/kay/.hermes/hermes-agent/venv/bin/python"
GWS_SETUP="/Users/kay/.hermes/hermes-agent/skills/productivity/google-workspace/scripts/setup.py"

exec "$HERMES_PYTHON" "$GWS_SETUP" "$@"
