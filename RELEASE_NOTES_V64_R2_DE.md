# Plant Factory V64_r2 – Release Notes

## Ergebnis

V64_r2 übernimmt V64_r1 vollständig und ersetzt ausschließlich die primäre Automation-Konfigurationsoberfläche durch **PF-AUTOMATION-STUDIO-V1**. Das kanonische V9-Modell, die Server-API, Projektdateien, Exporte, Shards und alle anderen Arbeitsbereiche bleiben unverändert kompatibel.

## Neu im Automation Studio

- Übersicht mit V9-Inventar, Geräteabdeckung, Zustands-/Regelabdeckung und konkreten Empfehlungen
- Prozesse & States mit typisierten Formularen, Geräteauswahl, Strategien und Vorlagen
- Regeln als verständlicher WENN–BIS–DANN–SONST-Satzbaukasten
- Filter & Timer mit direktem Nutzungsnachweis
- Bibliothek für alle relevanten V9-Katalogtabellen
- Rule-Engine als strukturiertes Formular ohne JSON-Rohtexteingabe
- Gerätekarte für den Zusammenhang Controller → I/O → State → Regel

Das Studio bearbeitet 13 kanonische V9-Sektionen. Mehrere geänderte Sektionen werden atomar als ein Store-Commit übernommen. Dadurch bleiben Undo/Redo, Validierung, Dirty-State und Export auf derselben Datenwahrheit.

## Abwärtskompatibilität

- Der präzise V64_r1-Zeicheneditor bleibt vollständig erhalten.
- Die Legacy-Routen `processes`, `rules`, `v9-states` und `v9-rules` bleiben für Deep Links, Tests und bestehende Integrationen erreichbar.
- Die primäre Automation-Navigation zeigt nur noch das neue Studio und vermeidet doppelte Bedienpfade.
- Topologie, Cross V8, Validierung, Logik, HMI, Runtime, P&ID, Projekt- und Exportpfade bleiben additive Nachfolger ohne Schemaänderung.

## Technische Referenzen

`PFAUTOMATIONSTUDIOV1_Integration_und_DiffPatch.md`, `Automation_Studio_V9_Prototyp.html` und `PFAUTOMATIONSTUDIOV1_patch_bundle.zip` wurden als technische Referenzen analysiert. Maßgeblich für die Integration waren der Nutzerauftrag, die vorhandene Plant-Factory-Architektur und die freigegebenen V9-Verträge.
