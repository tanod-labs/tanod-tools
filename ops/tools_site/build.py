"""Generate Tanod Tools (https://tanod.dev/tools/) in every language from ops/tools_site/.

Sources:
  content/<slug>.html          one file per tool (English): a JSON meta block in an HTML comment, then the
                               tool markup after <!--tool--> and the explainer after <!--explain-->
  i18n/content/<lang>/<slug>.html   the same page translated (translatable meta keys, tool markup, explainer);
                               structure checked against the English by i18n/content_check.py
  i18n/slugs.json              the one table of localized URL slugs and tool names
  i18n/site.json               page chrome strings for this script (header, footer, index page...), keyed by English
  i18n/glossary.json           shared terms; its "privacy" sentences are used verbatim for the privacy tags
  i18n/strings/<module>.json   translations of the UI strings in site/tools/js/<module>.js (see i18n/strings.py)
  css/*.css                    concatenated in name order into site/tools/tools.css
  site/tools/js/*.js           hand-written ES modules (not generated; one per tool plus shared cores)

Outputs: site/tools/ (English) and site/<es|pt|fr|de|id>/tools/ (index + one page per tool),
site/tools/tools.css, site/tools/js/i18n/<lang>/<page>.js (per-page string tables), the ?v=ASSET_V stamp on
every local import in site/tools/js/*.js (bump ASSET_V when any script changes), the sitemaps
site/sitemap-tools.xml (index) + site/sitemap-tools-<lang>.xml, and the robots.txt Sitemap line.

Usage: python3 ops/tools_site/build.py [--partial]
  --partial   skip pages whose translation doesn't exist yet instead of failing (development only;
              hreflang and the language switcher then list only the languages a page exists in)
  --caddy     print the Caddyfile path matcher for the server tool pages in every language and exit
"""
import hashlib
import html
import json
import re
import sys
import unicodedata
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
SITE = ROOT / "site"
OUT = SITE / "tools"
I18N = HERE / "i18n"
ORIGIN = "https://tanod.dev"
LASTMOD = "2026-10-08"
WEB_DAILY_LIMIT = 10      # = scanapi settings.web_tools_per_day (SCANAPI_WEB_TOOLS_PER_DAY); copy only, the server enforces it
ASSET_V = "5"

# The six server-backed tools stay out of every sitemap (all languages) until Cloudflare Turnstile and the
# /web/v1 API are switched on for the public. Flip this one flag to list them.
SERVER_TOOLS_PUBLIC = False

sys.path.insert(0, str(I18N))
import strings as js_strings  # noqa: E402

# code, URL prefix, hreflang / <html lang>, og:locale, name in its own language, short label
LANGS = [
    ("en", "", "en", "en_US", "English", "EN"),
    ("es", "/es", "es", "es_LA", "Español", "ES"),
    ("pt-BR", "/pt", "pt-BR", "pt_BR", "Português (Brasil)", "PT"),
    ("fr", "/fr", "fr", "fr_FR", "Français", "FR"),
    ("de", "/de", "de", "de_DE", "Deutsch", "DE"),
    ("id", "/id", "id", "id_ID", "Bahasa Indonesia", "ID"),
]
LANG_CODES = [l[0] for l in LANGS]
PREFIX = {l[0]: l[1] for l in LANGS}
HREFLANG = {l[0]: l[2] for l in LANGS}
OG_LOCALE = {l[0]: l[3] for l in LANGS}
NATIVE = {l[0]: l[4] for l in LANGS}
SHORT = {l[0]: l[5] for l in LANGS}

CATEGORIES = [
    ("pdf", "PDF", "cat-pdf", "Merge, split, rotate and convert PDF files."),
    ("image", "Image", "cat-image", "Resize, compress, convert and clean up photos."),
    ("text", "Text", "cat-text", "Count, clean, compare and transform text."),
    ("dev", "Developer", "cat-dev", "Encode, decode, hash, format and test."),
    ("calc", "Calculators", "cat-calc", "Percentages, units, dates, time zones and maths."),
    ("util", "Utilities", "cat-util", "QR codes, barcodes, passwords, timers and random picks."),
]

ORDER = [
    "merge-pdf", "compress-pdf", "split-pdf", "extract-pdf-pages", "remove-pdf-pages", "rotate-pdf",
    "reorder-pdf-pages", "add-page-numbers-to-pdf", "watermark-pdf", "pdf-to-jpg",
    "jpg-to-pdf", "png-to-pdf", "url-to-pdf", "ocr-pdf", "protect-pdf", "unlock-pdf", "edit-pdf-metadata",
    "compress-image", "resize-image", "convert-image", "png-to-jpg", "jpg-to-png", "webp-to-png",
    "svg-to-png", "crop-image", "rotate-image", "merge-images", "add-text-to-image", "image-filters",
    "add-border-to-image", "image-to-text", "image-to-base64", "image-color-picker",
    "remove-exif", "favicon-generator", "placeholder-image-generator",
    "word-counter", "character-counter", "text-to-speech", "case-converter", "remove-duplicate-lines",
    "sort-lines-alphabetically", "remove-line-breaks", "find-and-replace", "text-diff",
    "text-to-slug", "reverse-text", "markdown-to-html", "html-to-markdown", "csv-to-json",
    "json-to-csv", "text-to-binary", "morse-code-translator", "lorem-ipsum-generator",
    "json-formatter", "sql-formatter", "xml-formatter", "html-formatter", "css-minifier",
    "yaml-to-json", "json-to-yaml", "json-to-typescript",
    "base64-encode-decode", "url-encode-decode", "hash-generator",
    "jwt-decoder", "unix-timestamp-converter", "cron-expression-explainer", "cron-expression-generator",
    "regex-tester", "subnet-calculator", "chmod-calculator", "http-status-codes", "user-agent-parser",
    "color-converter", "color-palette-generator", "css-gradient-generator", "meta-tag-generator",
    "number-base-converter", "uuid-generator",
    "percentage-calculator", "scientific-calculator", "fraction-calculator", "unit-converter",
    "time-zone-converter", "age-calculator", "date-difference-calculator", "date-calculator",
    "bmi-calculator", "roman-numeral-converter", "aspect-ratio-calculator",
    "qr-code-generator", "wifi-qr-code-generator", "vcard-qr-code-generator", "barcode-generator",
    "password-generator", "random-number-generator", "random-name-picker", "countdown-timer", "stopwatch",
]

