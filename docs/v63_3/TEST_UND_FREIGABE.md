# Test und Freigabe V63.3

## Prüfkette

Die vollständige Freigabe wird durch `./test_all.sh` ausgeführt. Sie umfasst
19 Stufen:

1. Python-Syntax und funktionalen Stil.
2. JavaScript-Syntax und funktionalen Stil.
3. PF-PID-V1-Generator mit 26 Symbolen.
4. PF-LOGIC-V1 und PF-AUTOMATION-V9-BRIDGE.
5. Statische Verträge V61.1 bis V63.3.
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
16. Chromium-Browserregressionen V61.1 bis V63.3.
17. Deterministisches vollständiges Beispielprojekt.
18. V63.3 UX-, Symbol- und Widget-/Objekt-Vertrag.
19. Abschluss-, Dokumentations- und Prüfsummengates.

## V63.3 Browserregressionen

- I/O-Aktionsleiste enthält Speichern und Entfernen nebeneinander;
- Zuordnungsregister startet eingeklappt und ist zugänglich umschaltbar;
- Tabellenzeilen behalten eine stabile Spaltengeometrie;
- lange Element- und Aliaswerte werden ohne Datenverlust gekürzt;
- Generic_Sensor_Entity ist in der Kategorie Messstellen auffindbar;
- Widgetregister steht direkt unter der Schritt-1-Einleitung;
- Objekt-Dropdown übernimmt die aktuelle Canvas-Auswahl;
- explizites Anlegen erzeugt Widget und Objektbinding atomar;
- vorhandene Device-Zuweisung wird als passende Runtime-Quelle übernommen;
- Widgetrelation wird im Editor sichtbar und zum Binding navigierbar;
- keine Browser-Konsolen-, Seiten- oder Requestfehler.

## Freigabekriterien

- alle 19 Stufen bestanden;
- vollständiger Test im Entwicklungsbaum und aus einem frisch extrahierten
  Archiv;
- externe `automation_system_v0101`-Autorität bestanden;
- deterministischer Doppelbuild byte-identisch;
- keine Symlinks, absoluten Pfade oder Traversal-Einträge;
- alle internen SHA-256-Prüfsummen gültig;
- Screenshots aus dem finalen Build erzeugt.

## Anlagenfreigabe

Die automatisierte Freigabe bestätigt die Software-Baseline. Eine konkrete
Produktionsanlage benötigt zusätzlich FAT/SAT, reale I/O-Punktprüfung,
Safety- und Security-Freigabe sowie die Abnahme der eingesetzten SPS-/SCADA-,
Feldbus- und Netzwerkinfrastruktur.

## Finales Ergebnis

- Quellbaum: bestanden;
- Fresh Extract: bestanden;
- externe `automation_system_v0101`: 29/29;
- Chromium-Verträge: 320/320;
- V63.3 UX-Browservertrag: 60/60;
- deterministischer Doppelbuild: byte-identisch;
- Archiv: 372 Dateien und 371 interne SHA-256-Einträge;
- keine Symlinks, Pfadtraversal-Einträge oder ausgeschlossenen
  Abhängigkeitsverzeichnisse.

Der temporäre Release-Arbeitsbereich liegt außerhalb des Quellbaums. Damit
bleibt die Prüfkette auch bei Repository-Scans und reproduzierbaren
Zwischenbuilds stabil.
