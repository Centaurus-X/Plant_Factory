#!/usr/bin/env bash
# Complete release verification for Plant Factory V64_r6.
# Set AUTOMATION_RUNTIME or PYTHONPATH to enable external runtime authority checks.
set -euo pipefail
cd "$(dirname "$0")"

# Keep the long-running release workspace outside the source tree so that
# repository scans, rebuilds and external cleanup policies cannot remove it.
WORK_BASE="${PF_TEST_WORK_ROOT:-${TMPDIR:-/tmp}}"
if [[ ! -d "${WORK_BASE}" || ! -w "${WORK_BASE}" ]]; then
  WORK_BASE="$PWD"
fi
WORK="$(mktemp -d -p "${WORK_BASE}" plant_factory_release_test.XXXXXX)"
SERVER_PID=""

stop_server() {
  if [[ -z "${SERVER_PID}" ]]; then
    return
  fi
  if kill -0 "${SERVER_PID}" >/dev/null 2>&1; then
    kill "${SERVER_PID}" >/dev/null 2>&1 || true
    for _shutdown_attempt in $(seq 1 30); do
      if ! kill -0 "${SERVER_PID}" >/dev/null 2>&1; then
        break
      fi
      sleep 0.1
    done
    if kill -0 "${SERVER_PID}" >/dev/null 2>&1; then
      kill -9 "${SERVER_PID}" >/dev/null 2>&1 || true
    fi
  fi
  wait "${SERVER_PID}" >/dev/null 2>&1 || true
  SERVER_PID=""
}

cleanup() {
  stop_server
  rm -rf "${WORK}"
  find . -type d -name __pycache__ -prune -exec rm -rf {} + 2>/dev/null || true
  find . -type f -name '*.pyc' -delete 2>/dev/null || true
}
trap cleanup EXIT

if [[ -n "${AUTOMATION_RUNTIME:-}" ]]; then
  export PYTHONPATH="${AUTOMATION_RUNTIME}:${PYTHONPATH:-}"
fi

step() {
  printf '\n== %s ==\n' "$1"
}

step "1/20 Python syntax and functional style"
python3 _tools/check_functional_style.py

step "2/20 JavaScript syntax and functional style"
while IFS= read -r -d '' file; do
  node --check "${file}" >/dev/null
  printf '   ok  %s\n' "${file#./}"
done < <(find public test _tools -type f \( -name '*.js' -o -name '*.mjs' -o -name '*.cjs' \) -print0)
node _tools/check_js_functional_style.cjs

step "3/20 Deterministic PF-PID-V1 symbol and normalization contract"
python3 _tools/build_symbol_standard.py --check
node test/test_pid_standard.mjs
python3 test/test_v61_standard.py

step "4/20 PF-LOGIC-V1 runtime and PF-AUTOMATION-V9-BRIDGE contracts"
python3 _tools/build_logic_library.py --check
node test/test_logic_core.mjs
python3 test/test_logic_runtime.py
node test/test_automation_contract.mjs

step "5/20 Static markup and V61.1/V62.1/V63.1/V63.2/V63.3/V63.4/V64 contracts"
python3 test/test_markup.py
python3 test/test_v61_release.py
python3 test/test_v62_release.py
python3 test/test_v63_release.py
python3 test/test_v63_2_release.py
python3 test/test_v63_3_release.py
node test/test_hmi_widget_relation.mjs
python3 test/test_v63_4_release.py
python3 test/test_v64_release.py
node test/test_v64_model.mjs
python3 test/test_v64_r1_release.py
python3 test/test_v64_automation.py
python3 test/test_v64_r2_release.py
python3 test/test_v64_r3_release.py
node test/test_v64_r3_model.mjs
python3 test/test_v64_r3_server.py
python3 test/test_v64_r4_release.py
node test/test_v64_r4_model.mjs
python3 test/test_v64_r4_server.py
python3 test/test_v64_r5_release.py
node test/test_v64_r5_model.mjs
python3 test/test_v64_r5_server.py
python3 test/test_v64_r6_release.py
node test/test_v64_r6_model.mjs
python3 test/test_v64_r6_server.py

