# V55.1 — Die Oberfläche holt den Datenvertrag ein

**Stand:** V55.1.0 · Vorgänger: V54.3.0 (`DIAGNOSE_UND_PATCH_V54_3_DE.md`)

> **Was aus V54.3 übernommen ist.** V54.3 hat den Stellpfad der Runtime
> nachgelesen und drei Fehler in der ausgelieferten Konfiguration behoben —
> Sollwertschlüssel, Skalierung, Rückleseprüfung. Diese Korrekturen und die
> Antwort zur Schrittmotor-Frage stehen unverändert in
> `DIAGNOSE_UND_PATCH_V54_3_DE.md`; `config/device_state_data_v9.json` trägt
> sie. V55.1 fasst davon nichts an. Die Befunde dieses Dokuments betreffen
> ausschließlich die Darstellung — sie bestanden seit V52 und waren in V54.3
> unverändert vorhanden, weil dort keine CSS-Datei berührt wurde.

---

## 0. Worum es geht

V54.2 hat die Konfiguration bis auf das Byte genau gemacht: `uuid5`-Identität,
Fingerprints, fail-closed-Verbote im Cross-Vertrag, ein wörtlicher Snapshot im
Anlagenbild, 410 automatische Prüfungen.

Diese Sorgfalt endete am Bildschirmrand. Sechzehn Bedienelemente trugen ein
Emoji als Symbol, die deklarierten Schriften wurden nie geladen, zwei
Akzentblautöne lagen gleichzeitig auf der Seite, zwölf gleichrangige Tabs
brachen je nach Fensterbreite anders um, und die Statusleiste zeigte
`0 Elemente | 0 Verbindungen · Bereit` — während der Store zur selben Zeit
Fingerprint, Herkunft, Dirty-Zustand und Fehlerzahl kannte.

V55.1 räumt das auf. **Kein Vorschlag berührt das Format, die Prüfungen oder
den Funktionsumfang.** Alle zwölf Bereiche bleiben, an derselben Stelle im
Ablauf, mit denselben Bezeichnern im DOM.

---

## 1. Die zwölf Befunde und was daraus wurde

| | Befund | Fundstelle bis V54.3 | Behandlung |
|---|---|---|---|
| B01 | Emoji als Icon-System (16 Stück) | `index.html` 36–129 | Strichsatz, in `index.html` eingebettet |
| B02 | Deklarierte Schriften werden nie geladen | `tokens.css` 44 gegen `index.html` 13–18 | `fonts.css` + `public/fonts/` |
| B03 | Zwei Akzentfarben gleichzeitig | `style.css` 12 überschreibt `tokens.css` 167 | Altblock entfernt, eine Quelle |
| B04 | Zwei Komponenten-Vokabulare | `style.css` 640 ff. gegen `components.css` 110 ff. | `bridge.css` |
| B05 | Zwölf gleichrangige Tabs | `index.html` 186–224 | Drei Gruppen, zwei Ebenen |
| B06 | Zeichenfläche ist der kleinste Bereich | `tokens.css` 186 (620 px) | Startbreite 400 px |
| B07 | Keine Werkzeugumgebung am Blatt | `index.html` 161, `core.js` 600 ff. | Lineale, Punktraster, Zoom am Ort |
| B08 | Statusleiste ohne Status | `index.html` 308–318 | An den Store gehängt |
| B09 | Fünf Definitionen derselben Animation | `style.css` 1488/1506/1531, `layout.css`, `hmi_animation.js` | Zwei Orte, gleiche Werte |
| B10 | Zwei Bauweisen für Markup | ~60 `innerHTML`-Stellen | offen, siehe Abschnitt 6 |
| B11 | Dunkler Modus als Reihe von Reparaturen | `style.css` 868–905 | entfällt mit B03/B04 |
| B12 | Anlagen- und Oberflächenfarben getrennt | `hmi_animation.js` gegen `tokens.css` | Werte angeglichen, Erzeugung offen |

