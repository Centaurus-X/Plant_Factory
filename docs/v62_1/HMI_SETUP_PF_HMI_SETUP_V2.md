# PF-HMI-SETUP-V2 — geführte HMI-Konfiguration

## 1. Grundsatz

PF-HMI-SETUP-V2 verändert ausschließlich die Bedienführung. Das bestehende
`hmi_ui`-Datenmodell und seine Exportkompatibilität bleiben erhalten.

Die Konfiguration folgt einer fachlichen Abhängigkeit:

```text
Widget → P&ID-/SVG-Objekt → Runtime-Quelle oder Interaktion
       → visueller Zustand / Alarm → Darstellung
```

## 2. Schritt 1: Widgets

Ein Widget definiert das explizite HMI-Bedien- oder Anzeigeelement. Verfügbare
Typen sind Text, Indicator, Button, Toggle und Slider.

Verbindliche Regeln:

- Prozessobjekte erzeugen niemals automatisch ein Widget;
- Button und Toggle sind ausdrücklich optional;
- das Widget gehört zu einer View;
- Löschen eines Widgets zeigt eine modale Warnung und entfernt die davon
  abhängigen Bindings transaktional.

## 3. Schritt 2: Datenbindung

Ein Binding koppelt:

1. ein Widget;
2. ein P&ID-/SVG-Objekt;
3. eine Runtime-Quelle oder eine HMI-Interaktion.

Zusätzlich bleiben Formatierung, Skalierung, Clamp, Platzierung und Interaktion
konfigurierbar. Unvollständige Bindings werden im Sanity-Report ausgewiesen und
beim Export kontrolliert behandelt.

## 4. Schritt 3: Zustände & Alarme

Visuelle Zustände und Alarme bleiben getrennte Fachobjekte:

- Styles definieren Bedingung, Zielbinding, Klassen und Priorität;
- Alarme definieren Quelle, Bedingung, Severity, Latching, Quittierung,
  Meldung, Blinkverhalten und Ziel;
- bestehende Threshold-Wizard- und Live-Preview-Funktionen bleiben erhalten;
- Löschvorgänge benötigen PF-MODAL-V1-Bestätigungen.

## 5. Schritt 4: Darstellung

Die Darstellung steuert den View-Hintergrund und die Appearance vorhandener
Widgets. Sie verändert weder Runtime-Quelle noch Binding- oder Alarmsemantik.

## 6. UI-Vertrag

Jeder Schritt besitzt:

- eine verständliche Überschrift und Kurzbeschreibung;
- einen aktuellen Bestandsstatus;
- eine geführte Vor-/Zurücknavigation;
- dieselbe aktive View wie die übrigen HMI-Schritte;
- unveränderte IDs der bestehenden Editoren und Modellfelder.

## 7. Kompatibilität

Erhalten bleiben:

- bestehende Widgets, Bindings, Styles und Alarme;
- Animationen und SVG-Klassenziele;
- Runtime-Sources und HMI-Interaktionen;
- HMI-Overlay, Preview und Export;
- Legacy-Projekte und unbekannte Erweiterungsfelder;
- SVG-/JSON-Bundle-Generierung.
