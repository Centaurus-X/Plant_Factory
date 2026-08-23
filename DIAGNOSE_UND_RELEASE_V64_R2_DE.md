# Diagnose und Freigabe – Plant Factory V64_r2

## Ausgangslage

Die bisherige Automation-Konfiguration war funktional, aber auf mehrere historische Seiten verteilt. Das bereitgestellte PF-AUTOMATION-STUDIO-V1 bündelt dieselben fachlichen Tabellen in einem durchgängigen Arbeitsablauf. Eine direkte Komplettanwendung des gelieferten Patches wäre für V64_r1 ungeeignet gewesen, weil sie dessen Zeicheneditor-CSS und neue Releaseartefakte überschrieben hätte.

## Integrationsentscheidung

Die Integration wurde deshalb additiv durchgeführt:

1. Automation Studio als eigenes ES-Modul über den bestehenden V9-Bootstrap
2. eigene, vollständig auf `#tab-v9-automation` beziehungsweise `.as-root` begrenzte R2-CSS-Schicht
3. neuer primärer Automation-Routenpunkt bei erhaltenen Legacy-Deep-Links
4. atomarer `replaceSections`-Storepfad mit Whitelist der kanonischen V9-Sektionen
5. keine neue Datenbank, kein paralleler Browser-Speicher und keine zweite Projektionswahrheit

## Systemweite UI/UX-Prüfung

Geprüft werden nicht nur die sieben Studio-Bereiche, sondern der vollständige Produktkontext:

- Anlage, Zeichnen, Logik, Automation, Topologie, Runtime und Prüfung
- P&ID-/HMI-Inspector, Dialoge, Kontextmenüs und Projektwechsel
- Light, Dark und Dark-Brown
- Desktop und responsive Viewports
- Legacy-Routen und additive Versionsverträge V62 bis V64_r1

Das Automation Studio übernimmt Typografie, Abstände, Farben, Zustände, Modaldienst und V9-Tokens des vorhandenen Designsystems. Seine Styles greifen nicht auf andere Seiten über.

## Daten- und Exportkonsistenz

PF-AUTOMATION-STUDIO-V1 arbeitet direkt auf `v9_store`. Änderungen werden auf die 13 erlaubten Sektionen begrenzt und als ein Commit normalisiert, reconciled, validiert und publiziert. Der bestehende V9-JSON-Exporteur, lokale V9-Shards und V8-Cross-Shards erhalten daher dieselbe kanonische Quelle wie zuvor.

## Nicht verändert

- V9-Schema und Sektionsreihenfolge
- HTTP- und Projekt-API
- P&ID-/HMI-/Animationsmodell
- PF-LOGIC-V1 und Compiler
- Topologie-, Cross-, Validierungs- und Exportmodule
- vorhandene Projekt- und Nutzdaten
