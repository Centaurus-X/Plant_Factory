# Plant Factory V64_r6 – Release Notes

## Ergebnis

V64_r6 ergänzt V64_r5 additiv um einen durchgängigen, editierbaren
Baugruppenweg zwischen **Anlage · Zeichnen** und dem Anlagenbild. Eine
strukturierte Zeichenbaugruppe erscheint weiterhin als zusammengehöriger
Entwurf, wird beim Einsetzen aber in reale Anlagen-Entities und Verbindungen
aufgelöst. Dadurch lassen sich Sensoren, Aktoren, Instrumente, Rohre,
Flansche und Apparate einzeln auswählen und über Details, I/O, HMI, Linien
und Ebenen konfigurieren.

Die Kategoriennavigation des Anlagen-Inventars besitzt nun einen sichtbaren
horizontalen Scrollbalken und eine vollständige Tastaturführung. Die
bisherigen Standard-, Legacy- und Custom-SVG-Wege bleiben erhalten.

## Änderungen

1. **Sichtbare Kategorien-Scrollbar**
   - native horizontale Scrollbar statt verborgenem Scrollbereich;
   - stabiler Platz durch scrollbar-gutter und begrenztes Überscrollen;
   - aktive Kategorie wird automatisch vollständig sichtbar;
   - Dark-, Dark-Brown-, Light- und Forced-Colors-Darstellung berücksichtigt.
2. **Barrierearme Kategorienavigation**
   - Tablisten-/Tab-Semantik und programmatisch gepflegter Auswahlstatus;
   - genau eine Kategorie im Tab-Fokus;
   - Pfeil links/rechts, Pos1 und Ende wechseln Kategorie und Fokus;
   - deutlich sichtbarer Tastaturfokus.
3. **Strukturierte Custom-Baugruppen**
   - Kompositionsmodus structured-assembly als additives Templatefeld;
   - eingebettetes, serverseitig normalisiertes Zeichenbaugruppenmodell;
   - reale Anlagen-Entities und -Verbindungen beim Platzieren;
   - ein gemeinsamer Historienpunkt für die vollständige Platzierung.
4. **Elementare Editierbarkeit im Anlagenbild**
   - jedes eingebettete Gerät bleibt eine normale Anlagen-Entity;
   - bestehende Inspektorregister Details, I/O, HMI, Linien und Ebenen gelten
     unverändert für jedes Einzelteil;
   - Baugruppenzugehörigkeit bleibt über stabile Metadaten nachvollziehbar.
5. **Originalgetreues Layout ohne Doppelzeichnung**
   - Texte, Bereiche, Bemaßungen und nicht-gerätetechnische Details bleiben
     in einer passiven Layout-Entity sichtbar;
   - in der Layout-Entity eingebettete Geräte- und Verbindungsebenen werden
     ausgeblendet, weil die echten Entities darüber liegen;
   - die Layout-Entity nimmt keine Zeigerereignisse entgegen.
6. **Kompatibilitätsweg und Migration**
   - flache SVG-Custom-Entities bleiben ausdrücklich verfügbar;
   - ältere passende Anlagenentwürfe können über den Inspektor in die
     elementare Baugruppe umgewandelt werden;
   - unbekannte oder unvollständige Kompositionsmetadaten fallen sicher auf
     den bisherigen flachen Modus zurück.
7. **Gebündelter Anlagenentwurf**
   - direkt unter Zeichen-Inventar → Baugruppen;
   - 31 elementare Entities, 14 gesteckte Prozessverbindungen;
   - 45 Zeichnungs-, Beschriftungs- und Maßelemente;
   - Blattmaß 1152 × 1068; keine aktive Animation erforderlich.

## Daten- und API-Vertrag

- Projekt- und Baugruppenschema bleiben Version 1.
- Der neue Template-Kompositionsmodus ist optional und additiv.
- Der Server berechnet Teil- und Verbindungszahlen aus den validierten Daten.
- Hängende Verbindungen und nicht skalare Entity-Eigenschaften werden nicht
  in den freigegebenen Templatevertrag übernommen.
- V9-, Runtime-, SCADA-, SVG-, HMI-, Logik- und Automation-Verträge bleiben
  unverändert kompatibel.

## Bedienung

1. In **Anlage · Zeichnen** eine vorhandene Baugruppe wählen oder Teile
   zusammenstellen.
2. **Als editierbare Baugruppe ins Anlagenbild** verwenden.
3. Im Anlagenbild unter **Eigene Symbole** die Karte mit Kennzeichen
   **Baugruppe · 31 Teile** einsetzen.
4. Ein Gerät im Anlagenbild anklicken und Details, I/O oder HMI bearbeiten.
5. Für ein bewusst einzelnes Custom-SVG weiterhin **Als flaches SVG ins
   Anlagen-Inventar** wählen.

## Kompatibilität

V64_r6 ist additiv zu V64_r5. Die Symbolbibliothek bleibt bei 71 kanonischen
PF-PID-V1-Templates; Standard- und Klassik-SVGs werden nicht verändert.
Bestehende Projekte und flache Custom-Symbole bleiben ladbar.
