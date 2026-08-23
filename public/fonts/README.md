# public/fonts — die beiden Schriften des Werkzeugs

`public/css/fonts.css` bindet zwei Familien. Sie werden **mitgeliefert oder
lokal beschafft, nie von einem CDN geladen** — das Zielsystem steht in der
Regel ohne Internetverbindung.

V57.1 liefert die acht Latin-WOFF2-Dateien aus den Fontsource-Paketen 5.2.7
mit. Die jeweiligen Lizenztexte liegen als `LICENSE-Public-Sans.txt` und
`LICENSE-IBM-Plex-Mono.txt` daneben.

```
python3 _tools/fetch_fonts.py          # holt alle acht Dateien hierher
python3 _tools/fetch_fonts.py --check  # nur berichten, was fehlt
```

Das Werkzeug prüft vorher, dass seine Zielnamen mit denen in `fonts.css`
übereinstimmen, und protokolliert je Datei Größe und SHA-256.

## Erwartete Dateien

| Datei | Familie | Schnitt |
|---|---|---|
| `PublicSans-Regular.woff2` | Public Sans | 400 |
| `PublicSans-Medium.woff2` | Public Sans | 500 |
| `PublicSans-SemiBold.woff2` | Public Sans | 600 |
| `PublicSans-Bold.woff2` | Public Sans | 700 |
| `PublicSans-Italic.woff2` | Public Sans | 400 kursiv |
| `IBMPlexMono-Regular.woff2` | IBM Plex Mono | 400 |
| `IBMPlexMono-Medium.woff2` | IBM Plex Mono | 500 |
| `IBMPlexMono-SemiBold.woff2` | IBM Plex Mono | 600 |

Die Namen sind bindend — `fonts.css` verweist genau auf sie.

## Drei Wege, drei Aufwände

**1 · Beschaffen.** `python3 _tools/fetch_fonts.py` auf einem Rechner mit Netz,
dann `public/fonts/` mitkopieren. Der übliche Weg.

**2 · Direktbezug.** Beide Familien stehen unter der SIL Open Font License 1.1
und dürfen weitergegeben werden:

* **Public Sans** — <https://github.com/uswds/public-sans/releases>,
  im Archiv `fonts/webfonts/*.woff2`
* **IBM Plex Mono** — <https://github.com/IBM/plex/releases>,
  im Archiv `IBM-Plex-Mono/fonts/complete/woff2/*.woff2`

Die Dateien der Releases heißen teils anders
(`public-sans-v2-latin-400-normal.woff2`). Vor dem Ablegen auf die Namen aus
der Tabelle umbenennen.

**3 · Systemweit installieren.** `fonts.css` beginnt jeden `src` mit `local()`.
Ist die Schrift auf dem Rechner installiert, wird nichts geladen und hier
braucht nichts zu liegen.

## Ohne diese Dateien

Die Oberfläche bleibt vollständig benutzbar — es fehlt die vorgesehene Schrift,
kein Layout und keine Funktion. Es greift die Rückfallkette aus `tokens.css`:

```
--v9-font-sans: 'Public Sans', 'Segoe UI', system-ui, …
--v9-font-mono: 'IBM Plex Mono', 'SFMono-Regular', Consolas, …
```

Beide Rückfälle sind bewusst so gewählt, dass Zeilenhöhen und Laufweiten nahe
an der Zielschrift liegen: das Layout verschiebt sich nicht sichtbar, und die
Monospace bleibt eine Monospace — Tabellen mit IDs und Messwerten bleiben in
Spalten stehen.

## Prüfen, ob es geklappt hat

In der Browser-Konsole:

```js
document.fonts.check('500 14px "Public Sans"')   // true, wenn gebunden
document.fonts.check('400 12px "IBM Plex Mono"') // true, wenn gebunden
```

`./test_all.sh` prüft in Stufe 3 sowohl die Deklaration als auch die Anwesenheit
aller acht Binärdateien. Damit ist die geplante Typografie jetzt Teil des
Release-Vertrags und kein optionaler Nachladeschritt mehr.
