# Release Notes Plant Factory V61.1

## Ziel des Releases

V61.1 führt den verbindlichen Objekt- und Symbolstandard **PF-PID-V1** ein.
Der visuelle Produktstand von V60.1 bleibt erhalten; zusätzlich werden
Geometrie, Ports, Beschriftungen, Verbindungen und Laufzeitzustände der
Engineering-Objekte deterministisch normalisiert.

## Wesentliche Änderungen

- 25 kanonische, lokal ausgelieferte P&ID-/Engineering-Symbole;
- einheitliche Geometrieprofile, Linienbreiten, Farben und SVG-Rollen;
- semantische Ports mit Typ, Richtung, Rolle und relativer Position;
- orthogonale Verbindungen mit kompatibler Portpaar-Auswahl;
- einheitliche zweizeilige Beschriftung aus TAG und Beschreibung;
- standardisierte Laufzeitzustände `ready`, `running`, `warning`, `alarm`,
  `disabled` und `maintenance`;
- nicht-destruktive Normalisierung beim Erzeugen, Laden und Speichern;
- weiterhin vollständige Auswahl-, Transformations-, Binding-, Animations-,
  Inspector-, History-, Export- und Projektfunktionen;
- explizite HMI-Richtlinie: Prozesssymbole erzeugen niemals automatisch
  Widgets oder Buttons;
- Buttons, Schalter, Slider und Anzeigen bleiben im HMI-Designer ausdrücklich
  optional verfügbar;
- Engineering-HMI-Overlay ist standardmäßig ausgeschaltet und kann bewusst
  eingeblendet werden;
- neue Referenzanlage `designziel_v1_v61_1` für den normalisierten
  Plant-Factory-Workflow.

## Kompatibilität

V60.1-Projekte werden beim Laden nicht-destruktiv auf den neuen Vertrag
projiziert. Bindings, Automationsdaten, Gerätezuordnungen, HMI-Modelle,
Animationen, unbekannte Erweiterungsfelder und benutzerdefinierte SVG-Inhalte
bleiben erhalten. Explizit als Sondergeometrie oder Sonderport markierte
Anpassungen werden nicht durch die kanonische Geometrie ersetzt.

Legacy- und Custom-Symbole bleiben über die Bibliotheksfilter verfügbar. Der
Standardfilter zeigt ausschließlich PF-PID-V1-Objekte.

## HMI- und Button-Richtlinie

Ein Drag-and-drop-Vorgang aus der Prozessbibliothek erzeugt ausschließlich ein
Engineering-Objekt. Es wird weder ein HMI-Widget angelegt noch ein Binding
abgeleitet. Ein Button entsteht nur durch eine explizite Aktion im
HMI-Designer und startet ohne automatische Bindung.

Bereits vorhandene explizite HMI-Widgets und Bindings werden vollständig
beibehalten. Automatisch gekennzeichnete Alt-Widgets werden nicht gelöscht,
aber vom Standardbericht als Migrationsabweichung ausgewiesen.

## Verifikation

Die vollständige Releaseprüfung wurde mit der bereitgestellten
`automation_system_v0101`-Runtime als externer Typautorität bestanden:

| Prüfbereich | Ergebnis |
|---|---:|
| PF-PID-V1 JavaScript-Vertrag | 31/31 |
| V9-Kerntests | 145/145 |
| JavaScript-Formatprüfungen | 42/42 |
| Python-Formatparität | 58/58 |
| Plant-Factory-Modellkette | 31/31 |
| Snapshot-Kette | 52/52 |
| Regelvertrag mit externer Runtime | 29/29 |
| Hermetischer Chromium-Smoke | 119/119 |

Zusätzlich wurden Generator-Reproduzierbarkeit, SVG- und Metadatenverträge,
funktionaler Quellstil, Markup, Security, HTTP-API, SVG-Konverter,
Konfigurationsbuild, Migration, Sharding und Archivintegrität geprüft.

Die detaillierten Freigabekriterien stehen in
`docs/v61_1/TEST_UND_FREIGABE.md` und das maschinenlesbare Ergebnis in
`docs/v61_1/RELEASE_MANIFEST_V61_1.json`.

## Betriebsfreigabe

V61.1 ist die geprüfte Software-Baseline. Vor dem Einsatz an einer konkreten
Produktionsanlage bleiben FAT/SAT, I/O-Punktprüfung, Rechte- und
Netzwerkfreigabe sowie die Abnahme mit realer SPS-/SCADA-Hardware erforderlich.
