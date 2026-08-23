# Release Notes Plant Factory V62.1

## Zusammenfassung

V62.1 konsolidiert die Bedienoberfläche der Plant Factory, ohne den in V61.1
freigegebenen Objektstandard **PF-PID-V1** oder bestehende Projektmodelle zu
verändern. Schwerpunkt sind verlässliche modale Dialoge, ein vollständiger
Verbindungseditor, ein sichtbarer Inspector-Rail, ein kontextsensitives
Rechtsklickmenü und ein geführtes HMI-Setup.

## Behobene Fehler

### Verbindung bearbeiten

Die Verbindungskarte erzeugte den Bearbeiten-Button historisch mit einem
Inline-Ereignishandler. Die aktive Content-Security-Policy erlaubt ausschließlich
lokale Skriptmodule; der Inline-Handler wurde daher vom Browser blockiert. V62.1
verwendet sichere Ereignisdelegation über `data-connection-action` und öffnet
einen transaktionalen Modal-Editor.

Der Editor unterstützt:

- Start- und Zielobjekt;
- Verbindungstyp;
- semantischen Start- und Zielport;
- Beschriftung und Linienbreite;
- feste oder portgebundene Anker;
- fachliche Vorabvalidierung;
- Speichern als eine atomare History-Operation;
- Abbrechen ohne Modelländerung.

Ablehnungen sind fachlich differenziert:

- `incompatible_endpoints` für fehlende, identische oder strukturell ungültige
  Endobjekte;
- `incompatible_ports` für unzulässige Portart, Richtung oder
  Verbindungskategorie.

### Inspector im eingeklappten Zustand

Im 44-Pixel-Rail konkurrierten Überlaufmenü und Einblendeschalter um denselben
Layoutbereich. Der Einblendeschalter wird in V62.1 unabhängig vom erweiterten
Header zentriert, kontrastreich dargestellt und bleibt während des gesamten
Collapse-Zustands sichtbar, fokussierbar und anklickbar.

## PF-MODAL-V1

Alle echten Anwendungsdialoge der Klassen `.modal` und `.v9-modal` werden von
einem gemeinsamen Fenstermanager erweitert. Dies gilt auch für dynamisch
erzeugte Dialoge.

Unterstützt werden:

- Verschieben per Titelzeile, Maus und Touch;
- Größenänderung über einen Resize-Griff;
- Maximieren und Wiederherstellen;
- Zentrieren;
- Begrenzung auf den sichtbaren Browserbereich;
- Tastatursteuerung über Alt + Pfeiltasten, Alt + 0 und Alt + Enter;
- Escape, Fokusführung und Fokuswiederherstellung;
- einheitliche Light-/Dark-Theme-Darstellung.

Browser-native `alert()`, `confirm()` und `prompt()` werden im Produktcode nicht
mehr verwendet. Hinweise, Eingaben und Bestätigungen sind themenfähige
Anwendungsmodale. Das HMI-Canvas-Overlay und das Rechtsklickmenü bleiben bewusst
nicht modal, da sie den Workspace nicht sperren dürfen.

## PF-CANVAS-CONTEXT-V1

Die Engineering-Zeichenfläche kann vollständig per Rechtsklick bedient werden.
Das Menü unterscheidet zwischen Zeichenfläche, Prozessobjekt und Verbindung.

Objektaktionen umfassen Eigenschaften, I/O-/Runtime-Binding, HMI-Widget,
HMI-Datenbindung, neue Verbindung, bestehende Verbindungen und Löschen.
Verbindungsaktionen umfassen Bearbeiten, Start-/Zielobjekt auswählen und
Löschen. Zeichenflächenaktionen umfassen Einpassen, Raster, Snap, HMI-Ebene,
Undo, Redo und Auswahlaufhebung.

Das Kontextmenü verwendet `role="menu"`, ist mit Pfeiltasten, Pos1, Ende und
Escape bedienbar und löst keinen unbeabsichtigten Objekt-Drag aus.

## PF-HMI-SETUP-V2

Das vorhandene HMI-Datenmodell bleibt unverändert, die Bedienung wird jedoch in
vier verständliche Schritte gegliedert:

1. **Widgets** — explizite Anzeige- oder Bedienelemente anlegen;
2. **Datenbindung** — Widget, P&ID-/SVG-Objekt und Runtime-Quelle koppeln;
3. **Zustände & Alarme** — visuelle Reaktionen, Grenzwerte und Alarmverhalten
   konfigurieren;
4. **Darstellung** — View-Hintergrund und Widget-Design finalisieren.

Jeder Schritt besitzt eine Erklärung, einen Bestandsstatus und eine
Vor-/Zurücknavigation. Der Datenfluss wird als
`Widget → P&ID-/SVG-Objekt → Runtime-Quelle / Interaktion` dargestellt.
Buttons und Toggle bleiben optional und werden niemals automatisch beim
Einfügen eines Prozessobjekts erzeugt.

## Kompatibilität

V62.1 erhält vollständig:

- PF-PID-V1 mit 25 kanonischen Symbolen;
- Legacy- und Custom-SVG-Objekte;
- Entity-IDs, TAGs, Geometrie, Ports und Verbindungen;
- V9-/V8-Bindings und Runtime-Konfiguration;
- Animationen und HMI-Animationstargets;
- Widgets, Bindings, Styles, Alarme und Interaktionen;
- History, Snapshots, Verifikation, Projekt- und Exportformate;
- SVG- und JSON-Ausgabe aus demselben Projektmodell.

## Test- und Betriebsgrenze

Die Freigabekette befindet sich in `test_all.sh`; das maschinenlesbare Ergebnis
steht in `docs/v62_1/RELEASE_MANIFEST_V62_1.json`. Virtuelle Python-Umgebungen,
`site-packages`, Node-Abhängigkeiten und temporäre Release-Arbeitsbereiche werden
von den projektspezifischen Architekturprüfungen ausgeschlossen, bleiben aber
als Laufzeitabhängigkeiten funktional getestet.

V62.1 ist eine Software-Baseline. Vor der Freigabe an einer realen Anlage sind
weiterhin FAT/SAT, I/O-Punktprüfung, Safety- und Security-Betrachtung sowie die
Abnahme mit der konkreten SPS-/SCADA- und Netzwerkinfrastruktur erforderlich.

## Finales Freigabeergebnis

Der finale Releasezustand wurde sowohl im Entwicklungsverzeichnis als auch aus
einem frisch extrahierten, prüfsummenkontrollierten Archiv vollständig geprüft.
Bestanden wurden unter anderem 31/31 PF-PID-V1-Prüfungen, 145/145 V9-Kerntests,
31/31 Plant-Factory-Prüfungen, 52/52 Snapshot-Prüfungen, 29/29 Prüfungen gegen
die bereitgestellte `automation_system_v0101`-Runtime, 119/119 bestehende
Chromium-Prüfungen und 45/45 neue V62.1-Interaktionsprüfungen.

Das Archiv enthält 303 Dateien und 302 interne SHA-256-Prüfsummen, keine
Symlinks, keine virtuellen Umgebungen, keine Node-Abhängigkeiten, keine
Python-Caches und keine unsicheren Archivpfade. Ein zweiter deterministischer
Build ist byte-identisch.
