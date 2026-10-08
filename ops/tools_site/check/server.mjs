// Static server for the site with the production Content-Security-Policy (copied from the Caddyfile), plus a mock of
// the server-backed tools' API (/web/v1/*) for the server tool pages. The mock mirrors scanapi/webtools.py: same paths,
// the same strict body keys, the X-Turnstile-Token and Origin checks, the daily count and the error shapes.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { makePdf, makeEncryptedPdf } from "./fixtures.mjs";

export const CSP = "default-src 'self'; script-src 'self' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://cloudflareinsights.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
// The server tool pages (Caddyfile @tools_server): Cloudflare Turnstile's script and iframe are allowed there only.
export const CSP_SERVER = "default-src 'self'; script-src 'self' https://static.cloudflareinsights.com https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://cloudflareinsights.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
export const SERVER_TOOLS = ["compress-pdf", "ocr-pdf", "image-to-text", "url-to-pdf", "protect-pdf", "unlock-pdf"];
// Localized pages of the server tools (/es/tools/comprimir-pdf/ ...) get the same CSP: the Caddyfile's @tools_server
// matcher must list them too (python3 ops/tools_site/build.py --caddy prints it).
export const SLUGS = JSON.parse(readFileSync(new URL("../i18n/slugs.json", import.meta.url), "utf8"));
export const LANG_PREFIX = { "en": "", "es": "/es", "pt-BR": "/pt", "fr": "/fr", "de": "/de", "id": "/id" };
export const toolPath = (lang, slug) => `${LANG_PREFIX[lang]}/tools/${lang === "en" ? slug : SLUGS[slug][lang].slug}/`;
const SERVER_PAGES = new Set(Object.keys(LANG_PREFIX).flatMap((l) => SERVER_TOOLS.map((s) => toolPath(l, s))));
const SERVER_PATH = { test: (path) => [...SERVER_PAGES].some((p) => path.startsWith(p)) };

const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml",
  ".png": "image/png", ".woff2": "font/woff2", ".xml": "application/xml", ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8", ".wasm": "application/wasm", ".ico": "image/x-icon",
};

/* ------------------------------------------------------------------ /web/v1 mock */

const KEYS = {
  "/web/v1/pdf/compress": [["pdf_base64"], ["level"]],
  "/web/v1/pdf/ocr": [["pdf_base64", "pages"], ["skip_text"]],
  "/web/v1/image/ocr": [["image_base64"], []],
  "/web/v1/pdf/html-to-pdf": [["url"], ["paper", "landscape", "print_background"]],
  "/web/v1/pdf/protect": [["pdf_base64", "password"], ["allow_print", "allow_copy"]],
  "/web/v1/pdf/unlock": [["pdf_base64", "password"], []],
};
export const mock = { limit: 10, used: 0, next: null, calls: [], enabled: true };
export function resetMock() { Object.assign(mock, { limit: 10, used: 0, next: null, calls: [], enabled: true }); }

const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const file = (name, bytes, type = "application/pdf") => ({ name, content_type: type, bytes: bytes.length, data_base64: b64(bytes) });

