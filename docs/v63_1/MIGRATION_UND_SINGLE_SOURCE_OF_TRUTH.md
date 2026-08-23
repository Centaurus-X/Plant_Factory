# Migration und Single Source of Truth

## Bestehende Projekte

Beim Laden eines Projekts ohne `logic` wird ein leeres PF-LOGIC-V1-Modell
angelegt. Es werden keine Nodes, Regeln oder HMI-Widgets automatisch erzeugt.
Alle bisherigen Projektbereiche bleiben unverändert.

## Neue Logik

Ein Schaltplan referenziert bestehende Anlagen- und Runtimeobjekte. Er besitzt
keine Kopie ihrer Geometrie oder Hardwarekonfiguration. Änderungen an stabilen
IDs und Bindings werden über den Signalkatalog sichtbar; verwaiste Referenzen
werden als Diagnose gemeldet.

## Export

Der Export normalisiert und validiert zuerst `project.logic`. Danach werden alle
Zielartefakte in einem Durchlauf erzeugt. V9-Regeln mit PF-LOGIC-Kennzeichnung
werden idempotent ersetzt. Manuell gepflegte Regeln bleiben erhalten.

## Konflikte

Ein klassisch direkt gesteuertes Ziel kann nicht zusätzlich im Logic-Modus
beschrieben werden. Der Compiler verlangt entweder die Umstellung auf
`logic` oder eine bewusste `hybrid`-Deklaration. Dadurch kann keine
unbeabsichtigte Doppelsteuerung entstehen.

## Rückweg

Das Entfernen aller Schaltpläne stellt den bisherigen reinen Plant-/HMI-/Runtime-
Betrieb wieder her. Abgeleitete PF-LOGIC-Regeln werden beim nächsten Export
entfernt beziehungsweise ersetzt; manuelle Regeln bleiben unberührt.