# 48x48 marks: 4px square-capped strokes by default (see .mark in css/00-base.css);
# filled parts set fill and stroke explicitly.
F = 'fill="currentColor" stroke="none"'
PAGE = '<path d="M10 4h20l8 8v32H10z"/><path d="M30 4v8h8"/>'
ICONS = {
    # categories
    "cat-pdf": PAGE + '<path d="M16 22h16M16 30h16M16 38h9"/>',
    "cat-image": '<path d="M4 8h40v32H4z"/><path d="M4 34l12-12 10 10 6-6 12 12"/><circle cx="33" cy="17" r="3.5" ' + F + '/>',
    "cat-text": '<path d="M4 8h40M4 18h40M4 28h40M4 38h22"/>',
    "cat-dev": '<path d="M4 6h40v36H4z"/><path d="M12 18l8 6-8 6M24 32h12"/>',
    "cat-calc": '<path d="M8 4h32v40H8z"/><path d="M14 10h20v7H14z"/>'
                '<rect x="14" y="23" width="5" height="5" ' + F + '/><rect x="21.5" y="23" width="5" height="5" ' + F + '/><rect x="29" y="23" width="5" height="5" ' + F + '/>'
                '<rect x="14" y="32" width="5" height="5" ' + F + '/><rect x="21.5" y="32" width="5" height="5" ' + F + '/><rect x="29" y="32" width="5" height="5" ' + F + '/>',
    "cat-util": '<path d="M4 18h40v24H4z"/><path d="M16 18v-8h16v8"/><path d="M4 28h40"/><path d="M21 28v5h6v-5"/>',
    # pdf
    "merge-pdf": '<path d="M4 6h16v20H4zM28 6h16v20H28z"/><path d="M12 26v8h24v-8"/><path d="M24 34v10"/>',
    "split-pdf": PAGE + '<path d="M2 26h4M12 26h6M24 26h6M36 26h4M44 26h2"/>',
    "extract-pdf-pages": PAGE + '<path d="M17 35l14-14M22 21h9v9"/>',
    "remove-pdf-pages": PAGE + '<path d="M18 22l12 12M30 22L18 34"/>',
    "rotate-pdf": PAGE + '<path d="M17 30a7 7 0 1 0 2.5-7.5"/><path d="M17 18v6h6"/>',
    "reorder-pdf-pages": '<path d="M4 4h16v20H4z"/><path d="M28 24h16v20H28z"/><path d="M28 8h10v10"/><path d="M20 40H10V30"/>',
    "add-page-numbers-to-pdf": PAGE + '<path d="M16 20h16M16 27h16"/><rect x="20" y="33" width="8" height="7" ' + F + '/>',
    "watermark-pdf": PAGE + '<path d="M16 37l16-16M16 28l7-7"/>',
    "pdf-to-jpg": '<path d="M4 8h40v32H4z"/><path d="M4 34l12-12 10 10 6-6 12 12"/><circle cx="33" cy="17" r="3.5" ' + F + '/>',
    "jpg-to-pdf": PAGE + '<path d="M15 37l7-8 5 5 3-3 4 6"/><circle cx="29" cy="22" r="2.5" ' + F + '/>',
    "edit-pdf-metadata": PAGE + '<path d="M16 20h4M24 20h8M16 28h4M24 28h8M16 36h4M24 36h5"/>',
    # server-backed pdf tools
    "compress-pdf": PAGE + '<path d="M24 16v10M18 21l6 6 6-6M16 33h16M16 39h16"/>',
    "ocr-pdf": PAGE + '<path d="M15 19h18M24 19v20"/><path d="M15 39h4M29 39h4"/>',
    "url-to-pdf": '<circle cx="17" cy="17" r="13"/><path d="M4 17h26M17 4c-5 7-5 19 0 26M17 4c5 7 5 19 0 26"/>'
                  '<path d="M28 26h16v18H28z"/><path d="M32 33h8M32 38h5"/>',
    "protect-pdf": PAGE + '<path d="M16 28h16v12H16z"/><path d="M19 28v-4a5 5 0 0 1 10 0v4"/>',
    "unlock-pdf": PAGE + '<path d="M16 28h16v12H16z"/><path d="M19 28v-4a5 5 0 0 1 10 0"/>',
    # image
    "compress-image": '<path d="M4 24h40"/><path d="M24 4v11M17 9l7 7 7-7"/><path d="M24 44V33M17 39l7-7 7 7"/>',
    "resize-image": '<path d="M4 26h18v18H4z"/><path d="M4 18V4h40v40H30"/><path d="M28 20l10-10M30 10h8v8"/>',
    "convert-image": '<path d="M6 16h32M30 8l8 8-8 8"/><path d="M42 32H10M18 24l-8 8 8 8"/>',
    "crop-image": '<path d="M12 2v34h34"/><path d="M2 12h34v34"/>',
    "rotate-image": '<path d="M18 18h24v24H18z"/><path d="M7 26V15a8 8 0 0 1 8-8h9"/><path d="M19 2l5 5-5 5"/>',
    "remove-exif": '<path d="M24 5c-7 0-12 5-12 12 0 9 12 25 12 25s12-16 12-25c0-7-5-12-12-12z"/><path d="M5 5l38 38"/>',
    "favicon-generator": '<path d="M4 20h24v24H4z"/><path d="M30 8h14v14H30z"/><rect x="18" y="4" width="7" height="7" ' + F + '/>',
    # text
    "word-counter": '<path d="M4 8h40M4 18h40M4 28h18"/><path d="M30 28v16M36 28v16M42 28v16"/>',
    "case-converter": '<path d="M3 42L13 8h2l10 34M7 30h14"/><circle cx="36" cy="34" r="7"/><path d="M43 24v18"/>',
    "remove-duplicate-lines": '<path d="M4 10h26M4 22h26M4 34h26"/><path d="M36 18l8 8M44 18l-8 8"/>',
    "find-and-replace": '<circle cx="20" cy="20" r="13"/><path d="M30 30l14 14"/>',
    "text-diff": '<path d="M4 6h16v36H4zM28 6h16v36H28z"/><path d="M8 18h8M12 14v8M32 30h8"/>',
    "lorem-ipsum-generator": '<path d="M4 8h40M4 18h40M4 28h40M4 38h22"/><path d="M32 38h12" stroke-dasharray="3 3"/>',
    "svg-to-png": '<path d="M6 38C12 10 36 38 42 10"/><path d="M3 35h6v6H3zM39 7h6v6h-6z"/>',
    "image-to-base64": '<path d="M4 4h26v22H4z"/><path d="M4 22l8-8 6 6 4-4 8 8"/><path d="M4 34h40M4 42h28"/>',
    "image-to-text": '<path d="M4 4h24v20H4z"/><path d="M4 20l7-7 5 5 3-3 9 9"/><path d="M34 8h10M34 16h10M4 32h40M4 40h30"/>',
    "image-color-picker": '<path d="M30 6a6 6 0 0 1 12 12l-6 6-12-12z"/><path d="M27 15L10 32v6h6l17-17"/>',
    # more text
    "character-counter": '<path d="M3 40L13 8h2l10 32M7 28h14"/><path d="M32 16v24M40 16v24M28 24h16M28 32h16"/>',
    "sort-lines-alphabetically": '<path d="M4 8h22M4 18h16M4 28h10"/><path d="M38 6v32M30 30l8 8 8-8"/>',
    "remove-line-breaks": '<path d="M4 10h18l10 14h12M4 38h18l10-14"/>',
    "text-to-slug": '<path d="M4 16h40v16H4z"/><path d="M10 24h6M21 24h6M32 24h6"/>',
    "reverse-text": '<path d="M44 14H8M16 6l-8 8 8 8"/><path d="M4 30h40M4 40h28"/>',
    "markdown-to-html": '<path d="M2 10h44v28H2z"/><path d="M9 31V17l6 7 6-7v14"/><path d="M35 17v14M29 25l6 6 6-6"/>',
    "html-to-markdown": '<path d="M14 10L4 24l10 14M34 10l10 14-10 14"/><path d="M28 6l-8 36"/>',
    "csv-to-json": '<path d="M4 8h40v32H4z"/><path d="M4 19h40M4 30h40M18 8v32M31 8v32"/>',
    "json-to-csv": '<path d="M14 4h-2a3 3 0 0 0-3 3v12l-5 5 5 5v12a3 3 0 0 0 3 3h2"/><path d="M22 14h22M22 24h22M22 34h22"/>',
    "text-to-binary": '<path d="M4 6h10v16H4zM22 6v16M30 6h10v16H30z"/><path d="M8 28v16M18 28h10v16H18zM36 28v16"/>',
    "morse-code-translator": '<rect x="4" y="13" width="7" height="7" ' + F + '/><path d="M17 16.5h16"/><rect x="38" y="13" width="7" height="7" ' + F + '/>'
                             '<path d="M4 33.5h14"/><rect x="24" y="30" width="7" height="7" ' + F + '/><path d="M37 33.5h7"/>',
    # developer
    "url-encode-decode": '<path d="M20 28l8-8"/><path d="M22 14l5-5a8 8 0 0 1 11 11l-5 5M26 34l-5 5A8 8 0 0 1 10 28l5-5"/>',
    "hash-generator": '<path d="M4 4h40v40H4z"/><path d="M12 14h6M24 14h12M12 24h12M30 24h6M12 34h4M22 34h14"/>',
    "jwt-decoder": '<path d="M4 17h10v14H4zM19 17h10v14H19zM34 17h10v14H34z"/>',
    "unix-timestamp-converter": '<circle cx="18" cy="18" r="14"/><path d="M18 10v9l6 4"/><path d="M28 37h16M28 44h10"/>',
    "cron-expression-explainer": '<path d="M4 8h40v36H4z"/><path d="M4 18h40M14 3v9M34 3v9"/><path d="M24 23v14M18 26l12 8M30 26l-12 8"/>',
    "regex-tester": '<rect x="6" y="34" width="8" height="8" ' + F + '/><path d="M32 6v22M22 11.5l20 11M42 11.5l-20 11"/>',
    "color-converter": '<circle cx="24" cy="16" r="11"/><circle cx="16" cy="31" r="11"/><circle cx="32" cy="31" r="11"/>',
    "number-base-converter": '<circle cx="13" cy="30" r="9"/><path d="M27 21l16 18M43 21L27 39"/><path d="M4 8h40"/>',
    # utilities
    "percentage-calculator": '<circle cx="12" cy="12" r="6"/><circle cx="36" cy="36" r="6"/><path d="M38 6L10 42"/>',
    "unit-converter": '<path d="M4 16h40v16H4z"/><path d="M12 16v7M20 16v10M28 16v7M36 16v10"/>',
    "age-calculator": '<path d="M6 26h36v18H6z"/><path d="M6 34c6 4 12-4 18 0s12 4 18 0"/><path d="M24 15v11"/><path d="M24 3c-3 4-3 7 0 9 3-2 3-5 0-9z" ' + F + '/>',
    "date-difference-calculator": '<path d="M4 8h40v36H4z"/><path d="M4 18h40M14 3v9M34 3v9"/><path d="M12 31h24M30 25l6 6-6 6"/>',
    "aspect-ratio-calculator": '<path d="M4 8h40v32H4z"/><path d="M12 18v12h12"/><path d="M36 30V18H24"/>',
    "qr-code-generator": '<path d="M4 4h14v14H4zM30 4h14v14H30zM4 30h14v14H4z"/>'
                         '<path d="M28 28h6v6h-6zM38 28h6v6h-6zM28 38h6v6h-6zM38 38h6v6h-6zM33 33h6v6h-6z" ' + F + '/>',
    "password-generator": '<circle cx="14" cy="24" r="9"/><path d="M23 24h21M36 24v8M43 24v6"/>',
    "uuid-generator": '<path d="M18 4l-4 40M34 4l-4 40M6 16h38M4 32h38"/>',
    "base64-encode-decode": '<path d="M4 10h10M20 10h4M30 10h14M4 24h4M14 24h14M34 24h10M4 38h18M28 38h4M38 38h6"/>',
    "json-formatter": '<path d="M16 4h-3a3 3 0 0 0-3 3v12l-6 5 6 5v12a3 3 0 0 0 3 3h3"/><path d="M32 4h3a3 3 0 0 1 3 3v12l6 5-6 5v12a3 3 0 0 1-3 3h-3"/>',
    # v3: image
    "merge-images": '<path d="M4 10h18v28H4zM26 10h18v28H26z"/><path d="M4 32l8-8 10 10M26 32l8-8 10 10"/>',
    "add-text-to-image": '<path d="M4 8h40v32H4z"/><path d="M14 18h20M24 18v15"/>',
    "image-filters": '<path d="M4 10h40M4 24h40M4 38h40"/><path d="M14 4v12M32 18v12M20 32v12"/>',
    "add-border-to-image": '<path d="M4 4h40v40H4z"/><path d="M12 12h24v24H12z"/>',
    "placeholder-image-generator": '<path d="M4 8h40v32H4z"/><path d="M4 8l40 32M44 8L4 40"/>',
    # v3: text
    "text-to-speech": '<path d="M4 18h8l12-10v32L12 30H4z"/><path d="M31 17a10 10 0 0 1 0 14M37 11a18 18 0 0 1 0 26"/>',
    # v3: developer
    "sql-formatter": '<ellipse cx="24" cy="10" rx="16" ry="6"/><path d="M8 10v28c0 3.3 7.2 6 16 6s16-2.7 16-6V10"/>'
                     '<path d="M8 24c0 3.3 7.2 6 16 6s16-2.7 16-6"/>',
    "xml-formatter": '<path d="M13 6L4 15l9 9M35 6l9 9-9 9"/><path d="M27 4l-6 22"/><path d="M4 34h40M14 42h30"/>',
    "html-formatter": '<path d="M4 4h40v40H4z"/><path d="M4 13h40"/><path d="M17 22l-7 7 7 7M31 22l7 7-7 7"/>',
    "css-minifier": '<path d="M4 8h16M4 18h10M4 28h16M4 38h10"/><path d="M27 12l8 12-8 12M45 12l-8 12 8 12"/>',
    "yaml-to-json": '<path d="M3 8l6 8 6-8M9 16v12"/><path d="M28 6h-2a3 3 0 0 0-3 3v11l-4 4 4 4v11a3 3 0 0 0 3 3h2"/>'
                    '<path d="M36 6h2a3 3 0 0 1 3 3v11l4 4-4 4v11a3 3 0 0 1-3 3h-2"/>',
    "json-to-yaml": '<path d="M12 6h-2a3 3 0 0 0-3 3v11l-4 4 4 4v11a3 3 0 0 0 3 3h2"/><path d="M20 6h2a3 3 0 0 1 3 3v11l4 4-4 4v11a3 3 0 0 1-3 3h-2"/>'
                    '<path d="M33 8l6 8 6-8M39 16v12"/>',
    "json-to-typescript": '<path d="M4 8h22M15 8v34"/><path d="M34 6h2a3 3 0 0 1 3 3v11l5 4-5 4v11a3 3 0 0 1-3 3h-2"/>',
    "cron-expression-generator": '<path d="M4 8h40v36H4z"/><path d="M4 18h40M14 3v9M34 3v9"/><path d="M24 23v16M16 31h16"/>',
    "subnet-calculator": '<path d="M18 4h12v10H18zM4 34h12v10H4zM18 34h12v10H18zM32 34h12v10H32z"/><path d="M24 14v20M10 34v-10h28v10"/>',
    "chmod-calculator": '<path d="M4 6h12v12H4zM18 6h12v12H18zM32 6h12v12H32z"/>'
                        '<rect x="7" y="9" width="6" height="6" ' + F + '/><rect x="35" y="9" width="6" height="6" ' + F + '/><path d="M4 30h40M4 40h26"/>',
    "http-status-codes": '<path d="M4 6h40v28H22l-10 10V34H4z"/><path d="M13 20h4M22 20h4M31 20h4"/>',
    "user-agent-parser": '<path d="M4 6h40v36H4z"/><path d="M4 15h40"/><circle cx="24" cy="25" r="4"/><path d="M15 38c2-5 5-7 9-7s7 2 9 7"/>',
    "color-palette-generator": '<path d="M4 8h40v32H4z"/><path d="M14 8v32M24 8v32M34 8v32"/><rect x="4" y="8" width="10" height="32" ' + F + '/>',
    "css-gradient-generator": '<path d="M4 4h40v40H4z"/><path d="M4 18L18 4M4 32L32 4M4 44L44 4" stroke-dasharray="2 4"/><path d="M18 44l26-26M32 44l12-12"/>',
    "meta-tag-generator": '<path d="M4 4h18l22 22-18 18L4 22z"/><circle cx="14" cy="14" r="3.5" ' + F + '/>',
    # v3: calculators
    "scientific-calculator": '<path d="M8 4h32v40H8z"/><path d="M14 10h20v7H14z"/><path d="M14 27h7M17.5 23.5v7M27 27h7M14 37h7M27 35h7M27 39h7"/>',
    "fraction-calculator": '<path d="M16 4h16v12H16zM16 32h16v12H16z"/><path d="M4 24h40"/>',
    "time-zone-converter": '<circle cx="15" cy="17" r="11"/><path d="M15 11v7l4 3"/><circle cx="33" cy="31" r="11"/><path d="M33 25v7l-4 3"/>',
    "date-calculator": '<path d="M4 8h40v36H4z"/><path d="M4 18h40M14 3v9M34 3v9"/><path d="M10 31h10M15 26v10M28 31h10"/>',
    "bmi-calculator": '<path d="M4 12h40v32H4z"/><path d="M14 26a10 10 0 0 1 20 0"/><path d="M24 26l5-6"/>',
    "roman-numeral-converter": '<path d="M9 8v32M4 8h10M4 40h10"/><path d="M20 8l12 32 12-32"/>',
    # v3: utilities
    "wifi-qr-code-generator": '<path d="M4 18a28 28 0 0 1 40 0M10 25a19 19 0 0 1 28 0M16 32a10 10 0 0 1 16 0"/><rect x="21" y="37" width="6" height="6" ' + F + '/>',
    "vcard-qr-code-generator": '<path d="M4 8h40v32H4z"/><circle cx="16" cy="20" r="5"/><path d="M8 34c1-5 4-7 8-7s7 2 8 7M30 18h8M30 26h8"/>',
    "barcode-generator": '<path d="M6 8v32M18 8v32M30 8v32M42 8v32"/><rect x="9" y="6" width="5" height="36" ' + F + '/>'
                         '<rect x="22" y="6" width="3" height="36" ' + F + '/><rect x="34" y="6" width="5" height="36" ' + F + '/>',
    "random-number-generator": '<path d="M6 6h36v36H6z"/><rect x="12" y="12" width="6" height="6" ' + F + '/><rect x="30" y="12" width="6" height="6" ' + F + '/>'
                               '<rect x="21" y="21" width="6" height="6" ' + F + '/><rect x="12" y="30" width="6" height="6" ' + F + '/><rect x="30" y="30" width="6" height="6" ' + F + '/>',
    "random-name-picker": '<circle cx="24" cy="27" r="17"/><path d="M24 27V10M24 27l14.5 8.5M24 27L9.5 35.5"/><path d="M19 2h10l-5 6z" ' + F + '/>',
    "countdown-timer": '<path d="M10 4h28M10 44h28M14 4c0 12 20 14 20 20s-20 8-20 20M34 4c0 12-20 14-20 20s20 8 20 20"/>',
    "stopwatch": '<circle cx="24" cy="27" r="17"/><path d="M18 4h12M24 4v6M24 27l7-7M38 12l3-3"/>',
    # ui
    "i-check": '<path d="M8 25l10 10L40 13"/>',
    "i-alert": '<path d="M24 5L3 42h42z"/><path d="M24 18v11"/><rect x="22" y="33" width="4" height="4" ' + F + '/>',
    "i-clock": '<circle cx="24" cy="24" r="19"/><path d="M24 12v13l8 6"/>',
    "i-download": '<path d="M24 4v28M12 20l12 12 12-12M6 42h36"/>',
    "i-upload": '<path d="M24 34V6M12 18L24 6l12 12M6 42h36"/>',
    "i-rot-left": '<path d="M12 18a16 16 0 1 1-2 14"/><path d="M8 6v12h12"/>',
    "i-rot-right": '<path d="M36 18a16 16 0 1 0 2 14"/><path d="M40 6v12H28"/>',
    "i-arrow-left": '<path d="M42 24H8M20 12L8 24l12 12"/>',
    "i-arrow-right": '<path d="M6 24h34M28 12l12 12-12 12"/>',
    "i-arrow-up": '<path d="M24 42V8M12 20L24 8l12 12"/>',
    "i-arrow-down": '<path d="M24 6v34M12 28l12 12 12-12"/>',
    "i-x": '<path d="M10 10l28 28M38 10L10 38"/>',
    "i-lock": '<path d="M9 21h30v23H9z"/><path d="M15 21v-6a9 9 0 0 1 18 0v6"/>',
    "i-server": '<path d="M5 5h38v15H5zM5 28h38v15H5z"/><path d="M11 12.5h8M11 35.5h8"/>'
                '<rect x="33" y="10" width="5" height="5" ' + F + '/><rect x="33" y="33" width="5" height="5" ' + F + '/>',
    "i-search": '<circle cx="20" cy="20" r="13"/><path d="M30 30l14 14"/>',
    "i-copy": '<path d="M16 16h26v28H16z"/><path d="M8 32V6h24"/>',
    "i-plus": '<path d="M24 6v36M6 24h36"/>',
    "i-refresh": '<path d="M40 17A17 17 0 1 0 41 29"/><path d="M42 5v12H30"/>',
    "i-flip-h": '<path d="M24 2v44"/><path d="M18 10L4 38h14z"/><path d="M30 10l14 28H30z"/>',
    "i-flip-v": '<path d="M2 24h44"/><path d="M10 18L38 4v14z"/><path d="M10 30l28 14V30z"/>',
    "i-globe": '<circle cx="24" cy="24" r="19"/><path d="M5 24h38M24 5c-7 7-7 31 0 38M24 5c7 7 7 31 0 38"/>',
}

