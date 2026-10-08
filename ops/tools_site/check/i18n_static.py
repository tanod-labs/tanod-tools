"""Static checks of the generated tools pages in every language (no browser).

- every page: balanced tags, one <h1>, <html lang> matches its directory, a self-referencing canonical,
  JSON-LD that parses (with inLanguage on localized pages), a string-table link that exists (localized pages)
- hreflang: every page lists itself, every alternate exists and lists this page back under this page's
  language (reciprocity), x-default points at the English page
- sitemaps: sitemap-tools.xml indexes one file per language; every URL exists; its alternates match the page's;
  server tool pages are listed only when build.SERVER_TOOLS_PUBLIC is true; robots.txt names sitemap-tools.xml
- leftover English: text of a localized page that also appears, as a sentence of 4+ words, on the English page
  (chrome, tool markup and content alike); the privacy tags use the glossary sentences

Usage: python3 ops/tools_site/check/i18n_static.py
"""
import json
from html import unescape as html_unescape
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from xml.etree import ElementTree as ET

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE.parent / "i18n"))
import build  # noqa: E402
import strings as js_strings  # noqa: E402

SITE = build.SITE
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}
# Sentences allowed to stay English on localized pages (product, protocol and library names, code samples).
ALLOW = re.compile(r"Cloudflare Web Analytics|Lorem ipsum|lorem ipsum|The quick brown fox|Hello|hello world", re.I)


class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack, self.errors, self.texts = [], [], []
        self.h1 = 0
        self.lang = None
        self.canonical = None
        self.alts = []
        self.ld = []
        self.strings = None
        self._ld = None
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "html":
            self.lang = a.get("lang")
        if tag == "h1":
            self.h1 += 1
        if tag == "link" and a.get("rel") == "canonical":
            self.canonical = a.get("href")
        if tag == "link" and a.get("rel") == "alternate" and a.get("hreflang"):
            self.alts.append((a["hreflang"], a["href"]))
        if tag == "link" and "data-strings" in a:
            self.strings = a.get("href")
        if tag == "script" and a.get("type") == "application/ld+json":
            self._ld = ""
        if tag in ("script", "style", "code", "pre", "textarea", "svg"):
            self._skip += 1
        for k in ("placeholder", "aria-label", "aria-roledescription", "title", "alt"):
            if a.get(k):
                self.texts.append(a[k])
        if tag not in VOID:
            self.stack.append(tag)

    def handle_startendtag(self, tag, attrs):
        if tag not in VOID and tag not in ("path", "use", "circle", "rect", "ellipse"):
            self.errors.append(f"self-closed <{tag}/>")

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        if tag in ("script", "style", "code", "pre", "textarea", "svg"):
            self._skip = max(0, self._skip - 1)
        if tag == "script" and self._ld is not None:
            self.ld.append(self._ld)
            self._ld = None
        if not self.stack or self.stack[-1] != tag:
            self.errors.append(f"</{tag}> closes <{self.stack[-1] if self.stack else 'nothing'}>")
            if tag in self.stack:
                while self.stack and self.stack.pop() != tag:
                    pass
            return
        self.stack.pop()

    def handle_data(self, data):
        if self._ld is not None:
            self._ld += data
        elif not self._skip:
            t = re.sub(r"\s+", " ", data).strip()
            if t:
                self.texts.append(t)


def parse(path: Path) -> Page:
    p = Page()
    p.feed(path.read_text())
    p.close()
    if p.stack:
        p.errors.append(f"unclosed {p.stack}")
    return p


def sentences(texts):
    out = set()
    for t in texts:
        for s in re.split(r"(?<=[.!?:;])\s+", t):
            if len(re.findall(r"[A-Za-z]{2,}", s)) >= 4 and len(s.split()) >= 4 and not ALLOW.search(s):
                out.add(s.strip())
    return out


def url_to_file(url: str) -> Path:
    assert url.startswith(build.ORIGIN), url
    return SITE / url[len(build.ORIGIN):].lstrip("/") / "index.html"


