# V64_r6 – Architektur und Bedienung

## Ziel

Eine Zeichenbaugruppe muss im Anlagenbild gleichzeitig zwei Eigenschaften
besitzen: Sie bleibt visuell und fachlich als zusammengehöriger Entwurf
erkennbar, ihre Geräte bleiben jedoch elementare Anlagenobjekte mit eigenen
Ports, I/O-, Device-, HMI- und Runtime-Zuordnungen.

## Datenfluss

    Zeichenbaugruppe (Schema plant-factory.plant-drawing-assembly, Version 1)
        → SVG-Artefakt mit Layout und R6-Metadaten
        → POST /api/templates als composition_mode = structured-assembly
        → Server normalisiert eingebettete Baugruppe und Exportgrenzen
        → Anlagen-Inventar kennzeichnet Karte als Baugruppe
        → generischer Platzierungshook erzeugt Layout + Entities + Connections
        → bestehender Anlagen-Inspector bearbeitet jedes Einzelteil

## Templateprojektion

Der Kompositionsmodus und die eingebettete Baugruppe sind optionale
Metadaten eines Custom-Templates. Der Server akzeptiert nur den bekannten
Modus structured-assembly. Danach wird dieselbe Normalisierung wie bei
gespeicherten Zeichenbaugruppen angewendet. Teil- und Verbindungszahlen werden
nicht vom Client vertraut, sondern neu berechnet.

Die Exportgrenzen enthalten x, y, width und height als endliche Zahlen.
Ungültige Metadaten werden verworfen; das Template bleibt als flaches SVG
verwendbar.

## Platzierung im Anlagenbild

### Passive Layout-Entity

Die Custom-SVG-Entity bewahrt die nicht-elementaren Zeichnungsanteile:

- Bereiche und gestrichelte Rahmen;
- Bemaßungen und Maßketten;
- freie Linien und Beschriftungen;
- blattbezogene Details.

Sie trägt drawing_assembly_role = layout und nimmt keine Zeigerereignisse
entgegen. Eingebettete data-pf-entity-id- und data-pf-connection-id-Gruppen
werden nur in dieser Layoutkopie ausgeblendet.

### Elementare Entities

Jedes Teil wird über den bestehenden Elementmanager erzeugt. Template-ID,
Geometrie, Drehung, Skalierung, Spiegelung, Zustand, Ebene, Beschriftung und
skalare Eigenschaften bleiben erhalten. Ergänzt werden ausschließlich
Herkunftsmetadaten:

- drawing_source_entity_id;
- drawing_assembly_id;
- drawing_assembly_template_id;
- drawing_assembly_name;
- drawing_assembly_role = part.

Damit gelten unverändert alle bestehenden Anlagenfunktionen: Auswahl,
Mehrfachauswahl, Details, I/O, HMI, Zustände, Ebenen, History und Export.

### Verbindungen

Gültige interne Joints werden nach den Entities über den bestehenden
Connection Mapper angelegt. Quell- und Zielport bleiben semantisch. Die
gesamte Platzierung bildet einen Historienpunkt; partielle Undo-Zustände
werden vermieden.

### Transformation

Der Mittelpunkt der gespeicherten Exportgrenzen ist der lokale Drehpunkt.
Position, Skalierung und Drehung der Inventarkarte werden gleichermaßen auf
Layout, Entities und Ports angewendet. Dadurch bleiben Zeichnung und reale
Anlagenobjekte deckungsgleich.

## Kategoriennavigation

Die vorhandene Kategoriezeile bleibt eine horizontale Flexliste. R6 macht
ihre native Scrollbar sichtbar und ergänzt:

- role tablist am Container und role tab an jeder Kategorie;
- aria-selected und genau einen tabindex 0;
- Pfeil links/rechts, Pos1 und Ende;
- scrollIntoView-äquivalentes, kontrolliertes Sichtbarhalten;
- Focus-Visible- und Forced-Colors-Stile.

Der Test belegt Bedienbarkeit und Browsersemantik; eine pauschale
WCAG-Konformitätsbehauptung ist damit ausdrücklich nicht verbunden.

## Gebündelter Anlagenentwurf

ID: assembly_template_mt4tvvee_tuvofeq

| Merkmal | Wert |
|---|---:|
| Entities | 31 |
| Verbindungen | 14 |
| Zeichenelemente | 45 |
| Gesamtbestandteile | 90 |
| Breite | 1152 |
| Höhe | 1068 |
| Kategorie | Baugruppen |

## Bedienung

1. **Zeichnen** öffnen und **Baugruppen** wählen.
2. **Anlagen Entwurf** auf die Zeichenfläche setzen; alle Teile bleiben dort
   elementar editierbar.
3. **Als editierbare Baugruppe ins Anlagenbild** ausführen.
4. **Anlage** öffnen, unter **Eigene Symbole** die Baugruppenkarte einsetzen.
5. Ein einzelnes Gerät anklicken und Details, I/O oder HMI konfigurieren.
6. Die Layout-Entity nur für die gemeinsame Zeichnungsdarstellung verwenden.

Für ein einzelnes, nicht zerlegbares Symbol den ausdrücklich bezeichneten
flachen SVG-Weg verwenden.
