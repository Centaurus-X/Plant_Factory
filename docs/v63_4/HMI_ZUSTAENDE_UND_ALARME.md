# PF-V63.4-HMI-UX – Zustände und Alarme

## Ziel

Der Tab soll einen schnellen Standardweg und weiterhin den vollständigen
Expertenzugriff bieten, ohne zwei Datenmodelle einzuführen.

## Informationshierarchie

### 1. Signal testen

Die lokale Simulation verändert nur die Vorschau. Signal, Wert, Slider,
Schnellwerte und Wertebereich bleiben verfügbar. Der Bereich ist beim ersten
Öffnen aufgeklappt.

### 2. Grenzwert-Wizard

Der empfohlene Ablauf ist:

```text
Binding → WARN/ALARM-Schwellen → sichtbare Ausgabe → Styles/Alarm erzeugen
```

Bindingoptionen zeigen Widget, P&ID-/SVG-Objekt und Runtime-Quelle gemeinsam.
Die Ausgabe kann auf Widget/Overlay, SVG-Objekt oder beide Ziele angewendet
werden. Ein Alarmobjekt bleibt optional.

### 3. Erweiterte Einstellungen

Latching, Quittierung und projektspezifische OK-/WARN-/ALARM-Klassen für
Overlay und SVG sind vollständig vorhanden, aber standardmäßig eingeklappt.

### 4. Manuelle Editoren

Die bisherigen Style- und Alarmeditoren bleiben unverändert verfügbar. Sie
sind als Expertenbereich standardmäßig geschlossen und schreiben weiterhin in
dieselben `styles[]`- und `alarms[]`-Arrays.

## Datenvertrag

V63.4 ändert weder die Struktur noch die Bedeutung von Styles, Alarmen,
Bindings, Sources oder Interaktionen. Der Wizard und die manuellen Editoren
sind zwei Bedienwege auf dasselbe kanonische HMI-Modell.
