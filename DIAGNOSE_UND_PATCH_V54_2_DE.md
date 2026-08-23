# V54.2 — Die Konfiguration reist im Anlagenbild mit

**Stand:** V54.2.0 · Vorgänger: V54.1.0 (`DIAGNOSE_UND_PATCH_V54_1_DE.md`)

---

## 0. Warum dein Vorschlag der bessere Weg ist

Die offene Frage aus V54.1 lautete: *welche Seite gewinnt, wenn Designer-Sicht
und V9-Config dieselbe Entität beschreiben?* Eine Rückführung hätte diese Frage
beantworten müssen — und jede Antwort wäre falsch gewesen, weil sie von der
Anlage abhängt, nicht vom Werkzeug.

Dein Vorschlag löst das Problem, indem er es auflöst: **statt zu
rekonstruieren, wird kopiert.** Der Export legt die V9-Konfiguration wörtlich
ins SVG. Damit gibt es keine zweite Wahrheit, über deren Vorrang man streiten
müsste — nur eine Sicherung.

Drei Eigenschaften, die eine Rückrechnung nie gehabt hätte:

| | Rückführung Designer→V9 | Snapshot |
|---|---|---|
| Treue | Rekonstruktion, verlustbehaftet | **byte-genau** |
| Fingerprint | neu, weicht ab | **unverändert** |
| Konfliktregel nötig | ja | **nein** |
| Funktioniert bei fehlender Worker-Config | nein | **ja** |

Und dein zweiter Punkt — Replikation auch bei veraltetem Snapshot — ist genau
der Grund, warum das Werkzeug **einordnet statt zu blockieren**.

---

## 1. Was der Snapshot ist

Ein Block in `<metadata>` des exportierten SVG:

```xml
<metadata>
  <plantfactory:snapshot version="1" captured-at="2026-08-01T11:57:34Z" configs="4">
    { "snapshot_version": 1, "kind": "plant_factory_config_snapshot", … }
  </plantfactory:snapshot>
</metadata>
```

Er enthält **Master und alle Shards** — je Eintrag:

| Feld | Zweck |
|---|---|
| `text` | die Datei, **wörtlich**. Primärquelle. |
| `text_sha256` | Prüfsumme der Bytes im SVG |
| `fingerprint` | der Runtime-Fingerprint (`sha256` der kanonischen Bytes) |
| `fingerprint_source` | `server` oder `local` — Herkunft ist nachvollziehbar |
| `authority` | `authority_epoch`, `scope_revision`, `execution_epoch` |
| `role`, `scope`, `node_id`, `owner_node_id` | wofür der Stand gilt |
| `section_counts` | Umfang auf einen Blick, ohne den Text zu parsen |

Über allem ein `payload_sha256` — er erkennt Manipulation am Snapshot selbst.

### Drei Entwurfsentscheidungen, die zählen

**Klartext statt gzip+Base64.** Ein Snapshot ist eine Notfallmaßnahme. Er muss
auch dann lesbar sein, wenn kein Werkzeug dieser Codebasis mehr zur Hand ist —
mit `grep`, mit einem Texteditor. Kompression spart ~80 % und kostet genau
diese Eigenschaft. Bei ~37 kB je Config ist der Handel eindeutig.

**Der Originaltext, nicht das geparste Objekt.** `JSON.parse("1000.0")` liefert
`1000`. Der Runtime-Fingerprint hasht die kanonischen Bytes, und dort sind
`1000` und `1000.0` verschieden. Ein aus dem Objekt wiederhergestellter
Snapshot hätte einen anderen Fingerprint — Authority V5 würde die
Wiederherstellung als Abweichung werten.

**`<metadata>`, nicht `<script>` oder ein Kommentar.** Der SVG-Standard sieht
diesen Ort dafür vor: nicht gerendert, nicht ausgeführt, und Vektoreditoren
erhalten ihn beim Öffnen und Speichern.

---

## 2. Der Replikationsfall — dein Kernpunkt

Ein Snapshot altert. Das Werkzeug lehnt ihn deshalb **nie** ab, sondern ordnet
ihn ein:

| Lage | Bedeutung | Replizierbar |
|---|---|---|
| `identical` | Fingerprints gleich | — nichts zu tun |
| `stale` | Snapshot älter als der laufende Stand | **ja** |
| `ahead` | Snapshot **neuer** — Rückfall nach einem Ausfall | **ja** |
| `unrelated` | anderer Node oder Scope | nein (nur mit `--force`) |
| `no_head` | kein laufender Stand — der Snapshot ist alles | **ja** |

