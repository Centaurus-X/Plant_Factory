#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""declassify_js.py — überführt ES-Klassen in funktionale Factory-Funktionen.

Motivation
----------
Die V50-Bestandsmodule sind objektorientiert aufgebaut (18 Klassen). V53 löst
das vollständig auf: aus jeder Klasse wird eine Factory-Funktion, die ein
Closure-Objekt zurückgibt. Kein `class`, kein `new`, kein `this`.

Transformation
--------------
    class X {
      constructor(a) { KONSTRUKTOR }
      m(y) { RUMPF }
    }
    const x = new X(1);

wird zu

    function createX(a) {
      const self = {};
      self.m = function (y) { RUMPF' };     // Methoden zuerst …
      KONSTRUKTOR'                          // … dann der Konstruktorkörper,
      return self;                          //     damit er Methoden aufrufen darf
    }
    const x = createX(1);

`'` bedeutet: jedes `this` wurde durch `self` ersetzt — aber ausschließlich
außerhalb von Strings, Template-Literalen, Kommentaren und Regex-Literalen.
Dafür läuft ein kleiner Lexer über den Quelltext (siehe scan_code_spans).

Warum das verhaltensgleich ist
------------------------------
* Keine der 18 Klassen nutzt `extends`, `static`, Getter/Setter oder
  Klassenfelder — geprüft vor der Konvertierung.
* Methoden werden vor dem Konstruktorkörper zugewiesen, Aufrufe daraus
  funktionieren also unverändert.
* `self` ist lexikalisch gebunden. Damit verlieren Methoden ihren Kontext
  auch dann nicht, wenn sie als Callback weitergereicht werden — das ist
  strikt robuster als `this`.

Designvorgaben: kein OOP, keine Decorators, functools.partial statt lambda.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from functools import partial
from pathlib import Path

CLASS_PATTERN = re.compile(r"^class (\w+)(?:\s+extends\s+(\w+))?\s*\{", re.M)
REGEX_PRECEDERS = set("(,=:[!&|?{};+-*%~^<>")


# --------------------------------------------------------------------------
# Lexer: liefert die Bereiche, die echter Code sind
# --------------------------------------------------------------------------

def scan_code_spans(source):
    """Liefert die (start, end)-Bereiche, die weder String noch Kommentar sind.

    Erkennt: '…', "…", `…` (inkl. ${}-Interpolation als Code), //…, /*…*/
    und Regex-Literale. Regex wird über das letzte bedeutungstragende Zeichen
    von einer Division unterschieden.
    """
    spans = []
    index = 0
    length = len(source)
    code_start = 0
    last_significant = ""

    def close(position):
        if position > code_start:
            spans.append((code_start, position))

    while index < length:
        char = source[index]
        nxt = source[index + 1] if index + 1 < length else ""

        if char == "/" and nxt == "/":
            close(index)
            index = source.find("\n", index)
            index = length if index < 0 else index
            code_start = index
            continue

        if char == "/" and nxt == "*":
            close(index)
            end = source.find("*/", index + 2)
            index = length if end < 0 else end + 2
            code_start = index
            continue

        if char in ("'", '"'):
            close(index)
            index = skip_quoted(source, index, char)
            code_start = index
            last_significant = "s"
            continue

        if char == "`":
            close(index)
            index, inner = skip_template(source, index)
            spans.extend(inner)
            code_start = index
            last_significant = "s"
            continue

        if char == "/" and (last_significant == "" or last_significant in REGEX_PRECEDERS):
            close(index)
            index = skip_regex(source, index)
            code_start = index
            last_significant = "r"
            continue

        if not char.isspace():
            last_significant = char
        index += 1

    close(length)
    return spans


def skip_quoted(source, index, quote):
    index += 1
    while index < len(source):
        if source[index] == "\\":
            index += 2
            continue
        if source[index] == quote:
            return index + 1
        index += 1
    return index


def skip_template(source, index):
    """Überspringt ein Template-Literal ab dem öffnenden Backtick.

    Liefert (Position hinter dem schließenden Backtick, Code-Spannen der
    ${…}-Ausdrücke). Beliebig tief verschachtelte Templates funktionieren,
    weil skip_expression und skip_template sich gegenseitig aufrufen.
    """
    inner_spans = []
    index += 1
    length = len(source)
    while index < length:
        char = source[index]
        if char == "\\":
            index += 2
            continue
        if char == "`":
            return index + 1, inner_spans
        if char == "$" and source[index + 1:index + 2] == "{":
            end, spans = skip_expression(source, index + 2)
            inner_spans.extend(spans)
            index = end + 1
            continue
        index += 1
    return index, inner_spans


def skip_expression(source, start):
    """Scannt einen ${…}-Ausdruck bis zur passenden schließenden Klammer.

    Liefert (Position der schließenden Klammer, Code-Spannen darin).
    Strings, Kommentare und verschachtelte Templates werden korrekt
    übersprungen und nicht als Code gemeldet.
    """
    spans = []
    depth = 1
    cursor = start
    code_from = start
    length = len(source)
    last_significant = ""

    def flush(position):
        if position > code_from:
            spans.append((code_from, position))

    while cursor < length:
        char = source[cursor]
        nxt = source[cursor + 1] if cursor + 1 < length else ""

        if char == "\\":
            cursor += 2
            continue
        if char in ("'", '"'):
            flush(cursor)
            cursor = skip_quoted(source, cursor, char)
            code_from = cursor
            last_significant = "s"
            continue
        if char == "`":
            flush(cursor)
            cursor, nested = skip_template(source, cursor)
            spans.extend(nested)
            code_from = cursor
            last_significant = "s"
            continue
        if char == "/" and nxt == "/":
            flush(cursor)
            end = source.find("\n", cursor)
            cursor = length if end < 0 else end
            code_from = cursor
            continue
        if char == "/" and nxt == "*":
            flush(cursor)
            end = source.find("*/", cursor + 2)
            cursor = length if end < 0 else end + 2
            code_from = cursor
            continue
        if char == "/" and (last_significant == "" or last_significant in REGEX_PRECEDERS):
            flush(cursor)
            cursor = skip_regex(source, cursor)
            code_from = cursor
            last_significant = "r"
            continue
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                flush(cursor)
                return cursor, spans
        if not char.isspace():
            last_significant = char
        cursor += 1

    flush(length)
    return cursor, spans


def skip_regex(source, index):
    index += 1
    in_class = False
    while index < len(source):
        char = source[index]
        if char == "\\":
            index += 2
            continue
        if char == "[":
            in_class = True
        elif char == "]":
            in_class = False
        elif char == "/" and not in_class:
            index += 1
            while index < len(source) and source[index].isalpha():
                index += 1
            return index
        elif char == "\n":
            return index
        index += 1
    return index


def replace_in_code(source, pattern, replacement):
    """Ersetzt pattern nur außerhalb von Strings, Kommentaren und Regex."""
    spans = scan_code_spans(source)
    pieces = []
    cursor = 0
    count = 0
    for start, end in spans:
        pieces.append(source[cursor:start])
        chunk, hits = pattern.subn(replacement, source[start:end])
        pieces.append(chunk)
        count += hits
        cursor = end
    pieces.append(source[cursor:])
    return "".join(pieces), count


THIS_PATTERN = re.compile(r"\bthis\b")
# Zeilen der Form `var self = self;` (aus `var self = this;`) entfernen.
SELF_ALIAS_PATTERN = re.compile(r"^[ \t]*(?:var|let|const)[ \t]+self[ \t]*=[ \t]*self[ \t]*;[ \t]*\n", re.M)


# --------------------------------------------------------------------------
# Klassenzerlegung
# --------------------------------------------------------------------------

def match_block(source, open_index):
    """Findet das schließende } zum { an open_index — stringsicher."""
    spans = scan_code_spans(source)
    depth = 0
    for start, end in spans:
        if end <= open_index:
            continue
        cursor = max(start, open_index)
        while cursor < end:
            char = source[cursor]
            if char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    return cursor
            cursor += 1
    raise ValueError("Kein schließendes } gefunden ab Position %d" % open_index)


def split_members(body):
    """Zerlegt einen Klassenrumpf in Methoden — stringsicher, Klammertiefe 0."""
    spans = scan_code_spans(body)
    code = set()
    for start, end in spans:
        code.update(range(start, end))

    members = []
    index = 0
    length = len(body)
    header = re.compile(
        r"(?P<lead>\s*)(?P<static>static\s+)?(?P<async>async\s+)?(?P<gen>\*\s*)?"
        r"(?P<name>[A-Za-z_$][\w$]*)\s*(?P<params>\()")

    while index < length:
        match = header.match(body, index)
        if not match or match.start("name") not in code:
            index += 1
            continue
        params_open = match.start("params")
        params_close = match_paren(body, params_open, code)
        brace_open = body.find("{", params_close)
        if brace_open < 0:
            break
        brace_close = match_brace(body, brace_open, code)
        members.append({
            "name": match.group("name"),
            "static": bool(match.group("static")),
            "async": bool(match.group("async")),
            "generator": bool(match.group("gen")),
            "params": body[params_open + 1:params_close],
            "body": body[brace_open + 1:brace_close],
        })
        index = brace_close + 1
    return members


def match_paren(body, open_index, code):
    depth = 0
    for cursor in range(open_index, len(body)):
        if cursor not in code:
            continue
        if body[cursor] == "(":
            depth += 1
        elif body[cursor] == ")":
            depth -= 1
            if depth == 0:
                return cursor
    raise ValueError("Keine schließende ) gefunden")


def match_brace(body, open_index, code):
    depth = 0
    for cursor in range(open_index, len(body)):
        if cursor not in code:
            continue
        if body[cursor] == "{":
            depth += 1
        elif body[cursor] == "}":
            depth -= 1
            if depth == 0:
                return cursor
    raise ValueError("Kein schließendes } gefunden")


def reindent(text, spaces):
    """Verschiebt einen Block um `spaces` Zeichen nach links/rechts."""
    lines = text.split("\n")
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    if not lines:
        return ""
    indents = [len(line) - len(line.lstrip(" ")) for line in lines if line.strip()]
    base = min(indents) if indents else 0
    pad = " " * spaces
    return "\n".join((pad + line[base:]) if line.strip() else "" for line in lines)


def render_factory(name, members, base_indent=""):
    """Erzeugt die Factory-Funktion aus den Klassenmitgliedern."""
    constructor = None
    methods = []
    for member in members:
        if member["name"] == "constructor":
            constructor = member
        else:
            methods.append(member)

    params = constructor["params"].strip() if constructor else ""
    out = ["function create%s(%s) {" % (name, params)]
    out.append("  const self = {};")
    out.append("")

    for method in methods:
        prefix = "async " if method["async"] else ""
        star = "*" if method["generator"] else ""
        signature = "  self.%s = %sfunction %s(%s) {" % (
            method["name"], prefix, star, method["params"].strip())
        out.append(signature)
        rendered = reindent(method["body"], 4)
        if rendered:
            out.append(rendered)
        out.append("  };")
        out.append("")

    if constructor and constructor["body"].strip():
        out.append("  // --- Konstruktorkörper (läuft nach der Methodenbindung) ---")
        rendered = reindent(constructor["body"], 2)
        if rendered:
            out.append(rendered)
        out.append("")

    out.append("  return self;")
    out.append("}")
    return "\n".join(base_indent + line if line else "" for line in out)


def convert_source(source, stats):
    """Konvertiert alle Klassen einer Datei."""
    while True:
        match = CLASS_PATTERN.search(source)
        if not match:
            break
        name = match.group(1)
        if match.group(2):
            raise ValueError("Klasse %s nutzt extends — nicht unterstützt" % name)
        open_index = source.index("{", match.start())
        close_index = match_block(source, open_index)
        body = source[open_index + 1:close_index]
        members = split_members(body)

        for member in members:
            if member["static"]:
                raise ValueError("Klasse %s hat statische Methode %s" % (name, member["name"]))

        factory = render_factory(name, members)
        source = source[:match.start()] + factory + source[close_index + 1:]
        stats["classes"] += 1
        stats["methods"] += len([m for m in members if m["name"] != "constructor"])
        stats["names"].append(name)

    # this -> self, nur im Code
    source, hits = replace_in_code(source, THIS_PATTERN, "self")
    stats["this"] += hits

    # Der Bestand nutzt an 13 Stellen das Idiom `var self = this;`, um den
    # Klassenkontext in Callbacks zu retten. Nach der Ersetzung stünde dort
    # `var self = self;` — eine lokale, dank Hoisting undefinierte Variable,
    # die das Closure-Objekt der Factory verdeckt. Solche Zeilen entfallen
    # ersatzlos, denn `self` ist bereits lexikalisch gebunden.
    source, dropped = replace_in_code(source, SELF_ALIAS_PATTERN, "")
    stats["self_alias_removed"] += dropped

    # new X() -> createX()
    for name in stats["names"]:
        pattern = re.compile(r"\bnew\s+%s\b" % re.escape(name))
        source, hits = replace_in_code(source, pattern, "create%s" % name)
        stats["new"] += hits
    return source


def convert_file(path, stats):
    source = Path(path).read_text(encoding="utf-8")
    if not CLASS_PATTERN.search(source):
        return False
    file_stats = {"classes": 0, "methods": 0, "this": 0, "new": 0,
                  "self_alias_removed": 0, "names": []}
    converted = convert_source(source, file_stats)
    Path(path).write_text(converted, encoding="utf-8")
    stats["files"] += 1
    for key in ("classes", "methods", "this", "new", "self_alias_removed"):
        stats[key] += file_stats[key]
    stats["detail"][str(path)] = file_stats
    return True


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Überführt ES-Klassen in funktionale Factory-Funktionen.")
    parser.add_argument("paths", nargs="+")
    parser.add_argument("--report", default=None)
    args = parser.parse_args(argv)

    stats = {"files": 0, "classes": 0, "methods": 0, "this": 0, "new": 0,
             "self_alias_removed": 0, "detail": {}}
    for raw in args.paths:
        path = Path(raw)
        if not path.is_file():
            print("Nicht gefunden: %s" % path, file=sys.stderr)
            return 2
        if convert_file(path, stats):
            detail = stats["detail"][str(path)]
            print("%-30s Klassen=%d Methoden=%d this=%d new=%d alias=%d  %s" % (
                path.name, detail["classes"], detail["methods"], detail["this"],
                detail["new"], detail["self_alias_removed"], ", ".join(detail["names"])))

    print("\nGesamt: %d Dateien, %d Klassen, %d Methoden, %d this-Ersetzungen, "
          "%d new-Aufrufe, %d self-Aliase entfernt"
          % (stats["files"], stats["classes"], stats["methods"], stats["this"],
             stats["new"], stats["self_alias_removed"]))
    if args.report:
        Path(args.report).write_text(json.dumps(stats, indent=2, ensure_ascii=False),
                                     encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


# --------------------------------------------------------------------------
# Selbsttest des Lexers
# --------------------------------------------------------------------------

SELFTEST_CASES = (
    ("const a = 'this';", 0),
    ('const a = "this";', 0),
    ("// this\nlet x = this;", 1),
    ("/* this */ let x = this;", 1),
    ("const r = /this/g; let x = this;", 1),
    ("const t = `a ${this.b} c`;", 1),
    ("const t = `a ${x ? `<i>${this.y}</i>` : ''} c`;", 1),
    ("const t = `x ${ f('this') } this-in-text`;", 0),
    ("const t = `${ {a: this.b} }`;", 1),
    ("const t = `${ '}' }${this.z}`;", 1),
    ("const t = `a\\`b ${this.c}`;", 1),
    ("const s = 'a\\'this\\'b'; this.x = 1;", 1),
    ("x = a / b; y = this;", 1),
    ("const t = `${ // this\n this.a }`;", 1),
)


def selftest():
    failures = []
    for source, expected in SELFTEST_CASES:
        _, hits = replace_in_code(source, THIS_PATTERN, "self")
        if hits != expected:
            failures.append("%r -> %d statt %d" % (source, hits, expected))
    return failures