step "6/20 Security and isolated HTTP API"
python3 test/test_security.py
python3 test/test_server_api.py

step "7/20 Consolidated SVG converter"
python3 test/test_svg_converter.py

step "8/20 JavaScript regression suite"
npm test

step "9/20 Python and JavaScript formatting parity"
python3 test/test_format_parity.py
node test/test_v9_format.mjs

step "10/20 Reproducible configuration build"
find config/shards -maxdepth 1 -type f -name '*.json' -print | sort > "${WORK}/shard-files.txt"
{
  sha256sum config/device_state_data_v9.json
  while IFS= read -r file; do sha256sum "${file}"; done < "${WORK}/shard-files.txt"
} > "${WORK}/hash-before.txt"
MERGE_REPORT="${WORK}/merge_report_v9.json" ./build_config.sh > "${WORK}/build-config.log"
{
  sha256sum config/device_state_data_v9.json
  while IFS= read -r file; do sha256sum "${file}"; done < "${WORK}/shard-files.txt"
} > "${WORK}/hash-after.txt"
diff -u "${WORK}/hash-before.txt" "${WORK}/hash-after.txt"
tail -6 "${WORK}/build-config.log" | sed 's/^/   /'
echo "   ok  master and shard configuration rebuilt byte-identically"

step "11/20 Deterministic migration baseline"
python3 _tools/migrate_config_to_v9.py \
  --target "${WORK}/migrated.json" \
  --report "${WORK}/migration-report.json" >/dev/null
python3 - "${WORK}/migrated.json" <<'PY'
import json
import sys
from pathlib import Path

reference = json.loads(Path('test/fixtures/migrated_v9_reference.json').read_text(encoding='utf-8'))
actual = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
assert json.dumps(reference, sort_keys=True) == json.dumps(actual, sort_keys=True)
expected = {
    'wago_1': 'cded47f3-4dc5-5439-9aa6-73f0fff5e335',
    'wago_2': '62671112-766c-59ed-b0ff-30a49d48f747',
    'wago_3': 'd11032fa-33db-56de-a4ed-7e16cca3ded7',
    'wago_4': '82fb9eb0-3fd9-5db5-a04e-7f06e405cfdf',
    'wago_5': '06ab4528-f8a3-5ec7-a91f-eea79d60761e',
}
actual_uuids = {row['device_name']: row['controller_uuid'] for row in actual['controllers']}
assert actual_uuids == expected, actual_uuids
print('   ok  migration and five controller UUIDs match the release baseline')
PY

step "12/20 V9 local and V8 cross shard split"
python3 _tools/build_shards.py config/device_state_data_v9.json \
  --out "${WORK}/shards" --verify
python3 - "${WORK}/shards" <<'PY'
import json
import sys
from pathlib import Path

root = Path(sys.argv[1])
cross_files = sorted(root.glob('device_state_data_v8_cross_*.json'))
local_files = sorted(root.glob('device_state_data_v9_node_*.json'))
assert cross_files, 'no V8 cross shard generated'
assert len(local_files) >= 2, 'at least two V9 local shards required'
for path in cross_files:
    shard = json.loads(path.read_text(encoding='utf-8'))
    meta = shard['meta'][0]
    assert meta['version'] == 8 and meta['scope'] == 'cross'
    assert shard.get('local_node') == []
    for row in shard.get('controllers', []):
        for key in ('bus_type', 'host', 'port', 'unit'):
            assert key not in row, '%s leaked into %s' % (key, path.name)
print('   ok  %s local shards and %s cross shards satisfy rollout boundaries'
      % (len(local_files), len(cross_files)))
PY