def main() -> int:
    pages = {}   # absolute URL -> (lang, slug or None, Page)
    problems, warnings = [], []
    for lang in build.LANG_CODES:
        root = build.out_dir(lang)
        for f in sorted(root.glob("*/index.html")) + [root / "index.html"]:
            if f.parent.name in ("js", "vendor"):
                continue
            rel = "/" + str(f.parent.relative_to(SITE)) + "/"
            if rel == "/tools/./" or f.parent == root:
                rel = build.index_path(lang)
            pages[build.ORIGIN + rel] = (lang, f, parse(f))
    en_by_path = {}
    for url, (lang, f, p) in pages.items():
        name = url[len(build.ORIGIN):]
        for e in p.errors:
            problems.append(f"{name}: {e}")
        if p.h1 != 1:
            problems.append(f"{name}: {p.h1} <h1> elements")
        if p.lang != build.HREFLANG[lang]:
            problems.append(f"{name}: <html lang={p.lang!r}>, expected {build.HREFLANG[lang]!r}")
        if p.canonical != url:
            problems.append(f"{name}: canonical {p.canonical!r}")
        for raw in p.ld:
            try:
                ld = json.loads(raw)
            except json.JSONDecodeError as e:
                problems.append(f"{name}: JSON-LD doesn't parse: {e}")
                continue
            if lang != "en":
                for node in ld.get("@graph", []):
                    if node.get("@type") in ("WebApplication", "HowTo", "FAQPage", "WebSite") and node.get("inLanguage") != build.HREFLANG[lang]:
                        problems.append(f"{name}: JSON-LD {node.get('@type')} inLanguage {node.get('inLanguage')!r}")
        if not p.ld:
            problems.append(f"{name}: no JSON-LD")
        if lang != "en":
            if not p.strings:
                problems.append(f"{name}: no string table link")
            elif not (SITE / p.strings.split("?")[0].lstrip("/")).exists():
                problems.append(f"{name}: string table {p.strings} missing")
        # hreflang
        alts = dict(p.alts)
        if len(alts) != len(p.alts):
            problems.append(f"{name}: duplicate hreflang")
        if alts.get(build.HREFLANG[lang]) != url:
            problems.append(f"{name}: no self hreflang")
        xd = alts.get("x-default")
        if not xd or pages.get(xd, (None,))[0] != "en":
            problems.append(f"{name}: x-default {xd!r} isn't an English page")
        for h, u in p.alts:
            if h == "x-default":
                continue
            other = pages.get(u)
            if not other:
                problems.append(f"{name}: hreflang {h} -> {u} doesn't exist")
                continue
            if build.HREFLANG[other[0]] != h:
                problems.append(f"{name}: hreflang {h} -> a {other[0]} page")
            back = dict(other[2].alts)
            if back.get(build.HREFLANG[lang]) != url:
                problems.append(f"{name}: {u} doesn't link back with hreflang {build.HREFLANG[lang]}")
            if back.get("x-default") != xd:
                problems.append(f"{name}: x-default differs from {u}'s")
        if lang == "en":
            en_by_path[url] = p
    # leftover English
    for url, (lang, f, p) in pages.items():
        if lang == "en":
            continue
        en_url = dict(p.alts).get("x-default")
        en = pages.get(en_url)
        if not en:
            continue
        left = sentences(p.texts) & sentences(en[2].texts)
        for s in sorted(left):
            warnings.append(f"{url[len(build.ORIGIN):]}: English left? {s[:110]!r}")
    # privacy tags
    for url, (lang, f, p) in pages.items():
        if lang == "en":
            continue
        html = f.read_text()
        for m in re.finditer(r'<p class="(local-tag[^"]*|drop__local[^"]*)">(?:<svg.*?</svg>)(.*?)</p>', html):
            cls, txt = m.group(1), html_unescape(m.group(2))
            if cls == "local-tag" and f.parent != build.out_dir(lang):
                continue  # a tool's own local_text (translated content), or the glossary sentence
            if not any(v.get(lang) == txt for v in build.PRIVACY.values()) and cls != "local-tag":
                problems.append(f"{url[len(build.ORIGIN):]}: privacy line not from the glossary: {txt!r}")
    # sitemaps
    ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9", "x": "http://www.w3.org/1999/xhtml"}
    idx = ET.parse(SITE / "sitemap-tools.xml").getroot()
    files = [e.text for e in idx.findall("s:sitemap/s:loc", ns)]
    if len(files) != len(build.LANG_CODES):
        problems.append(f"sitemap-tools.xml lists {len(files)} sitemaps")
    listed = set()
    server = [f.stem for f in sorted((build.HERE / "content").glob("*.html"))
              if build.parse_content(f.read_text(), f.name)[0].get("server")]
    server_urls = {build.ORIGIN + build.tool_path(lang, s) for lang in build.LANG_CODES for s in server}
    for loc in files:
        sm = ET.parse(SITE / loc[len(build.ORIGIN) + 1:]).getroot()
        for u in sm.findall("s:url", ns):
            url = u.find("s:loc", ns).text
            listed.add(url)
            if url not in pages:
                problems.append(f"{loc}: {url} doesn't exist")
                continue
            alts = sorted((x.get("hreflang"), x.get("href")) for x in u.findall("x:link", ns))
            if alts != sorted(pages[url][2].alts):
                problems.append(f"{loc}: alternates of {url} differ from the page's")
            if url in server_urls and not build.SERVER_TOOLS_PUBLIC:
                problems.append(f"{loc}: server tool {url} listed while SERVER_TOOLS_PUBLIC is False")
    for url in pages:
        if url not in listed and url not in server_urls:
            problems.append(f"{url}: not in any sitemap")
    main_xml = (SITE / "sitemap.xml").read_text()
    if "/tools/" in main_xml:
        problems.append("sitemap.xml still lists /tools/ URLs")
    if f"Sitemap: {build.ORIGIN}/sitemap-tools.xml" not in (SITE / "robots.txt").read_text():
        problems.append("robots.txt doesn't name sitemap-tools.xml")
    # UI strings complete for every script
    entries = {"index"} | {build.parse_content(f.read_text(), f.name)[0].get("module", f.stem)
                           for f in (build.HERE / "content").glob("*.html") if f.stem in build.SLUGS and f.stem in build.ORDER}
    for m in sorted({m for e in entries for m in js_strings.closure(e)}):
        problems += js_strings.problems(m)

    for w in warnings:
        print("warn  " + w)
    for e in problems:
        print("FAIL  " + e)
    by_lang = {}
    for lang, _, _ in pages.values():
        by_lang[lang] = by_lang.get(lang, 0) + 1
    print(f"\n{len(pages)} pages ({', '.join(f'{k} {v}' for k, v in by_lang.items())}), "
          f"{len(problems)} problems, {len(warnings)} warnings")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
