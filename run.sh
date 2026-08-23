#!/usr/bin/env bash
# Start the local Plant Factory service with config/server.yaml defaults.
# Optionally expose the external runtime type authority through AUTOMATION_RUNTIME.
set -euo pipefail
cd "$(dirname "$0")"

if [[ -n "${AUTOMATION_RUNTIME:-}" ]]; then
  export PYTHONPATH="${AUTOMATION_RUNTIME}:${PYTHONPATH:-}"
  echo "Runtime type authority enabled: ${AUTOMATION_RUNTIME}"
fi

exec python3 svg_editor_tool.py "$@"
