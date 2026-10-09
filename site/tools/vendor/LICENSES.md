# Open-source libraries used by Tanod Tools

Every library below is served from this site (no CDN) and runs in your browser. Each one's
licence file sits next to it in this folder. Files are the unmodified upstream builds from npm
unless noted.

| Library | Version | Licence | Files here | Used by |
|---|---|---|---|---|
| [pdf-lib](https://github.com/Hopding/pdf-lib) | 1.17.1 | MIT | `pdf-lib/pdf-lib.esm.min.js`, `pdf-lib/LICENSE.md` | All PDF editing tools |
| [PDF.js](https://github.com/mozilla/pdf.js) (`pdfjs-dist`) | 6.4.299 | Apache-2.0 | `pdfjs/pdf.min.mjs`, `pdfjs/pdf.worker.min.mjs`, `pdfjs/LICENSE` | PDF page previews, PDF to JPG/PNG, the invoice attached to a ZUGFeRD or Factur-X PDF |
| PDF.js image decoders (JPEG 2000 via OpenJPEG, JBIG2 via PDFium), JavaScript fallbacks | 6.4.299 | BSD-2-Clause (OpenJPEG, PDF.js OpenJPEG glue), BSD-3-Clause (PDFium JBIG2), Apache-2.0 (PDF.js JBIG2 glue) | `pdfjs/wasm/*_nowasm_fallback.js`, `pdfjs/wasm/LICENSE_*` | Loaded only when a PDF contains JPEG 2000 or JBIG2 images |
| [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) | 2.0.4 | MIT | `qrcode/qrcode.mjs`, `qrcode/LICENSE` | QR code generator |
| [jsdiff](https://github.com/kpdecker/jsdiff) (`diff`) | 9.0.0 | BSD-3-Clause | `diff/diff.min.js`, `diff/LICENSE` | Text diff |
| [UPNG.js](https://github.com/photopea/UPNG.js) (`upng-js`) | 2.1.0 | MIT | `upng/UPNG.js`, `upng/LICENSE` | PNG colour reduction in Compress image |
| [marked](https://github.com/markedjs/marked) | 18.1.0 | MIT | `marked/marked.esm.js`, `marked/LICENSE` | Markdown to HTML |
| [DOMPurify](https://github.com/cure53/DOMPurify) (`dompurify`) | 3.4.16 | Apache-2.0 or MPL-2.0 (used here under Apache-2.0) | `dompurify/purify.es.mjs`, `dompurify/LICENSE`, `dompurify/LICENSE-MPL` | Cleaning the HTML in Markdown to HTML |
| [Turndown](https://github.com/mixmark-io/turndown) (`turndown`) | 7.2.4 | MIT | `turndown/turndown.browser.es.js`, `turndown/LICENSE` | HTML to Markdown |
| [SQL Formatter](https://github.com/sql-formatter-org/sql-formatter) (`sql-formatter`) | 15.9.0 | MIT | `sql-formatter/sql-formatter.min.js`, `sql-formatter/LICENSE` | SQL formatter |
| [js-yaml](https://github.com/nodeca/js-yaml) (`js-yaml`) | 5.4.3 | MIT | `js-yaml/js-yaml.esm.min.mjs`, `js-yaml/LICENSE` | YAML to JSON, JSON to YAML |
| [js-beautify](https://github.com/beautifier/js-beautify) (`js-beautify`) | 2.0.3 | MIT | `js-beautify/beautifier.min.js`, `js-beautify/LICENSE` | HTML formatter, CSS minifier and beautifier |
| [JsBarcode](https://github.com/lindell/JsBarcode) (`jsbarcode`) | 3.12.3 | MIT | `jsbarcode/JsBarcode.all.min.js`, `jsbarcode/LICENSE` | Barcode generator |
| [UAParser.js](https://github.com/faisalman/ua-parser-js) (`ua-parser-js`) | 1.0.41 | MIT | `ua-parser-js/ua-parser.min.js`, `ua-parser-js/LICENSE` | User agent parser |
| [gifenc](https://github.com/mattdesl/gifenc) | 1.0.3 | MIT | `gifenc/gifenc.esm.js`, `gifenc/LICENSE.md` | GIF maker |
| [ts-heic](https://github.com/stacksjs/ts-heic) (`@stacksjs/ts-heic`) | 0.0.2 | MIT | `ts-heic/ts-heic.esm.js`, `ts-heic/LICENSE.md` | HEIC to JPG |

Notes:

- `pdf-lib.esm.min.js`, `marked.esm.js`, `purify.es.mjs`, `sql-formatter.min.js`, `js-yaml.esm.min.mjs`,
  `beautifier.min.js` and `gifenc.esm.js` have their trailing `sourceMappingURL` comment removed (the maps are not
  shipped). The code is otherwise byte-for-byte the npm build.
- `sql-formatter.min.js`, `beautifier.min.js`, `JsBarcode.all.min.js` and `ua-parser.min.js` are the packages'
  browser (UMD) builds, loaded from this site only when their tool is first used. UAParser.js is the 1.x line,
  which is MIT-licensed (later major versions use a different licence).
- `ts-heic.esm.js` is the package's `dist/index.js`, unchanged (about 95 KB, 23 KB gzipped). It is a HEIC/HEIF decoder written in
  plain JavaScript: no WebAssembly, so it runs under this site's Content-Security-Policy. It decodes 8-bit 4:2:0 HEVC still
  pictures (single images and tile grids, as phones save them) and refuses anything else with an error. It runs in a worker
  (`js/heic-worker.js`) and is loaded only when HEIC to JPG converts its first photo. The MIT licence covers the code only: HEVC
  (H.265) itself is covered by patents of third parties, as it is for any HEVC decoder.
- `gifenc.esm.js` is the package's ES module build (about 9 KB). Its colour quantiser is a port of PnnQuant.js, credited in
  the package's source; the package itself is MIT-licensed. It runs in the page (no worker, no WebAssembly) and is
  loaded only when GIF maker's Create GIF button is first pressed.
- The upstream qrcode-generator package states its MIT licence in its source header but ships no
  separate licence file; `qrcode/LICENSE` reproduces the MIT text with the author's copyright line.
- PDF.js runs with `isEvalSupported: false` and `useWasm: false`, so it works under this site's
  Content-Security-Policy without `unsafe-eval` or `wasm-unsafe-eval`.
- Fonts (Bungee, Archivo, JetBrains Mono) are the main site's self-hosted files under `/fonts/`,
  licensed under the SIL Open Font License 1.1.

The tool code itself (everything under `/tools/js/`) was written for this site.
