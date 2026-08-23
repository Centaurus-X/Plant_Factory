# V64_r1 zu V64_r2 – Diff-Audit

## Ergebnis

V64_r2 erweitert den freigegebenen V64_r1-Stand ausschließlich im vorgesehenen Bereich der Automation-Konfigurationsoberfläche. Das V9-Schema, die Server-API, die Anlagen-, Zeichen-, HMI-, Logik-, Topologie-, Runtime- und Exportmodelle bleiben kompatibel.

## Produktive Änderungen

- neues, gekapseltes Modul `public/js/v9_ui_automation.js`
- neue, ausschließlich auf das Automation Studio begrenzte Styles in `public/css/v64_r2.css`
- additive Registrierung im vorhandenen V9-Bootstrap und Workspace-Router
- atomarer `replaceSections`-Pfad im bestehenden V9-Store
- Automation Studio als primäre Automation-Route; historische Routen bleiben adressierbar
- reine Releasekennzeichnung in Chrome, Index und Zeichenmodul

## Bewusst unverändert

- Python-Server und HTTP-/Projekt-API
- V9-Schema, Sektionsreihenfolge, Validatoren, Migration, Sharding und V8-Cross-Projektion
- PF-PID-V1-, PF-LOGIC-V1-, HMI-, SVG-Event- und Animationsverträge
- Anlagen- und Zeicheneditor einschließlich der V64_r1-Präzisionsimporte
- vorhandene Konfigurationen, Projekte, Referenz-SVGs und Nutzdaten

## Prüfartefakte

Die übrigen Unterschiede bestehen ausschließlich aus additiven Tests, Screenshots, Dokumentation, Releasemanifest und den auf V64_r2 erweiterten Prüfskripten. Temporäre Laufzeit- und Entwicklungsabhängigkeiten sind nicht Bestandteil des Releasearchivs.

## Freigabeentscheidung

Der Diff ist minimal-invasiv und entspricht dem geforderten Integrationsscope: Nur die primäre Automation-Konfigurationsoberfläche wird ersetzt; alle darunterliegenden Daten- und Exportpfade bleiben die bereits vorhandene kanonische Implementierung.
