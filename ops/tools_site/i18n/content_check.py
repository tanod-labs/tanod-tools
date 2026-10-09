"""Check translated tool pages in ops/tools_site/i18n/content/<lang>/<slug>.html against the English source.

- the meta block parses and has exactly the translatable keys the English file has
- the tool HTML has the same structure as the English (tags, ids, classes, every attribute except the
  human-text ones: placeholder, aria-label, title, alt, and value on text inputs), the same {{mark:...}} and
  <!--srv--> placeholders
- the explainer keeps its headings and the same set of link targets
- howto/faq have the same number of items
- English sentences left untranslated are listed (warnings)

Usage: python3 ops/tools_site/i18n/content_check.py <lang> [slug ...]   (all files of that language if no slug)
Exit status 1 when there are errors (warnings alone don't fail).
"""
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

HERE = Path(__file__).resolve().parent
EN_DIR = HERE.parent / "content"
LANGS = ["es", "pt-BR", "fr", "de", "id", "it", "tr", "vi", "ru", "pl", "hi"]
TRANSLATABLE = ["title", "description", "h1", "lede", "blurb", "keywords", "limits", "howto_title", "howto", "faq",
                "local_text"]
HUMAN_ATTRS = {"placeholder", "aria-label", "aria-roledescription", "title", "alt"}


def split(src: str, name: str):
    m = re.match(r"\s*<!--meta\s*(\{.*?\})\s*-->", src, re.S)
    if not m:
        raise ValueError(f"{name}: missing <!--meta {{...}} --> block")
    meta = json.loads(m.group(1))
    rest = src[m.end():]
    parts = dict(re.findall(r"<!--(tool|explain)-->(.*?)(?=<!--(?:tool|explain)-->|\Z)", rest, re.S))
    return meta, parts.get("tool", "").strip(), parts.get("explain", "").strip()


