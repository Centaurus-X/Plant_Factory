# PF-V63.4-HMI-UX – Darstellung

## Geführter Ablauf

### 1. View

Der Hintergrund wird für die aktive View konfiguriert. Automatisch,
transparent, dunkel, hell und frei gewählte Farbe bleiben verfügbar.

### 2. Widget

Widgets werden als Auswahlkarten mit Name, gebundenem P&ID-/SVG-Objekt und Typ
angezeigt. Die Auswahl verändert weder Datenbindung noch Objektbezug.

### 3. Design

Die Konfiguration ist in Grunddesign sowie Farben und Schrift gegliedert.
Folgende Felder bleiben erhalten:

- Variante, Größe und Form;
- Rahmenbreite;
- Vordergrund-, Hintergrund- und Rahmenfarbe;
- Schriftgröße;
- Widget-CSS-Klassen;
- SVG-Zielklassen.

CSS- und SVG-Klassen befinden sich in einem standardmäßig geschlossenen
Expertenbereich. Eine Vorschau aktualisiert sich sofort; erst
**Darstellung übernehmen** schreibt die Konfiguration in das kanonische
Widgetmodell.

## Kontextkarte

Vor den Designfeldern werden Widget, P&ID-/SVG-Objekt und Datenstatus angezeigt.
Damit ist jederzeit klar, welches Element gestaltet wird, ohne dass eine
zweite Relation erzeugt wird.
