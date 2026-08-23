# PF-V63.2-STABILITY

## Normativer Zweck

Dieser Vertrag ergänzt PF-PID-V1, PF-MODAL-V1, PF-HMI-SETUP-V2 und
PF-LOGIC-V1, ohne deren Datenmodelle zu verändern.

## Verbindungsdialog

- Defaultbreite: 620 px.
- Maximale Breite: Viewport minus 32 px.
- Höhe: inhaltsabhängig.
- Maximale Höhe: Viewport minus 32 px.
- Resize, Drag, Center und Maximize bleiben erlaubt.
- Beim erneuten Öffnen wird nur bei `data-window-reset-on-open="true"` die
  Defaultgeometrie wiederhergestellt.

## Verbindungslayout

- Eine gespeicherte Modellverbindung darf beim Rendern niemals dupliziert
  werden.
- Ungültige oder noch nicht verfügbare SVG-Geometrie bleibt `pending`.
- Sichtbar wird eine Linie ausschließlich mit endlichen Koordinaten und einem
  validen Pfad ohne `NaN`, `Infinity` oder `undefined`.
- Rebuilds müssen ältere Retry-Zyklen abbrechen.
- Objektbewegungen dürfen nur die Geometrie, nicht die Modellanzahl ändern.

## I/O-Auswahl

- Genau eine Canvas-Auswahl aktiviert dasselbe Objekt im I/O-Editor.
- Vorhandene Zuweisungen werden vollständig geladen.
- Mehrfachauswahl wird nicht automatisch auf eine einzelne I/O-Entity
  reduziert.

## Additive Demo

- Die Demo besitzt die stabile ID `logic_timer_counter_demo`.
- Sie darf `project.logic` niemals ersetzen.
- Mehrfaches Öffnen erzeugt keine Duplikate.
- Eigene Schaltpläne und deren Graphen bleiben byte-semantisch unverändert.
