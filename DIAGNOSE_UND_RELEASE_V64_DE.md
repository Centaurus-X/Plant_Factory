# Plant Factory V64 – Diagnose und Releasebegründung

## Auftrag und Ergebnis

Untersucht wurden die vollständige V63.4-Codebasis, ihre Projekt-, HMI-,
SVG-, Template-, Runtime-, Automation-V9-, V8-Cross- und Releasepfade sowie
drei animierte Referenzanlagen und deren Generatoren.

Das Ergebnis ist V64 als additive Erweiterung. Bestehende Funktionen wurden
nicht ersetzt. Zwei bislang getrennte Bereiche sind jetzt geschlossen:

1. SVG-Animationen reagieren auf dieselben Signale und Ereignisse wie HMI,
   Styles und Alarme.
2. Spezialisierte Anlagenskizzen lassen sich aus elementaren, verbindbaren
   Komponenten erstellen und kontrolliert in das Inventar übernehmen.

## Befund der drei Referenz-SVGs

| Datei | SVG-Elemente | SMIL-Elemente | IDs | semantische data-Ziele | Hauptzyklus |
|---|---:|---:|---:|---:|---:|
| PID_Anlage_animiert.svg | 219 | 66 | 3 | 0 | 24 s |
| Rohrofen_Template_animiert.svg | 148 | 46 | 0 | 0 | 30 s |
| Reaktor_PID_animiert.svg | 216 | 48 | 0 | 0 | 30 s |

Zusätzliche Sicherheitsmerkmale:

- keine Script-Elemente;
- keine Event-Handler;
- keine externen HTTP-Ressourcen;
- reine SVG-/SMIL-Darstellung.

Die Beispiele zeigen fachlich wertvolle Animationen:

- Zustands- und Temperaturfarben;
- Flussbewegung über Strichversatz;
- pulsierende Mess- und Alarmringe;
- Pumpenrotation;
- Ventilzustände;
- Füllstandsänderungen;
- wechselnde Messwerte;
- synchronisierte Prozessphasen.

Der entscheidende Mangel für eine reale HMI-Nutzung war nicht die Darstellung,
sondern die Adressierbarkeit: Bei null bis drei IDs und ohne semantische
data-Attribute lässt sich eine komplette Datei abspielen, aber ein einzelnes
Ventil, Rohrsegment oder Temperaturfeld kann nicht zuverlässig an ein echtes
Runtime-Signal gekoppelt werden.

## Befund der Generatoren

Die drei funktionalen Generatoren erzeugen die Geometrie deterministisch:

- build_pid_animation.py: 295 Zeilen, 24-s-Prozesszyklus;
- build_reactor_template_pid.py: 197 Zeilen, farbige, schlichte und animierte
  Varianten aus einer Geometriequelle;
- build_reactor_pid.py: 359 Zeilen, 30-s-Prozesszyklus.

Ihre SMIL-Helfer modellieren Zeitabläufe direkt im SVG. Diese Technik bleibt
für Demonstration und autonome Animation gültig, besitzt aber keine allgemeine
Schnittstelle für Sensor-, Aktor-, State-, Event-, Interaktions- oder
Alarmwerte.

## Befund der V63.4-Architektur

### Bereits tragfähig

- Registry und PF-PID-V1-Templatevertrag;
- semantische Objektports;
- SVG-Sanitizer und atomare Schreiboperationen;
- HMI-Widgets, Bindings, Styles, Alarme und Interaktionen;
- Zustandsklassen und einfache Animationseffekte;
- Projekt-Speichern/-Laden;
- SCADA-Bundle mit SVG, JSON, HTML und Runtime;
- Automation-V9-Export und V8-Cross-Projektion;
- Undo/Redo und additive Projektsektionen.

### Fehlende Kettenglieder

- kein allgemeiner Animationsregelvertrag;
- keine Runtime-Auswertung benannter SVG-Teilziele;
- kein UI für Trigger, Quelle, Bedingung, Teilziel und Effekt;
- keine Mitgabe einer separaten Event-Runtime im SCADA-Bundle;
- kein spezialisiertes elementares Zeichenmodell;
- keine kontrollierte Komposition einer Auswahl zu einer Inventar-Entity;
- kein Zeichenmodell in Projekt- und Runtime-/V9-Export.

## V64-Architekturentscheidung

### Eine Animationswahrheit

Die kanonische Regel liegt in **project.hmi.event_animations**. Export und
Runtime erhalten normalisierte Projektionen derselben Daten. Es gibt keine
zweite, unabhängige Animationskonfiguration.

Eine Regel besteht aus:

- stabiler animation_id;
- enabled und view_id;
- Trigger mit Typ, Quelle und Bedingung;
- Ziel mit element_id und optionalem part_selector;
- Effekt mit Typ, Farben, Dauer, Intensität und typspezifischen Parametern.

### Ein Konstruktionsmodell

**project.plant_drawing** speichert:

- Sheets;
- elementare Entity-Instanzen mit Template-ID;
- lokale semantische Ports;
- Verbindungen zwischen Entity und Port;
- freie Primitiven;
- Referenzen auf bewusst erzeugte Custom-Templates.

