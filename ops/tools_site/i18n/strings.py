"""UI string tables for the tools' JavaScript (site/tools/js/*.js).

Code marks every user-visible English string with tx("..."), txf("...") or txn(n, "one", "other"); see
site/tools/js/i18n.js. This module extracts those keys, checks ops/tools_site/i18n/strings/<module>.json for a
translation in every language, and builds the per-page tables the build writes to site/tools/js/i18n/<lang>/.

strings/<module>.json:  { "<English key>": { "es": "...", "pt-BR": "...", "fr": "...", "de": "...", "id": "..." } }
Plural keys are "<one>|<other>" and map each language to {"one": ..., "other": ...} (plus "few"/"many" where the
language has them; Indonesian may give a plain string).

Usage: python3 ops/tools_site/i18n/strings.py [module ...]    report missing, stale and broken entries
       python3 ops/tools_site/i18n/strings.py --suspects [module ...]   also list unwrapped English-looking literals
"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
JS = HERE.parent.parent.parent / "site" / "tools" / "js"
TABLES = HERE / "strings"
LANGS = ["es", "pt-BR", "fr", "de", "id"]

STR = r'"((?:[^"\\\n]|\\.)*)"'
RE_TX = re.compile(r"\btxf?\(\s*" + STR)
RE_TXN = re.compile(r"\btxn\([^\"()]*(?:\([^\"()]*\)[^\"()]*)*,\s*" + STR + r"\s*,\s*" + STR)
RE_IMPORT = re.compile(r"""(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']\./([\w-]+)\.js(?:\?v=\w+)?["']""")
PH = re.compile(r"\{(\w+)\}")


def js_unescape(s: str) -> str:
    return json.loads('"' + s.replace("\\'", "'") + '"')


def keys_of(module: str) -> list:
    """Keys used by one module, in source order, without duplicates."""
    src = (JS / f"{module}.js").read_text()
    out = []

    def code(m):  # skip examples in comments
        line = src[src.rfind("\n", 0, m.start()) + 1:m.start()].lstrip()
        return not (line.startswith(("//", "*", "/*")) or re.search(r"(^|[\s;,(])//", line))
    for m in RE_TX.finditer(src):
        if code(m):
            out.append((m.start(), js_unescape(m.group(1))))
    for m in RE_TXN.finditer(src):
        if code(m):
            out.append((m.start(), js_unescape(m.group(1)) + "|" + js_unescape(m.group(2))))
    out = [k for _, k in sorted(out)]
    seen, keys = set(), []
    for k in out:
        if k not in seen:
            seen.add(k)
            keys.append(k)
    return keys


def imports_of(module: str) -> list:
    src = (JS / f"{module}.js").read_text()
    return [m for m in RE_IMPORT.findall(src) if (JS / f"{m}.js").exists()]


def closure(module: str) -> list:
    """The module and every local module it imports (statically or dynamically), dependencies first."""
    order, seen = [], set()

    def visit(m):
        if m in seen:
            return
        seen.add(m)
        for d in imports_of(m):
            visit(d)
        order.append(m)
    visit(module)
    return order


def table(module: str) -> dict:
    p = TABLES / f"{module}.json"
    return json.loads(p.read_text()) if p.exists() else {}


def problems(module: str) -> list:
    """Missing or malformed translations for one module (empty when complete)."""
    out = []
    tab = table(module)
    for key in keys_of(module):
        entry = tab.get(key)
        if entry is None:
            out.append(f"{module}: missing entry {key!r}")
            continue
        want = set(PH.findall(key))
        for lang in LANGS:
            v = entry.get(lang)
            if v is None:
                out.append(f"{module}: {lang} missing for {key!r}")
                continue
            forms = v.values() if isinstance(v, dict) else [v]
            if isinstance(v, dict) and "other" not in v:
                out.append(f"{module}: {lang} plural without 'other' for {key!r}")
            if "|" in key and not isinstance(v, dict) and lang != "id":
                out.append(f"{module}: {lang} plural key needs {{one, other}} for {key!r}")
            for f in forms:
                if not isinstance(f, str) or not f.strip():
                    out.append(f"{module}: {lang} empty for {key!r}")
                    continue
                got = set(PH.findall(f))
                if got - want:
                    out.append(f"{module}: {lang} unknown placeholder {sorted(got - want)} in {key!r}")
                if "|" not in key and want - got:
                    out.append(f"{module}: {lang} drops placeholder {sorted(want - got)} in {key!r}")
    return out


def stale(module: str) -> list:
    used = set(keys_of(module))
    return [k for k in table(module) if k not in used]


def page_table(module: str, lang: str) -> dict:
    """Merged {key: translation} for a page whose entry module is `module` (its own entries win)."""
    out = {}
    for m in closure(module):
        tab = table(m)
        for key in keys_of(m):
            entry = tab.get(key)
            if entry and lang in entry:
                out[key] = entry[lang]
    return out


SUSPECT = re.compile(r"""(["'`])((?:(?!\1)[^\\\n]|\\.)*?[A-Za-z]{2,}(?:(?!\1)[^\\\n]|\\.)*?)\1""")


def suspects(module: str) -> list:
    """String literals that look like English prose but aren't wrapped (heuristic, for review)."""
    out = []
    for no, line in enumerate((JS / f"{module}.js").read_text().split("\n"), 1):
        s = line.strip()
        if s.startswith("//") or s.startswith("/*") or s.startswith("*") or s.startswith("import ") or "console." in s:
            continue
        for m in SUSPECT.finditer(line):
            text = m.group(2)
            before = line[:m.start()]
            if re.search(r"\btx[fn]?\(\s*$|\btxn\([^)]*,\s*$", before):
                continue
            if not re.search(r"[A-Za-z]{3,}\s+[a-z]{2,}", text) and not re.fullmatch(r"[A-Z][a-z]+[.…!?]?", text):
                continue
            if re.search(r"querySelector|\$\$?\(|classList|getAttribute|dataset", before[-40:]):
                continue
            if re.fullmatch(r"[a-z0-9_ -]*--?[a-z0-9_ -]*", text):
                continue
            out.append(f"{module}.js:{no}: {text[:90]}")
    return out


def main(argv):
    show = "--suspects" in argv
    mods = [a for a in argv if not a.startswith("--")] or sorted(p.stem for p in JS.glob("*.js"))
    bad = 0
    for m in mods:
        for p in problems(m):
            print(p)
            bad += 1
        for k in stale(m):
            print(f"{m}: stale entry {k!r}")
        if show:
            for s in suspects(m):
                print("suspect " + s)
    total = sum(len(keys_of(m)) for m in mods)
    print(f"{len(mods)} modules, {total} keys, {bad} problems")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
