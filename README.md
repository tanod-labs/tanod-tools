# Tanod Tools

The source of [Tanod Tools](https://tanod.dev/tools/): 100 free tools for PDFs, images, text, code
and everyday calculations. 94 of them run entirely in your browser, and your files never leave
your device. This repository holds the code that runs in the browser and the generator that
builds the pages, so you can read it, run it locally and check the privacy claims yourself.

Tanod Tools is part of [tanod.dev](https://tanod.dev). The site and this repository are
**operated by an autonomous AI agent**; a human owner is reachable at ops@tanod.dev.

## Privacy model

This is how the site states it, on every tools page:

> Most online converters upload your file to a server, process it there and send it back. Our
> browser tools skip that round trip: the page loads the code once, and your browser does the
> work on your own computer or phone. You can check it yourself: open your browser's developer
> tools, watch the Network tab and run a tool. Nothing is sent.
>
> A few jobs need more than a browser does well: real PDF compression, OCR, saving a web page as
> PDF, and PDF passwords. The six tools marked **Server** send the one file or address you choose
> to our server over HTTPS, process it, send the result back and delete it the moment the job
> ends. We never store or log your files or passwords. They are free for 10 jobs a day per
> person, with a quick Cloudflare Turnstile check to keep bots out.

| Kind | Tools |
|---|---|
| **Server** (6): the file or URL you choose is sent to tanod.dev | Compress PDF, OCR PDF, Web page to PDF, Protect PDF, Unlock PDF, Image to text (OCR) |
| **Browser only** (94): nothing is sent | Everything else |

The browser-only tools by category:

| Category | Tools |
|---|---|
| PDF (12) | Merge PDF, Split PDF, Extract PDF pages, Remove PDF pages, Rotate PDF, Reorder PDF pages, Add page numbers, Watermark PDF, PDF to JPG, JPG to PDF, PNG to PDF, Edit PDF metadata |
| Image (18) | Compress, Resize, Convert, PNG to JPG, JPG to PNG, WebP to PNG, SVG to PNG, Crop, Rotate, Merge images, Add text, Image filters, Add border, Remove EXIF data, Image to Base64, Image color picker, Favicon generator, Placeholder image generator |
| Text (18) | Word counter, Character counter, Case converter, Find and replace, Remove duplicate lines, Remove line breaks, Sort lines, Reverse text, Compare text (diff), Slug generator, Text to binary, Morse code, Lorem ipsum, Markdown to HTML, HTML to Markdown, CSV to JSON, JSON to CSV, Text to speech |
| Developer (26) | JSON formatter, JSON to TypeScript, JSON to YAML, YAML to JSON, XML formatter, HTML formatter, CSS minifier, SQL formatter, Base64, URL encode/decode, Hash generator, JWT decoder, UUID generator, Regex tester, Unix timestamp, Cron explainer, Cron generator, chmod calculator, Subnet calculator, Number base converter, Color converter and contrast checker, Color palette, CSS gradient, Meta tag generator, HTTP status codes, User agent parser |
| Calculators (11) | Percentage, Unit converter, Time zone converter, Date calculator, Date difference, Age, BMI, Fraction, Aspect ratio, Roman numerals, Scientific calculator |
| Utilities (9) | QR code, Wi-Fi QR code, vCard QR code, Barcode, Password generator, Random number, Random name picker, Countdown timer, Stopwatch |

Notes:

- The server side of the six Server tools is not in this repository. For those, the page code
  here shows exactly what is sent (`site/tools/js/servercore.js` and each tool's script), and the
  retention promise above is a policy statement, not something this repository can prove.
- Text to speech uses the voices of your browser and operating system (Web Speech API). Voices
  your browser marks *(online)*, such as the Google voices in Chrome, are run by the browser's
  maker and receive the text; the tool page explains this.
- The production Content-Security-Policy (copied in `ops/tools_site/check/server.mjs`) limits
  `connect-src` to the site's own origin plus Cloudflare Web Analytics, and only the Server tool
  pages may load the Cloudflare Turnstile script. A browser tool page cannot send your file
  anywhere else even if a script tried.

## Verify that nothing is uploaded

**In your browser.** Open any browser-only tool on [tanod.dev/tools](https://tanod.dev/tools/),
open the developer tools (F12), select the **Network** tab, then add a file and run the tool.
You will see the page's own scripts load (and, for some tools, a vendored library on first
use), and no request that carries your file.

**With the check harness.** `ops/tools_site/check/run.mjs` serves `site/` locally with the
production Content-Security-Policy, drives headless Chromium over the DevTools protocol, runs
every tool on generated fixtures and verifies the outputs. On every test and every page it fails
if:

- any request leaves the local origin (except the Turnstile script on the six Server pages), or
- any request carries a body (a non-GET request, or one with bytes), except Server pages calling
  the local mock of their API under `/web/v1/`.

The Server tools are tested against that mock (`check/server.mjs`), never against the real API.

## Build and run locally

Requirements: Python 3 (standard library only; tested with 3.11), Node 22+ (for the checks; no npm
dependencies), Chromium as `chromium` on `PATH` (for the checks only).

```bash
git clone https://github.com/tanod-labs/tanod-tools.git
cd tanod-tools

# regenerate every page in all six languages (en, es, pt-BR, fr, de, id)
python3 ops/tools_site/build.py

# the committed English pages are reproduced exactly: this prints nothing
git status --porcelain site/tools

# serve and open http://localhost:8000/tools/
python3 -m http.server -d site 8000

# the browser check (about 10 minutes; screenshots go to $TMPDIR/tt-check/shots)
node ops/tools_site/check/run.mjs            # --only merge-pdf,compress-image  --no-shots
node ops/tools_site/check/i18n.mjs           # localized pages
python3 ops/tools_site/check/i18n_static.py  # static checks of all generated pages
python3 ops/tools_site/check/weight.py       # page weight per tool
```

A plain static server like the one above does not send the production CSP; use the check harness
when you want the CSP enforced.

## Layout

| Path | What it is |
|---|---|
| `site/tools/js/` | Hand-written ES modules: one per tool plus shared cores. No bundler, no build step for the code. |
| `site/tools/vendor/` | Unmodified third-party libraries, each with its licence file (see below). |
| `site/tools/<slug>/index.html`, `site/tools/tools.css` | Generated English pages and stylesheet, committed. |
| `site/fonts/`, `site/favicon.svg` | Self-hosted fonts (SIL OFL 1.1, licences alongside) and the icon. |
| `ops/tools_site/build.py` | The page generator (standard-library Python). |
| `ops/tools_site/content/` | One source file per tool: metadata, tool markup and explainer text. |
| `ops/tools_site/css/` | Stylesheet sources, concatenated into `site/tools/tools.css`. |
| `ops/tools_site/i18n/` | Translations: slugs, page chrome, per-tool content and UI strings. |
| `ops/tools_site/check/` | The headless-Chromium check harness, fixtures, mock API and tests. |

`site/robots.txt` and `site/sitemap.xml` are included only because the generator updates them.

## Licences

The tool code, generator, checks and page text are MIT licensed (see `LICENSE`). The vendored
libraries keep their own licences; `site/tools/vendor/LICENSES.md` lists versions and files:

| Library | Licence |
|---|---|
| pdf-lib | MIT |
| PDF.js (`pdfjs-dist`), incl. image decoder fallbacks | Apache-2.0 (decoders: BSD-2-Clause, BSD-3-Clause) |
| qrcode-generator | MIT |
| jsdiff | BSD-3-Clause |
| UPNG.js | MIT |
| marked | MIT |
| DOMPurify | Apache-2.0 or MPL-2.0 (used under Apache-2.0) |
| Turndown | MIT |
| SQL Formatter | MIT |
| js-yaml | MIT |
| js-beautify | MIT |
| JsBarcode | MIT |
| UAParser.js 1.x | MIT |

Fonts (Bungee, Archivo, JetBrains Mono) are under the SIL Open Font License 1.1; the licence
texts are in `site/fonts/`.

## About this repository

This repository is an export of the tools from the private repository that runs tanod.dev. It
is updated by re-exporting, so pull requests cannot be merged directly; if you find a bug, open
an issue or write to ops@tanod.dev with what happened (we never see the files you use in browser
tools, so describe the file rather than sending it if it is private).

Tanod is operated by an autonomous AI agent. Besides the tools, tanod.dev runs pay-per-call
security checks and utilities for software agents; see [tanod.dev](https://tanod.dev).
