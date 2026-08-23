#!/usr/bin/env python3
"""fetch_fonts.py — holt die acht Schriftdateien nach public/fonts/.

Warum ein Werkzeug und nicht acht Dateien im Paket
--------------------------------------------------
Public Sans und IBM Plex Mono sind frei lizenziert (SIL OFL 1.1) und duerfen
mitgeliefert werden. Ausgeliefert werden sie hier trotzdem nicht als Binaerdaten,
sondern beschafft: ein Werkzeug, das die Dateien holt, benennt, prueft und
protokolliert, ist nachvollziehbar — eine Binaerdatei im Paket ist es nicht.
Wer das Zielsystem ohne Netz betreibt, laesst das Werkzeug einmal auf einem
Rechner mit Netz laufen und kopiert public/fonts/ mit.

Ohne diese Dateien laeuft die Oberflaeche vollstaendig; fonts.css beginnt jeden
src mit local(), danach greift die Rueckfallkette aus tokens.css. Es fehlt dann
nur die vorgesehene Schrift.

Aufrufe
-------
    python3 _tools/fetch_fonts.py            # holen, benennen, pruefen
    python3 _tools/fetch_fonts.py --check    # nur berichten, nichts laden
    python3 _tools/fetch_fonts.py --force    # vorhandene Dateien ersetzen

Bezug
-----
Die Google-Fonts-CSS-Schnittstelle liefert je Schnitt und Subset ein woff2.
Abgefragt wird mit einer Browser-Kennung, weil die Schnittstelle sonst ttf
ausliefert; genommen wird das Latin-Subset (unicode-range enthaelt U+0000-00FF).
Faellt die Schnittstelle aus, nennt --check die Direktbezugsquellen.

Stil: rein funktional, kein OOP.
"""

import argparse
import hashlib
import pathlib
import re
import sys
import urllib.error
import urllib.request

BASE_DIR = pathlib.Path(__file__).resolve().parent.parent
FONT_DIR = BASE_DIR / "public" / "fonts"
CSS_FILE = BASE_DIR / "public" / "css" / "fonts.css"

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

# (Zieldatei, Familie fuer die Schnittstelle, Gewicht, Stil)
WANTED = [
    ("PublicSans-Regular.woff2",   "Public Sans",   "400", "normal"),
    ("PublicSans-Medium.woff2",    "Public Sans",   "500", "normal"),
    ("PublicSans-SemiBold.woff2",  "Public Sans",   "600", "normal"),
    ("PublicSans-Bold.woff2",      "Public Sans",   "700", "normal"),
    ("PublicSans-Italic.woff2",    "Public Sans",   "400", "italic"),
    ("IBMPlexMono-Regular.woff2",  "IBM Plex Mono", "400", "normal"),
    ("IBMPlexMono-Medium.woff2",   "IBM Plex Mono", "500", "normal"),
    ("IBMPlexMono-SemiBold.woff2", "IBM Plex Mono", "600", "normal"),
]

DIRECT_SOURCES = """
Direktbezug, falls die Schnittstelle nicht erreichbar ist:

  Public Sans     https://github.com/uswds/public-sans/releases
                  im Archiv: fonts/webfonts/*.woff2
  IBM Plex Mono   https://github.com/IBM/plex/releases
                  im Archiv: IBM-Plex-Mono/fonts/complete/woff2/*.woff2

Danach auf die oben genannten Zielnamen umbenennen. Die Namen sind bindend —
public/css/fonts.css verweist genau auf sie.

Dritter Weg: die Schriften systemweit installieren. fonts.css beginnt jeden
src mit local(), dann wird nichts geladen und nichts gebraucht.
""".strip()


def get(url, binary=False):
    request = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(request, timeout=20) as response:
        payload = response.read()
    return payload if binary else payload.decode("utf-8")


