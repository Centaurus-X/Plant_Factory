# V64_r4 – Test und Freigabe

## Prüfumfang

- statischer R4-Releasevertrag (`test/test_v64_r4_release.py`)
- R4-Modellvertrag Streckprofile, Spiegeln, Invertieren, Skalierungsmodi, wachsendes Blatt,
  R4-Beispiel (`test/test_v64_r4_model.mjs`)
- R4-Serververtrag Streckprofil in der Template-API, Geometriefelder in der Baugruppen-Bibliothek,
  neue PF-PID-V1-Teile (`test/test_v64_r4_server.py`)
- R4-Browservertrag Strecken per Griff, F/I/Umschalt+F, Inspektor-Register, Kontextmenü,
  Strg-Navigation, wachsendes Blatt, Neubau der Rohrofen-Anlage per Mausgesten, Baugruppe und
  Custom-Entity speichern, Offenlegen im Anlagen-Inventar, Einsetzen, R4-Beispiel, Light/Dark
  (`test/smoke_v64_r4.py`)
- vollständige V62–V64_r3-Abwärtskompatibilität einschließlich pixelidentischem Referenzexport

## Funktionale Kriterien

- Ein gestrecktes Rohr zeichnet feste Endkappen und Pfeil in Originalgröße; die Grafik füllt die
  gesamte Länge; der Port sitzt exakt am Ende.
- Spiegeln mappt Ports mit und ist reversibel; Invertieren tauscht Ein-/Ausgang und dreht alle
  markierten Pfeile.
- Geräte behalten beim Griffziehen ihr Seitenverhältnis; Ports bleiben auf dem Symbol.
- Ein Teil im Blattrand verschiebt den Inhalt rasterbündig, die relative Lage bleibt erhalten;
  ein Teil hinter dem Blattende vergrößert das Blatt; der Blattrahmen folgt.
- Inspektor: vier Register bei einem Teil, zwei ohne Auswahl; Länge/Höhe, Invertieren, Spiegeln,
  Portrichtungen, Eigenschaften und Blattmaße werden übernommen.
- Kontextmenü öffnet per Rechtsklick, führt Aktionen aus und schließt mit Escape.
- Strg + Ziehen verschiebt die Ansicht, Strg + Klick schaltet die Auswahl um, Strg + Pfeil
  verschiebt.
- Neubau: neun Teile per Ablegen-nahe-Port, Drehen und Ziehen ergeben acht geschlossene Joints;
  Doppelklick wählt alle neun; Baugruppe und Custom-Entity werden mit Geometrieflags gespeichert;
  die Anlagen-Bibliothek wechselt auf „Eigene Symbole“; das Einsetzen erzeugt ein Element.
- Das R4-Beispiel hat 31 Teile, 25 geschlossene Joints und beschriftete Grenzstellen.

## Visuelle Kriterien

- Raster deckt die gesamte Ansicht, gestrichelter Blattrahmen zeigt das Exportmaß.
- Register, Flags, Port-Tabelle, Eigenschaftszeilen und Kontextmenü in Light und Dark.
- Keine CSS-Auswirkung außerhalb der Zeichenebene (Ausnahme: Hervorhebung der gespeicherten
  Custom-Entity in der Anlagen-Bibliothek).

## Lokale Freigabematrix

| Prüfbereich | Ergebnis |
|---|---:|
| V64_r4 statischer Releasevertrag | bestanden |
| V64_r4 Modellvertrag | 48/48 |
| V64_r4 Serververtrag | 23/23 |
| V64_r4 Browser- und Visualvertrag | 82/82 |
| V64_r3 Browser- und Visualvertrag | 56/56 |
| V64_r2 Browser- und Visualvertrag | 37/37 |
| V64_r1 Browser- und Visualvertrag | 44/44 |
| V64 Browser-Regression | 46/46 |
| geerbte statische Verträge V61 … V64_r3 | bestanden |
