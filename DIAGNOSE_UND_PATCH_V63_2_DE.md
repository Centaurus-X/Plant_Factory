# Tiefe Diagnose und Patchbericht V63.2

## 1. Ausgangslage

V63.1 war funktional vollständig, zeigte im praktischen Einsatz aber vier
Lifecycle- und Darstellungsfehler. Zusätzlich war im Automation-Bereich noch
ein historischer Editor sichtbar, obwohl der V9-Vertrag bereits
`process_states`, `filters`, `timers`, `rule_engine` und `rules` als
kanonische Runtime-Struktur verwendet.

## 2. Diagnose „Verbindung erstellen“

### Ursache

Der allgemeine PF-MODAL-V1-Manager bewahrt absichtlich die Größe und Position
eines Fensters. Für einen kleinen Formular-Dialog war das ungünstig: Eine
vorherige Maximierung oder Resize-Operation konnte beim nächsten Öffnen eine
überdimensionierte Geometrie hinterlassen.

### Patch

Der Dialog erhält deklarative Default-Geometrie:

```text
data-window-reset-on-open="true"
data-window-default-width="620"
data-window-default-height="auto"
```

Der Modalmanager setzt nur bei entsprechend markierten Dialogen Maximierung,
Inline-Größe und Offset zurück. Andere modale Fenster behalten ihr bisheriges
Verhalten.

## 3. Diagnose sporadisch erscheinender Verbindungslinien

### Ursache

Die Modellverbindungen waren bereits geladen. Ihre SVG-Pfade wurden jedoch in
einigen Ladefolgen berechnet, bevor alle Symbole eine gültige Bounding Box und
Screen-Transformationsmatrix besaßen. Beim späteren Objektverschieben wurde
die Pfadberechnung erneut ausgeführt und die bereits vorhandene Linie dadurch
erstmals sichtbar.

### Patch

`connection_mapper.js` verwendet nun einen deterministischen Layoutvertrag:

1. Verbindungselement mit `data-render-state="pending"` erzeugen.
2. Zwei Layoutzyklen abwarten.
3. CTM, Bounding Box und alle Koordinaten auf Gültigkeit prüfen.
4. Bei noch nicht fertigem Layout begrenzt und abbrechbar erneut versuchen.
5. Nur einen endlichen, gültigen SVG-Pfad als `ready` sichtbar schalten.
6. Bei einem neuen Rebuild ältere Retry-Zyklen über eine Epoch-ID abbrechen.

Die Modellliste `state.connections` wird dabei nicht verändert. Der Patch
betrifft ausschließlich die Darstellung bereits gespeicherter Verbindungen.

## 4. Diagnose I/O-Auswahlsynchronisierung

### Ursache

Der I/O-Editor aktualisierte zwar seine Optionsliste nach einem Rebuild, setzte
aber den Select-Wert nicht auf die aktive Canvas-Auswahl. Deshalb musste das
Objekt erneut manuell ausgewählt werden.

### Patch

Bei genau einer selektierten Entity wird der I/O-Editor an folgenden Punkten
synchronisiert:

- `selection:changed`;
- `elements:rebuilt`;
- `history:restored`;
- Initialisierung nach Projektladung.

Danach wird die bestehende Zuweisung über denselben kanonischen
`populateFromExisting()`-Pfad geladen. Es existiert keine zweite Feldlogik.

## 5. Diagnose verschwundener eigener Schaltpläne

### Ursache

Die frühere Demo-Funktion erzeugte ein vollständiges Demomodell und ersetzte
damit den gesamten Wert von `project.logic`. Das war ein echter destruktiver
Modellersatz.

### Patch

V63.2 erzeugt nur das Demo-Diagramm und fügt es in das vorhandene normalisierte
Modell ein. Die stabile ID `logic_timer_counter_demo` verhindert Duplikate.
Beim erstmaligen Einfügen entsteht ein History-Eintrag; ein reiner Wechsel zur
vorhandenen Demo verändert das Modell nicht.

## 6. Automation-Drift

### Diagnose

Es gab drei fachlich unterschiedliche Ebenen:

- projektseitige Process States;
- projektseitige dynamische Regeln;
- die geladene oder exportierte V9-Runtime-Projektion.

Der historische Bereich `automation_rule_sets` konnte als vierte, konkurrierende
Bearbeitungsquelle erscheinen. Das widersprach der Single-Source-of-Truth-
Architektur.

### Patch

`automation_contract.js` normalisiert alte Daten verlustfrei:

- aktive `automation_rule_sets` werden geleert;
- ihre Inhalte werden dedupliziert nach `legacy_automation_rule_sets`
  verschoben;
- `dynamic_rule_engine.rule_sets` bleibt die einzige editierbare
  Projektregel-Autorität;
- V9 `rule_engine` und `rules` bleiben die Runtime-Sicht;
- `project.logic` bleibt die einzige editierbare grafische Logikquelle.

## 7. Minimal-invasiver Umfang

Unverändert bleiben insbesondere Objektgeometrie, Symbolbibliothek,
Projektdateiformat, HMI-Datenmodell, Logic-Core, V9-Sektionsvertrag,
V8-Cross-Grenzen, Runtime-Adapter und bestehende Exportdateien. Neue
Normalisierung wird nur an den Projektlade-/Speichergrenzen angewendet.

## 8. Regression und Freigabe

Die V63.2-Prüfung umfasst statische Verträge, Generatorreproduzierbarkeit,
Modelltests, Browserinteraktionen, externe Runtime-Autorität, deterministischen
Doppelbuild und eine vollständige Wiederholungsprüfung aus einem frisch
extrahierten Archiv. Die konkreten Ergebnisse stehen in
`docs/v63_2/TEST_UND_FREIGABE.md` und im maschinenlesbaren Release-Manifest.
