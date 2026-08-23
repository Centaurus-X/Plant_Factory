#!/usr/bin/env bash
# =============================================================================
# build_config.sh — erzeugt die ausgelieferte Konfiguration reproduzierbar neu.
#
# Kette:
#   1. Feld-Shards            -> master_global          (merge_shards_to_master)
#   2. Overlay-Patches        -> master_global (final)  (apply_config_patch)
#   3. master_global          -> Node- und Cross-Shards (build_shards)
#
# Jeder Schritt prueft gegen die echte Runtime-Type-Authority, sofern
# automation_system_v0101 im PYTHONPATH liegt. Ohne Runtime laeuft die Kette
# ebenfalls durch; dann gilt die Browser-Validierung als Mass.
#
# Aufruf:  ./build_config.sh   (optional: PYTHONPATH=/pfad/zu/automation_system_v0101)
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")"

SITE_ID="site_main"
MASTER="config/device_state_data_v9.json"
SHARD_DIR="config/shards"
MERGE_REPORT="${MERGE_REPORT:-config/merge_report_v9.json}"
# Keep the build workspace local for restricted environments without /tmp.
WORK="$(mktemp -d -p "$PWD" .build_tmp.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

echo "== 1/3  Feld-Shards -> master_global =="
python3 _tools/merge_shards_to_master.py \
  config/_incoming/node_fn01.json \
  config/_incoming/node_fn02.json \
  --cross config/_incoming/cross_fn01.json \
  --assign ctrl_wago_3=fn-02 \
  --site-id "$SITE_ID" \
  --out "$WORK/master_raw.json" \
  --report "$MERGE_REPORT" \
  --description "Master-Global-Contract der Anlage site_main: zusammengefuehrt aus den Feld-Shards fn-01, fn-02 und dem V8-Cross-Shard von fn-01, danach um den fn-02-Ausbau und den Cross-Worker-Abgleich erweitert (build_config.sh)." \
  --verify

echo
echo "== 2/3  Overlay-Patches -> master_global (final) =="
python3 _tools/apply_config_patch.py "$WORK/master_raw.json" \
  config/_patches/cross_worker_e2e_abgleich.json \
  config/_patches/fn02_ausbau.json \
  --out "$MASTER" --verify

echo
echo "== 3/3  master_global -> Node- und Cross-Shards =="
python3 _tools/build_shards.py "$MASTER" --out "$SHARD_DIR" --verify

echo
echo "== Formatpruefung =="
if python3 _tools/format_v9_config.py --check "$MASTER" "$SHARD_DIR"/*.json; then
  echo "   ok  alle Dateien im kanonischen Lesbarkeitsformat"
else
  echo "   FEHLER: Formatabweichung nach dem Schreiben" >&2
  exit 1
fi

echo
echo "KONFIGURATION NEU ERZEUGT"
