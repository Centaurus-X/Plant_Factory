# Plant Factory V64_r6 — interne Produkt- und Architektur-Dokumentation

## Aktueller additiver Stand V64_r6

Diese Datei dokumentiert weiterhin die gewachsene Basisarchitektur. Der
aktuelle Release V64_r6 ergänzt sie ohne Schemawechsel um:

- sichtbare, tastaturbedienbare Kategoriennavigation im Anlagen-Inventar;
- strukturierte Zeichenbaugruppen, die im Anlagenbild wieder als einzelne
  Geräte und Verbindungen eingesetzt werden;
- eine passive Layoutschicht für Maße, Bereiche und Beschriftungen;
- den gebündelten **Anlagen Entwurf** mit 31 Entities, 14 Verbindungen und
  45 Zeichenelementen;
- einen expliziten Migrationsweg für passende ältere flache Entwürfe.

Normativ sind **RELEASE_NOTES_V64_R6_DE.md**,
**DIAGNOSE_UND_RELEASE_V64_R6_DE.md** und **docs/v64_r6/**. Die folgenden
Abschnitte beschreiben die vollständig erhaltene PF-PID-, HMI-, Logik-,
Automation- und V9-Basis.


## 1. Produktauftrag

Plant Factory V63.2 ist ein lokaler Engineering-Workspace für HMI-, P&ID- und
Automatisierungsmodelle. Die Anwendung verbindet SVG-basierte Anlagenbilder mit
V9-Bindings, Prozessmodellen, Regeln, Topologie, Validierung, HMI-Widgets,
Snapshots und Exporten.

Der verbindliche Objektvertrag lautet **PF-PID-V1, Version 1.0**. Er legt fest,
wie Prozessobjekte geometrisch dargestellt, verbunden, beschriftet,
konfiguriert und zur Laufzeit visualisiert werden.

## 2. Verbindlicher Objektstandard PF-PID-V1

Jedes Standardobjekt besitzt:

- ein kanonisches Geometrieprofil und ein stabiles Seitenverhältnis;
- nicht skalierende Konturen und semantische SVG-Rollen;
- relative Ports mit eindeutiger Kennung, Art, Richtung und Funktion;
- eine strukturierte Beschriftung aus TAG und Klartext;
- einen definierten Laufzeitzustand;
- persistente IDs und vollständig erhaltene Fach-, Binding- und
  Erweiterungsdaten.

Die 25 kanonischen Symbole werden deterministisch durch
`_tools/build_symbol_standard.py` erzeugt. Quelle des Vertrags ist
`config/symbol_standard_v1.json`; das ausgelieferte Bibliotheksinventar steht
in `public/svg_templates/library_manifest_v1.json`.

Ausführliche Normen und Migrationsregeln:

- `docs/v61_1/OBJEKTSTANDARD_PF_PID_V1.md`
- `docs/v61_1/MIGRATION_UND_KOMPATIBILITAET.md`

## 3. Nicht-destruktive Normalisierung

Normalisierung findet beim Erzeugen, Laden und Speichern statt. Sie ergänzt
fehlende Standardinformationen und korrigiert unsichere Standardwerte, ohne
fachliche Nutzdaten zu verwerfen.

Erhalten bleiben insbesondere:

- Position, Rotation, Skalierung und bewusst markierte Sondergeometrie;
- V9-/V8-Bindings, Controller-, Kanal- und Gerätezuordnungen;
- Animationen, Laufzeitwerte und Zustandszuordnungen;
- Verbindungen und bewusst definierte Sonderports;
- HMI-Modelle und explizite Widget-Bindings;
- Custom-SVG-Inhalte und unbekannte Erweiterungsfelder;
- History-, Projekt-, Snapshot- und Exportfähigkeit.

## 4. Verbindungsstandard

Verbindungen werden semantisch zwischen kompatiblen Ports aufgebaut. Der
Connection-Mapper wählt ein gültiges Portpaar, lehnt inkompatible Endpunkte ab
und erzeugt orthogonale Routen hinter den Prozessobjekten. Prozess-, Signal-,
Daten- und Energietypen bleiben voneinander unterscheidbar.

Die Persistenz speichert sowohl Entity-IDs als auch Port-IDs. Dadurch bleiben
Verbindungen nach Normalisierung, Laden, Verschieben, Skalieren und Export
stabil.

## 5. HMI- und Button-Policy

Das Ablegen eines Prozesssymbols erzeugt ausschließlich eine Engineering-
Entity. Es werden **keine** HMI-Widgets, Buttons oder Bindings automatisch
angelegt.

HMI-Elemente bleiben vollständig verfügbar, sind jedoch ausdrücklich optional:

1. Der Benutzer öffnet den HMI-Bereich bewusst.
2. Ein Widget wird explizit angelegt.
3. Ein Binding wird explizit gewählt oder konfiguriert.
4. Das Widget bleibt als `origin = explicit` und `auto_created = false`
   persistent.

Die Referenzanlage demonstriert genau zwei optionale Widgets: einen Indicator
und einen Button. Diese Richtlinie ist in Projektmodell, Manifest, Tests und
Browser-Smoke verankert.

## 6. Funktionale Architektur

Der ausführbare Produktcode verwendet funktionale Module und Factory-
Funktionen. Klassen, Decorators und Lambda-Ausdrücke sind durch Release-Gates
untersagt.

Zentrale Module:

| Modul | Verantwortung |
|---|---|
| `public/js/core.js` | API, Eventfluss, Zustand, History und gemeinsame Hilfen |
| `public/js/pid_standard.js` | ausführbarer PF-PID-V1-Vertrag und Normalisierung |
| `public/js/registry.js` | Bibliothek, Suche, Standardscope und Custom-Symbole |
| `public/js/elements.js` | Entity-Lebenszyklus, Ports, Geometrie und Canvasinteraktion |
| `public/js/connection_mapper.js` | Portkompatibilität, Routing und Verbindungspersistenz |
| `public/js/hmi.js` | explizite optionale HMI-Widgets und Bindings |
| `public/js/ui.js` | Projektladen, Speichern, Inspector und Anwendungskomposition |
| `public/js/v61_ui.js` | PF-PID-V1-Status, Overlaysteuerung und Standardbericht |
| `public/js/dialog_service.js` | Hinweise, Bestätigungen und Eingabedialoge nach PF-MODAL-V1 |
| `public/js/v62_ui.js` | Modalmanager, Inspector-Rail und Canvas-Kontextmenü |
| `public/js/logic_core.js` | kanonisches PF-LOGIC-V1-Modell und Typvertrag |
| `public/js/v63_logic_ui.js` | Logic-/FBD-Workspace, additive Diagramme und Compiler-UI |
| `public/js/automation_contract.js` | PF-AUTOMATION-V9-BRIDGE und Legacy-Migration |
| `svg_editor_tool.py` | gehärteter lokaler HTTP-Server und Projekt-/Template-API |


## 6.1 V62.1 Interaktionsstandards

Ab V62.1 gelten zusätzlich:

- **PF-MODAL-V1** für statische und dynamische Anwendungsdialoge;
- **PF-CANVAS-CONTEXT-V1** für Rechtsklickaktionen auf Objekt, Verbindung und
  freie Zeichenfläche;
- **PF-HMI-SETUP-V2** für die geführte Konfiguration von Widgets,
  Datenbindungen, Zuständen, Alarmen und Darstellung.

Die Standards sind additiv. Sie verwenden die bestehenden Domänencontroller
und ändern weder PF-PID-V1 noch das `hmi_ui`- oder Runtime-Datenmodell.


## 6.2 V63.1 Schaltlogikstandard

Ab V63.1 gilt zusätzlich **PF-LOGIC-V1**. Der Logic-/FBD-Editor ist eine
separate Sicht auf das kanonische Projektmodell und speichert ausschließlich
unter `project.logic`. Bestehende Entities, V9-I/O, `process_states`, Timer,
HMI-Widgets und interne Signale werden über stabile Signalreferenzen gebunden
und nicht dupliziert.

Der Standard umfasst:

- eigenes Inventar für Schaltpläne, Bausteine und Signale;
- 33 typisierte Function Blocks;
- zentrale Port-, Zyklus- und Writer-Validierung;
- Universal Runtime JSON und funktionalen Bridge-Layer;
- native V9-Regeln und getrennte V8-Cross-Ausgabe;
- Siemens-SCL und deterministisches PLC-Tag-Mapping;
- Ownership `direct`, `logic` und `hybrid` ohne zweite Wahrheit.

Verbindliche Spezifikation: `docs/v63_1/PF_LOGIC_V1_STANDARD.md`.

## 6.3 V63.2 Stabilitäts- und Automation-Vertrag

V63.2 ergänzt **PF-V63.2-STABILITY** und **PF-AUTOMATION-V9-BRIDGE**.
Die Änderungen sind additiv und verändern weder PF-PID-V1 noch PF-LOGIC-V1.

Verbindliche Regeln:

- der Verbindungsdialog startet kompakt und verwirft nur für diesen Dialog
  veraltete Fenstergeometrie;
- gespeicherte SVG-Verbindungen werden erst nach gültigem Layout als `ready`
  sichtbar, ohne das Modell zu verändern;
- eine eindeutige Canvas-Auswahl wird direkt in den I/O-Editor übernommen;
- die Timer-/Counter-Demo wird als zusätzlicher Schaltplan eingefügt und
  ersetzt niemals `project.logic`;
- Projekt-States leben ausschließlich unter `project.processes.process_states`;
- Projektregeln leben ausschließlich unter
  `project.dynamic_rule_engine.rule_sets`;
- grafische Schaltlogik lebt ausschließlich unter `project.logic`;
- `process_states`, `filters`, `timers`, `rule_engine` und `rules` bilden die
  kanonische V9-Runtime-Sicht;
- historische `automation_rule_sets` werden verlustfrei unter
  `legacy_automation_rule_sets` archiviert und nicht aktiv exportiert.

Normative Dokumente: `docs/v63_2/STABILITAETSVERTRAG.md` und
`docs/v63_2/AUTOMATION_V9_BRIDGE.md`.

## 7. Verzeichnisstruktur

```text
Automated_SVG_Integration_63_2/
├── config/                         # Server-, V9-, PF-PID- und PF-LOGIC-Verträge
├── docs/v61_1/                     # stabiler PF-PID-V1-Objektstandard
├── docs/v62_1/                     # geerbte Modal-, Kontext- und HMI-Verträge
├── docs/v63_1/                     # geerbte PF-LOGIC- und Runtimeverträge
├── docs/v63_2/                     # Stabilität, Automation-Bridge und Freigabe
├── projekte/                       # Referenz- und Benutzerprojekte
├── public/                         # Browseranwendung, CSS, JS und SVG-Templates
├── runtime_compat/                 # universeller Logik-Runtime-/Bridge-Layer
├── release_evidence/               # freigegebene visuelle Nachweise
├── test/                           # funktionale, fachliche und Browserprüfungen
├── _tools/                         # deterministische Build- und Prüfwerkzeuge
├── svg_editor_tool.py              # lokaler Server
├── test_all.sh                     # vollständige Freigabekette
└── VERSION                         # 63.2
```

## 8. Installation und Start

```bash
python -m pip install -r requirements.txt
./run.sh
```

Der Server bindet standardmäßig ausschließlich an `127.0.0.1`. Die konkrete
Adresse und der Port werden aus `config/server.yaml` gelesen.

## 9. Vollständige Verifikation

```bash
AUTOMATION_RUNTIME=/pfad/zu/automation_system_v0101 ./test_all.sh
```

Die Releasekette prüft Syntax, funktionalen Stil, Generatorreproduzierbarkeit,
SVG-Sicherheit, Objektstandard, API, Konverter, Konfiguration, Migration,
Sharding, Regeln, Plant-Factory-Modelle, Snapshots und einen hermetischen
Chromium-Browserlauf.

Verbindliche Ergebnisse und Freigabekriterien:

- `docs/v63_2/TEST_UND_FREIGABE.md`
- `docs/v63_2/RELEASE_MANIFEST_V63_2.json`
- `docs/v63_1/TEST_UND_FREIGABE.md`
- `docs/v62_1/TEST_UND_FREIGABE.md`
- `docs/v62_1/RELEASE_MANIFEST_V62_1.json`
- `docs/v61_1/TEST_UND_FREIGABE.md`
- `docs/v61_1/RELEASE_MANIFEST_V61_1.json`
- `release_evidence/README.md`

## 10. Betriebsgrenze

V63.2 ist eine geprüfte Software-Baseline. Eine reale Anlagenfreigabe erfordert
zusätzlich FAT/SAT, I/O-Punktprüfung, Safety-Betrachtung, Rollen- und
Rechtekonzept, TLS-/Netzwerkfreigabe, Backup/Restore, Monitoring und die
Abnahme mit der konkreten SPS-/SCADA-Hardware.
