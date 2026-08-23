# Test und Freigabe V63.2

## Prüfkette

Die vollständige Freigabe wird durch `./test_all.sh` ausgeführt. Sie umfasst:

1. Python-Syntax und funktionalen Stil.
2. JavaScript-Syntax und funktionalen Stil.
3. PF-PID-V1-Generator und Objektstandard.
4. PF-LOGIC-V1, Runtime-Adapter und PF-AUTOMATION-V9-BRIDGE.
5. Statische V61.1-, V62.1-, V63.1- und V63.2-Verträge.
6. Security und isolierte HTTP-API.
7. SVG-Konverter.
8. JavaScript-Regressionssuite.
9. Formatparität.
10. Reproduzierbaren V9-Konfigurationsbuild.
11. Deterministische Migration.
12. V9-/V8-Cross-Sharding.
13. Regel- und Prozessbibliotheken.
14. Regelvertrag und externe Runtime-Autorität.
15. Plant-Factory-, Snapshot- und V9-Modellkette.
16. Chromium-Browserprüfungen einschließlich der vier V63.2-Regressionen.
17. Deterministischen Beispielprojekt-Build.
18. Abschluss-, Manifest- und Dokumentationsprüfung.

## V63.2 Browserregressionen

- kompakter Verbindungsdialog nach normalem, maximiertem und erneutem Öffnen;
- fünf gespeicherte Verbindungen unmittelbar nach Projektladung;
- endliche Pfade und unveränderte Modellanzahl nach Objektbewegung;
- automatische I/O-Auswahl einschließlich vorhandener Felder;
- eigener Schaltplan bleibt beim Wechsel zur Timer-/Counter-Demo erhalten;
- konsolidierte Automation-Navigation und V9-Bridge-Zusammenfassung.

## Releasekriterien

- alle 18 Stufen bestanden;
- keine Browser-Konsolen-, Seiten- oder Requestfehler;
- externe `automation_system_v0101`-Autorität bestanden;
- zweiter Archivbuild byte-identisch;
- keine Symlinks, absoluten Pfade oder Pfadtraversal-Einträge;
- alle internen SHA-256-Prüfsummen gültig;
- vollständiger Test aus einem frisch extrahierten Archiv bestanden.

## Ergebnis

Alle 18 Release-Stufen wurden im Entwicklungsstand und aus dem unveränderten,
frisch extrahierten Archiv bestanden. Der deterministische Doppelbuild war
byte-identisch; Archivpfade, Symlinks und interne SHA-256-Prüfsummen wurden
zusätzlich geprüft.

Wesentliche Zähler:

- PF-PID-V1: 31/31;
- PF-LOGIC-V1 JavaScript: 66/66;
- PF-LOGIC-V1 Runtime: 35/35;
- PF-AUTOMATION-V9-BRIDGE: 40/40;
- statischer V63.2-Vertrag: 86/86;
- externe Runtime-Autorität: 29/29;
- Browser: 119/119 + 45/45 + 51/51 + 45/45.

Der maschinenlesbare Status ist in `RELEASE_MANIFEST_V63_2.json` festgehalten.
