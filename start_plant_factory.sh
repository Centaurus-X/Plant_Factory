#!/usr/bin/env bash
# Start Plant Factory V64 from its own resolved release directory.
set -euo pipefail

SCRIPT_PATH="${BASH_SOURCE[0]}"
while [[ -L "${SCRIPT_PATH}" ]]; do
  SCRIPT_DIR="$(cd -P -- "$(dirname -- "${SCRIPT_PATH}")" && pwd)"
  SCRIPT_PATH="$(readlink -- "${SCRIPT_PATH}")"
  if [[ "${SCRIPT_PATH}" != /* ]]; then
    SCRIPT_PATH="${SCRIPT_DIR}/${SCRIPT_PATH}"
  fi
done
RELEASE_DIR="$(cd -P -- "$(dirname -- "${SCRIPT_PATH}")" && pwd)"
cd "${RELEASE_DIR}"

VENV_DIR="${PLANT_FACTORY_VENV:-${RELEASE_DIR}/.venv}"
HOST="${PLANT_FACTORY_HOST:-0.0.0.0}"
PORT="${PLANT_FACTORY_PORT:-8090}"

if [[ -n "${PLANT_FACTORY_PYTHON:-}" ]]; then
  PYTHON_BIN="${PLANT_FACTORY_PYTHON}"
elif [[ -x "${VENV_DIR}/bin/python" ]]; then
  PYTHON_BIN="${VENV_DIR}/bin/python"
else
  python3 -m venv "${VENV_DIR}"
  PYTHON_BIN="${VENV_DIR}/bin/python"
fi

if ! "${PYTHON_BIN}" -c 'import aiohttp' >/dev/null 2>&1; then
  "${PYTHON_BIN}" -m pip install --disable-pip-version-check -r requirements.txt
fi

if [[ -n "${AUTOMATION_RUNTIME:-}" ]]; then
  export PYTHONPATH="${AUTOMATION_RUNTIME}:${PYTHONPATH:-}"
fi

echo "Plant Factory V64"
echo "Release: ${RELEASE_DIR}"
echo "Listen:  ${HOST}:${PORT}"

exec "${PYTHON_BIN}" svg_editor_tool.py \
  --host "${HOST}" \
  --port "${PORT}" \
  "$@"