Das bestehende Anlagenbild bleibt die Runtime-/HMI-Wahrheit. Der neue Editor
ist ein Konstruktionswerkzeug. Eine Baugruppe gelangt nur nach bewusster
Vorschau und Aktion als Custom-Entity in das Anlagenbild.

### Semantik vor Geometrie

Verbindungen referenzieren Entity-ID und Port-ID, nicht nur anonyme
Koordinaten. Position, Größe und Drehung verändern die Weltkoordinate eines
Ports deterministisch. Dadurch bleiben Rohre und Geräte auch nach
Transformation verbindbar.

### Additive V9-Projektion

V64 ergänzt:

- plant_drawing;
- plant_drawing_report;
- hmi_ui.plant_drawing_ref;
- hmi_ui.event_animations;
- hmi_ui_report.event_animations.

Bestehende V9-Tabellen und Shards werden nicht umgedeutet.

## Implementierte Komponenten

### SVG Event Runtime

Die neue Runtime:

- normalisiert und validiert Regeln;
- erzeugt stabile Signalklüssel;
- vergleicht boolesche, numerische und textuelle Bedingungen;
- löst vollständige Objekte und CSS-Teilselektoren auf;
- setzt und entfernt Effekte reversibel;
- verarbeitet Einzel- und Batchsignale;
- verarbeitet benannte Events, Interaktionen und Alarme;
- stellt Status und Validierungsbericht bereit.

### HMI UI

Der Animationsdesigner ist im vorhandenen Schritt **Zustände & Alarme**
eingebettet. Presets verkürzen Standardfälle; alle Felder bleiben explizit
editierbar. Die Vorschau verändert nur die Darstellung, nicht den gespeicherten
Signalzustand.

### Objektinventar

Die neue Kategorie **Rohrbauteile** und die neuen Geräte decken die
Referenzanlagen elementar ab. Jedes Symbol besitzt Ports und semantische
Animationsbereiche.

### Zeicheneditor

Der Editor stellt getrennte Flächen für Inventar, Canvas und Inspektor bereit.
Er unterstützt:

- Suche und Kategorien;
- Platzieren und Transformieren;
- Mehrfachauswahl;
- Portverbindungen;
- freie Primitiven;
- Rohrofen-Demo;
- Auswahlvorschau;
- Baugruppenexport;
- Inventarübernahme;
- SVG-/JSON-Export;
- Validierungsanzeige.

## Sicherheits- und Qualitätsentscheidungen

- importierte SVG-Bäume werden vor Darstellung erneut gegen aktive Inhalte
  abgesichert;
- IDs innerhalb eingebetteter Templates erhalten Instanzpräfixe;
- externe href-Referenzen werden nicht übernommen;
- Custom-Upload läuft zusätzlich durch den Server-Sanitizer;
- Dateien werden serverseitig atomar geschrieben;
- Metadaten und SVG-Inhalt bleiben getrennt validierbar;
- neue Python- und JavaScript-Module bleiben rein funktional;
- keine Klassen, Lambdas, Arrow-Funktionen oder Decorators in neuem Code.

## Kompatibilitätsbewertung

### Unverändert

- V63.4-HMI-Navigation;
- Widget-/Binding-Vertrag;
- Styles und Alarme;
- PF-PID-V1-Objektinstanzen;
- PF-LOGIC-V1;
- Automation V9/V8 Cross;
- Projekt- und SVG-Snapshotpfade;
- Custom- und Legacy-SVG-Import.

### Additiv

- leere event_animations bei Altprojekten;
- leeres plant_drawing bei Altprojekten;
- neue Runtime-Methoden;
- neue Templates;
- neuer Workspace;
- neue Exportsektionen.

## Bewusste Restgrenzen

1. Eine freie, visuelle SMIL-Keyframe-Timeline ist nicht Bestandteil von V64.
   Die produktive Steuerung erfolgt signal- und ereignisbasiert.
2. Fremd-SVGs ohne IDs oder semantische data-Markierungen können nur als
   Ganzes adressiert werden.
3. Orthogonales Routing verwendet derzeit einen deterministischen Mittelknick;
   eine Hindernisumfahrung ist eine mögliche spätere Optimierung.
4. Eine zusammengesetzte Custom-Entity bleibt im Anlagenbild eine Entity.
   Das Konstruktionsmodell bewahrt parallel die elementaren Quellen.
5. Produktionshärtung des LAN-Dienstes bleibt ein separater offener
   Betriebsblock: TLS, Authentifizierung, Rollen, Origin-/CSRF-Schutz,
   Rate-Limits, systemd und Logrotation.

## Freigabekriterium

V64 ist freigabefähig, wenn:

- statische und funktionale V64-Verträge bestehen;
- alle geerbten Tests ohne Regression bestehen;
- Browserkonsole und Requests fehlerfrei bleiben;
- Zeichen-, Port-, Vorschau-, Inventar- und Animationsabläufe funktionieren;
- V9-/SCADA-Export die neuen Verträge enthält;
- Archiv und SHA-256-Manifeste verifiziert sind;
- die installierte Testumgebung denselben Stand ausliefert.
