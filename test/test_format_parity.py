#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Paritaetstest: JS-Formatter (Browser) gegen Python-Formatter (Server).

Beide Implementierungen muessen BYTE-GLEICHE Dateien schreiben. Sonst haengt der
Fingerprint einer Config davon ab, wer sie zuletzt gespeichert hat — und
Authority V5 wuerde einen unveraenderten Commit als Abweichung werten.

Geprueft wird auf zwei Ebenen:

    1. Tabellenparitaet — die Ordnungstabellen werden aus dem JS-Modul
       ausgelesen (per Node, nicht per Regex) und Feld fuer Feld verglichen.
    2. Ausgabeparitaet  — beide Implementierungen formatieren dieselben echten
       Runtime-Dateien; die Bytes muessen identisch sein, und zwar auch
       identisch zur Originaldatei.

Ausfuehren:  python3 test/test_format_parity.py
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from functools import partial
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NODE_BINARY = os.environ.get("NODE_BINARY", "node")
sys.path.insert(0, str(ROOT))

from _tools import format_v9_config as py_fmt  # noqa: E402

FIXTURES = ROOT / "test" / "fixtures"
REFERENCES = (
    "format_ref_v9_node_fn01.json",
    "format_ref_v9_node_fn02.json",
    "format_ref_v8_cross_fn01.json",
)

FAILURES = []
PASSED = [0]


def check(name, condition, detail=""):
    if condition:
        PASSED[0] += 1
        return
    FAILURES.append(name + (" — " + detail if detail else ""))


def node_available():
    try:
        subprocess.run([NODE_BINARY, "--version"], capture_output=True, check=True)
        return True
    except Exception:  # noqa: BLE001
        return False


def dump_js_tables():
    """Liest die JS-Tabellen ueber Node aus — kein Regex-Parsing der Quelle."""
    module = (ROOT / "public" / "js" / "v9_json_format.js").as_posix()
    script = (
        "import('file://%s').then(function (m) {"
        "  process.stdout.write(JSON.stringify({"
        "    TOP_LEVEL_ORDER: m.TOP_LEVEL_ORDER,"
        "    TOP_SPACING: m.TOP_SPACING,"
        "    FIELD_ORDER_BY_SECTION: m.FIELD_ORDER_BY_SECTION,"
        "    FIELD_ORDER_BY_PARENT: m.FIELD_ORDER_BY_PARENT,"
        "    FLOAT_PATHS: m.FLOAT_PATHS,"
        "    INT_PATHS: m.INT_PATHS"
        "  }));"
        "});" % module
    )
    result = subprocess.run([NODE_BINARY, "--input-type=module", "-e", script],
                            capture_output=True, text=True, encoding="utf-8", check=True)
    return json.loads(result.stdout)


def dump_js_output(path):
    module = (ROOT / "public" / "js" / "v9_json_format.js").as_posix()
    script = (
        "import fs from 'node:fs';"
        "const m = await import('file://%s');"
        "process.stdout.write(m.formatConfigText(fs.readFileSync(%s, 'utf8')));"
        % (module, json.dumps(str(path)))
    )
    result = subprocess.run([NODE_BINARY, "--input-type=module", "-e", script],
                            capture_output=True, text=True, encoding="utf-8", check=True)
    return result.stdout


