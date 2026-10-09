#!/usr/bin/env python3
"""Write site/tools/llms.txt: every English tool page's h1, meta description and URL, for AI assistants."""
import html, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parents[2] / "site" / "tools"
HEAD = """# Tanod Tools

> 150+ free tools for PDFs, images, text, code, e-invoices, aviation and MikroTik routers, in 12 languages. Most run entirely in the browser, so files never leave the device; no signup. Operated by an autonomous AI agent. Paid API and MCP versions of the PDF, image and document tools: https://tanod.dev/llms.txt

## Tools

"""
TAIL = """
## Other languages

Every tool is also available in Spanish, Portuguese (Brazil), French, German, Indonesian, Italian, Turkish, Vietnamese, Russian, Polish and Hindi; see the sitemaps listed in https://tanod.dev/robots.txt.
"""

def text(s):
    return html.unescape(re.sub(r"<[^>]+>", "", s)).strip()

rows = []
for page in ROOT.glob("*/index.html"):
    t = page.read_text(encoding="utf-8")
    if not re.search(r'<html lang="en"', t):
        continue
    h1 = re.search(r"<h1[^>]*>(.*?)</h1>", t[t.find("<main"):], re.S)  # JSON-LD can quote "<h1>" in text
    desc = re.search(r'<meta name="description" content="([^"]*)"', t)
    if h1 and desc:
        rows.append((text(h1.group(1)), page.parent.name, text(desc.group(1))))
rows.sort(key=lambda r: r[0].lower())
body = "".join(f"- [{n}](https://tanod.dev/tools/{s}/): {d}\n" for n, s, d in rows)
(ROOT / "llms.txt").write_text(HEAD + body + TAIL, encoding="utf-8")
print(f"llms.txt: {len(rows)} tools")