Zehn von zwölf sind erledigt. B10 und die Erzeugungsseite von B12 sind
bewusst offen — Begründung in Abschnitt 6.

---

## 2. Die eine Ursache hinter der Hälfte der Befunde

Die Ladereihenfolge lautete:

```
tokens.css → style.css → layout.css → components.css
```

`tokens.css` bildete am Ende die Alt-Variablen auf das neue System ab:

```css
:root { --primary-color: var(--v9-accent); }   /* tokens.css, Zeile 167 */
```

`style.css` wurde **danach** geladen und enthielt einen eigenen `:root`-Block:

```css
:root { --primary-color: #2563eb; }            /* style.css, Zeile 12 */
```

Gleiche Spezifität, später geladen — die Abbildung war wirkungslos. Gemessen
am laufenden Dokument:

```
--primary-color   #2563eb     Altpanels, Kopfleiste, Werkzeuge
--v9-accent       #4f46e5     V9-Panels, aktiver Tab
btn-speichern     rgb(37, 99, 235)
tab.active        rgb(79, 70, 229)
```

Zwei Blautöne, die sich um zu wenig unterscheiden, um als Absicht gelesen zu
werden, und um zu viel, um dieselbe Farbe zu sein. Derselbe Mechanismus
erklärte den flickenhaften dunklen Modus (B11) und einen Teil der
Geometrieunterschiede (B04): es gab schlicht zwei Wahrheiten.

**Behandlung.** Der `:root`-Block in `style.css` ist entfallen. `tokens.css`
definiert jetzt auch alle Alt-Variablen — `--gray-50` bis `--gray-900`,
`--bg-color`, `--spacing-*`, `--header-height`, alles. Kein Altmodul und keine
Altregel musste dafür angefasst werden; sie folgen dem neuen System
automatisch.

---

## 3. Was sich gestalterisch geändert hat

### Schrift

`Public Sans` für die Oberfläche, `IBM Plex Mono` für alles Technische — IDs,
UUIDs, Fingerprints, Koordinaten, Messwerte, Dateinamen, JSON. Beide sind frei
lizenziert (SIL OFL 1.1) und werden **mitgeliefert, nicht von einem CDN
geladen**: das Zielsystem steht in der Regel ohne Internet.

Die woff2-Dateien gehören nach `public/fonts/`; die erwarteten Namen und die
Bezugsquellen stehen in `public/fonts/README.md`. Jeder `src` beginnt mit
`local()` — ist die Schrift installiert, wird nichts geladen. Fehlt beides,
greift die Rückfallkette und die Oberfläche bleibt vollständig benutzbar.

### Farbe

Warmes Stone statt kühlem Slate: ein Werkzeug, das stundenlang offen steht,
soll nicht kalt wirken. Der Akzent wechselt von Indigo `#4f46e5` auf Violett
`#6d28d9`.

Das ist kein Geschmacksurteil. Indigo lag zu nah an `info-blue`, einer der
fünf Zustandsfarben des Anlagenbilds. **Der Bedienakzent darf nie mit einem
Anlagenzustand verwechselt werden** — deshalb weicht er aus, nicht die
Zustandsfarbe.

Aus demselben Grund trägt der Export-Schalter jetzt den Akzent und nicht mehr
Grün: Grün heißt im Anlagenbild „ok".

### Symbole

Ein Strichsatz aus 33 Symbolen, 24er-Raster, Strichstärke 1,6, `currentColor`.
Ein Strichsymbol kann etwas, das ein Emoji nicht kann: Zustand zeigen. Es wird
gedimmt, wenn die Aktion nicht verfügbar ist, und nimmt den Akzent an, wenn
das Werkzeug aktiv ist. Bei „Raster" und „Einrasten" ist genau das die
eigentliche Information — beide tragen deshalb zusätzlich eine Beschriftung.

