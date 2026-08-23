# Plant Factory V62.1 — Test- und Freigabevertrag

## 1. Vollständige Prüfung

```bash
AUTOMATION_RUNTIME=/pfad/zu/automation_system_v0101 ./test_all.sh
```

Die Freigabekette umfasst 16 Stufen:

1. Python-Syntax und funktionalen Produktstil;
2. JavaScript-Syntax und funktionalen Produktstil;
3. deterministischen PF-PID-V1-Standard;
4. Markup und V62.1-Integrationsvertrag;
5. SVG-Sicherheit und isolierte HTTP-API;
6. konsolidierten SVG-Konverter;
7. JavaScript-Regressionssuite;
8. Python-/JavaScript-Formatparität;
9. reproduzierbaren Konfigurationsbuild;
10. deterministische V9-Migration;
11. V9-Lokal- und V8-Cross-Shards;
12. Regel- und Prozessbibliotheken;
13. Regelvertrag und externe Runtime-Autorität;
14. Plant-Factory-Modell-, Snapshot- und V9-Kernkette;
15. Serverstart, bestehende Browserregression und V62.1-Interaktionen;
16. Repository-, Dokumentations- und Releaseverträge.

## 2. Freigabeergebnis

Der vollständige Lauf wurde im Entwicklungsstand und erneut aus einem frisch
extrahierten Releasearchiv bestanden.

| Prüfbereich | Ergebnis |
|---|---:|
| PF-PID-V1 JavaScript-Vertrag | 31/31 |
| V9-Kern | 145/145 |
| JavaScript-Format | 42/42 |
| Python-Formatparität | 58/58 |
| Plant-Factory-Modellkette | 31/31 |
| Snapshot-Kette | 52/52 |
| Externe `automation_system_v0101`-Runtime | 29/29 |
| Chromium-Kompatibilitätslauf | 119/119 |
| Chromium-V62.1-Interaktionslauf | 45/45 |
| Vollständige Release-Stufen | 16/16 |

## 3. V62.1-Browservertrag

Der Browserlauf verifiziert insbesondere:

- der Bearbeiten-Button einer Verbindung öffnet ein sichtbares, verwaltetes
  Modal;
- Abbrechen verändert die Verbindung nicht;
- Speichern aktualisiert zulässige Eigenschaften atomar;
- inkompatible Endpunkte und Ports liefern unterschiedliche Gründe;
- statische und dynamische Dialoge besitzen Drag-, Resize-, Center- und
  Maximize-Steuerung;
- der Inspector-Einblendeschalter bleibt während des gesamten Einklappens im
  44-Pixel-Rail sichtbar und anklickbar;
- Rechtsklick auf Objekt, Verbindung und freie Zeichenfläche erzeugt den
  passenden Kontext;
- Objektaktionen öffnen die vorhandenen Inspector- und HMI-Bereiche;
- das HMI-Setup zeigt vier verständliche Schritte und die Datenfluss-Pipeline;
- Buttons und Toggle bleiben optional;
- es entstehen keine Page-, Request- oder Konsolenfehler.

## 4. Architekturprüfung und Abhängigkeiten

Die Architekturprüfung gilt ausschließlich für den Plant-Factory-Produktcode.
Ausgeschlossen werden:

- `.venv/` und `venv/` einschließlich `site-packages`;
- `node_modules/`;
- `__pycache__/`, `.pytest_cache/`, `.mypy_cache/`;
- `.release_test.*`.

Diese Verzeichnisse enthalten installierte Fremdpakete oder temporäre
Prüfarbeitsstände. Sie werden nicht als eigener Produktcode bewertet, bleiben
aber als Laufzeitabhängigkeiten in den funktionalen Tests aktiv.

## 5. Archivfreigabe

Das Releasearchiv enthält 303 Dateien. `SHA256SUMS` prüft die übrigen 302
Dateien und schließt nur sich selbst aus. Bestätigt wurden:

- keine absoluten Pfade oder Pfadtraversal-Einträge;
- keine Symlinks, virtuelle Umgebung, Node-Abhängigkeiten oder Python-Caches;
- erhaltene Unix-Ausführungsrechte;
- vollständige Prüfsummen nach frischer Extraktion;
- vollständiger 16-stufiger Test aus dem extrahierten Archiv;
- byte-identischer zweiter deterministischer Build.

## 6. Anlagenfreigabe

Die Softwarefreigabe ersetzt keine Anlagenabnahme. Für produktive
SPS-/SCADA-Kopplung sind zusätzlich FAT/SAT, I/O-Punktprüfung, Safety- und
Security-Bewertung, Rollen- und Rechtekonzept, TLS-/Netzwerkfreigabe,
Backup/Restore und Monitoring erforderlich.