step "13/20 V9 rule and process template libraries"
RULE_HASH_BEFORE="$(sha256sum config/rule_library_v9.json config/process_library_v9.json)"
python3 _tools/convert_libraries_to_v9.py >/dev/null
RULE_HASH_AFTER="$(sha256sum config/rule_library_v9.json config/process_library_v9.json)"
[[ "${RULE_HASH_BEFORE}" == "${RULE_HASH_AFTER}" ]]
python3 - <<'PY'
import json
for path, key in (
    ('config/rule_library_v9.json', 'rule'),
    ('config/process_library_v9.json', 'process_state'),
):
    payload = json.load(open(path, encoding='utf-8'))
    assert payload['version'] == 9
    assert all('__template__' in item and key in item for item in payload['templates'])
print('   ok  V9 libraries are deterministic and structurally complete')
PY

step "14/20 Rule contract and optional external runtime authority"
python3 test/test_rule_contract.py

step "15/20 Plant Factory end-to-end model chain"
node test/test_plant_factory.mjs
node test/test_snapshot.mjs
node test/test_v9_core.mjs

step "16/20 Server startup and Chromium browser regressions"
SMOKE_PORT="${SMOKE_PORT:-$(python3 - <<'PYSOCKET'
import socket
with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as handle:
    handle.bind(('127.0.0.1', 0))
    print(handle.getsockname()[1])
PYSOCKET
)}"
SMOKE_BASE_URL="http://127.0.0.1:${SMOKE_PORT}"
python3 svg_editor_tool.py --host 127.0.0.1 --port "${SMOKE_PORT}" > "${WORK}/server.log" 2>&1 &
SERVER_PID=$!
SERVER_READY=0
for _attempt in $(seq 1 80); do
  if ! kill -0 "${SERVER_PID}" >/dev/null 2>&1; then
    cat "${WORK}/server.log" >&2
    echo "Server stopped before browser verification." >&2
    exit 1
  fi
  if SMOKE_BASE_URL="${SMOKE_BASE_URL}" python3 - <<'PYREADY' >/dev/null 2>&1
import os
import urllib.request
urllib.request.urlopen(os.environ['SMOKE_BASE_URL'] + '/', timeout=1).read(1)
PYREADY
  then
    SERVER_READY=1
    break
  fi
  sleep 0.25
done
[[ "${SERVER_READY}" -eq 1 ]] || { cat "${WORK}/server.log" >&2; exit 1; }

export SMOKE_OUTPUT_DIR="${WORK}/browser-test"
export SMOKE_EVIDENCE_DIR="${WORK}/browser-evidence"
export SMOKE_FORCE_HERMETIC="${SMOKE_FORCE_HERMETIC:-0}"
if python3 -c "import playwright" >/dev/null 2>&1; then
  PYTHONUNBUFFERED=1 timeout 360s python3 test/smoke_ui.py "${SMOKE_BASE_URL}"
  PYTHONUNBUFFERED=1 timeout 240s python3 test/smoke_v62.py "${SMOKE_BASE_URL}"
  PYTHONUNBUFFERED=1 timeout 300s python3 test/smoke_v63.py "${SMOKE_BASE_URL}"
  PYTHONUNBUFFERED=1 timeout 300s python3 test/smoke_v63_2.py "${SMOKE_BASE_URL}"
  PYTHONUNBUFFERED=1 timeout 300s python3 test/smoke_v63_3.py "${SMOKE_BASE_URL}"
  PYTHONUNBUFFERED=1 timeout 360s python3 test/smoke_v63_4.py "${SMOKE_BASE_URL}"
  PYTHONUNBUFFERED=1 timeout 360s python3 test/smoke_v64.py "${SMOKE_BASE_URL}"
  PYTHONUNBUFFERED=1 timeout 420s python3 test/smoke_v64_r1.py "${SMOKE_BASE_URL}"
  PYTHONUNBUFFERED=1 timeout 480s python3 test/smoke_v64_r2.py "${SMOKE_BASE_URL}"
  PYTHONUNBUFFERED=1 timeout 600s python3 test/smoke_v64_r3.py "${SMOKE_BASE_URL}"
  PYTHONUNBUFFERED=1 timeout 600s python3 test/smoke_v64_r4.py "${SMOKE_BASE_URL}"
  PYTHONUNBUFFERED=1 timeout 600s python3 test/smoke_v64_r5.py "${SMOKE_BASE_URL}"
  PYTHONUNBUFFERED=1 timeout 600s python3 test/smoke_v64_r6.py "${SMOKE_BASE_URL}"