**Der Satz liegt inline in `index.html`, nicht als `<use href="icons.svg#…">`.**
Eine externe Sprite-Referenz braucht einen erreichbaren, gleichnamigen
Ursprung mit korrektem MIME-Typ; beim Öffnen über `file://`, in einem
eingebetteten Rahmen oder hinter einem strengen Proxy bleiben die Schalter
dann leer. Inline gibt es weder Anfrage noch Aufblitzen. `public/icons.svg`
bleibt als Einzelnachweis daneben liegen — identischer Inhalt, Bezeichner dort
ohne das Präfix `ico-`.

Jedes `<symbol>` trägt seine Präsentationsattribute selbst
(`fill="none" stroke="currentColor" …`) statt sie über die `<use>`-Grenze zu
erben. Redundant, aber unabhängig vom Rendering-Kontext.

### Maß

Grundraster 4 px, Zeilenhöhe 28, Schalterhöhe 28/32, Radius 2/4, Trennung
durch 1-px-Linien. Schatten bleibt dem vorbehalten, was tatsächlich über der
Fläche liegt: Dialog, Toast, schwebender Zoom-Block. In einem Werkzeug mit
dreißig sichtbaren Werten je Panel ist jeder weitere Schatten eine Ablenkung.

Kopfleiste 60 → 52 px, Werkzeugleiste 48 → 40, Statusleiste 32 → 28. Das sind
28 px mehr für das Anlagenbild, ohne dass etwas enger wird.

---

## 4. Was sich strukturell geändert hat

### Navigation in zwei Ebenen

Zwölf gleichrangige Tabs in einer Reihe brachen je nach Fensterbreite auf zwei
bis drei Zeilen um — Schaltflächen wanderten unter dem Zeiger weg. Die
Aufgaben zerfallen aber klar in drei Phasen:

| Gruppe | Tabs |
|---|---|
| **Zeichnung** | Elements · Connections · Device · HMI |
| **Automatisierung** | Processes · Rules · States V9 · Rules V9 |
| **Rollout** | Validierung · Topologie · Cross V8 · Export |

Ebene 1 ist ein Segmentumschalter, kein zweiter Tab-Streifen: Tabs innerhalb
von Tabs lesen sich nicht. Ebene 2 sind die höchstens vier Tabs der aktiven
Gruppe, ohne Umbruch.

> **Korrigiert in V55.2.** Die hier beschriebene Lösung schnitt drei
> Bedienelemente ab, statt sie umbrechen zu lassen. Was daran falsch war und
> wie es behoben wurde, steht in `DIAGNOSE_UND_PATCH_V55_2_DE.md`.

### Die Zeichenfläche bekommt ihre Umgebung

* **Lineale** oben und links. Die Streifen selbst sind CSS-Verlaufsmuster —
  kein Canvas, kein Neuzeichnen je Frame. Nur die Zeigermarke wandert, ein
  Transform pro Bewegung, gedrosselt auf einen Frame.
* **Punktraster, beim Start sichtbar.** Eine leere weiße Fläche ohne Bezug ist
  für ein Zeichenwerkzeug kein sinnvoller Ausgangszustand. Punkte statt Linien,
  weil ein Linienraster mit den Rohrleitungen konkurriert.
* **Zoom am Ort der Handlung.** Bis V54.3 stand die Stufe als Text oben in der
  Werkzeugleiste, gezoomt wurde unten am Mauszeiger. Der Block sitzt jetzt
  unten rechts an der Fläche. Die IDs `btn-zoom-in`, `btn-zoom-out`,
  `btn-zoom-reset`, `zoom-level` sind unverändert — `elements.js` merkt nichts.