class Skel(HTMLParser):
    """Tag/attribute skeleton (human text removed) plus the visible text segments."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.items, self.texts, self.hrefs, self.heads = [], [], [], []
        self.stack = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        keep = []
        is_text_input = tag == "input" and a.get("type", "text") in ("text", "search", None)
        for k, v in attrs:
            if k in HUMAN_ATTRS or (k == "value" and is_text_input):
                if v:
                    self.texts.append(v)
                keep.append((k, "*"))
            else:
                keep.append((k, v))
        self.items.append(("<", tag, tuple(keep)))
        if tag == "a" and a.get("href"):
            self.hrefs.append(a["href"])
        if tag in ("h2", "h3", "h4"):
            self.heads.append(tag)
        if tag not in ("input", "br", "img", "hr", "meta", "link", "source", "wbr", "col"):
            self.stack.append(tag)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        self.items.append((">", tag))
        if self.stack and self.stack[-1] == tag:
            self.stack.pop()

    def handle_comment(self, data):
        self.items.append(("!", data.strip()))

    def handle_data(self, data):
        for m in re.finditer(r"\{\{mark:[^}]*\}\}", data):
            self.items.append(("mark", m.group(0)))
        t = re.sub(r"\{\{mark:[^}]*\}\}", " ", data).strip()
        if t and not (self.stack and self.stack[-1] in ("code", "pre", "script", "style")):
            self.texts.append(re.sub(r"\s+", " ", t))


def skel(html: str) -> Skel:
    p = Skel()
    p.feed(html)
    p.close()
    return p


def sentences(texts):
    out = []
    for t in texts:
        for s in re.split(r"(?<=[.!?:;])\s+", t):
            s = s.strip()
            if len(re.findall(r"[A-Za-z]{2,}", s)) >= 4:
                out.append(s)
    return out


def meta_texts(meta: dict) -> list:
    out = []
    for k in TRANSLATABLE:
        v = meta.get(k)
        if isinstance(v, str):
            out.append(re.sub(r"<[^>]+>", " ", v))
        elif isinstance(v, list):
            for x in v:
                for y in (x if isinstance(x, list) else [x]):
                    out.append(re.sub(r"<[^>]+>", " ", y))
    return out


def check(lang: str, slug: str):
    """Returns (errors, warnings)."""
    errors, warnings = [], []
    en_src = (EN_DIR / f"{slug}.html").read_text()
    path = HERE / "content" / lang / f"{slug}.html"
    if not path.exists():
        return [f"{lang}/{slug}: missing"], []
    try:
        en_meta, en_tool, en_explain = split(en_src, slug)
        meta, tool, explain = split(path.read_text(), f"{lang}/{slug}")
    except (ValueError, json.JSONDecodeError) as e:
        return [f"{lang}/{slug}: {e}"], []
    want = [k for k in TRANSLATABLE if k in en_meta]
    extra = [k for k in meta if k not in want]
    missing = [k for k in want if k not in meta]
    if extra:
        errors.append(f"{lang}/{slug}: meta keys not allowed here: {extra}")
    if missing:
        errors.append(f"{lang}/{slug}: meta keys missing: {missing}")
    for k in ("howto", "faq"):
        if k in meta and k in en_meta and len(meta[k]) != len(en_meta[k]):
            errors.append(f"{lang}/{slug}: {k} has {len(meta[k])} items, English has {len(en_meta[k])}")
    if "faq" in meta and not all(isinstance(x, list) and len(x) == 2 for x in meta["faq"]):
        errors.append(f"{lang}/{slug}: faq items must be [question, answer]")
    t = meta.get("title", "")
    if not t.endswith("| Tanod Tools"):
        errors.append(f"{lang}/{slug}: title must end with '| Tanod Tools'")
    if len(t) > 70:
        warnings.append(f"{lang}/{slug}: title is {len(t)} characters (aim for <= 65)")
    d = meta.get("description", "")
    if not 70 <= len(d) <= 170:
        warnings.append(f"{lang}/{slug}: description is {len(d)} characters (aim for 70-160)")
    for k in ("limits", "lede"):
        if k in meta and k in en_meta:
            a = sorted(re.findall(r'href="([^"]*)"', en_meta[k]))
            b = sorted(re.findall(r'href="([^"]*)"', meta[k]))
            if a != b:
                errors.append(f"{lang}/{slug}: links in {k} differ from English: {a} vs {b}")
    def faq_links(m):
        return sorted(h for qa in m.get("faq", []) for x in qa for h in re.findall(r'href="([^"]*)"', x))
    if faq_links(en_meta) != faq_links(meta):
        errors.append(f"{lang}/{slug}: links in faq differ from English: {faq_links(en_meta)} vs {faq_links(meta)}")

    a, b = skel(en_tool), skel(tool)
    if a.items != b.items:
        for i, (x, y) in enumerate(zip(a.items, b.items)):
            if x != y:
                errors.append(f"{lang}/{slug}: tool HTML differs from English at item {i}: English {x!r}, translation {y!r}")
                break
        else:
            errors.append(f"{lang}/{slug}: tool HTML has {len(b.items)} items, English {len(a.items)}")
    if b.stack:
        errors.append(f"{lang}/{slug}: unclosed tags in tool HTML: {b.stack}")
    ea, eb = skel(en_explain), skel(explain)
    if sorted(ea.hrefs) != sorted(eb.hrefs):
        errors.append(f"{lang}/{slug}: explainer links differ from English: {sorted(set(ea.hrefs) ^ set(eb.hrefs))}")
    if ea.heads != eb.heads:
        errors.append(f"{lang}/{slug}: explainer headings differ from English: {ea.heads} vs {eb.heads}")
    if eb.stack:
        errors.append(f"{lang}/{slug}: unclosed tags in explainer: {eb.stack}")

    en_sent = set(sentences(a.texts + ea.texts + meta_texts(en_meta)))
    for s in sentences(b.texts + eb.texts + meta_texts(meta)):
        if s in en_sent:
            warnings.append(f"{lang}/{slug}: untranslated? {s[:100]!r}")
    return errors, warnings


def main(argv):
    if not argv or argv[0] not in LANGS:
        print(__doc__)
        return 2
    lang = argv[0]
    slugs = argv[1:] or sorted(p.stem for p in (HERE / "content" / lang).glob("*.html"))
    n_err = 0
    for s in slugs:
        errs, warns = check(lang, s)
        for e in errs:
            print("ERROR " + e)
        for w in warns:
            print("warn  " + w)
        n_err += len(errs)
    print(f"{len(slugs)} files, {n_err} errors")
    return 1 if n_err else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
