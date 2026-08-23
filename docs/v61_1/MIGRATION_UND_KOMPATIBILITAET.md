# Migration und Kompatibilität V60.1 → V61.1

## 1. Migrationsprinzip

Die Migration ist **nicht-destruktiv**. Sie erfolgt durch
`normalizeProjectModel()` beim Laden und vor dem Speichern. Es gibt keinen
separaten Zwangsexport und keine Änderung der V9-/V8-Fachkonfiguration.

Ziel ist ein kanonisches Darstellungs- und Verbindungsmodell, ohne
projektbezogene Funktionen oder Daten zu verlieren.

## 2. Erhaltene Daten

Folgende Inhalte werden unverändert übernommen oder strukturgleich kopiert:

- Instanz-IDs und Template-IDs;
- Position, Rotation, Skalierung und benutzerseitige Größenänderung bereits
  normalisierter Objekte;
- Gerätezuordnungen, Controller, Kanäle und Bindings;
- Animationstargets und Darstellungsparameter;
- Prozesse, Regeln, Automation, Bibliotheken und freie Regeln;
- HMI-Views, Widgets, Bindings, Styles und Alarme;
- SVG-Projektinhalt, Snapshots und Exportdaten;
- unbekannte projektspezifische Erweiterungsfelder;
- explizit markierte Sondergeometrie und Sonderports.

## 3. Normalisierte Daten

Bei einem bekannten PF-PID-V1-Template werden beim ersten Upgrade vereinheitlicht:

- Basisbreite und Basishöhe;
- kanonischer SVG-Inhalt;
- Standard-ViewBox;
- TAG-Präfix und fehlendes TAG;
- semantische Standardports;
- Geometrie-, Standard- und HMI-Policy-Metadaten;
- Laufzeitzustand;
- Verbindungstyp, Anker und kompatible Portbezüge.

Bereits nach PF-PID-V1 normalisierte und anschließend skalierte Objekte
behalten ihre Instanzabmessungen.

## 4. Sonderfälle

### Custom-SVG

Unbekannte oder hochgeladene Custom-Templates bleiben in der Custom-Bibliothek
und werden nicht auf eine fremde kanonische Geometrie umgeschrieben.

### Sondergeometrie

`geometry_custom = true` schützt SVG-Inhalt, ViewBox und Abmessungen. Diese
Option ist für bewusst abweichende Maschinen- oder OEM-Symbole vorgesehen.

### Sonderports

`ports_custom = true` führt kanonische und projektbezogene Ports anhand ihrer
ID zusammen. Die UI setzt diese Markierung automatisch, sobald ein Port
bearbeitet wird.

### Feste Verbindungsanker

Ein fester Anker bleibt erhalten. Der Portbezug der betreffenden Seite wird
entfernt, damit nicht gleichzeitig zwei widersprüchliche Positionierungsarten
persistiert sind.

### Historische HMI-Auto-Widgets

V61.1 erzeugt keine neuen Auto-Widgets. Bereits vorhandene Widgets werden aus
Kompatibilitätsgründen nicht gelöscht. Der Standardbericht listet Widgets mit
`auto_created = true` oder `origin = "auto"` als Abweichung. Sie können danach
bewusst bestätigt, neu angelegt oder entfernt werden.

## 5. Kompatibilitätsmatrix

| Bereich | V60.1-Projekt in V61.1 |
|---|---|
| bekannte Prozesssymbole | automatisch normalisiert |
| Legacy-Template | weiter verfügbar, als Legacy markiert |
| Custom-SVG | vollständig erhalten |
| Position/Transformation | erhalten |
| Resize nach erster Normalisierung | erhalten |
| Bindings/Devices/V9 | erhalten |
| Animationen | erhalten |
| Verbindungen | auf kompatible Ports projiziert |
| feste Anker | als expliziter Override erhalten |
| explizite HMI-Widgets | erhalten |
| automatische HMI-Widgets | erhalten, aber als Abweichung gemeldet |
| unbekannte Felder | erhalten |

## 6. Empfohlener Upgrade-Ablauf

1. V60.1-Projekt unverändert sichern.
2. V61.1 starten und Projekt laden.
3. Standardstatus im Header prüfen.
4. Port- und Verbindungsauswahl visuell kontrollieren.
5. optionale HMI-Widgets bewusst prüfen; Auto-Altbestände bereinigen.
6. Projekt unter neuem Namen speichern.
7. Snapshot-/Exportverifikation ausführen.
8. FAT/SAT mit der realen SPS-/SCADA-Umgebung durchführen.

Die Referenzanlage `designziel_v1_v61_1` zeigt den erwarteten Zielzustand.