elif node -e "import('playwright')" >/dev/null 2>&1; then
  timeout 360s node test/smoke_ui.mjs "${SMOKE_BASE_URL}"
  echo "Python Playwright is required for the V62.1/V63.1/V63.2/V63.3/V63.4 interaction smoke tests." >&2
  exit 1
else
  echo "Python Playwright is required for the release smoke tests." >&2
  exit 1
fi
unset SMOKE_OUTPUT_DIR SMOKE_EVIDENCE_DIR SMOKE_FORCE_HERMETIC
stop_server

step "17/20 Deterministic complete example project"
node _tools/build_v63_2_example.mjs --check
python3 - <<'PY'
import json
from pathlib import Path
from xml.etree import ElementTree

root = Path('.')
project = json.loads((root / 'projekte' / 'v63_2_komplettbeispiel.json').read_text(encoding='utf-8'))
assert project.get('release') == '63.2'
assert len(project.get('elements', [])) == 6
assert len(project.get('connections', [])) == 5
assert len(project.get('logic', {}).get('diagrams', [])) == 2
assert project.get('automation_cfg', {}).get('automation_rule_sets') == []
ElementTree.parse(root / 'projekte' / 'v63_2_komplettbeispiel.svg')
print('   ok  complete V63.2 example is deterministic and structurally valid')
PY

step "18/20 V63.3 I/O, Generic Sensor and Widget/Object UX contracts"
python3 test/test_v63_3_release.py
node test/test_hmi_widget_relation.mjs

step "19/20 V63.4 guided HMI and V64 event-animation/drawing contracts"
python3 test/test_v63_4_release.py

python3 test/test_v64_release.py
node test/test_v64_model.mjs
python3 test/test_v64_r1_release.py
python3 test/test_v64_automation.py
python3 test/test_v64_r2_release.py
python3 test/test_v64_r3_release.py
node test/test_v64_r3_model.mjs
python3 test/test_v64_r3_server.py
python3 test/test_v64_r4_release.py
node test/test_v64_r4_model.mjs
python3 test/test_v64_r4_server.py
python3 test/test_v64_r5_release.py
node test/test_v64_r5_model.mjs
python3 test/test_v64_r5_server.py
python3 test/test_v64_r6_release.py
node test/test_v64_r6_model.mjs
python3 test/test_v64_r6_server.py
step "20/20 Final repository, documentation and checksum gates"
python3 _tools/check_functional_style.py
node _tools/check_js_functional_style.cjs
python3 test/test_markup.py
python3 test/test_v61_release.py
python3 test/test_v62_release.py
python3 test/test_v63_release.py
python3 test/test_v63_2_release.py
python3 test/test_v63_3_release.py
node test/test_hmi_widget_relation.mjs
python3 test/test_v63_4_release.py
python3 _tools/build_symbol_standard.py --check
python3 test/test_v64_release.py
node test/test_v64_model.mjs
python3 test/test_v64_r1_release.py
python3 test/test_v64_automation.py
python3 test/test_v64_r2_release.py
python3 test/test_v64_r3_release.py
python3 test/test_v64_r4_release.py
python3 test/test_v64_r5_release.py
python3 test/test_v64_r6_release.py
python3 _tools/build_logic_library.py --check
node test/test_logic_core.mjs
node test/test_automation_contract.mjs
python3 test/test_logic_runtime.py
node _tools/build_v63_2_example.mjs --check
python3 _tools/create_sha256_manifest.py --check
[[ ! -d node_modules ]] || echo "   note  node_modules exists in the development tree and is excluded from the release archive"

printf '\nALL V64_R6 RELEASE CHECKS PASSED\n'