* **Auswahl-Chip.** Was ist gewählt und woran hängt es (`actuator:7`, oder
  „nicht gebunden"). Bis V54.3 musste man dafür in den Eigenschaften-Tab
  wechseln.
* **Blattmaß** oben links, mit der aktuellen Zoomstufe.

### Die Statusleiste spricht

```
12 Elemente · 9 Verbindungen · 3 gebunden      Bereit      ● Vertrag gültig · 2 Hinweise | fp 52e183d1 | site_main · fn-01 | X 1240 · Y 680
```

Alle diese Werte lagen schon im Store. `v9_ui_chrome.js` hängt sich an
`config:changed` und `config:saved` und trägt sie ein. Dieselben Angaben
stehen verkürzt in der Werkzeugleiste, dort wo der Export-Schalter ist: wer
eine Konfiguration ausrollt, soll vor dem Klick sehen, was er ausrollt.

Auf schmalen Fenstern verschwinden zuerst der Fingerprint, dann der
Begleittext, zuletzt das ganze Abzeichen — der Vertragszustand steht ohnehin
noch unten.

### Ebenen wandern nach links

„Ebenen" saß am Fuß der rechten Leiste, unter zwölf Tabs. Ebenen gehören zum
Zeichnen, nicht zu den Eigenschaften. Der Block liegt jetzt in der linken
Leiste; die rechte wird dadurch um einen Abschnitt kürzer.

### Breiten

Rechte Leiste 620 → 400 px, linke 280 → 260. Auf einem 1440-px-Fenster
wachsen damit rund 500 px Zeichenfläche auf rund 700. Der Ziehgriff bleibt,
die Breite wird weiterhin gemerkt (`--sidebar-right-remember: 1`).

---

## 5. Die Brücke — warum kein Modul angefasst werden musste

Es gab zwei vollständige Bausteinsätze nebeneinander:

| | alt (`style.css`) | neu (`components.css`) |
|---|---|---|
| Schalterhöhe | 34 px | 32 px |
| Radius | 6 px | 5 px |
| Schriftgröße | 14 px | 13 px |
| Schriftschnitt | 500 | 550 |

Beide erscheinen im selben Panel. Der Wechsel von „Rules" auf „Rules V9"
verschob jede Kante um ein bis zwei Pixel — sichtbar, ohne dass man den Grund
benennen könnte.

Der naheliegende Weg wäre gewesen, die Altmodule auf `v9_dom.js` umzuschreiben.
Das sind rund sechzig `innerHTML`-Stellen in fünf Dateien mit zusammen
9 500 Zeilen. Für eine optische Aufwertung ist das ein zu großer Hebel und ein
zu großes Risiko.

Stattdessen: **`public/css/bridge.css`**. Sie hebt die alten Klassen auf die
Geometrie und Farbe der V9-Komponenten — `.btn`, `.btn-icon`, `.tool-btn`,
`.card`, `.pill`, `.tag`, `.subtab`, `.table`, die Eingabefelder, die
Modaldialoge, die Symbolkacheln, die Verbindungslinien. Kein JavaScript ändert
sich, kein `innerHTML` muss umgeschrieben werden.

Entfernt man die Datei aus `index.html`, ist die Darstellung von V54.3
wiederhergestellt. Das ist der Rückweg, falls etwas nicht passt.

---

## 5a. Die Schriften — beschafft, nicht mitgeliefert

Die beiden Familien sind frei lizenziert (SIL OFL 1.1) und dürfen weitergegeben
werden. Ausgeliefert werden sie hier trotzdem nicht als Binärdaten, sondern
beschafft:

```bash
python3 _tools/fetch_fonts.py          # holt die acht woff2 nach public/fonts/
python3 _tools/fetch_fonts.py --check  # nur berichten, was fehlt
```

Das Werkzeug prüft **vor** dem Laden, dass seine acht Zielnamen mit denen in
`fonts.css` übereinstimmen — laufen sie auseinander, lädt es nichts und sagt,
welche Seite abweicht. Danach protokolliert es je Datei Größe und SHA-256.

Drei Gründe für den Weg über ein Werkzeug statt über acht Dateien im Archiv:
ein Skript ist nachvollziehbar und prüfbar, ein Binärblob nicht; das Paket
bleibt klein; und die Bezugsquelle bleibt sichtbar, was bei einer OFL-Schrift
zur Lizenz gehört.

**Ohne die Dateien ist das Paket vollständig, nicht kaputt.** `fonts.css`
beginnt jeden `src` mit `local()` — sind die Schriften systemweit
installiert, wird nichts geladen. Fehlt beides, greift die Rückfallkette aus
`tokens.css`. Sie ist bewusst so gewählt, dass Zeilenhöhen und Laufweiten nahe
an der Zielschrift liegen: das Layout verschiebt sich nicht sichtbar, und die
Monospace bleibt eine Monospace. `test_all.sh` prüft deshalb die
*Deklaration*, nicht die Anwesenheit der Binärdateien.

---

## 6. Was bewusst offen bleibt

**B10 — die zwei Bauweisen für Markup.** `bridge.css` behandelt das Symptom,
nicht die Ursache: jede künftige optische Änderung muss weiterhin an zwei
Orten gemacht werden. Die Umstellung gehört gemacht, aber ein Panel je Runde,
nach Größe: `processes.js` (779 Zeilen) → `connection_mapper.js` (895) →
`rules_generator.js` (1 980) → `hmi.js` (4 303). Jede Runde ist für sich
prüfbar und für sich zurückzunehmen.

**B12 — die Erzeugung der Zustandsfarben.** Editor und Export führen jetzt
dieselben RGB-Tripel, geprüft in Stufe 3 der Testkette. Sie stehen aber immer
noch an zwei Stellen (`bridge.css` und `ANIMATION_CSS` in
`hmi_animation.js`). Der Verweis zur Laufzeit ist keine Lösung — das
exportierte SVG muss ohne die CSS-Dateien des Editors funktionieren. Die
Lösung ist ein Erzeugungsschritt in `build_config.sh`, der beide aus einer
Quelle schreibt.

**Die Schriftdateien selbst.** `fonts.css` und `public/fonts/README.md` sind
da, die woff2-Dateien nicht — sie müssen aus den genannten Releases geholt und
abgelegt werden. Ohne sie läuft die Oberfläche in der Systemschrift; es fehlt
nur die vorgesehene Schrift, kein Layout und keine Funktion.

**Ein Komponenten-Katalog.** Eine Prüfseite `public/styleguide.html`, die alle
Bausteine in hell und dunkel zeigt, würde den erreichten Zustand halten. Noch
nicht gebaut.

---

## 7. Nachweis

Die Testkette hat eine Stufe mehr: **13 statt 12**.

```
== 3/13  Oberflaeche: eine Quelle je Zusicherung ==
   ok   Tokens nur in tokens.css
   ok   hmi-blink genau einmal definiert
   ok   .hidden genau einmal definiert
   ok   keine Emoji in index.html
   ok   Symbolsatz eingebettet (33 Symbole)
   ok   Schalter nutzen den Symbolsatz (28 Verweise)
   ok   Stylesheet-Reihenfolge  tokens -> fonts -> style -> layout -> components -> bridge
   ok   Schriften deklariert und gebunden
   ok   public/fonts/ nennt die erwarteten Dateien
   ok   zwoelf Tabs
   ok   drei Gruppen
   ok   keine Gruppe mit mehr als fuenf Tabs
   ok   Zustandsfarbe ok-green deckungsgleich
   ok   Zustandsfarbe warn-yellow deckungsgleich
   ok   Zustandsfarbe alarm-red deckungsgleich
   ok   Zustandsfarbe info-blue deckungsgleich
   ok   Zustandsfarbe idle-grey deckungsgleich
```

Diese Prüfungen sind kein Zierrat. Jede davon war bis V54.3 verletzt, und jede
bricht leise wieder auf, sobald jemand eine Regel an der falschen Stelle
ergänzt. Eine doppelte Farbdefinition erzeugt keinen Fehler — sie erzeugt eine
Oberfläche, die eine Nuance daneben liegt und die niemand mehr benennen kann.

Der UI-Smoke-Test (Stufe 13) prüft zusätzlich am laufenden Browser:

* drei Arbeitsbereiche, jeder Tab genau einer Gruppe zugeordnet
* alle zwölf Tabs genau einmal sichtbar, keine Gruppe mit mehr als fünf
* `--primary-color` und `--v9-accent` sind derselbe Wert
* Public Sans steht an erster Stelle im Schriftstack
* keine Emoji im gerenderten Markup
* Statusleiste nennt Vertragszustand, Fingerprint und Node
* Lineale, Zoom-Block, sichtbares Raster und Auswahl-Chip sind da

Weil die Tabs jetzt in Gruppen liegen, klickt der Test nicht mehr direkt auf
`#tab-btn-…` — ein Tab, dessen Gruppe nicht offen ist, steht auf `hidden`. Die
Hilfsfunktion `openTab()` öffnet erst die Gruppe, dann den Tab.

Die Stufen 1, 2 und 4 bis 13 sind unverändert. Insbesondere Stufe 2 („kein OOP
im Frontend") gilt auch für `v9_ui_chrome.js`.

---

## 8. Neue und geänderte Dateien

**Neu**

| Datei | Zweck |
|---|---|
| `public/css/fonts.css` | `@font-face` für Public Sans und IBM Plex Mono |
| `public/css/bridge.css` | hebt die Altklassen auf die V9-Geometrie; einzige Quelle der Anlagen-Zustandsklassen im Editor |
| `public/js/v9_ui_chrome.js` | Tabgruppen, Statusleiste, Lineale, Auswahl-Chip |
| `public/icons.svg` | Symbolsatz als Einzelnachweis (33 Symbole) |
| `public/fonts/README.md` | erwartete Dateien und Bezugsquellen |

**Geändert**

| Datei | Änderung |
|---|---|
| `public/css/tokens.css` | vollständig neu: warmes Stone, Violett-Akzent, alle Alt-Variablen |
| `public/css/style.css` | beide `:root`-Blöcke entfernt, Duplikate von `hmi-blink`, `.hidden`, Scrollbars und den Zustandsklassen entfernt, Dark-Mode-Reparaturen an `:nth-of-type` entfernt (1 533 → 1 296 Zeilen) |
| `public/css/layout.css` | Navigation in zwei Ebenen, Zeichenflächen-Umgebung, Statusleistenfelder |
| `public/index.html` | Symbolsatz eingebettet, Emoji ersetzt, Tabs gruppiert, Lineale und Statusleiste, Ladereihenfolge |
| `public/js/core.js` | Raster und Einrasten beim Start an; Theme-Schalter tauscht die Symbolreferenz statt eines Emoji-Textinhalts |
| `test/smoke_ui.mjs` | `openTab()`, 17 neue Prüfungen |
| `test_all.sh` | Stufe 3 neu, Umnummerierung auf 13 |
| `VERSION`, `package.json` | 55.1.0 |

**Unverändert**: alle 26 Config-Sektionen, alle Werkzeuge unter `_tools/`,
`_server_v9.py`, `svg_editor_tool.py`, der Export samt Snapshot, sämtliche
V9-Panels und alle übrigen Frontend-Module.

---

## 9. Was das für den Betrieb bedeutet

Nichts ändert sich am Ablauf. Dieselben zwölf Bereiche, dieselben
Schaltflächen, dieselben Tastenkürzel, dieselben Dateien.

Was sich ändert: Das Anlagenbild ist der größte Bereich statt des kleinsten.
Der Vertragszustand steht dort, wo ausgerollt wird. Der Zoom sitzt dort, wo
gezoomt wird. Und die Oberfläche sieht nicht mehr so aus, als hätte jemand
anders sie gebaut als das, was darunter läuft.

### Rückweg

`bridge.css` und `fonts.css` aus `index.html` entfernen und den
`:root`-Block aus V54.3 wieder in `style.css` legen — dann ist die
Darstellung von V54.3 zurück. Die Gruppierung der Tabs fällt weg, sobald
`v9_ui_chrome.js` nicht geladen wird; die Tabs sind dann wieder alle sichtbar.
