# Release-Testprotokoll V60.1

## 1. Freigabekommando

```bash
./test_all.sh
```

Die Prüfung ist fail-fast, räumt temporäre Dateien und Serverprozesse über
`trap` auf und entfernt erzeugte `__pycache__`-Verzeichnisse.

## 2. Ergebnisübersicht

| Stufe | Prüfung | Ergebnis |
|---:|---|---|
| 1 | Python-Syntax und funktionaler Stil | bestanden |
| 2 | JavaScript-Syntax und funktionaler Stil | bestanden |
| 3 | statisches Markup und V60-Mergevertrag | bestanden |
| 4 | Security und isolierte HTTP-API | bestanden |
| 5 | konsolidierter SVG-Konverter | bestanden |
| 6 | JavaScript-Regressionssuite | 270/270 |
| 7 | Python-/JavaScript-Formatparität | 58/58 + 42/42 |
| 8 | reproduzierbarer Config-Build | byte-identisch |
| 9 | deterministische Migration | bestanden |
| 10 | V9-Node-/V8-Cross-Shard-Split | 2 lokal + 1 cross |
| 11 | Regel- und Prozessbibliotheken | deterministisch |
| 12 | Regelvertrag und optionale Runtime-Autorität | 15/15 |
| 13 | Plant-Factory-End-to-End-Modellkette | 31 + 52 + 145 Prüfungen |
| 14 | Serverstart und Chromium-Smoke | 88/88 |
| 15 | abschließende Repository-Prüfung | bestanden |

Gesamtergebnis:

```text
ALL V60.1 RELEASE CHECKS PASSED
```

## 3. Stil-Gates

### Python

`_tools/check_functional_style.py` parst alle Python-Dateien und verbietet:

- Klassen;
- Lambda-Ausdrücke;
- Decorators.

### JavaScript

`_tools/check_js_functional_style.cjs` verwendet die TypeScript-AST und
verbietet in `.js`, `.mjs` und `.cjs`:

- Klassen und Klassenexpressionen;
- Methodendeklarationen;
- Arrow Functions.

Zusätzlich läuft `node --check` über alle JavaScript-Test-, Tool- und
Produktionsdateien.

## 4. Markup- und Mergevertrag

`test/test_markup.py` prüft:

- eindeutige HTML-IDs;
- vorhandene `label for`-Ziele;
- gültige ARIA-Referenzen;
- vorhandene lokale CSS-/JS-Assets;
- gültige Iconreferenzen;
- vorhandene lokale Fonts;
- Einbindung der V60.1-Schichten;
- fünf korrekt ausgezeichnete Dialoge;
- assistiv angekündigte Statusmeldungen.

`test/test_v60_merge.py` prüft:

- Releasekennung `60.1` / `60.1.0`;
- sichtbare V60.1-Kennung;
- sichere Standardbindung;
- vollständige Merge-UI-Funktionen;
- XML-Parsebarkeit sämtlicher Projekt- und Template-SVGs;
- vollständigen SVG-Bestand;
- funktionalen Python-/JavaScript-Stil;
- V9-Vertrag und fünf Controller.

## 5. Security-Tests

`test/test_security.py` verifiziert isoliert:

- Entfernung von `script` und `foreignObject`;
- Entfernung von Eventattributen;
- Entfernung externer Ressourcen und CSS-URLs;
- Erhalt lokaler Fragmentreferenzen;
- XML-Gültigkeit nach Sanitisierung;
- Erhalt eingebetteter Config-Snapshots;
- Ablehnung von `DOCTYPE`;
- sichere Metadatenkommentare;
- sichere Projektnamen;
- atomare Textschreibvorgänge;
- Localhost-Default;
- YAML-Listen und leere Inline-Listen.

`test/test_server_api.py` startet die Anwendung vollständig isoliert mit
temporären Projekt- und Exportverzeichnissen. Geprüft werden:

- Editor-Einstieg;
- Security Header;
- Template-API;
- V9-Config-API;
- sanitizierter Export;
- traversal-sicherer Exportname;
- atomare Projektspeicherung;
- Pfadbegrenzung;
- vollständiges Wiederladen.

## 6. SVG-Konverter

`test/test_svg_converter.py` prüft:

- funktionalen Konverterkontext;
- deterministische Dateinamen;
- reale Konvertierung eines Beispiels;
- Zielgröße 64 × 64 für Icons;
- eindeutige Animations-IDs;
- genau einen geeigneten `defs`-Container;
- Delegation des Kompatibilitätsstarters.

## 7. Fach- und Formatprüfungen

Die bestehende fachliche Testbasis bleibt vollständig erhalten:

- V9-Kern: 145 Prüfungen;
- JavaScript-Format: 42 Prüfungen;
- Plant Factory: 31 Prüfungen;
- Snapshot: 52 Prüfungen;
- Python-Formatparität: 58 Prüfungen;
- Regelvertrag: 15 Prüfungen.

Der Config-Rebuild bildet Hashes vor und nach `build_config.sh` und verlangt
einen leeren Diff. Migration und Controller-UUIDs werden gegen die
Release-Fixture geprüft.

## 8. Browser-Smoke

Geprüfte Bedienpfade:

- HTTP-Start und sichtbare Version;
- keine Page-, Request- oder Konsolenfehler;
- Workspace- und V60-CSS;
- Symbolbibliothek, Favoriten, Minimap und Inspector-Apply;
- vier Canvas-Routen;
- acht globale Routen;
- korrekter Wechsel zwischen Canvas- und Vollbreitenmodus;
- Preview → HMI;
- Projektliste und Projektladung;
- reale klickbare SVG-Geometrie;
- Auswahlstatus und Auswahl-Chip;
- Chip innerhalb der Canvasgrenze;
- Dark Mode und Palettenwechsel;
- Shortcut-Hilfe und Escape;
- responsive Kopfzeile und Canvas bei 1366 × 768;
- Laden und Export im Header-Menü.

### Administrativ blockiertes Chromium

Bei `ERR_BLOCKED_BY_ADMINISTRATOR` wird ein hermetischer Modus verwendet. Der
Fallback ersetzt keine Anwendungslogik. Er lädt dieselben acht Stylesheets,
dieselben 14 Entry-Module und insgesamt 35 echte Frontendmodule; API-Aufrufe
werden an den gestarteten lokalen Server weitergeleitet. Jede andere
Browserstörung bleibt ein Fehler.

## 9. Externe Runtime-Autorität

Ohne externe Runtime erscheint:

```text
Hinweis: Runtime nicht im PYTHONPATH — Tiefprüfung übersprungen.
```

Mit Runtime:

```bash
AUTOMATION_RUNTIME=/pfad/zu/automation_system_v0101 ./test_all.sh
```

Die acht bekannten `filter_id`-Hinweise bleiben unabhängig davon sichtbar.

## 10. Einzelkommandos

```bash
python3 _tools/check_functional_style.py
node _tools/check_js_functional_style.cjs
python3 test/test_markup.py
python3 test/test_v60_merge.py
python3 test/test_security.py
python3 test/test_server_api.py
python3 test/test_svg_converter.py
npm test
python3 test/test_format_parity.py
node test/test_v9_format.mjs
python3 test/test_rule_contract.py
python3 test/smoke_ui.py http://127.0.0.1:8090
```

Der Browser-Smoke erwartet einen laufenden Server. `test_all.sh` übernimmt
Start, Readiness-Prüfung und Cleanup automatisch.