Nur `unrelated` bremst. Alles andere ist eine informierte Entscheidung des
Betreibers, keine Fehlerlage. Die Alterseinordnung kommt aus `scope_revision`
(Snapshot gegen Head); fehlt sie, entscheidet der Fingerprint — dann wird
konservativ „älter" angenommen und das auch so gesagt.

Vor jedem Überschreiben legt `restore` eine Sicherung `*.vor_restore` daneben.

```
$ python3 _tools/config_snapshot.py compare anlage.svg --head config/device_state_data_v9.json
Lage       : VERALTET — der laufende Stand ist neuer
Begruendung: scope_revision 17 gegen 42.
Snapshot   : 53888ca293520ae6e0033a9333fa32da
Laufend    : e56bf5f713757135ffc989f5a9c0cea8
Replizierbar: ja
Abweichende Sektionen:
  meta                         Snapshot 1      laufend 1
  rules                        Snapshot 10     laufend 11
```

Der Katastrophenfall:

```
$ python3 _tools/config_snapshot.py restore anlage.svg --verify
Lage       : no_head
Begruendung: Kein laufender Stand vorhanden — der Snapshot ist die einzige
             Quelle und kann unveraendert eingespielt werden.
Geschrieben: config/device_state_data_v9.json (37052 Bytes, byte-genau)
Runtime    : OK | Fingerprint 52e183d12f8e6873
```

---

## 3. Was dabei aufgefallen ist

### F-4: Der Store lud kompaktes JSON statt der Datei

`v9_store.js` rief `/api/v9/config` ohne `?format=text` — die Antwort war eine
kompakte Serialisierung, nicht die Datei im Lesbarkeitsformat (37 422 gegen
37 052 Zeichen). Für die Anzeige egal, für einen Snapshot nicht: die
Wiederherstellung hätte eine andere Schreibweise geschrieben als die, die auf
dem Worker lag. Behoben — der Store lädt jetzt die Datei.

### F-5: Der Browser konnte den Fingerprint nicht bilden

`JSON.parse` verliert Gleitkomma-Literale, der im Browser gerechnete
Fingerprint wich vom Runtime-Wert ab. Er wäre damit als Vergleichswert wertlos
gewesen.

Behoben, indem `canonicalJsonText()` die Hinweise aus `collectFloatLiterals()`
mitnimmt — dieselbe Technik, die V54.0 für den Formatter eingeführt hat.
Nachweis:

```
JS-Fingerprint  : 52e183d12f8e68739b77ae444c00dfa5d2424e666ba1fccfe41387cd15352a59
Runtime-Referenz: 52e183d12f8e68739b77ae444c00dfa5d2424e666ba1fccfe41387cd15352a59
```

Zusätzlich liefert der Server den Fingerprint jetzt als `X-Config-Fingerprint`
— für `/api/v9/config`, `/api/v9/shard/{node}` und `/api/v9/cross/{owner}`.
Der Snapshot bevorzugt ihn und vermerkt die Herkunft.

### F-6: Der Vergleich war unsymmetrisch

`compareWithHead` rechnete die Snapshot-Seite mit Gleitkomma-Hinweisen, die
Head-Seite ohne. Ergebnis: zwei identische Stände galten als verschieden.
Behoben — liegt für den Head kein Rohtext vor, wird auch die Snapshot-Seite
ohne Hinweise gerechnet.

### F-7: Shards wurden neu berechnet statt geholt

Der Export projizierte die Shards lokal. Inhaltlich richtig, aber nicht
byte-gleich zur Datei auf dem Worker: der Server kanonisiert beim Schreiben die
Zahlentypen. Behoben — der Export holt die Shard-Dateien vor dem SVG-Aufbau vom
Server; die lokale Projektion bleibt als Rückfall und wird in `source` als
solche benannt.

### Zwei Fallen im DOM

`querySelector('plantfactory:snapshot')` wirft: der Doppelpunkt ist im
CSS-Selektor der Trenner einer Pseudoklasse. Ersetzt durch einen Gang über die
Kinderliste.

`createCDATASection` gibt es nur in XML-Dokumenten. Lebt das SVG in einer
HTML-Seite — der Normalfall im Editor — wirft es einen `NotSupportedError`.
Jetzt mit Rückfall auf einen Textknoten; `extractSnapshot()` löst die dabei
maskierten Entities wieder auf. Beide Sprachen beherrschen beide Wege.

---

## 4. Der Nachweis

### Ende zu Ende, über die echte Schaltfläche

Der Test klickt im Browser auf „Export", fängt den erzeugten SVG-Blob ab und
gibt ihn an das Python-Werkzeug:

