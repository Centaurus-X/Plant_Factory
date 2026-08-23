# Objektstandard PF-PID-V1

## 1. Zweck und Verbindlichkeit

**PF-PID-V1** ist ab Plant Factory V61.1 der verbindliche Standard für alle
neu platzierten P&ID- und Engineering-Objekte. Er definiert die persistierte
Objektstruktur und ihre Darstellung. Der Vertrag gilt für Bibliothek,
Zeichenfläche, Inspector, Verbindungen, Animation, HMI-Zuordnung, Export und
Projektmigration.

Die maschinenlesbaren Quellen sind:

- `config/symbol_standard_v1.json` — globaler Standardvertrag;
- `public/svg_templates/library_manifest_v1.json` — Bibliotheksmanifest;
- `public/js/pid_standard.js` — Laufzeitnormalisierung;
- `_tools/build_symbol_standard.py` — deterministischer Generator.

Direkte manuelle Änderungen an generierten Standard-SVGs sind nicht zulässig.
Änderungen erfolgen in der Generatorquelle und werden anschließend mit
`python3 _tools/build_symbol_standard.py` reproduziert.

## 2. Invarianten eines Standardobjekts

Ein PF-PID-V1-Objekt besitzt mindestens:

- stabile Instanz-ID und stabile Template-ID;
- `standard = "PF-PID-V1"` und Standardversion `1.0`;
- kanonische Basisgeometrie mit einem definierten Geometrieprofil;
- ein TAG nach dem Muster `^[A-Z][A-Z0-9]{0,5}-[0-9]{3}[A-Z]?$`;
- eine Beschreibung als zweite Beschriftungszeile;
- mindestens zwei semantische Ports;
- vollständig aktivierte Fähigkeiten für Auswahl, Bewegung, Skalierung,
  Rotation, Verbindung, Binding, Animation und Konfiguration;
- einen standardisierten Laufzeitzustand;
- eine HMI-Richtlinie ohne automatische Widget-Erzeugung.

Unbekannte Felder werden beim Normalisieren kopiert und nicht verworfen.

## 3. Geometrieprofile

Die Basisgrößen werden in Engineering-Pixeln auf einem 10-Pixel-Raster
definiert. Verbindungen dürfen auf einem feineren 5-Pixel-Raster geführt
werden.

| Profil | Basisgröße | Verwendung |
|---|---:|---|
| `compact` | 80 × 80 | Ventile und kompakte Symbole |
| `machine` | 90 × 80 | Pumpen, Verdichter, Wärmetauscher |
| `vessel` | 80 × 110 | vertikale Behälter |
| `horizontal_vessel` | 120 × 80 | Trommeln und horizontale Behälter |
| `reactor` | 100 × 130 | Reaktoren und Rührbehälter |
| `instrument` | 70 × 90 | Messstellen und Transmitter |
| `column` | 90 × 140 | Kolonnen |
| `pipeline` | 120 × 60 | Rohrleitungsobjekte |
| `hardware` | 120 × 90 | I/O- und Automatisierungshardware |

Die Objektgröße darf nach dem Platzieren verändert werden. Relative Ports
skalieren mit der Instanz, Linien verwenden `vector-effect="non-scaling-stroke"`.
Der Drehpunkt ist standardmäßig die Objektmitte.

### 3.1 Sondergeometrie

Benutzerdefinierte SVG-Inhalte bleiben erhalten, wenn die Instanz
`geometry_custom = true` trägt. In diesem Fall werden Breite, Höhe, ViewBox,
SVG-Inhalt und Geometrie-Metadaten nicht auf das Standardprofil zurückgesetzt.
Das Objekt behält dennoch den übrigen Interaktions- und Persistenzvertrag.

## 4. SVG-Darstellungsvertrag

Kanonische Templates verwenden die Rollen:

- `symbol`, `body`, `outline`, `detail`, `state`, `flow`, `port`, `label`.

Primärkonturen haben 2,2 Pixel, Sekundärdetails 1,4 Pixel, Prozessleitungen
2,4 Pixel und Signalleitungen 1,6 Pixel. Farben werden über die
`--pid-*`-Variablen an Light/Dark Theme und Laufzeitzustand gekoppelt.

Jede SVG-Datei enthält einen `META`-Kommentar mit Template-Metadaten und die
Attribute `data-pf-standard`, `data-pf-family` und `data-pf-profile`.
Aktive Inhalte, externe Ressourcen, Eventattribute, `foreignObject`,
`DOCTYPE` und Entities sind nicht zulässig.

## 5. TAG- und Beschriftungsstandard

