# Tiefe Diagnose und minimal-invasiver Patch V63.3

## Ausgangslage

V63.2 war funktional stabil, zeigte aber in der täglichen Bedienung vier
zusammenhängende UX-Probleme: getrennte I/O-Aktionen, ein dauerhaft offenes
und bei langen Werten unübersichtliches Zuordnungsregister, eine fehlende
generische Messstellen-Entity und einen zu indirekten HMI-Widget-/Objekt-
Workflow.

## 1. I/O-Aktionsführung

### Diagnose

Die Aktion zum Speichern lag im oberen Zielbereich, während das Entfernen der
Zuweisung unter den dynamischen Feldern stand. Beide Aktionen beziehen sich
auf denselben Datensatz, waren visuell aber getrennt. Das erhöhte die Gefahr,
dass Anwender den aktuellen Formularzustand nicht eindeutig einer Aktion
zuordnen konnten.

### Patch

Beide Aktionen stehen nun in einer gemeinsamen, responsiven Aktionszeile nach
den I/O-Feldern. Die Ereignis- und Persistenzfunktionen wurden nicht ersetzt;
nur deren Platzierung wurde konsolidiert.

## 2. Register „Aktuelle Zuordnungen“

### Diagnose

Die bisherige Tabelle nutzte ein generisches Grid mit nicht ausreichend
stabilen Spaltenbreiten. Lange Instanz-IDs und Aliase verschoben nachfolgende
Felder oder liefen optisch zusammen. Außerdem belegte das Register permanent
viel Inspectorhöhe, obwohl es nur für Überblick und Diagnose benötigt wird.

### Patch

- standardmäßig eingeklapptes Register;
- zentraler Expand/Collapse-Zustand;
- sichtbarer Eintragszähler;
- stabile achtspaltige Grid-Geometrie;
- horizontales Scrollen auf schmalen Viewports;
- Ellipsis ausschließlich für Element und Alias;
- vollständige Werte in Tooltips;
- vollständige Daten bleiben im Modell unverändert.

## 3. Generic_Sensor_Entity

### Diagnose

PF-PID-V1 enthielt spezialisierte Messstellen, aber keine neutrale Entity für
Sensoren, deren konkreter Typ erst bei der I/O-Projektierung bekannt ist.
Anwender mussten dadurch ein semantisch zu konkretes Symbol wählen oder ein
Custom-SVG importieren.

### Patch

Die deterministische Symboldefinition wurde um `Generic_Sensor_Entity`
erweitert. Sie ist der Kategorie Messstellen zugeordnet, besitzt eine offene
Sensorrolle und standardisierte Prozess-, Signal- und Datenports. Die Runtime
bleibt unverändert: Erst die I/O-Zuweisung legt Sensor-ID, Typ, Controller,
Bus, Adresse und Funktion fest.

## 4. HMI-Widget-/Objekt-Verknüpfung

### Diagnose

Widgetliste, Erzeugung und Binding waren räumlich getrennt. Das Binding musste
nach dem Widget häufig in einem zweiten Schritt manuell erzeugt und mit dem
P&ID-Objekt verbunden werden. Die schmale Zweispaltenansicht führte bei langen
IDs und Labels zu Überlagerungen.

### Patch

- vollbreites Widgetregister unmittelbar unter der Schritt-1-Einleitung;
- sichtbare Spalten für Widget, Typ, Objekt, Datenquelle und ID;
- separates, darunterliegendes Erzeugungs-/Bearbeitungsraster;
- Objekt-Dropdown und Übernahme der aktuellen Canvas-Auswahl;
- atomare Erzeugung von Widget und Binding;
- Vorbelegung der Quelle aus vorhandener Device-Zuweisung;
- sichtbare Relation im Widgeteditor;
- direkte Navigation zum Bindingeditor;
- keine automatische Widget-Erzeugung aus P&ID-Objekten.

## Kompatibilitätsbewertung

Unverändert bleiben:

- kanonische Projektpfade für Devices, HMI, Process States, Rules und Logic;
- PF-PID-V1-Geometrie und bestehende 25 Symbole;
- Legacy- und Custom-SVG-Objekte;
- HMI-Widgets, Bindings, Styles, Alarme, Animationen und Interaktionen;
- Logic-/FBD-Schaltpläne und Runtime-/PLC-Adapter;
- V9- und V8-Cross-Konfigurationen;
- Projekt-, Snapshot-, SVG-, HMI- und SCADA-Exporte;
- Undo/Redo sowie transaktionale Projektänderungen.

Die Änderungen sind auf UI-Komposition, Metadaten und eine zusätzliche
Symboldefinition begrenzt. Es erfolgt keine destruktive Migration.

## Testinfrastruktur

Der lang laufende Release-Arbeitsbereich wird in V63.3 außerhalb des
Quellbaums angelegt. Dadurch können Repository-Scans, reproduzierbare Builds
oder externe Bereinigungsregeln das temporäre Testverzeichnis nicht während
der Prüfkette entfernen. Der Arbeitsbereich wird weiterhin über einen
`EXIT`-Trap vollständig bereinigt.

## Finale Verifikation

Die 19-stufige Freigabekette wurde im Quellstand und aus einem frisch
extrahierten Releasearchiv bestanden. Die externe
`automation_system_v0101`-Autorität bestand 29/29 Prüfungen. Die fünf
Chromium-Verträge bestanden zusammen 320/320 Interaktionsprüfungen ohne
Konsolen-, Seiten- oder Requestfehler. Der deterministische Doppelbuild war
byte-identisch; Archivpfade, interne Prüfsummen und Ausschlüsse wurden
vollständig verifiziert.
