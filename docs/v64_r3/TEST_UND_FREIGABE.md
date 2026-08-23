# V64_r3 – Test und Freigabe

## Prüfumfang

- statischer R3-Releasevertrag (`test/test_v64_r3_release.py`)
- R3-Modellvertrag Einrasten, Joints, Verbund, Drehen, Griffe, Baugruppen (`test/test_v64_r3_model.mjs`)
- R3-Serververtrag Baugruppen-Bibliothek (`test/test_v64_r3_server.py`)
- R3-Browservertrag Einrasten, Verbund, Alt-Lösen, Griffe, Baugruppe speichern/platzieren,
  Übernahme als Einzelobjekte, getrennte Inventare, Light/Dark/Brown (`test/smoke_v64_r3.py`)
- vollständige V62–V64_r2-Abwärtskompatibilität einschließlich des unveränderten r1-Beispiels

## Funktionale Kriterien

- Ein an einen freien Port gezogenes Teil rastet innerhalb der Toleranz ein und erzeugt genau einen Joint.
- Belegte Ports werden nicht erneut angeboten.
- Der Verbund bewegt sich gemeinsam; Alt + Ziehen entfernt die Joints des gelösten Teils.
- Griffe ändern Breite/Höhe und führen Ports relativ mit; R dreht um 90°.
- Baugruppen bewahren Teile, interne Joints und freie Ports; Platzieren erzeugt neue Entity-IDs.
- Ein Teil einer platzierten Baugruppe bleibt einzeln konfigurierbar (Name, Tag, Maße, Drehung).
- Übernahme als Einzelobjekte erzeugt je Teil eine Anlagen-Entity und je Joint eine Anlagenverbindung.
- Baugruppen erscheinen nicht im SVG-Template-Inventar; Anlagen-Symbole erscheinen nur nach
  expliziter Übernahme im Zeichen-Inventar.

## Visuelle Kriterien

- Steckmarken an geschlossenen Joints, orange Spannlinie an geöffneten Joints.
- Pulsierender Zielport und Beschriftung beim Einrasten.
- Griffe folgen dem Footprint auch bei gedrehten Teilen.
- Inventar-Register, Baugruppenkarten mit Vorschau und Übernahme-Karte in Light, Dark und Dark-Brown.
- Keine CSS-Auswirkung außerhalb der Zeichenebene.

## Lokale Freigabematrix

| Prüfbereich | Ergebnis |
|---|---:|
| V64_r3 statischer Releasevertrag | bestanden |
| V64_r3 Modellvertrag | 33/33 |
| V64_r3 Serververtrag | 20/20 |
| V64_r3 Browser- und Visualvertrag | 55/55 |
| V64 Browser-Regression | 46/46 |
| V64_r1 Browser- und Visualvertrag | 44/44 |
| V64_r2 Browser- und Visualvertrag | 37/37 |
| geerbte statische Verträge V64 / r1 / r2 | bestanden |