Die erste Zeile enthält das Engineering-TAG, die zweite Zeile die lesbare
Beschreibung. Neue TAGs werden je Template-Präfix deterministisch ab `101`
vergeben und kollidieren nicht mit vorhandenen Entities.

Beispiele:

- `T-101` — Feed Tank;
- `P-101` — Feed Pump;
- `E-101` — Heat Exchanger;
- `R-101` — Jacketed Reactor;
- `CV-101` — Outlet Control Valve;
- `TT-101` — Reactor Temperature.

Beschriftungen bleiben bei Drehung aufrecht und werden außerhalb der
Objektkontur angeordnet.

## 6. Semantische Ports

Ein Port besitzt:

- `id` und Anzeigename;
- relative Koordinaten `rx` und `ry` im Bereich 0 bis 1;
- abgeleitete lokale Koordinaten `x` und `y`;
- Art `process`, `utility`, `signal`, `data`, `power` oder `io`;
- Richtung `in`, `out` oder `bidirectional`;
- fachliche Rolle, beispielsweise `feed`, `product`, `status` oder `control`.

Kompatible Verbindungstypen:

| Verbindung | Erlaubte Portarten |
|---|---|
| `pipe` | `process`, `utility` — nur artgleich |
| `signal` | `signal`, `io` |
| `data` | `data`, `io` |
| `power` | `power` |

Die automatische Auswahl bewertet alle kompatiblen Portpaare und verwendet
das geometrisch nächste Paar. Richtungsregeln werden berücksichtigt. Eine
Typ- oder Endpunktänderung ohne kompatibles Portpaar wird abgelehnt, statt
eine fachlich ungültige Verbindung zu speichern.

Explizite feste Anker bleiben als dokumentierter Sonderfall zulässig. Dabei
wird der entsprechende Portbezug entfernt und
`manual_anchor_override = true` gesetzt.

### 6.1 Benutzerdefinierte Ports

Eine Portbearbeitung setzt `ports_custom = true`. Dadurch bleiben ergänzte
oder verschobene Ports bei Laden und Speichern erhalten. Ohne diese Markierung
wird die kanonische Portliste des Templates verwendet.

## 7. Laufzeitzustände

Zulässige Zustände:

- `ready`;
- `running`;
- `warning`;
- `alarm`;
- `disabled`;
- `maintenance`.

Unbekannte Zustände werden für die Darstellung sicher auf `ready`
normalisiert. Der angeforderte Rohwert bleibt unter
`properties.runtime_state_source` nachvollziehbar. Zustände steuern nur die
Darstellung; Bindings und Automationslogik bleiben unabhängig davon erhalten.

## 8. Interaktions- und Featurevertrag

Normalisierung darf folgende Funktionen nicht deaktivieren:

- Auswahl, Mehrfachauswahl, Verschieben, Skalieren und Rotieren;
- Undo/Redo und Projekt-History;
- semantisches Verbinden und manuelle Anker;
- Inspector-Konfiguration;
- Geräte-, Controller-, Kanal- und V9-Bindings;
- SVG-Fill-/Darstellungsanpassungen;
- HMI-Animation und Signalbrücken;
- Speichern, Laden, Snapshot, Verifikation und Export;
- benutzerdefinierte Erweiterungsfelder.

Die Fähigkeiten werden in `capabilities` und `interaction` persistiert.
`auto_create_hmi_widgets` wird unabhängig von Eingangsdaten immer auf `false`
gesetzt.

## 9. HMI- und Button-Standard

Das Platzieren eines Prozesssymbols erzeugt **nur das Engineering-Objekt**.
Es erzeugt niemals automatisch:

- einen Button;
- einen Toggle;
- einen Indicator;
- ein anderes HMI-Widget;
- ein HMI-Binding.

HMI-Controls werden ausschließlich im HMI-Designer explizit angelegt. Buttons
sind damit weiterhin vollständig verfügbar, aber optional. Neue Widgets
tragen `origin = "explicit"` und `auto_created = false`; eine Bindung wird erst
durch eine bewusste Konfiguration erzeugt.

Das Engineering-Overlay für explizite HMI-Widgets ist standardmäßig verborgen
und kann über **HMI optional** eingeblendet werden.

## 10. Bibliotheksumfang V61.1

Der Generator liefert 25 kanonische Templates aus den Familien Behälter,
Pumpen, Wärmetauscher, Ventile, Reaktoren, Messstellen, Kolonnen,
Rohrleitungen, Antriebe, Filter und I/O-Hardware. Legacy- und Custom-Assets
bleiben separat filterbar.

Der Standardbestand ist reproduzierbar, wenn folgender Befehl ohne Änderungen
endet:

```bash
python3 _tools/build_symbol_standard.py --check
```
