# V64_r2 – Architektur und Bedienung

## Architektur

`v9_ui_automation.js` ist eine reine UI- und Orchestrierungsschicht. Es liest die kanonische Konfiguration aus `v9_store.js`, führt eine isolierte Arbeitskopie und schreibt ausschließlich geänderte, durch `SECTION_ORDER` erlaubte Sektionen über `replaceSections()` zurück.

```text
Automation Studio UI
        ↓
atomarer Patch aus erlaubten V9-Sektionen
        ↓
v9_store.replaceSections()
        ↓
orderSections → reconcile → validate → history/config:changed
        ↓
bestehende V9-, Shard-, Runtime- und Exportpfade
```

Die sieben fachlichen Views sind Übersicht, Prozesse & States, Regeln, Filter & Timer, Bibliothek, Engine und Gerätekarte. Bibliotheksendpunkte werden ausschließlich lesend verwendet.

## Bedienung

1. In der linken Hauptnavigation **Automation** wählen.
2. Über die horizontale Studio-Navigation den fachlichen Bereich öffnen.
3. Links ein Inventarobjekt auswählen oder neu anlegen.
4. In der Mitte strukturiert bearbeiten.
5. Rechts Kontext, Auswirkungen, Nutzung und kanonische V9-Sicht kontrollieren.
6. Globale Projektfunktionen für Speichern, Validieren und Export verwenden.

Die alte Automation-Unterseitenleiste ist bewusst verborgen. Bestehende Deep Links und Kompatibilitätstests können die historischen Routen weiterhin ansprechen.

## Sicherheits- und Stilgrenzen

- kein `innerHTML` im Automation-Modul
- keine nativen Browser-Dialoge
- kein `localStorage`
- keine Klassen, Arrow Functions oder Lambdas
- CSS vollständig auf den Studio-Host begrenzt
- Dialoge über den vorhandenen PF-MODAL-V1-Dienst
