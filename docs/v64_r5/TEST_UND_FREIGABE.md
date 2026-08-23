# V64_r5 – Test und Freigabe

## Prüfumfang

- statischer R5-Releasevertrag (`test/test_v64_r5_release.py`): Version, DOM, Ebenen-Schalter,
  Werkzeuge, Editor-/Modell-/Server-Token, 71 Templates, Klassik- und Gestell-Metadaten,
  Zustandsfarben, SMIL-Animation, CSS-Kapselung, Dokumente, Nachweise, Freigabegates,
  funktionaler Stil (keine Klassen, Lambdas, Dekoratoren, Pfeilfunktionen)
- R5-Modellvertrag (`test/test_v64_r5_model.mjs`): Ebenen, Leitungsstile und Presets,
  Punktlisten, Leitung/Bereich/Bemaßung, Verschieben, Grenzen, zentrierte Texte, Zustände und
  Ebenen der Entities, Rohr mit Flansch (Streckkappe 22), Flansch mit Verschraubung, Rohrstück
  mit Seitenanschluss, Blattrand, Baugruppen-Felder, beide Referenzbeispiele (Maße, Zählungen,
  Joints, Zustände, Leitungsstile, Lage der seitlichen Kapillare bei (494, 210))
- R5-Serververtrag (`test/test_v64_r5_server.py`): Ebenen- und Stil-Konstanten, Normalisierung
  von Zustand/Ebene/Punkten (max. 256)/Stil/Animation/Bereich/Bemaßung, Verwerfen externer
  Schrift-URLs, Gestell-Joints, Template-API mit `style`/`visual_states`/`default_visual_state`/
  `layer`, Streckprofile von Rohr mit Flansch und U-Bogen, Seitenanschluss-Ports,
  Bibliotheks-Roundtrip
- R5-Browservertrag (`test/smoke_v64_r5.py`): Inventar 66 + 5 Karten, Klassik-Karten,
  Gestell-Register, Werkzeuge, Ebenen- und Animationsschalter, Template-API, Stecken
  Rohr → Flansch → Rohr mit Flansch mit fester Flanschkappe, Zustände mit berechneten Farben,
  Taste Z, Animation anhalten/starten, Leitung per Klick + Enter/Escape, Bereich und Bemaßung
  per Ziehen, Gestell-Joint, Ebenen ein-/ausblenden, Bibliothek speichern/laden/löschen, beide
  Referenzbeispiele auf Referenzblatt mit Referenzrand, Sicherheitsabfrage, Export mit
  Laufstrichen/Zuständen/Leitungen ohne ausgeblendete Ebene, Light/Dark, Konsolen- und
  Seitenfehler
- vollständige V62–V64_r4-Abwärtskompatibilität einschließlich pixelidentischem Referenzexport

## Funktionale Kriterien

- Klassik-Teile stecken wie Standardteile; ein Rohr mit Flansch behält beim Strecken seinen
  Flanschbalken (`fixed [[0, 22], [158, 160]]`).
- Zustände färben Ofen `rgb(238, 28, 36)`, Kühler `rgb(30, 155, 232)`, offene Ventile
  `rgb(45, 179, 74)`, geschlossene Ventile rot; **Z** wechselt zyklisch.
- Laufstriche laufen per SMIL; der Animationsschalter pausiert die Zeichenfläche
  (`animationsPaused()`), der Export behält die Animation.
- Leitungen: Klick setzt Punkte, Umschalt orthogonal, Enter beendet, Escape verwirft; Stil und
  Animation sind im Inspektor änderbar.
- Bereiche tragen Titel innen oder über dem Rahmen; Bemaßungen tragen Maßtext innen oder auf
  der anderen Seite.
- Ebenen: ausgeblendete Ebenen verschwinden von der Zeichenfläche (Teile, Ports, Joints) und aus
  dem Export; Gestell-Joints nutzen die Verbindungsart `structure`.
- Die Bibliothek persistiert Leitungen, Bereiche, Bemaßungen, Zustände, Ebenen und Gestell-Joints.
- Das Reaktor-Beispiel hat 39 Teile, 23 geschlossene Joints, 31 Zeichenelemente, Blatt
  1300 × 1110, Rand 4; die Symbolvariante 19 Teile, 22 Zeichenelemente, Blatt 1150 × 830.
- Das Laden eines Beispiels über eine nicht leere Skizze fragt nach („Beispiel laden“).

## Visuelle Kriterien

- Reaktor-P&ID und Symbolvariante entsprechen den Referenzbildern in Geometrie, Farben,
  Strichstärken (22/16 px Rohr, 3,5 px Leitung, 4 px Flanschbalken) und Schriftgrößen
  (11/13 px Arial).
- Standard-Symbole (42 Templates) sind byte-identisch zu V64_r4.
- Klassik-Karten sind im Inventar als „Klassik“ gekennzeichnet; Gestellteile liegen im Register
  **Gestell**.
- Keine CSS-Auswirkung außerhalb der Zeichenebene; Dark Theme hellt Bereichs-, Bemaßungs- und
  Standardtexte auf, explizite Farben bleiben.

## Lokale Freigabematrix

| Prüfbereich | Ergebnis |
|---|---:|
| V64_r5 statischer Releasevertrag | bestanden |
| V64_r5 Modellvertrag | 82/82 |
| V64_r5 Serververtrag | 56/56 |
| V64_r5 Browser- und Visualvertrag | 95/95 |
| V64_r4 Browser- und Visualvertrag | 82/82 |
| V64_r3 Browser- und Visualvertrag | 56/56 |
| V64_r2 Browser- und Visualvertrag | 37/37 |
| V64_r1 Browser- und Visualvertrag | 44/44 |
| V64 Browser-Regression | 46/46 |
| geerbte statische Verträge V61 … V64_r4 | bestanden |
