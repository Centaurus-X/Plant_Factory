# Tiefe Diagnose und Releasekonsolidierung V62.1

## Fehlerursachen

### Bearbeiten einer Verbindung

Der alte Listeneintrag verwendete einen im HTML-String erzeugten
`onclick`-Handler. Die Content-Security-Policy `script-src 'self'` blockiert
Inline-JavaScript. Deshalb reagierte der sichtbare Button nicht, obwohl die
fachliche Verbindungslogik vorhanden war.

Die Korrektur verwendet einen dauerhaften Listener am Verbindungslisten-Host
und `data-connection-action`. Dadurch funktionieren auch nachträglich
neu gerenderte Karten ohne neue Inline-Handler. Der neue Editor bearbeitet eine
lokale Kopie und schreibt erst beim Speichern in Zustand, SVG-Pfad und History.

### Eingeklappter Inspector

Der Collapse-Zustand reduzierte den rechten Grid-Track auf 44 Pixel. Gleichzeitig
blieben zwei Headeraktionen in einer für den erweiterten Inspector berechneten
Flexanordnung. Der Einblendeschalter konnte dadurch an der rechten Kante
abgeschnitten werden. V62.1 blendet das Überlaufmenü im Rail aus und positioniert
den Schalter mit einer eigenen 30-Pixel-Geometrie bei `left: 7px`.

## Minimale Eingriffsstrategie

- PF-PID-V1, Projektmodell und Exportformate bleiben unverändert.
- Bestehende Controller werden nicht ersetzt, sondern durch additive Dienste
  und sichere Ereignisdelegation ergänzt.
- Der Fenstermanager erkennt vorhandene `.modal`- und `.v9-modal`-Strukturen.
- Das Kontextmenü ruft ausschließlich etablierte Inspector-, Element-,
  Connection- und History-Funktionen auf.
- PF-HMI-SETUP-V2 ändert Labels und Führung, nicht die gespeicherten Feldnamen.

## Ergebnis

V62.1 führt die drei neuen UI-Verträge PF-MODAL-V1,
PF-CANVAS-CONTEXT-V1 und PF-HMI-SETUP-V2 ein. Legacy-Objekte, Animationen,
Runtime-Konfiguration, HMI-Modelle und beide Exportpfade bleiben kompatibel.

## Finale Verifikation

Die transitionsichere Inspector-Geometrie wurde im Chromium-Lauf an mehreren
Zeitpunkten unmittelbar nach dem Einklappen geprüft. Der Einblendeschalter
bleibt vollständig innerhalb des 44-Pixel-Rails. Der Verbindungseditor wurde
auf Öffnen, Abbrechen, atomisches Speichern, Verschieben, Zentrieren,
Maximieren und Wiederherstellen geprüft. Die Canvas-Kontexte für freie Fläche,
Objekt und Verbindung sowie die Kopplung zum geführten HMI-Setup wurden ohne
Page-, Request- oder Konsolenfehler verifiziert.

Der vollständige Releasevertrag ist bestanden: 16/16 Stufen, 119/119 bestehende
Browserprüfungen und 45/45 V62.1-Interaktionsprüfungen. Die bereitgestellte
`automation_system_v0101`-Runtime bestätigt 29/29 Regelvertragsprüfungen.

Das finale Archiv wurde frisch extrahiert, über 302 interne Prüfsummen
kontrolliert und erneut vollständig getestet. Ein zweiter deterministischer
Archivbau ist byte-identisch. Damit ist V62.1 als reproduzierbare
Software-Baseline freigegeben; die konkrete Anlagenfreigabe bleibt von FAT/SAT,
I/O-, Safety-, Security- und Infrastrukturabnahme abhängig.