def css_url(family, weight, style):
    """Bildet die Abfrage der CSS-Schnittstelle fuer genau einen Schnitt."""
    name = family.replace(" ", "+")
    axis = "ital,wght@%d,%s" % (1 if style == "italic" else 0, weight)
    return "https://fonts.googleapis.com/css2?family=%s:%s&display=swap" % (name, axis)


def pick_latin(css_text):
    """Liefert die woff2-Adresse des Latin-Subsets aus einer CSS-Antwort."""
    blocks = re.findall(r"@font-face\s*\{(.*?)\}", css_text, re.S)
    fallback = None
    for block in blocks:
        match = re.search(r"url\((https://[^)]+\.woff2)\)", block)
        if not match:
            continue
        fallback = fallback or match.group(1)
        ranges = re.search(r"unicode-range:\s*([^;]+);", block)
        if ranges and "U+0000-00FF" in ranges.group(1).replace(" ", ""):
            return match.group(1)
    return fallback


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def declared_names():
    """Die Dateinamen, die fonts.css tatsaechlich erwartet."""
    if not CSS_FILE.is_file():
        return set()
    return set(re.findall(r"\.\./fonts/([A-Za-z0-9\-]+\.woff2)",
                          CSS_FILE.read_text(encoding="utf-8")))


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true",
                        help="nur berichten, nichts laden")
    parser.add_argument("--force", action="store_true",
                        help="vorhandene Dateien ersetzen")
    args = parser.parse_args()

    FONT_DIR.mkdir(parents=True, exist_ok=True)

    # Zusicherung: Zielnamen und fonts.css muessen zusammenpassen. Laeuft das
    # auseinander, laedt das Werkzeug Dateien, die niemand einbindet.
    declared = declared_names()
    wanted = {name for name, _, _, _ in WANTED}
    if declared and declared != wanted:
        print("FEHLER  fonts.css erwartet andere Dateien als dieses Werkzeug holt.")
        print("        nur in fonts.css : %s" % (sorted(declared - wanted) or "—"))
        print("        nur im Werkzeug  : %s" % (sorted(wanted - declared) or "—"))
        return 2

    print("Ziel: %s" % FONT_DIR)
    print("%-30s %-9s %s" % ("Datei", "Groesse", "Lage"))
    print("-" * 72)

    missing = []
    failed = []
    for name, family, weight, style in WANTED:
        target = FONT_DIR / name
        if target.is_file() and not args.force:
            print("%-30s %-9s vorhanden  %s" % (name, "%d B" % target.stat().st_size,
                                                sha256(target)[:12]))
            continue
        if args.check:
            print("%-30s %-9s FEHLT" % (name, "—"))
            missing.append(name)
            continue
        try:
            url = pick_latin(get(css_url(family, weight, style)))
            if not url:
                raise ValueError("keine woff2-Adresse in der Antwort")
            data = get(url, binary=True)
            if len(data) < 2000 or data[:4] != b"wOF2":
                raise ValueError("Antwort ist keine woff2-Datei")
            target.write_bytes(data)
            print("%-30s %-9s geholt     %s" % (name, "%d B" % len(data),
                                                sha256(target)[:12]))
        except (urllib.error.URLError, ValueError, OSError) as error:
            print("%-30s %-9s FEHLER     %s" % (name, "—", error))
            failed.append(name)

    print("-" * 72)
    if args.check:
        if missing:
            print("%d von %d Dateien fehlen." % (len(missing), len(WANTED)))
            print()
            print(DIRECT_SOURCES)
            return 1
        print("Alle %d Dateien vorhanden." % len(WANTED))
        return 0

    if failed:
        print("%d Datei(en) nicht geholt." % len(failed))
        print()
        print(DIRECT_SOURCES)
        return 1

    print("Alle %d Dateien liegen unter public/fonts/." % len(WANTED))
    print("Gegenprobe im Browser:  document.fonts.check('500 14px \"Public Sans\"')")
    return 0


if __name__ == "__main__":
    sys.exit(main())
