# Test- und Freigabevertrag V63.1

`test_all.sh` führt 17 Stufen aus:

1. Python-Syntax und funktionaler Stil;
2. JavaScript-Syntax und funktionaler Stil;
3. PF-PID-V1;
4. PF-LOGIC-V1-Bibliothek, Core, Compiler und Runtime;
5. Markup- und Releaseverträge;
6. Security und HTTP-API;
7. SVG-Konverter;
8. JavaScript-Regression;
9. Formatparität;
10. reproduzierbarer Konfigurationsbuild;
11. deterministische V9-Migration;
12. V9-/V8-Sharding;
13. Regel- und Prozessbibliotheken;
14. Rule-Contract und optionale Runtime-Autorität;
15. Plant-Factory-Modellkette;
16. Serverstart und Chromium-Smoke für V62- und V63-Interaktionen;
17. abschließende Repository- und Dokumentationsprüfung.

Besonders geprüft werden:

- leere additive Logic-Modelle und Legacy-Projektladung;
- 33 eindeutige Blocktypen und deterministische Generatorausgabe;
- Porttypen, Zyklen und Writerkonflikte;
- idempotente V9-Regelerzeugung;
- physisch bereinigte V8-Cross-Ausgabe;
- TON/TOF/TP/CTU/CTD in JavaScript und Python;
- bereitgestellte V9-Runtime-Referenz mit vier WAGO-/Modbus-Controllern;
- Schaltplaninventar, Drag, Undo, Kontextmenü, Inspector und Compiler-Modal;
- Rückkehr in alle bestehenden Plant-/HMI-Arbeitsbereiche;
- vollständige Browserdiagnostik ohne Console-, Page- oder Request-Fehler.

Eine Softwarefreigabe ersetzt keine Anlagenfreigabe. Vor Produktivbetrieb sind
FAT/SAT, I/O-Punktprüfung, Safety, Security, PLC-/SCADA- und Netzwerkabnahme
verpflichtend.

## Freigabeergebnis

Alle 17 Stufen sind bestanden. Die V63-spezifischen Verträge erreichen 66/66
JavaScript-, 35/35 Python-Runtime-, 75/75 statische und 51/51 Browserprüfungen.
Zusätzlich bleiben die 119 Basis- und 45 V62-Browserprüfungen grün. Die
bereitgestellte `automation_system_v0101`-Autorität besteht 29/29 Prüfungen.

Das deterministische Archiv enthält 335 Dateien sowie 334 Prüfsummeneinträge
und wurde aus einem frischen Extract erneut geprüft.
