# Plant Factory V64_r6 – Diagnose und Patchbegründung

## Ausgangsbefund

### 1. Kategorien im Anlagen-Inventar

Die Kategorienzeile war bereits horizontal überlaufend, ihr nativer
Scrollbalken wurde jedoch in der Basis-CSS für Firefox und WebKit verborgen.
Bei schmalem Inventar waren Kategorien deshalb nur durch unpräzises
Trackpad-/Mausrad-Scrollen erreichbar. Eine fokussierte Kategorie wurde nicht
automatisch in den sichtbaren Ausschnitt gebracht.

### 2. Gespeicherte Baugruppe im Anlagenbild

Der Zeicheneditor konnte Teile schon elementar ins Anlagenbild übertragen.
Der alternative Weg **In Anlagen-Inventar übernehmen** serialisierte den
Entwurf aber ausschließlich als vollständiges SVG. Das Anlagen-Inventar
kannte daher nur eine Custom-Entity (beispielsweise X-101). Die eingebetteten
Geräte waren optisch vorhanden, aber keine auswählbaren Anlagen-Entities;
I/O-, Device- und HMI-Zuordnungen konnten nur am Gesamtobjekt erfolgen.

## Gewählte Korrektur

### Sichtbarer nativer Scrollbereich

Die R6-CSS überschreibt ausschließlich die Kategorienzeile. Der Browser
zeichnet einen schmalen nativen horizontalen Scrollbalken; Fokus, Hover,
Dark Themes und Forced Colors besitzen eigene Zustände. Die bestehende
Kategorieauswahl bleibt fachlich unverändert.

Die Interaktionsschicht ergänzt Tablisten-Semantik und eine roving-tabindex-
Navigation. Pfeiltasten, Pos1 und Ende aktivieren die entsprechende
Kategorie und scrollen sie vollständig ins Sichtfeld.

### Strukturierte Baugruppe mit passiver Layoutschicht

Das vorhandene Baugruppenschema wird als eingebettete Quelle wiederverwendet.
Beim Platzieren erzeugt ein generischer Template-Platzierungshook:

1. eine passive Layout-Entity für Texte, Maße und Bereiche;
2. pro Gerätebauteil eine normale Anlagen-Entity;
3. pro gültigem Joint eine normale Anlagenverbindung;
4. gemeinsame Baugruppenmetadaten für Herkunft und Zugehörigkeit.

Die Transformation berücksichtigt Einsetzpunkt, Quellgrenzen, Drehung und
Skalierung. Die eingebetteten Geräte- und Verbindungsgruppen der Layout-SVG
werden ausgeblendet; dadurch entstehen weder Doppelkonturen noch doppelte
Ports. Die echten Entities bleiben vollständig auswählbar.

### Migration älterer flacher Entwürfe

Eine bestehende flache Custom-Entity wird nur dann als Kandidat angeboten,
wenn ihre SVG-Metadaten eindeutig zu einer verfügbaren Zeichenbaugruppe
passen. Die explizite Inspektoraktion behält das SVG als Layoutträger und
ergänzt die elementaren Entities und Verbindungen. Es erfolgt keine
automatische, potenziell überraschende Datenumwandlung.

## Minimal-invasive Grenzen

- kein neues Projekt- oder Baugruppenschema;
- keine Änderung der 71 PF-PID-V1-Template-SVGs;
- keine Änderung an V9-, Automation-, Runtime-, HMI- oder Logikverträgen;
- bestehende flache Custom-SVGs bleiben unverändert nutzbar;
- generischer Hook im Elementmanager statt Sonderfall im Kernrendering;
- serverseitige Felder optional; unbekannte Modi fallen auf flat zurück.

## Verifikation

- Basisvertrag V64: 100/100;
- additive Releaseverträge R1–R5: 40/40, 49/49, 86/86, 128/128, 199/199;
- Modellverträge V64, R3, R4, R5, R6: 13/13, 33/33, 48/48, 82/82, 16/16;
- isolierter R6-Serververtrag: 13/13;
- Browser- und Visualvertrag: 29/29 in einer alternativen Google-Chrome-Instanz.
