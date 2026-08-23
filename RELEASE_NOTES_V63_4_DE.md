# Plant Factory V63.4 – Release Notes

## Zweck

V63.4 ist ein minimal-invasives HMI-UX-Release auf der vollständig kompatiblen
V63.3-Basis. Das kanonische Projektmodell, die Widget-/Binding-Strukturen,
PF-PID-V1, PF-LOGIC-V1, die Automation-V9-Bridge sowie alle Runtime- und
Exportpfade bleiben unverändert.

## Änderungen

### Eindeutige HMI-Navigation

Die nummerierten Schritte **Widgets**, **Datenbindung**, **Zustände & Alarme**
und **Darstellung** sind nun die einzige sichtbare HMI-Navigation. Die ältere
zweite Tabzeile bleibt für geerbte Selektoren und Integrationen im DOM, ist
jedoch als reiner Kompatibilitätshaken verborgen.

Die sichtbare Tablist unterstützt Maus, Touch sowie Pfeiltasten, Pos1 und Ende.
`aria-selected`, `aria-controls` und ein roving `tabindex` bilden den aktiven
Schritt eindeutig ab.

### Widgetregister

Klickbare Widgetnamen werden als kompakte Aktionsbuttons statt als Links
dargestellt. Akzentfarbe, aktive Zeile, vollständige Namen, Tooltips und die
bestehende Auswahlfunktion bleiben erhalten.

### Zustände & Alarme

Der bisherige Funktionsumfang wurde in drei Ebenen geordnet:

1. **Signal testen** – Live-Simulation und Wertebereich;
2. **Grenzwerte, Zustände und Alarm in einem Schritt** – empfohlener Workflow;
3. **Erweiterte manuelle Bearbeitung** – vollständige Style- und Alarmeditoren.

Der Grenzwert-Wizard führt sichtbar über Binding, Schwellen, Ausgabe und
Erzeugung. Latching, Quittierung sowie sämtliche Overlay- und SVG-Klassen
bleiben im erweiterten Bereich konfigurierbar.

### Darstellung

Der Tab ist jetzt in drei fachliche Schritte gegliedert:

1. View-Hintergrund;
2. zu gestaltendes Widget;
3. Grunddesign, Farben, Schrift und optionale Klassen.

Eine Kontextübersicht zeigt Widget, P&ID-/SVG-Objekt und Datenstatus gemeinsam.
Es wurden keine Konfigurationsfelder entfernt oder umbenannt.

## Kompatibilität

- keine Änderung an `project.hmi.hmi_ui.widgets`;
- keine Änderung an `project.hmi.hmi_ui.bindings`;
- keine Änderung an Styles, Alarmen, Animationen oder Runtime-Sources;
- keine automatische Widget-Erzeugung;
- keine Änderung an V9, V8-Cross, PF-LOGIC-V1 oder Siemens-SCL;
- alle V63.3-I/O-, Symbol- und Widget-/Objektfunktionen bleiben erhalten.

## Freigabe

Die vollständige 20-stufige Releasekette wurde im Quellbaum und nochmals aus
dem unveränderten finalen ZIP bestanden. Der V63.4-Statischvertrag besteht mit
74/74 Prüfungen; die gesamte Chromium-Kette besteht mit 377/377 Prüfungen bei
null Konsolen-, Seiten- oder Requestfehlern. Die externe
`automation_system_v0101`-Autorität besteht mit 29/29 Prüfungen.

Das Archiv enthält 387 Dateien und 386 interne SHA-256-Einträge. Zwei
deterministische Builds sind byte-identisch; Pfadsicherheit, Symlinkfreiheit,
Ausführungsrechte und Fresh-Extract-Verifikation sind bestanden.