async function webAnswer(path, body) {
  const pdf = body.pdf_base64 ? Buffer.from(body.pdf_base64, "base64") : null;
  if (pdf && pdf.subarray(0, 5).toString() !== "%PDF-") return [422, { error: { code: "not_pdf", message: "the input is not a PDF" } }];
  switch (path) {
    case "/web/v1/pdf/compress": {
      const out = Buffer.from(await makePdf(1, { label: "Compressed" }));
      return [200, { tool: "compress", level: body.level || "recommended", bytes_before: pdf.length, bytes_after: out.length,
        saved_percent: 50, unchanged: false, input_pages: 1, file: file("compressed.pdf", out) }];
    }
    case "/web/v1/pdf/ocr": {
      const pages = [];
      for (const part of body.pages.split(",")) {
        const [a, b] = part.split("-").map(Number);
        for (let p = a; p <= (b || a); p++) pages.push(p);
      }
      if (pages.length > 10) return [422, { error: { code: "invalid_request", message: "pages must name at most 10 pages" } }];
      return [200, { tool: "ocr", input_pages: pages.length, ocr_pages: pages, skipped_has_text: [],
        text: pages.map((p) => `Fixture page ${p}`).join("\n\n"), text_truncated: false, file: file("searchable.pdf", pdf) }];
    }
    case "/web/v1/image/ocr": {
      const img = Buffer.from(body.image_base64, "base64");
      const png = img.subarray(1, 4).toString() === "PNG", jpg = img[0] === 0xff && img[1] === 0xd8;
      if (!png && !jpg) return [422, { error: { code: "unsupported_image", message: "not an image" } }];
      return [200, { tool: "image_ocr", text: `Hello from the OCR mock\nsecond line (${png ? "png" : "jpeg"})`, text_truncated: false }];
    }
    case "/web/v1/pdf/html-to-pdf": {
      if (!/^https?:\/\//.test(body.url)) return [422, { error: { code: "bad_url", message: "bad url" } }];
      if (/private\.test/.test(body.url)) return [422, { error: { code: "private_address", message: "blocked" } }];
      const out = Buffer.from(await makePdf(2, { label: "Web page" }));
      return [200, { tool: "html_to_pdf", pages: 2, paper: body.paper || "a4", landscape: !!body.landscape, file: file("page.pdf", out) }];
    }
    case "/web/v1/pdf/protect":
      return [200, { tool: "protect", input_pages: 1, encryption: "AES-256", file: file("protected.pdf", await makeEncryptedPdf()) }];
    case "/web/v1/pdf/unlock":
      if (body.password !== "right horse") return [422, { error: { code: "invalid_password", message: "the password does not open this PDF" } }];
      return [200, { tool: "unlock", input_pages: 1, opened_with: "user", file: file("unlocked.pdf", Buffer.from(await makePdf(1, { label: "Unlocked" }))) }];
  }
  return [404, { error: { code: "not_found", message: "no such tool" } }];
}

async function web(req, res, origin, raw) {
  const url = new URL(req.url, "http://x");
  const send = (status, body, headers = {}) => {
    const remaining = Math.max(0, mock.limit - mock.used);
    const out = JSON.stringify(status === 404 ? body : { ...body, remaining });
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers });
    res.end(out);
  };
  if (req.method === "GET" && url.pathname === "/web/v1/status") {
    return send(200, { enabled: mock.enabled, sitekey: mock.enabled ? "1x00000000000000000000AA" : null, action: "tanod-tools",
      daily_limit: mock.limit, max_file_bytes: 10_000_000, max_ocr_pages: 10, busy: {} });
  }
  if (req.method !== "POST" || !KEYS[url.pathname]) return send(405, { error: { code: "http_error", message: "Method Not Allowed" } });
  const call = { path: url.pathname, bytes: raw.length, token: req.headers["x-turnstile-token"] || "", origin: req.headers.origin || "" };
  mock.calls.push(call);
  if (call.origin !== origin) return send(403, { error: { code: "cross_origin", message: "x" } });
  if (!/^fake-token-/.test(call.token)) return send(403, { error: { code: "turnstile_required", message: "x" } });
  if ((req.headers["content-type"] || "").split(";")[0] !== "application/json") return send(415, { error: { code: "unsupported_media_type", message: "x" } });
  if (raw.length > 13_398_872) return send(413, { error: { code: "body_too_large", message: "x" } });
  let body;
  try { body = JSON.parse(raw.toString("utf8")); } catch (_) { return send(422, { error: { code: "invalid_request", message: "bad json" } }); }
  const [required, optional] = KEYS[url.pathname];
  const keys = Object.keys(body);
  call.keys = keys.sort();
  call.body = Object.fromEntries(Object.entries(body).map(([k, v]) => [k, /base64$/.test(k) ? `<${String(v).length} chars>` : v]));
  if (!required.every((k) => keys.includes(k)) || !keys.every((k) => required.includes(k) || optional.includes(k))) {
    return send(422, { error: { code: "invalid_request", message: `keys ${keys.join(",")}` } });
  }
  if (mock.used >= mock.limit) return send(429, { error: { code: "daily_limit", message: "x" } });
  if (mock.next) {
    const n = mock.next;
    mock.next = null;
    return send(n.status, { error: { code: n.code, message: n.message || "x" } }, n.status === 503 ? { "Retry-After": "20" } : {});
  }
  const [status, out] = await webAnswer(url.pathname, body);
  if (status === 200) mock.used++;
  return send(status, out);
}

/* ------------------------------------------------------------------ static files */

export function serve(root, port = 0, { csp = CSP } = {}) {
  const hits = [];
  let origin = "";
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    let path = decodeURIComponent(url.pathname);
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    if (path.startsWith("/web/v1/")) {
      hits.push({ method: req.method, path, bytes: raw.length, web: true });
      return web(req, res, origin, raw);
    }
    hits.push({ method: req.method, path, bytes: Number(req.headers["content-length"] || 0) || raw.length });
    const file = normalize(join(root, path));
    if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
    const pageCsp = SERVER_PATH.test(path) ? CSP_SERVER : csp;
    try {
      let target = file;
      let s = await stat(target);
      if (s.isDirectory()) {
        if (!path.endsWith("/")) { res.writeHead(301, { Location: path + "/" }); return res.end(); }
        target = join(target, "index.html");
        s = await stat(target);
      }
      const body = await readFile(target);
      res.writeHead(200, {
        "Content-Type": TYPES[extname(target)] || "application/octet-stream",
        "Content-Security-Policy": pageCsp,
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Cache-Control": "no-store",
      });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch (_) {
      res.writeHead(404, { "Content-Type": "text/plain", "Content-Security-Policy": pageCsp });
      res.end("not found");
    }
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => {
    origin = `http://127.0.0.1:${server.address().port}`;
    resolve({ server, hits, origin });
  }));
}