```
Snapshot   : Version 1, erzeugt 2026-08-01T11:57:34Z
Integritaet: unversehrt
Konfigurationen (4):
  master_global scope=master_global                    37052 B  fp=52e183d1 (server)
  node_local    scope=node_local    node=fn-01         23550 B  fp=90258819 (server)
  node_local    scope=node_local    node=fn-02         19071 B  fp=5d343081 (server)
  cross         scope=cross         owner=fn-01        18546 B  fp=95033fb3 (server)

Byte-Genauigkeit:
  OK   master byte-identisch zu config/device_state_data_v9.json
  OK   fn-01  byte-identisch zu config/shards/device_state_data_v9_node_fn-01.json
  OK   fn-02  byte-identisch zu config/shards/device_state_data_v9_node_fn-02.json
  OK   cross  byte-identisch zu config/shards/device_state_data_v8_cross_fn-01.json
```

### `test/test_snapshot.mjs` — 52 Prüfungen

Byte-Genauigkeit · Manipulation am Text fällt auf · Manipulation an der
Nutzlast fällt auf · alle fünf Vergleichslagen · Fingerprint-Determinismus ·
**JS schreibt, Python liest** und umgekehrt · Snapshot bleibt aus einem sonst
beschädigten SVG lesbar · abgeschnittener Snapshot liefert `null` statt
Halbwissen.

Der Robustheitsteil ist kein Zierrat: ein Snapshot wird gebraucht, wenn etwas
kaputt ist. Deshalb liest ihn ein Textschnitt zwischen bekannten Marken, kein
XML-Parser — ein Parser gibt bei einem beschädigten SVG auf.

### Die Suite

`./test_all.sh` — **zwölf** Stufen, **410 Prüfungen**:

| # | Stufe | Ergebnis |
|---|---|---|
| 1–7 | Syntax, Format, Konfiguration, Migration, Split, Bibliotheken | wie V54.1 |
| 8 | Regelvertrag gegen die echte Runtime | 29 |
| 9 | Plant-Factory-Kette | 31 |
| 10 | **Konfigurations-Snapshot** | **52** |
| 11 | Kern-Regressionstests | 145 |
| 12 | UI-Smoke-Test | 122 |

---

## 5. Neue und geänderte Dateien

**Neu**

| Datei | Zweck |
|---|---|
| `public/js/hmi_snapshot.js` | Snapshot bauen, einbetten, lesen, vergleichen |
| `_tools/config_snapshot.py` | CLI: `inspect`, `extract`, `compare`, `restore`, `embed` |
| `test/test_snapshot.mjs` | 52 Prüfungen inkl. Sprachparität |

**Geändert**

`public/js/v9_uuid.js` (SHA-256, synchron, gegen `node:crypto` verifiziert) ·
`public/js/v9_store.js` (lädt die Datei, merkt Rohtext und Fingerprint) ·
`public/js/ui.js` (Shard-Cache, Snapshot im Export) ·
`public/js/v9_bootstrap.js` (Snapshot-API) ·
`_server_v9.py` (`X-Config-Fingerprint` an drei Endpunkten) ·
`test/smoke_ui.mjs`, `test_all.sh`, `package.json`, `VERSION`

---

## 6. Was das für den Betrieb bedeutet

**Wiederherstellung ohne Worker-Config.** Das SVG genügt. `restore` schreibt
die Datei byte-genau zurück, der Fingerprint bleibt unverändert, die
Runtime-Type-Authority nimmt sie an.

**Replikation trotz veraltetem Snapshot.** Der Vergleich sagt, wie alt er ist
und welche Sektionen abweichen. Die Entscheidung bleibt beim Betreiber.

**Was der Snapshot nicht ist.** Er ersetzt keine Sicherungsstrategie — er
ergänzt sie um einen Ort, an dem eine Kopie ohnehin schon hingeht. Und er ist
kein Proposal: wer eine Config über Authority V5 in die Anlage bringen will,
geht weiterhin den Weg aus Abschnitt 1 der V54.1-Diagnose.

### Bewusst offen

1. **Kompression.** Vier Configs machen ~98 kB im SVG. Ein Schalter für
   gzip+Base64 wäre leicht ergänzt — bewusst nicht getan, siehe oben.
2. **Signatur.** `payload_sha256` erkennt Verfälschung, beweist aber keine
   Urheberschaft. Eine Signatur bräuchte eine Schlüsselverwaltung, die es hier
   nicht gibt.
3. **Restore über die Oberfläche.** Der Editor kann Snapshots lesen und
   einordnen (`window.__v9.snapshot`), das Zurückschreiben läuft über die CLI —
   passend zur Entscheidung aus V54.1, dass der Editor exportiert und nicht
   schreibt.
