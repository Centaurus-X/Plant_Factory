# PF-V63.3 I/O-Zuweisungen und Zuordnungsregister

## Zweck

Dieser Vertrag optimiert die Bedienung des bestehenden Geräte-/I/O-Modells,
ohne dessen Datenstruktur oder Runtime-Projektion zu verändern. Die
kanonische Ablage bleibt:

```text
project.devices.assignments[element_id]
```

Eine Zuweisung referenziert weiterhin genau ein P&ID-/SVG-Objekt und enthält
abhängig von der Rolle Sensor-, Aktor- oder Device-ID sowie Controller-, Bus-,
Adress- und Funktionsdaten.

## Bedienvertrag

- Eine eindeutige Canvas-Auswahl wird unmittelbar im I/O-Editor aktiviert.
- Vorhandene Zuweisungsdaten werden vollständig in das Formular geladen.
- **Zuweisung speichern** und **Zuweisung entfernen** stehen als zusammen-
  gehörige Aktionen direkt nebeneinander.
- Die Speicherung bleibt explizit; das reine Auswählen eines Objekts verändert
  keine Konfiguration.
- Mehrfachauswahl erzeugt keine implizite Einzelzuweisung.

## Zuordnungsregister

Das Register **Aktuelle Zuordnungen** ist standardmäßig eingeklappt. Dadurch
bleibt der Inspector auf die aktuell bearbeitete Entity fokussiert.

Beim Einblenden gilt:

- stabile Spaltengeometrie für alle Zeilen;
- horizontales Scrollen auf schmalen Viewports statt Überlagerung;
- gekürzte Darstellung langer Werte in **Element** und **Alias**;
- vollständiger Originalwert über den nativen Tooltip (`title`);
- unveränderte Speicherung der vollständigen Werte;
- sichtbarer Zähler im Registerkopf;
- zugänglicher Zustand über `aria-expanded` und `aria-controls`.

## Kompatibilität

Die Änderung ist rein additiv auf UI-Ebene. Bestehende Projektdateien,
Runtime-Konfigurationen, V9-/V8-Cross-Exporte, HMI-Bindings und Logic-Signale
werden nicht migriert oder umgeschrieben.