esc = lambda s: html.escape(str(s), quote=True)

PARTIAL = "--partial" in sys.argv


def sprite() -> str:
    syms = "".join(f'<symbol id="{k}" viewBox="0 0 48 48">{v}</symbol>' for k, v in ICONS.items())
    return f'<svg class="sprite" aria-hidden="true" focusable="false"><defs>{syms}</defs></svg>'


def mark(name: str, cls: str = "mark") -> str:
    return f'<svg class="{cls}" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><use href="#{name}"/></svg>'


def marks(src: str) -> str:
    """Expand {{mark:icon-id}} and {{mark:icon-id extra-class}} placeholders in content."""
    def sub(m):
        name, cls = m.group(1), (m.group(2) or "").strip()
        if name not in ICONS:
            sys.exit(f"unknown icon {name!r} in content")
        return mark(name, ("mark " + cls).strip())
    return re.sub(r"\{\{mark:([\w-]+)(?:\s+([\w -]+))?\}\}", sub, src)


# ------------------------------------------------------------------ strings

SLUGS = json.loads((I18N / "slugs.json").read_text())
SITE_STR = json.loads((I18N / "site.json").read_text())
PRIVACY = json.loads((I18N / "glossary.json").read_text())["privacy"]
MISSING = set()


def S(lang: str, text: str, **vars) -> str:
    """A page-chrome string in `lang` (keyed by its English text), with {placeholders} filled from vars."""
    out = text
    if lang != "en":
        entry = SITE_STR.get(text) or PRIVACY.get(text)
        if entry and entry.get(lang):
            out = entry[lang]
        else:
            MISSING.add((lang, text))
    return re.sub(r"\{(\w+)\}", lambda m: str(vars[m.group(1)]) if m.group(1) in vars else m.group(0), out)


