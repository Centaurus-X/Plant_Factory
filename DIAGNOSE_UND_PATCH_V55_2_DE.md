# V55.2 — Drei Bedienelemente lagen hinter der Kante

**Stand:** 55.2.0 · Vorgänger: 55.1.0 (`DIAGNOSE_UND_PATCH_V55_1_DE.md`)

> **Umfang.** Diese Runde behebt drei Layoutfehler, die V55.1 selbst
> eingeführt hat. Es ändert sich **keine** Zeile am Config-Vertrag, an den
> Prüfungen, am Ausgabeformat oder am Funktionsumfang. Betroffen sind zwei
> Dateien: `public/css/layout.css` und `public/js/v9_ui_chrome.js`.
> Alles aus V54.3 und V55.1 gilt unverändert weiter.

---

## 0. Was V55.1 falsch gemacht hat

V55.1 hatte einen echten Mangel behoben: zwölf gleichrangige Tabs in einer
Reihe, die je nach Fensterbreite auf zwei bis drei Zeilen umbrach — Tabs
wanderten unter dem Zeiger weg. Die Gruppierung in drei Phasen war richtig.

Das Mittel war falsch. An die Tabzeile und an die Werkzeugleiste kam
`overflow: hidden`. Damit hört das Umbrechen auf — aber alles, was nicht
hineinpasst, ist weg. **Ohne Rollbalken heißt weg: unerreichbar.**

Gemessen bei 924 px Fensterbreite und 340 px Leistenbreite:

| Bedienelement | Fehlbetrag | Zustand |
|---|---|---|
| Tab **Export** (Gruppe Rollout) | 22 px hinter der Kante | unsichtbar, nicht anklickbar, nicht scrollbar |
| **Löschen (Entf)** in der Werkzeugleiste | 44 px hinter der Kante | dito — eine löschende Aktion ohne Ausweichmenü |
| **Projektname** im Kopf | auf 18 px geschrumpft | Eingabefeld ohne nutzbare Breite |

Ein Bedienelement, das es gibt und das man nicht erreicht, ist schlechter als
eines, das umbricht. Beim Umbruch sieht man wenigstens, dass es da ist.

Der dritte Fall hat eine andere Ursache, aber dasselbe Muster: im Kopf
konkurrieren drei Gruppen um die Breite. `.header-left` stand auf
`flex: 0 0 auto` und verweigerte damit jedes Kürzen. `.header-center` war das
einzige schrumpffähige Element — und ging auf Null. Wer nicht nachgeben darf,
drückt die anderen weg.

Und es war nicht auf schmale Fenster begrenzt: `#sidebar-right` hat
`min-width: 300px`. Wer den Trenner nach rechts zieht, verliert den letzten
Tab — lautlos, an jedem Arbeitsplatz.

---

## 1. Was V55.2 daraus macht

### Beide Leisten rollen, statt abzuschneiden

```css
.canvas-toolbar,
#right-tabs .tab-list {
  min-width: 0;
  overflow-x: auto;          /* nicht hidden */
  overflow-y: hidden;
  overscroll-behavior-x: contain;
  scrollbar-width: thin;
}
```

`overflow-x: auto` ist der Unterschied: der Balken erscheint **nur**, wenn er
gebraucht wird. Passt alles, ist er nicht da — die Leiste sieht aus wie
vorher. `overscroll-behavior-x: contain` verhindert, dass das Rollen am Ende
auf die Seite durchschlägt.

Die Tabzeile bekommt zusätzlich `scroll-snap-type: x proximity`, damit sie an
Tabgrenzen einrastet statt mitten im Wort stehen zu bleiben.

### Der aktive Tab rollt sich selbst in Sicht

Rollen allein reicht nicht: wechselt man die Gruppe und der erste Tab der
neuen Gruppe liegt links außerhalb, wirkt das Panel leer oder falsch
beschriftet. `v9_ui_chrome.js` bekommt `revealActiveTab()`, aufgerufen aus
`showGroup()` und bei jedem Tabklick.

Bewusst über `scrollLeft` und nicht über `scrollIntoView()`: letzteres rollt
auch die Vorfahren mit und lässt das ganze Panel springen. Passt der Inhalt,
setzt die Funktion `scrollLeft = 0` — sonst bliebe eine alte Rollposition
stehen, wenn das Fenster wieder breiter wird.