def compare_tables(js_tables):
    check("TOP_LEVEL_ORDER identisch",
          list(js_tables["TOP_LEVEL_ORDER"]) == list(py_fmt.TOP_LEVEL_ORDER))
    check("TOP_SPACING identisch",
          js_tables["TOP_SPACING"] == py_fmt.TOP_SPACING)

    js_sections = js_tables["FIELD_ORDER_BY_SECTION"]
    check("FIELD_ORDER_BY_SECTION gleiche Sektionsmenge",
          sorted(js_sections) == sorted(py_fmt.FIELD_ORDER_BY_SECTION),
          "%s vs %s" % (len(js_sections), len(py_fmt.FIELD_ORDER_BY_SECTION)))
    for section in sorted(set(js_sections) & set(py_fmt.FIELD_ORDER_BY_SECTION)):
        check("FIELD_ORDER_BY_SECTION[%s]" % section,
              list(js_sections[section]) == list(py_fmt.FIELD_ORDER_BY_SECTION[section]),
              "JS=%s PY=%s" % (js_sections[section],
                               list(py_fmt.FIELD_ORDER_BY_SECTION[section])))

    js_parents = js_tables["FIELD_ORDER_BY_PARENT"]
    check("FIELD_ORDER_BY_PARENT gleiche Schluesselmenge",
          sorted(js_parents) == sorted(py_fmt.FIELD_ORDER_BY_PARENT),
          "%s vs %s" % (sorted(js_parents), sorted(py_fmt.FIELD_ORDER_BY_PARENT)))
    for parent in sorted(set(js_parents) & set(py_fmt.FIELD_ORDER_BY_PARENT)):
        check("FIELD_ORDER_BY_PARENT[%s]" % parent,
              list(js_parents[parent]) == list(py_fmt.FIELD_ORDER_BY_PARENT[parent]),
              "JS=%s PY=%s" % (js_parents[parent],
                               list(py_fmt.FIELD_ORDER_BY_PARENT[parent])))


def compare_number_tables(js_tables):
    """Die Zahlentabellen leben in canonicalize_v9_config.py — dort spiegeln."""
    from _tools.canonicalize_v9_config import FLOAT_PATHS, INT_PATHS  # noqa: PLC0415

    check("FLOAT_PATHS identisch",
          sorted(js_tables["FLOAT_PATHS"]) == sorted(FLOAT_PATHS),
          "nur JS: %s | nur PY: %s"
          % (sorted(set(js_tables["FLOAT_PATHS"]) - set(FLOAT_PATHS)),
             sorted(set(FLOAT_PATHS) - set(js_tables["FLOAT_PATHS"]))))
    check("INT_PATHS identisch",
          sorted(js_tables["INT_PATHS"]) == sorted(INT_PATHS),
          "nur JS: %s | nur PY: %s"
          % (sorted(set(js_tables["INT_PATHS"]) - set(INT_PATHS)),
             sorted(set(INT_PATHS) - set(js_tables["INT_PATHS"]))))


def first_diff(left, right):
    left_lines = left.split("\n")
    right_lines = right.split("\n")
    for index in range(max(len(left_lines), len(right_lines))):
        a = left_lines[index] if index < len(left_lines) else "<eof>"
        b = right_lines[index] if index < len(right_lines) else "<eof>"
        if a != b:
            return "Zeile %d\n    A: %s\n    B: %s" % (index + 1, a[:160], b[:160])
    return ""


def compare_output(with_node):
    for name in REFERENCES:
        path = FIXTURES / name
        source = path.read_text(encoding="utf-8").rstrip("\n") + "\n"
        py_out = py_fmt.format_config_text(source)
        check("Python byte-gleich zur Runtime: %s" % name, py_out == source,
              first_diff(source, py_out))
        check("Python idempotent: %s" % name,
              py_fmt.format_config_text(py_out) == py_out)
        if not with_node:
            continue
        js_out = dump_js_output(path)
        check("JS == Python: %s" % name, js_out == py_out, first_diff(py_out, js_out))


def main():
    with_node = node_available()
    if with_node:
        js_tables = dump_js_tables()
        compare_tables(js_tables)
        compare_number_tables(js_tables)
    else:
        print("   Hinweis: node nicht gefunden — nur Python-Seite geprueft.")
    compare_output(with_node)

    print("bestanden: %d | fehlgeschlagen: %d" % (PASSED[0], len(FAILURES)))
    if FAILURES:
        for item in FAILURES:
            print("  FEHLER: " + item)
        return 1
    print("FORMAT-PARITAET BESTANDEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
