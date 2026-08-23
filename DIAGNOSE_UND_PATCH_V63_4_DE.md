# Tiefe Diagnose und Patchbericht V63.4

## Ausgangslage

V63.3 stellte bereits einen korrekten expliziten Widget-/Objekt-Workflow bereit.
Die Analyse zeigte drei rein darstellungs- und führungsbezogene Probleme:

1. Widgetnamen waren funktional Buttons, wirkten durch die bisherige Gestaltung
   jedoch wie Textlinks.
2. Der gleiche HMI-Schritt wurde in einer nummerierten Workflowleiste und einer
   zweiten klassischen Tabzeile dargestellt.
3. Zustands-, Alarm- und Darstellungsoptionen waren vollständig, aber zu viele
   Basis- und Expertenfelder wurden gleichzeitig gezeigt.

Die Datenmodelle selbst waren konsistent. Ein Umbau der Runtime- oder
Projektstrukturen wäre deshalb unnötig und riskant gewesen.

## Patchstrategie

Der Patch ist ausschließlich additiv beziehungsweise präsentationsbezogen:

- `public/css/v63_4.css` liegt nach den geerbten Stylesheets;
- bestehende IDs und Eventpfade wurden erhalten;
- die ältere Tabzeile bleibt als verborgener DOM-Kompatibilitätshaken bestehen;
- Expertenfelder werden über native, zugängliche `details`-Bereiche gruppiert;
- das Speichern erfolgt weiterhin über die vorhandenen kanonischen Funktionen.

## Widgetregister

`.hmi-widget-table__select` erhält Rahmen, Hintergrund, Fokuszustand und
Akzentfarbe. Die Elemente bleiben echte `button`-Elemente und behalten
`data-widget-id`, Titel und zugängliche Beschriftung. Es findet keine Migration
von Widgets oder Bindings statt.

## Navigation

`.hmi-workflow-overview` ist die kanonische `tablist`. Die vier sichtbaren
Workflowbuttons besitzen `role="tab"`, `aria-selected`, `aria-controls` und
roving `tabindex`. Die alte `.hmi-legacy-tab-list` ist weiterhin vorhanden,
trägt `aria-hidden="true"` und `hidden` und wird durch V63.4-CSS sicher
unterdrückt.

Damit bleiben geerbte Selektoren auffindbar, ohne dass Anwender zwei
Navigationssysteme sehen.

## Zustände und Alarme

Die bestehende Live-Vorschau, der Threshold-Wizard sowie die manuellen Style-
und Alarmeditoren wurden nicht ersetzt. Sie werden nur in eine progressive
Informationshierarchie eingebettet:

- Live-Test standardmäßig geöffnet;
- empfohlener Threshold-Wizard dauerhaft sichtbar;
- manuelle Editoren standardmäßig geschlossen;
- projektspezifische Klassen, Latching und Quittierung im erweiterten Bereich.

Alle historischen Control-IDs und die Datenfelder in `styles[]` und `alarms[]`
bleiben erhalten.

## Darstellung

Die View-Konfiguration und die Widgetkonfiguration bleiben getrennte
kanonische Datenbereiche. V63.4 zeigt diese Trennung nun explizit und ergänzt
eine Widget-/Objekt-/Daten-Kontextkarte. Basisdesign und Farben sind sofort
sichtbar; CSS- und SVG-Klassen bleiben vollständig im erweiterten Bereich.

## Risikobewertung

Der Patch verändert keine Runtime-Semantik. Die relevanten Risiken liegen in
DOM-Sichtbarkeit, Fokusführung, Eventbindung und responsive Darstellung. Diese
werden durch statische Selektorverträge und reale Chromium-Interaktionen
abgesichert.