### Im Kopf gibt die linke Gruppe nach, nicht das Eingabefeld

```css
.header-left   { flex: 0 1 auto; min-width: 0; overflow: hidden; }
.header-left h1        { flex: 0 0 auto; }        /* die Marke bleibt ganz */
.header-left .version  { min-width: 0; text-overflow: ellipsis; }
.header-center { flex: 1 1 220px; min-width: 168px; }
```

Das Namensfeld ist jetzt das Unantastbare — es ist ein Eingabefeld, und ein
18 px breites Eingabefeld ist kaputt. Die Versionsangabe verschwindet unter
1180 px vollständig, statt zu „V5…" zu verstümmeln: eine abgeschnittene
Versionsangabe ist keine Versionsangabe. Sie steht ohnehin in der
Statusleiste, im README und in `VERSION`.

### Schmale Leiste: erst enger, dann rollen

```css
#sidebar-right { container-type: inline-size; container-name: rightbar; }
@container rightbar (max-width: 360px) {
  #right-tabs .tab-list { gap: var(--v9-space-2); padding: 0 var(--v9-space-2); }
}
```

Eine Container-Abfrage, keine Medienabfrage: es geht um die Breite der Leiste,
die der Nutzer zieht, nicht um die des Fensters. Zuerst rücken die Abstände
zusammen — das kostet nichts. Erst wenn das nicht reicht, wird gerollt.

---

## 2. Nachweis

Nachgemessen bei 924 px Fensterbreite, 340 px Leistenbreite:

| | V55.1 | V55.2 |
|---|---|---|
| Tabzeile `scrollWidth` / `clientWidth` | 333 / 311 → 22 px verdeckt | 311 / 311 |
| Tab **Export** | `visible: false` | sichtbar |
| **Löschen** erreichbar | nein | ja (Rollen) |
| Projektnamenfeld | 18 px | 179 px |
| Kopfzeile `scrollWidth` | 1027 > 924 | passt |

Die Testkette prüft das jetzt selbst. **Stufe 3** hat sieben Prüfungen mehr:

```
   ok  Tabzeile rollt statt abzuschneiden
   ok  Tabzeile ohne overflow: hidden
   ok  Werkzeugleiste rollt statt abzuschneiden
   ok  Werkzeugleiste ohne overflow: hidden
   ok  Projektnamenfeld mit Mindestbreite
   ok  Kopfzeile links darf kuerzen
   ok  aktiver Tab wird in Sicht gerollt
   ok  kein scrollIntoView-Aufruf
```

Sie lesen den ersten Regelblock des jeweiligen Selektors aus `layout.css`.
Deshalb sind die beiden `.canvas-toolbar`-Blöcke zu einem zusammengefasst —
sonst prüft die Kette die falsche Hälfte und meldet grün, während der Fehler
in der zweiten Hälfte steht.

---

## 3. Geänderte Dateien

| Datei | Änderung |
|---|---|
| `public/css/layout.css` | Rollverhalten beider Leisten, Kopfzeilen-Flex, Container-Abfrage, `.canvas-toolbar` zusammengefasst |
| `public/js/v9_ui_chrome.js` | `revealActiveTab()` |
| `test_all.sh` | Stufe 3: sieben Prüfungen mehr |
| `DIAGNOSE_UND_PATCH_V55_1_DE.md` | Verweis auf diese Runde an der betroffenen Stelle |
| `VERSION`, `package.json`, `public/index.html`, `svg_editor_tool.py` | 55.2.0 |

**Unverändert**: alle 26 Config-Sektionen, alle Werkzeuge unter `_tools/`, alle
Bestandsmodule unter `public/js/` außer `v9_ui_chrome.js`, `tokens.css`,
`fonts.css`, `bridge.css`, `components.css`, `style.css`, der Symbolsatz, die
Stufen 1–2 und 4–13 der Testkette.

---

## 4. Was das für den Betrieb bedeutet

Nichts, außer dass drei Bedienelemente wieder erreichbar sind. Keine Migration,
keine Konfigurationsänderung, kein Neuaufbau von Shards. `config/` ist
byte-identisch zu V55.1 und V54.3.
