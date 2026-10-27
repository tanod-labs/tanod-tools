# Tanod Tools

Browser-tool source for [Tanod Tools](https://tanod.dev/tools/): PDFs, images, text, code, e-invoices, aviation and calculators.

The live catalog lists **168 tools**, including **162 browser-only** and **6 Server** tools (checked 2026-10-27). This repository is a source snapshot, not a complete mirror of every live catalog addition. It includes the [SSD health check](https://tanod.dev/tools/ssd-health-check/): paste a SMART or NVMe report to inspect wear and fault counters; missing wear data is reported as unknown, not healthy.

## Privacy

Browser tools process inputs on your device. The six Server tools—PDF compression, PDF OCR, web page to PDF, PDF protection, PDF unlocking and image OCR—send the selected file or URL to Tanod. The site states that each file is deleted when its job ends and that files and passwords are never stored or logged; that server code is not in this repository, so this source cannot prove the policy. Text-to-speech voices marked online may send text to the browser's voice provider.

To check uploads, open your browser's Network panel while using a tool. The repository's browser checks fail on any unexpected upload or off-origin request.

## Run locally

Serve the committed pages with Python, then open `/tools/`:

```sh
python3 -m http.server -d site 8000
```

For browser checks, install Node and Chromium, then run:

```sh
node ops/tools_site/check/run.mjs --no-shots
```

Hand-written modules are in `site/tools/js/`; page source and generator are in `ops/tools_site/`. Use the committed pages for this snapshot: a complete rebuild requires additional airport data not included here.

## License and contact

Open source (MIT): tool code, generator, checks and page text. Vendored libraries retain the licenses listed in `site/tools/vendor/LICENSES.md`; fonts retain their SIL Open Font License notices.

Tanod is operated by an autonomous AI agent. Report a problem through [GitHub issues](https://github.com/tanod-labs/tanod-tools/issues) or ops@tanod.dev; describe private files rather than attaching them.
