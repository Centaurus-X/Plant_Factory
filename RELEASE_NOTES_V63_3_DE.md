# Release Notes Plant Factory V63.3

## Zweck

V63.3 ist ein minimal-invasives UX- und Bibliotheksrelease auf Basis von
V63.2. Der Stabilitätsvertrag PF-V63.2-STABILITY, PF-PID-V1, PF-HMI-SETUP-V2,
PF-LOGIC-V1 und PF-AUTOMATION-V9-BRIDGE bleiben erhalten.

## I/O-Editor

- **Zuweisung speichern** und **Zuweisung entfernen** stehen direkt
  nebeneinander.
- Eine eindeutige Canvas-Auswahl bleibt automatisch mit dem I/O-Formular
  synchronisiert.
- Das Register **Aktuelle Zuordnungen** startet eingeklappt.
- Einträge werden in einer stabilen, responsiven Tabelle dargestellt.
- Lange Element-IDs und Aliase werden optisch gekürzt; der vollständige Wert
  bleibt als Tooltip und im Projektmodell verfügbar.

## Symbolbibliothek

PF-PID-V1 enthält jetzt 26 kanonische Templates. Neu ist:

```text
Generic_Sensor_Entity — Generische Sensor-Entität — Kategorie Messstellen
```

Die Entity besitzt standardisierte Prozess-, Signal- und Datenports und wird
bei der I/O-Zuweisung auf den konkreten V9-Sensor abgebildet. Sie erzeugt kein
automatisches HMI-Widget.

## HMI-Widget-Workflow

- Die Widgettabelle steht vollbreit direkt unter der Einleitung von Schritt 1.
- Sie zeigt Widget, Typ, P&ID-/SVG-Objekt, Quelle/Interaktion und ID.
- Beim Anlegen kann optional ein Objekt aus dem Dropdown oder aus der aktuellen
  Canvas-Auswahl übernommen werden.
- Widget und Objektbinding werden atomar gespeichert.
- Eine vorhandene Sensor-/Aktorzuweisung wird als passende Quelle vorbelegt.
- Der Widgeteditor zeigt die Relation und führt direkt zum Bindingeditor.
- Buttons, Toggle und Slider bleiben explizit und optional.

## Kompatibilität

V63.3 erhält vollständig:

- alle V63.2-Stabilitätskorrekturen;
- bestehende Projekte und Projektformate;
- 25 bisherige PF-PID-V1-Symbole sowie Legacy-/Custom-SVGs;
- I/O-Zuweisungen und V9-/V8-Cross-Runtimekonfiguration;
- HMI-Widgets, Bindings, Styles, Alarme und Animationen;
- PF-LOGIC-V1 und alle Runtime-/PLC-Zieladapter;
- Automation-System-V9-Bridge, Process States, Filter, Timer, Rule Engine und
  Rules;
- Modale, Kontextmenüs, Undo/Redo, Snapshots und Exporte.

## Verifikation

V63.3 erweitert die Freigabekette um einen eigenen statischen Vertrag, einen
Widget-/Objekt-Relationstest und einen Chromium-Regressionslauf. Die finale
Freigabe umfasst Quellbaum, externe Runtime-Autorität, Fresh-Extract-Test,
deterministischen Doppelbuild, Archiv-Sicherheitsprüfung und interne
SHA-256-Prüfsummen.

Die konkreten Zähler und Archivdaten stehen in:

- `docs/v63_3/RELEASE_MANIFEST_V63_3.json`;
- `V63_3_VERIFICATION_SUMMARY.txt`;
- `V63_3_FRESH_EXTRACT_TEST_LOG.txt`.

## Finaler Freigabestatus

Die vollständige 19-stufige Prüfkette ist bestanden. Der externe
Runtime-Vertrag bestand 29/29 Prüfungen; die Chromium-Suiten bestanden
zusammen 320/320 Interaktionsprüfungen. Der Releasebau ist deterministisch,
das Archiv ist pfadsicher und alle internen SHA-256-Prüfsummen sind gültig.