COUNT_WORDS = {
    "en": ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"],
    "es": ["una", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve"],          # herramientas (f.)
    "pt-BR": ["uma", "duas", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"],      # ferramentas (f.)
    "fr": ["un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf"],           # outils (m.)
    "de": ["ein", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun"],
    "id": ["satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan"],
}


def count_word(lang: str, n: int) -> str:
    return COUNT_WORDS[lang][n - 1] if 1 <= n <= 9 else str(n)


def search_norm(s: str) -> str:
    """Mirror of norm() in site/tools/js/index.js, so typed words match data-words."""
    s = unicodedata.normalize("NFKD", s.lower().replace("ß", "ss"))
    return re.sub(r"\s+", " ", re.sub(r"[^A-Za-z0-9_\s]", " ", s)).strip()


# ------------------------------------------------------------------ URLs

def index_path(lang: str) -> str:
    return f"{PREFIX[lang]}/tools/"


def tool_path(lang: str, slug: str) -> str:
    return f"{PREFIX[lang]}/tools/{slug if lang == 'en' else SLUGS[slug][lang]['slug']}/"


def out_dir(lang: str) -> Path:
    return SITE / PREFIX[lang].lstrip("/") / "tools" if lang != "en" else OUT


def localize_links(lang: str, src: str) -> str:
    """Point /tools/ links in content at the same language's pages."""
    if lang == "en":
        return src

    def sub(m):
        slug, rest = m.group(1), m.group(2) or ""
        if slug is None:
            return f'href="{index_path(lang)}{rest}'
        if slug not in SLUGS:
            return m.group(0)
        return f'href="{tool_path(lang, slug)}{rest}'
    return re.sub(r'href="/tools/(?:([\w-]+)/)?(#[\w-]*)?(?=")', sub, src)


# ------------------------------------------------------------------ content

TRANSLATED_KEYS = ["title", "description", "h1", "lede", "blurb", "keywords", "limits", "howto_title", "howto", "faq",
                   "local_text"]


def parse_content(src: str, name: str):
    m = re.match(r"\s*<!--meta\s*(\{.*?\})\s*-->", src, re.S)
    if not m:
        sys.exit(f"{name}: missing <!--meta {{...}} --> block")
    meta = json.loads(m.group(1))
    rest = src[m.end():]
    parts = dict(re.findall(r"<!--(tool|explain)-->(.*?)(?=<!--(?:tool|explain)-->|\Z)", rest, re.S))
    return meta, parts.get("tool", "").strip(), parts.get("explain", "").strip()


def load_tools() -> dict:
    """{lang: {slug: meta}} for every page that exists (English always; others when translated)."""
    import content_check
    out = {lang: {} for lang in LANG_CODES}
    problems = []
    for path in sorted((HERE / "content").glob("*.html")):
        slug = path.stem
        meta, tool, explain = parse_content(path.read_text(), path.name)
        meta.update(slug=slug, tool=marks(tool), explain=marks(explain))
        for key in ("category", "name", "title", "description", "h1", "lede", "blurb", "limits", "howto", "faq"):
            if not meta.get(key):
                sys.exit(f"{path.name}: meta.{key} is required")
        if len(meta["title"]) > 65:
            print(f"warning: {slug} title is {len(meta['title'])} chars", file=sys.stderr)
        if not 70 <= len(meta["description"]) <= 165:
            print(f"warning: {slug} description is {len(meta['description'])} chars", file=sys.stderr)
        out["en"][slug] = meta
        if slug not in SLUGS:
            print(f"warning: {slug} has no entry in i18n/slugs.json; built in English only", file=sys.stderr)
            continue
        for lang in LANG_CODES[1:]:
            tpath = I18N / "content" / lang / f"{slug}.html"
            if not tpath.exists():
                if not PARTIAL:
                    problems.append(f"{lang}/{slug}: translation missing")
                continue
            errs, _ = content_check.check(lang, slug)
            if errs:
                problems.extend(errs)
                continue
            tmeta, ttool, texplain = parse_content(tpath.read_text(), f"{lang}/{slug}")
            m2 = {k: v for k, v in meta.items() if k not in TRANSLATED_KEYS}
            m2.update({k: tmeta[k] for k in TRANSLATED_KEYS if k in tmeta})
            m2.update(name=SLUGS[slug][lang]["name"], tool=marks(ttool), explain=marks(texplain),
                      en_name=meta["name"], en_keywords=meta.get("keywords", ""))
            for k in ("lede", "limits"):
                m2[k] = localize_links(lang, m2[k])
            m2["howto"] = [localize_links(lang, s) for s in m2["howto"]]
            m2["faq"] = [[q, localize_links(lang, a)] for q, a in m2["faq"]]
            m2["explain"] = localize_links(lang, m2["explain"])
            out[lang][slug] = m2
    if problems:
        for p in problems:
            print("error: " + p, file=sys.stderr)
        sys.exit(f"{len(problems)} translation problems (use --partial while translations are in progress)")
    return out


def alternates(pages: dict, slug: str | None) -> list:
    """[(hreflang, absolute URL)] for every language a page exists in, plus x-default (English)."""
    out = []
    for lang in LANG_CODES:
        if slug is None or slug in pages[lang]:
            out.append((HREFLANG[lang], ORIGIN + (index_path(lang) if slug is None else tool_path(lang, slug))))
    out.append(("x-default", ORIGIN + (index_path("en") if slug is None else tool_path("en", slug))))
    return out


# ------------------------------------------------------------------ chrome

def lang_switch(lang: str, pages: dict, slug: str | None) -> str:
    items = []
    for code in LANG_CODES:
        if slug is not None and slug not in pages[code]:
            continue
        href = index_path(code) if slug is None else tool_path(code, slug)
        cur = ' aria-current="true"' if code == lang else ""
        items.append(f'<li><a href="{href}" hreflang="{HREFLANG[code]}" lang="{HREFLANG[code]}"{cur}>{esc(NATIVE[code])}</a></li>')
    label = S(lang, "Language")
    return (f'<details class="langs"><summary aria-label="{esc(label)}: {esc(NATIVE[lang])}">{mark("i-globe")}'
            f'<span>{SHORT[lang]}</span></summary><ul>{"".join(items)}</ul></details>')


def header(lang: str, current_cat: str | None, pages: dict, slug: str | None) -> str:
    items = []
    for key, label, _, _ in CATEGORIES:
        cur = ' aria-current="true"' if key == current_cat else ""
        items.append(f'<li><a href="{index_path(lang)}#{key}"{cur}>{esc(S(lang, label))}</a></li>')
    return f"""<header class="top">
  <div class="wrap top__inner">
    <a class="wordmark" href="{index_path(lang)}" aria-label="{esc(S(lang, "Tanod Tools home"))}">Tanod<span>Tools</span></a>
    <nav class="catnav" aria-label="{esc(S(lang, "Tool categories"))}"><ul>{''.join(items)}</ul></nav>
    {lang_switch(lang, pages, slug)}
  </div>
</header>
<div class="stripe" aria-hidden="true"></div>"""


def server_slugs(tools: dict) -> list:
    return [s for s in ORDER if s in tools and tools[s].get("server")]


def footer(lang: str, pages: dict, slug: str | None) -> str:
    tools = pages[lang]
    en = pages["en"]
    srv = server_slugs(en)
    n_server = count_word(lang, len(srv))
    server_names = ", ".join(esc(tools[s]["name"] if s in tools else en[s]["name"]) for s in srv)
    cols = []
    for key, label, _, _ in CATEGORIES:
        links = "".join(
            f'<li><a href="{tool_path(lang, s)}">{esc(tools[s]["name"])}</a></li>'
            for s in ORDER if s in tools and tools[s]["category"] == key)
        cols.append(f'<div><h2>{esc(S(lang, label))}</h2><ul>{links}</ul></div>')
    langs = []
    for code in LANG_CODES:
        if slug is not None and slug not in pages[code]:
            continue
        href = index_path(code) if slug is None else tool_path(code, slug)
        cur = ' aria-current="true"' if code == lang else ""
        langs.append(f'<li><a href="{href}" hreflang="{HREFLANG[code]}" lang="{HREFLANG[code]}"{cur}>{esc(NATIVE[code])}</a></li>')
    privacy = S(lang, "Privacy.")
    p1 = S(lang, "Almost every tool here runs inside your browser: files and text you use are processed on your own device, never uploaded, and closing the tab clears them.")
    p2 = S(lang, "The {n} tools marked <strong>Processed on our server</strong> ({names}) send the one file or address you choose to our server over HTTPS. It is processed and deleted as soon as the job ends; we never store or log it. To enforce their free daily limit we keep a count of jobs per network address, deleted after three days.",
           n=n_server, names=server_names)
    p3 = S(lang, "The only analytics on this site is Cloudflare Web Analytics, which counts page views without cookies and never sees what you put into a tool. Server tool pages also load Cloudflare Turnstile, a human check that keeps bots out. No ads or ad trackers.")
    note = S(lang, "Tanod is operated by an autonomous AI agent.") + " " + S(lang, "Free to use; results come with no warranty, so keep your originals.")
    return f"""<footer class="foot">
  <div class="wrap">
    <div class="foot__grid">
      <div>
        <p class="foot__mark" aria-hidden="true">TANOD TOOLS</p>
        <div class="foot__privacy">
          <p><strong>{privacy}</strong> {p1}</p>
          <p>{p2}</p>
          <p>{p3}</p>
        </div>
      </div>
      <nav class="foot__cats" aria-label="{esc(S(lang, "All tools"))}">{''.join(cols)}</nav>
    </div>
    <nav class="foot__langs" aria-label="{esc(S(lang, "Language"))}"><ul>{''.join(langs)}</ul></nav>
    <p class="foot__note"><span>{note}</span><span><a href="/">tanod.dev</a> · <a href="/tools/vendor/LICENSES.md">{S(lang, "Open-source credits")}</a></span></p>
  </div>
</footer>"""


def head(lang: str, title: str, desc: str, url: str, jsonld: dict, alts: list, extra: str = "") -> str:
    ld = json.dumps(jsonld, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    alt_links = "".join(f'<link rel="alternate" hreflang="{h}" href="{u}">\n' for h, u in alts)
    og_alt = "".join(f'<meta property="og:locale:alternate" content="{OG_LOCALE[c]}">\n'
                     for c in LANG_CODES if c != lang and any(h == HREFLANG[c] for h, _ in alts))
    return f"""<!doctype html>
<html lang="{HREFLANG[lang]}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)}</title>
<meta name="description" content="{esc(desc)}">
<link rel="canonical" href="{url}">
{alt_links}<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#f3c11a">
<meta name="referrer" content="no-referrer">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Tanod Tools">
<meta property="og:locale" content="{OG_LOCALE[lang]}">
{og_alt}<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(desc)}">
<meta property="og:url" content="{url}">
<meta name="twitter:card" content="summary">
<link rel="preload" href="/fonts/archivo-var.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/bungee-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/tools/tools.css?v={ASSET_V}">
<link rel="icon" href="/favicon.svg?v=1" type="image/svg+xml">
<script type="application/ld+json">{ld}</script>
{extra}</head>"""


def local_tag(lang: str, meta: dict) -> str:
    if meta.get("server"):
        return f'<p class="local-tag server-tag">{mark("i-server")}{esc(S(lang, "Processed on our server, then deleted"))}</p>'
    if not meta.get("local", True):
        return ""
    if meta.get("local_text"):
        text = meta["local_text"]
    else:
        text = S(lang, "Your files never leave your device" if meta["category"] in ("pdf", "image")
                 else "Runs entirely in your browser")
    return f'<p class="local-tag">{mark("i-lock")}{esc(text)}</p>'


def with_drop_promise(lang: str, meta: dict) -> str:
    """Repeat the privacy promise inside the drop slot, where files go in (file tools only)."""
    tool = meta["tool"]
    if meta.get("server"):
        if "<!--srv-->" not in tool:
            sys.exit(f"{meta['slug']}: a server tool needs a <!--srv--> marker for the quota line")
        bar = f"""<div class="srvbar">
  <p class="quota" id="quota" aria-live="polite">{mark("i-server")}<span>{esc(S(lang, "Checking today's free server jobs…"))}</span></p>
  <div class="human" id="human" hidden></div>
</div>"""
        tool = tool.replace("<!--srv-->", bar)
        m = re.search(r'(<div class="drop"[^>]*>.*?<p class="drop__hint">.*?</p>)', tool, re.S)
        if m:
            promise = (f'<p class="drop__local drop__server">{mark("i-server")}'
                       f'{esc(S(lang, "Sent to our server for this one job, then deleted. Never stored or logged."))}</p>')
            tool = tool[:m.end()] + "\n  " + promise + tool[m.end():]
        return tool
    if meta["category"] not in ("pdf", "image") or not meta.get("local", True):
        return tool
    m = re.search(r'(<div class="drop"[^>]*>.*?<p class="drop__hint">.*?</p>)', tool, re.S)
    if not m:
        return tool
    promise = f'<p class="drop__local">{mark("i-lock")}{esc(S(lang, "Opened on this device. Nothing is uploaded."))}</p>'
    return tool[:m.end()] + "\n  " + promise + tool[m.end():]


# ------------------------------------------------------------------ string tables for the scripts

def strings_link(lang: str, page: str, module: str) -> str:
    """Write the page's UI string table and return the <link> that i18n.js loads it from ("" for English)."""
    if lang == "en":
        return ""
    table = js_strings.page_table(module, lang)
    body = "export default " + json.dumps(table, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + ";\n"
    d = OUT / "js" / "i18n" / lang
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{page}.js").write_text(body)
    v = hashlib.sha256(body.encode()).hexdigest()[:10]
    return f'<link rel="modulepreload" href="/tools/js/i18n/{lang}/{page}.js?v={v}" data-strings>\n'


# ------------------------------------------------------------------ pages

def tool_page(lang: str, meta: dict, pages: dict) -> str:
    tools = pages[lang]
    slug = meta["slug"]
    url = ORIGIN + tool_path(lang, slug)
    cat_key, cat_label = next((k, l) for k, l, _, _ in CATEGORIES if k == meta["category"])
    cat_label = S(lang, cat_label)
    steps = meta["howto"]
    faq = meta["faq"]
    in_lang = HREFLANG[lang]
    howto_title = meta.get("howto_title") or S(lang, "How to use {name}", name=meta["name"])
    graph = [
        {
            "@type": "WebApplication",
            "name": meta["name"],
            "url": url,
            "description": meta["description"],
            "inLanguage": in_lang,
            "applicationCategory": meta.get("app_category", "UtilitiesApplication"),
            "operatingSystem": S(lang, "Any (runs in a web browser)"),
            "browserRequirements": S(lang, "Requires JavaScript"),
            "isAccessibleForFree": True,
            "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"},
            "publisher": {"@type": "Organization", "name": "Tanod", "url": ORIGIN + "/"},
        },
        {
            "@type": "HowTo",
            "name": howto_title,
            "inLanguage": in_lang,
            "totalTime": meta.get("howto_time", "PT1M"),
            "tool": {"@type": "HowToTool", "name": S(lang, "A web browser")},
            "step": [
                {"@type": "HowToStep", "position": i + 1, "text": html.unescape(re.sub(r"<[^>]+>", "", s))}
                for i, s in enumerate(steps)
            ],
        },
        {
            "@type": "FAQPage",
            "inLanguage": in_lang,
            "mainEntity": [
                {"@type": "Question", "name": q,
                 "acceptedAnswer": {"@type": "Answer", "text": html.unescape(re.sub(r"<[^>]+>", "", a))}}
                for q, a in faq
            ],
        },
        {
            "@type": "BreadcrumbList",
            "itemListElement": [
                {"@type": "ListItem", "position": 1, "name": S(lang, "Tools"), "item": ORIGIN + index_path(lang)},
                {"@type": "ListItem", "position": 2, "name": cat_label, "item": f"{ORIGIN}{index_path(lang)}#{cat_key}"},
                {"@type": "ListItem", "position": 3, "name": meta["name"], "item": url},
            ],
        },
    ]
    jsonld = {"@context": "https://schema.org", "@graph": graph}
    extra = strings_link(lang, slug, meta.get("module", slug))
    extra += "".join(f'<script src="{esc(s)}" defer></script>\n' for s in meta.get("scripts", []))
    extra += f'<script type="module" src="/tools/js/{meta.get("module", slug)}.js?v={ASSET_V}"></script>\n'

    related = [s for s in meta.get("related", []) if s in tools and s != slug]
    for s in ORDER:  # top up with same-category tools
        if len(related) >= 6:
            break
        if s in tools and s != slug and s not in related and tools[s]["category"] == meta["category"]:
            related.append(s)
    rel_items = "".join(
        f'<li><a href="{tool_path(lang, s)}">{mark(tools[s].get("icon", s))}{esc(tools[s]["name"])}</a></li>' for s in related)
    steps_html = "".join(f"<li><span>{s}</span></li>" for s in steps)
    faq_html = "".join(
        f'<details><summary>{esc(q)}</summary><div class="faq__a"><p>{a}</p></div></details>' for q, a in faq)
    explain = (f'<section class="prose" aria-label="{esc(S(lang, "About this tool"))}">{meta["explain"]}</section>'
               if meta["explain"] else "")

    return f"""{head(lang, meta["title"], meta["description"], url, jsonld, alternates(pages, slug), extra)}
<body data-tool="{slug}"{' data-server="1"' if meta.get("server") else ""}>
<a class="skip" href="#tool">{esc(S(lang, "Skip to the tool"))}</a>
{sprite()}
{header(lang, cat_key, pages, slug)}
<main id="main" class="page">
  <div class="wrap">
    <nav class="crumbs" aria-label="{esc(S(lang, "Breadcrumb"))}"><ol><li><a href="{index_path(lang)}">{esc(S(lang, "Tools"))}</a></li><li><a href="{index_path(lang)}#{cat_key}">{esc(cat_label)}</a></li><li aria-current="page">{esc(meta["name"])}</li></ol></nav>
    <div class="intro">
      {mark(meta.get("icon", slug), "mark intro__mark")}
      <h1>{esc(meta["h1"])}</h1>
      <p class="lede">{meta["lede"]}</p>
      {local_tag(lang, meta)}
    </div>
    <section id="tool" class="board" aria-label="{esc(meta["name"])}" tabindex="-1">
{with_drop_promise(lang, meta)}
    </section>
    <p class="limits">{meta["limits"]}</p>
    <div class="ad-slot" data-ad-slot="below-tool" aria-hidden="true"></div>
    <div class="below">
      <section class="howto" aria-labelledby="howto-h"><h2 id="howto-h">{esc(howto_title)}</h2><ol class="steps">{steps_html}</ol></section>
      {explain}
      <section class="faq" aria-labelledby="faq-h"><h2 id="faq-h">{esc(S(lang, "Questions"))}</h2>{faq_html}</section>
      <aside class="related" aria-labelledby="rel-h"><h2 id="rel-h">{esc(S(lang, "Related tools"))}</h2><ul>{rel_items}</ul><p class="related__all"><a href="{index_path(lang)}">{esc(S(lang, "All free tools"))}</a></p></aside>
    </div>
    <div class="ad-slot" data-ad-slot="page-end" aria-hidden="true"></div>
  </div>
</main>
{footer(lang, pages, slug)}
</body>
</html>
"""


def index_page(lang: str, pages: dict) -> str:
    tools = pages[lang]
    url = ORIGIN + index_path(lang)
    title = S(lang, "Free online PDF, image, text and developer tools | Tanod Tools")
    desc = S(lang, "Free online tools: merge and compress PDFs, compress images, format JSON and SQL, convert time zones. Most run in your browser with no upload. No signup.")
    routes = []
    item_list = []
    pos = 0
    server_word = S(lang, "Server")
    for key, label, icon_id, blurb in CATEGORIES:
        slugs = [s for s in ORDER if s in tools and tools[s]["category"] == key]
        stops = []
        for s in slugs:
            t = tools[s]
            pos += 1
            item_list.append({"@type": "ListItem", "position": pos, "url": ORIGIN + tool_path(lang, s), "name": t["name"]})
            if lang == "en":
                words = " ".join([t["name"], t["blurb"], t.get("keywords", ""), "server" if t.get("server") else ""]).lower()
            else:
                words = search_norm(" ".join([t["name"], t["blurb"], t.get("keywords", ""), t.get("en_name", ""),
                                              t.get("en_keywords", ""), ("server " + server_word) if t.get("server") else ""]))
            badge = (f'<span class="stops__srv" title="{esc(S(lang, "Processed on our server, then deleted"))}">{esc(server_word)}</span>'
                     if t.get("server") else "")
            stops.append(
                f'<li data-words="{esc(words)}"><a href="{tool_path(lang, s)}">{mark(t.get("icon", s))}'
                f'<span class="stops__name">{esc(t["name"])}{badge}</span><span class="stops__desc">{esc(t["blurb"])}</span></a></li>')
        n_label = S(lang, "{n} tools", n=len(slugs))
        routes.append(f"""<section class="route" id="{key}" aria-labelledby="{key}-h">
  <div class="route__plate">{mark(icon_id)}<h2 id="{key}-h">{esc(S(lang, label))}</h2><span class="route__count" aria-label="{esc(n_label)}">{len(slugs)}</span></div>
  <ul class="stops">{''.join(stops)}</ul>
</section>""")
    jsonld = {
        "@context": "https://schema.org",
        "@graph": [
            {"@type": "WebSite", "name": "Tanod Tools", "url": url, "inLanguage": HREFLANG[lang]},
            {"@type": "ItemList", "name": S(lang, "Free browser tools"), "itemListElement": item_list},
        ],
    }
    extra = strings_link(lang, "index", "index")
    extra += f'<script type="module" src="/tools/js/index.js?v={ASSET_V}"></script>\n'
    n_server = count_word(lang, len(server_slugs(pages["en"])))
    daily = WEB_DAILY_LIMIT
    licences = f'<a href="/tools/vendor/LICENSES.md">{S(lang, "licences page")}</a>'
    who = S(lang, 'Tanod Tools is part of <a href="/">tanod.dev</a>, which also runs security checks and utilities for software agents. The site is operated by an autonomous AI agent. The tools are built on open-source libraries, credited on the {licences}.', licences=licences)
    return f"""{head(lang, title, desc, url, jsonld, alternates(pages, None), extra)}
<body data-tool="index">
<a class="skip" href="#find">{esc(S(lang, "Skip to search"))}</a>
{sprite()}
{header(lang, None, pages, None)}
<main id="main" class="page">
  <div class="wrap">
    <div class="hub-head">
      <h1>{esc(S(lang, "Free tools for PDFs, images, text and code"))}</h1>
      <p class="lede">{S(lang, "Merge a PDF, shrink a photo, count words, format SQL, convert a time zone. Almost every tool works inside your browser, so your files stay on your device. No signup, no watermark.")}</p>
      <p class="local-tag">{mark("i-lock")}{esc(S(lang, "Browser tools never upload your files"))}</p>
    </div>
    <div class="finder" role="search">
      <label class="visually-hidden" for="find">{esc(S(lang, "Find a tool"))}</label>
      {mark("i-search")}
      <input id="find" type="search" placeholder="{esc(S(lang, "Find a tool: merge, resize, count, hash…"))}" autocomplete="off" spellcheck="false">
      <p class="finder__count" id="find-count" aria-live="polite"></p>
    </div>
    <div class="routes">
{''.join(routes)}
    </div>
    <div class="ad-slot" data-ad-slot="index-below" aria-hidden="true"></div>
    <div class="hub-about">
      <section class="prose" aria-labelledby="how-h">
        <h2 id="how-h">{esc(S(lang, "How these tools keep files private"))}</h2>
        <p>{S(lang, "Most online converters upload your file to a server, process it there and send it back. Our browser tools skip that round trip: the page loads the code once, and your browser does the work on your own computer or phone. You can check it yourself: open your browser's developer tools, watch the Network tab and run a tool. Nothing is sent.")}</p>
        <p>{S(lang, "Browser tools have no queue and no daily limit. Big jobs are bounded only by your device's memory, so each tool lists a sensible size limit.")}</p>
        <p>{S(lang, "A few jobs need more than a browser does well: real PDF compression, OCR, saving a web page as PDF, and PDF passwords. The {n} tools marked <strong>Server</strong> send the one file or address you choose to our server over HTTPS, process it, send the result back and delete it the moment the job ends. We never store or log your files or passwords. They are free for {daily} jobs a day per person, with a quick Cloudflare Turnstile check to keep bots out.", n=n_server, daily=daily)}</p>
      </section>
      <section class="prose" aria-labelledby="who-h">
        <h2 id="who-h">{esc(S(lang, "Who makes this"))}</h2>
        <p>{who}</p>
        <p>{S(lang, "Found a bug or a file that doesn't work? We never see the files you use in browser tools, and server tools delete theirs straight away, so we can't look them up; describe what happened instead.")}</p>
      </section>
    </div>
  </div>
</main>
{footer(lang, pages, None)}
</body>
</html>
"""


# ------------------------------------------------------------------ sitemaps and robots

def public(meta: dict) -> bool:
    return SERVER_TOOLS_PUBLIC or not meta.get("server")


def sitemap_file(lang: str) -> str:
    return f"sitemap-tools-{lang.lower()}.xml"


def write_sitemaps(pages: dict) -> list:
    # the tools URLs used to be merged into sitemap.xml; they now live in their own per-language files
    main = SITE / "sitemap.xml"
    xml = main.read_text()
    xml2 = re.sub(r"<url><loc>https://tanod\.dev/tools/[^<]*</loc><lastmod>[^<]*</lastmod></url>", "", xml)
    if xml2 != xml:
        main.write_text(xml2)
    files = []
    for lang in LANG_CODES:
        urls = []
        entries = [(None, index_path(lang))] + [(s, tool_path(lang, s)) for s in ORDER
                                                if s in pages[lang] and public(pages["en"][s])]
        for slug, path in entries:
            alts = "".join(f'<xhtml:link rel="alternate" hreflang="{h}" href="{u}"/>' for h, u in alternates(pages, slug))
            urls.append(f"<url><loc>{ORIGIN}{path}</loc><lastmod>{LASTMOD}</lastmod>{alts}</url>")
        body = ('<?xml version="1.0" encoding="UTF-8"?>\n'
                '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">'
                + "".join(urls) + "</urlset>\n")
        (SITE / sitemap_file(lang)).write_text(body)
        files.append((sitemap_file(lang), len(urls)))
    index = ('<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
             + "".join(f"<sitemap><loc>{ORIGIN}/{f}</loc><lastmod>{LASTMOD}</lastmod></sitemap>" for f, _ in files)
             + "</sitemapindex>\n")
    (SITE / "sitemap-tools.xml").write_text(index)
    robots = SITE / "robots.txt"
    r = robots.read_text()
    line = f"Sitemap: {ORIGIN}/sitemap-tools.xml"
    if line not in r:
        robots.write_text(r.rstrip("\n") + "\n" + line + "\n")
    return files


def stamp_imports(entry_modules) -> int:
    """Give every local import in the built pages' scripts the current ASSET_V (from "./core.js?v=5"), so a release
    never pairs a new page module with a stale cached copy of a shared module. Idempotent; returns files changed."""
    n = 0
    mods = sorted({m for e in entry_modules for m in js_strings.closure(e)})
    for f in [OUT / "js" / f"{m}.js" for m in mods]:
        src = f.read_text()
        out = re.sub(r"""(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])\./([\w-]+)\.js(?:\?v=\w+)?\2""",
                     lambda m: f"{m.group(1)}{m.group(2)}./{m.group(3)}.js?v={ASSET_V}{m.group(2)}", src)
        if out != src:
            f.write_text(out)
            n += 1
    return n


def caddy_paths(pages: dict) -> str:
    paths = []
    for lang in LANG_CODES:
        for s in server_slugs(pages["en"]):
            paths.append(tool_path(lang, s) + "*")
    return "@tools_server path " + " ".join(paths)


def main() -> None:
    pages = load_tools()
    en = pages["en"]
    missing = [s for s in en if s not in ORDER]
    if missing:
        print(f"warning: not in ORDER, so not built: {missing}", file=sys.stderr)
        for lang in LANG_CODES:
            for s in missing:
                pages[lang].pop(s, None)
        en = pages["en"]
    for s, t in en.items():
        ic = t.get("icon", s)
        if ic not in ICONS:
            sys.exit(f"{s}: no icon {ic!r}")
    if "--caddy" in sys.argv:
        print(caddy_paths(pages))
        return
    if not PARTIAL:
        bad = []
        entries = {"index"} | {t.get("module", s) for s, t in en.items() if s in SLUGS}
        for m in sorted({m for e in entries for m in js_strings.closure(e)}):
            bad += js_strings.problems(m)
        if bad:
            print("\n".join(bad[:40]), file=sys.stderr)
            sys.exit(f"{len(bad)} UI string problems (python3 ops/tools_site/i18n/strings.py)")
    out = {}   # path -> html
    counts = {}
    for lang in LANG_CODES:
        d = out_dir(lang)
        out[d / "index.html"] = index_page(lang, pages)
        counts[lang] = 0
        for slug in ORDER:
            if slug in pages[lang]:
                p = d / (slug if lang == "en" else SLUGS[slug][lang]["slug"]) / "index.html"
                out[p] = tool_page(lang, pages[lang][slug], pages)
                counts[lang] += 1
    if MISSING:
        for lang, text in sorted(MISSING):
            print(f"error: i18n/site.json has no {lang} for {text!r}", file=sys.stderr)
        sys.exit(f"{len(MISSING)} page-chrome strings missing")
    stamp_imports({"index"} | {t.get("module", s) for s, t in en.items()})
    css = "\n".join(p.read_text() for p in sorted((HERE / "css").glob("*.css")))
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "tools.css").write_text(css)
    for path, page in out.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(page)
    for lang in LANG_CODES[1:]:  # drop pages of a language whose slug changed or whose translation was removed
        for d in out_dir(lang).iterdir():
            if d.is_dir() and (d / "index.html").exists() and (d / "index.html") not in out:
                (d / "index.html").unlink()
                d.rmdir()
    files = write_sitemaps(pages)
    print("built " + ", ".join(f"{lang} {n}" for lang, n in counts.items()) + " tool pages (+ an index each)")
    print("sitemaps: " + ", ".join(f"{f} ({n} URLs)" for f, n in files)
          + ("" if SERVER_TOOLS_PUBLIC else "; server tools left out (SERVER_TOOLS_PUBLIC = False)"))


if __name__ == "__main__":
    main()
