# Plant Factory V64 – Release Notes

## Ergebnis

V64 führt komplexe SVG-Animationen aus der bisherigen, autonomen
SMIL-Zeitachse in einen allgemein nutzbaren HMI-Ereignisvertrag über. Zugleich
stellt V64 einen spezialisierten, elementaren Anlagen-Zeicheneditor bereit.
Beide Erweiterungen verwenden die vorhandene PF-PID-V1-Registry, die
semantischen Ports, das Projektmodell und den V9-Exporter.

## Neue Funktionen

### Ereignisgesteuerte SVG-Animationen

- Signale: Sensor, Aktor, Prozesszustand oder generischer Schlüssel;
- Events: benannte Runtime-Ereignisse;
- Interaktionen: HMI-Aktionen mit Objektbezug;
- Alarme: Aktivierung und Rücknahme;
- Ziele: vollständige Entity oder semantisches Unterelement;
- Effekte: Fill, Stroke, Temperatur, Flow, Blink, Pulse, Rotate, Level,
  Opacity und Glow;
- Vorschau im Editor;
- identischer Vertrag im Projekt, SVG-Metadatenblock, Runtime-JSON und
  SCADA-Bundle.

### Anlagen-Zeicheneditor

- eigener Menüpunkt **Zeichnen** unter Anlage;
- Inventarsuche und Kategorienfilter;
- elementare Entities auf Grundlage der bestehenden Registry;
- Prozess-, Utility-, Signal- und Energieverbindungen;
- orthogonales Routing zwischen semantischen Ports;
- freie Linien, Rechtecke, Ellipsen und Texte;
- Raster, Einrasten, Zoom, Mehrfachauswahl und Undo/Redo;
- Objektinspektor für Name, Tag, Position, Größe und Drehung;
- Vorschau der ausgewählten Baugruppe;
- Übernahme als Custom-SVG mit nur den extern verbleibenden Ports;
- SVG- und JSON-Export;
- Rohrofen-Beispiel aus elementaren Einzelkomponenten.

### Neues Objektinventar

V64 ergänzt neun kanonische Templates:

1. gerades Prozessrohr;
2. 90°-Rohrbogen;
3. Rohr-T-Stück;
4. Flanschpaar;
5. Gasflasche;
6. vertikaler Rohrreaktor;
7. Rohrofen;
8. Doppelrohr-Kühler;
9. Plattenwärmetauscher.

Alle besitzen semantische Ports und adressierbare
**data-pf-state-target**-Bereiche.

## Datenverträge

- **project.hmi.event_animations**: kanonische Animationsregeln;
- **project.plant_drawing**: versioniertes Konstruktionsmodell;
- **runtime.hmi_ui.event_animations**: Runtimeprojektion;
- **runtime.plant_drawing**: additive V9-/Runtimeprojektion;
- **runtime.plant_drawing_report**: Validierungsstatus und Mengen;
- **runtime.hmi_ui.plant_drawing_ref**: eindeutige Referenz auf die
  Konstruktionssektion.

## Kompatibilität

- vorhandene V63.4-Projekte laden mit leeren V64-Sektionen;
- alte Styles, Alarme und Standardanimationen bleiben unverändert;
- autonome SMIL-Animationen in importierten SVGs bleiben abspielbar;
- V64-Regeln ersetzen SMIL nicht zwangsweise, sondern ergänzen die
  signalgebundene Steuerung;
- bestehende PF-PID-V1-IDs und Objektsemantik bleiben erhalten;
- keine automatische Widgeterzeugung beim Einfügen von Prozessobjekten;
- V9/V8-Cross- und PF-LOGIC-V1-Verträge bleiben bestehen.

## Betrieb

Das neue **start_plant_factory.sh** löst seinen eigenen Releasepfad robust auf,
verwendet eine vorhandene virtuelle Umgebung weiter und installiert
Abhängigkeiten nur, wenn **aiohttp** tatsächlich fehlt.

Standardwerte:

~~~text
Host: 0.0.0.0
Port: 8090
~~~

Für eine dauerhafte Produktionsexposition gelten weiterhin die dokumentierten
offenen Punkte zu TLS, Authentifizierung, Rollen, Origin-/CSRF-Schutz,
Rate-Limits, Service-Management und Logrotation.

## Bewusste Grenzen

- V64 bildet keine freie SMIL-Keyframe-Timeline nach. Ablaufsteuerung erfolgt
  über fachliche Signale und Ereignisse.
- Automatische Semantik aus beliebigen, unmarkierten Fremd-SVGs ist nicht
  zuverlässig möglich. Für Teilziele sind IDs oder **data-pf-state-target**
  erforderlich.
- Zusammengesetzte Inventar-Entities bleiben SVG-Kompositionen. Ihre
  ursprünglichen Einzelkomponenten werden im Zeichenmodell weiterhin separat
  gespeichert, aber im Anlagenbild als bewusst erzeugte Baugruppe verwendet.

## Prüfung

Der Release besitzt statische, funktionale, API-, Sicherheits-, Browser-,
Archiv- und Prüfsummenverträge. Die tatsächlich ausgeführten Ergebnisse werden
in **docs/v64/TEST_UND_FREIGABE.md** und
**docs/v64/RELEASE_MANIFEST_V64.json** festgehalten.
