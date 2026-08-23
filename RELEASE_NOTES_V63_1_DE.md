# Release Notes Plant Factory V63.1

## Zusammenfassung

V63.1 integriert den additiven Function-Block-/Schaltlogik-Editor
**PF-LOGIC-V1** in die bestehende Plant Factory. P&ID-/Plant-Editor, HMI-Editor,
Logic-/FBD-Editor und Runtime-Export sind getrennte Sichten auf dasselbe
kanonische Projektmodell. Bestehende Projekte benötigen keinen Logic-Graphen
und bleiben ohne Migration ihrer bisherigen Inhalte lauffähig.

## PF-LOGIC-V1

Der neue Logikarbeitsbereich stellt 33 Bausteine bereit:

- Signale und Bindings;
- BOOL-, INT-, REAL- und TIME-Konstanten;
- NOT, AND, OR und XOR;
- Gleichheit, Ungleichheit sowie größer/kleiner mit Grenzfällen;
- IEC-Timer TON, TOF und TP;
- Zähler CTU und CTD;
- Addition, Subtraktion, Multiplikation, Division, Minimum, Maximum und Limit;
- Process-State-, Parameter-, Notify-, Aktor-, HMI- und interne Signalausgänge.

Die Ports sind typisiert. Nicht kompatible Verbindungen und kombinatorische
Zyklen werden vor dem Export fail-closed abgelehnt. Zustandsbehaftete Timer und
Zähler werden im universellen Runtime-Layer deterministisch gespeichert.

## Gemeinsames kanonisches Modell

Die einzige editierbare Logikquelle ist `project.logic`. Der Graph referenziert
vorhandene Entities und Runtime-Objekte über stabile Signalpfade. SVG-Geometrie,
HMI-Layout, TAG-Beschreibungen und physische Feldbusdetails werden nicht in den
Logikgraphen kopiert.

Abgeleitete Zielartefakte werden bei jedem Export neu erzeugt. Der Compiler
verhindert mehrere unabhängige Writer auf dasselbe Ziel. Ein zweiter Writer ist
nur im expliziten `hybrid`-Modus erlaubt und wird durch Priorität und stabile
Quellidentität deterministisch arbitriert.

## Automation_System V9 und V8 Cross

Der strikte V9-Vertrag mit 26 Sektionen bleibt unverändert. Darstellbare
kombinatorische Logik wird als abgeleitete Einträge in `rules` kompiliert und
über `rule_engine` auf vorhandene `process_states` beziehungsweise Aktionen
bezogen. Timer, Zähler, numerische Pipelines und direkte Feldbus-/HMI-Aktionen,
die nicht verlustfrei in den flachen Regelvertrag passen, werden transparent
als Bridge-Bausteine im Kompatibilitätsbericht ausgewiesen.

Cross-Worker-Regeln werden getrennt in V8-Cross-Shards erzeugt. Transportiert
werden nur `controller_uuid` und lokale I/O-Identitäten sowie logische
Node-/Site-Routen. Host, Port, Unit und Feldbusadresse werden erst am besitzenden
Node aufgelöst.

## Siemens-/PLC-Kompatibilität

Der SCL-Compiler erzeugt IEC-nahe Funktionsbausteine mit typisierten Ein- und
Ausgängen. TON, TOF, TP, CTU und CTD werden als IEC-Bausteine ausgegeben. Ein
separates CSV ordnet kanonische Signalreferenzen deterministisch PLC-Tags zu.
Die Ausgabe ist ein Integrationsartefakt und ersetzt keine TIA-Portal-
Hardwarekonfiguration oder Safety-Abnahme.

## UI/UX

Die Hauptnavigation besitzt einen eigenen Bereich **Logik**. Das Inventar ist
in **Schaltpläne**, **Bausteine** und **Signale** gegliedert. Die Zeichenfläche
unterstützt Auswahl, Drag-and-drop, Verschieben, Portverbindungen, Zoom,
Einpassen, Undo/Redo und kontextsensitive Rechtsklickmenüs. Der Inspector trennt
Details, Binding, Ziel und Diagnose. Schaltplan- und Compilerfenster verwenden
den geerbten interaktiven Modalstandard PF-MODAL-V1.

## Behobene Integrationsfehler

Während der Browserverifikation wurden zwei konkrete Kopplungsfehler gefunden
und behoben:

- Der Router setzte zwar den Logic-Modus, entfernte aber das native `hidden`-
  Attribut des neuen Workspace nicht. Der Workspace wird nun bei jeder Route
  explizit ein- beziehungsweise ausgeblendet.
- Der lokale UI-Helfer normalisierte beim Zugriff auf den aktiven Schaltplan ein
  zweites Mal. Mutationen wirkten dadurch auf eine Kopie und gingen beim Commit
  verloren. Der aktive Schaltplan wird nun direkt aus dem bereits normalisierten
  Modell aufgelöst; Drag, Inspectoränderungen und andere Graphmutationen werden
  dauerhaft gespeichert und von Undo/Redo erfasst.

## Rückwärtskompatibilität

V63.1 erhält vollständig:

- PF-PID-V1 mit 25 kanonischen Symbolen;
- Legacy- und Custom-SVG-Objekte;
- Entities, TAGs, Geometrie, Ports und Prozessverbindungen;
- V9-/V8-Bindings und bisherige Runtime-Konfigurationen;
- HMI-Widgets, Bindings, Styles, Alarme und Animationen;
- PF-MODAL-V1, PF-CANVAS-CONTEXT-V1 und PF-HMI-SETUP-V2;
- History, Snapshots, Verifikation, Projekt- und SCADA-Exportformate.

## Verifikation und Releaseintegrität

Die vollständige Freigabe umfasst 17 Release-Stufen. Besonders relevant sind:

- PF-PID-V1: 31/31;
- PF-LOGIC-V1 JavaScript: 66/66;
- PF-LOGIC-V1 Python-Runtime und Automation-System-Adapter: 35/35;
- statischer V63.1-Releasevertrag: 75/75;
- V9-Kern: 145/145;
- Plant-Factory-Modellkette: 31/31;
- Snapshot-Kette: 52/52;
- externe `automation_system_v0101`-Runtime: 29/29;
- Chromium-Basisvertrag: 119/119;
- geerbte V62-Interaktionen: 45/45;
- neue V63-Logic-Interaktionen: 51/51.

Das Releasearchiv enthält 335 Dateien und 334 interne SHA-256-Einträge. Es
enthält keine virtuellen Umgebungen, Node-Abhängigkeiten, Python-Caches,
Symlinks, absoluten Pfade oder Traversal-Einträge. Ein zweiter deterministischer
Build ist byte-identisch. Die Freigabe wurde zusätzlich aus einem frisch
extrahierten Archiv wiederholt.

## Betriebsgrenze

V63.1 ist eine geprüfte Software-Baseline. Vor der Verwendung an einer realen
Anlage sind weiterhin FAT/SAT, reale I/O-Punktprüfung, Safety- und
Security-Betrachtung sowie die Abnahme mit der konkreten SPS-/SCADA-, Feldbus-
und Netzwerkinfrastruktur erforderlich.
