// Tanod Tools check: serves site/ with the production CSP, drives headless Chromium over CDP,
// runs each tool's core action on generated fixtures, verifies outputs, and screenshots pages.
//
// Usage: node ops/tools_site/check/run.mjs [--only slug,slug] [--no-shots] [--no-tests] [--out DIR]
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { launch, trackDownloads, waitDownload } from "./cdp.mjs";
import { serve, mock, resetMock, SERVER_TOOLS } from "./server.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const SITE = fileURLToPath(new URL("../../../site/", import.meta.url));
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const only = opt("--only") ? opt("--only").split(",") : null;
const OUT = opt("--out") || join(tmpdir(), "tt-check");
const doShots = !args.includes("--no-shots");
const doTests = !args.includes("--no-tests");
const port = Number(opt("--port") || 9333);

rmSync(OUT, { recursive: true, force: true });
for (const d of ["fixtures", "downloads", "shots"]) mkdirSync(join(OUT, d), { recursive: true });

const { server, origin, hits } = await serve(SITE.replace(/\/$/, ""));
const TURNSTILE = readFileSync(join(HERE, "fake-turnstile.js"), "utf8");
const browser = await launch({ port });

const results = [];
let dlCount = 0;

function makeCtx(page, slug) {
  const ctx = {
    page, origin, slug, mock, resetMock,
    fixtures: join(OUT, "fixtures"),
    async dl(selector = ".result__head a[download]", timeout = 60000) {
      const dir = join(OUT, "downloads", String(++dlCount));
      mkdirSync(dir, { recursive: true });
      await trackDownloads(browser, dir);
      const done = waitDownload(browser, timeout);
      await page.click(selector);
      const name = await done;
      const files = readdirSync(dir);
      const file = files.find((f) => f === name) || files[0];
      return { name, bytes: readFileSync(join(dir, file)) };
    },
    assert(cond, msg) { if (!cond) throw new Error("assert: " + msg); },
    eq(a, b, msg) {
      const A = JSON.stringify(a), B = JSON.stringify(b);
      if (A !== B) throw new Error(`expected ${msg || ""}: ${B}, got ${A}`);
    },
    async shot(name, width = 1280, { selector } = {}) {
      await page.viewport(width);
      const path = join(OUT, "shots", `${slug}--${name}-${width}.png`);
      if (!selector) return page.screenshot(path);
      const r = await page.eval(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x: 0, y: Math.max(0, r.top + scrollY - 16), width: document.documentElement.clientWidth, height: r.height + 32}; })()`);
      const { data } = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { ...r, scale: 1 } });
      writeFileSync(path, Buffer.from(data, "base64"));
    },
    async go(path = `/tools/${slug}/`) { await page.goto(origin + path); },
    status: () => page.eval(`(() => { const s = document.querySelector("#status"); return s ? {state: s.dataset.state, text: s.textContent, hidden: s.hidden} : null; })()`),
    async waitDone(timeout = 60000) {
      await page.waitFor(`(() => { const s = document.querySelector("#status"); return s && (s.dataset.state === "done" || s.dataset.state === "error") && s.dataset.state; })()`, { timeout });
      const st = await ctx.status();
      if (st.state === "error") throw new Error("tool reported error: " + st.text);
      return st;
    },
    async waitError(timeout = 30000) {
      await page.waitFor(`document.querySelector("#status")?.dataset.state === "error"`, { timeout });
      return (await ctx.status()).text;
    },
  };
  return ctx;
}

async function withPage(fn) {
  const page = await browser.newPage();
  await page.init();
  await page.fakeTurnstile(TURNSTILE);
  await page.viewport(1280);
  try { return await fn(page); } finally { await page.close(); }
}

/* Requests that left the local server. Server tool pages may load Cloudflare Turnstile (served from memory here by
   fakeTurnstile); on every other page that request is a failure too. */
function offOrigin(page, slug) {
  const turnstileOk = SERVER_TOOLS.includes(slug);
  return (page.requests || []).filter((r) => !r.url.startsWith(origin) && !/^(blob|data):/.test(r.url)
    && !(turnstileOk && r.url.startsWith("https://challenges.cloudflare.com/turnstile/v0/api.js"))).map((r) => r.url);
}

/* Requests with a body: only server tool pages may send any, and only to /web/v1/. */
function uploadsFrom(slug, from) {
  return hits.slice(from).filter((h) => (h.method !== "GET" && h.method !== "HEAD") || h.bytes > 0)
    .filter((h) => !(SERVER_TOOLS.includes(slug) && h.web));
}

/* ------------------------------------------------------------------ tests */

if (doTests) {
  const files = readdirSync(join(HERE, "tests")).filter((f) => f.endsWith(".mjs")).sort();
  for (const f of files) {
    const tests = (await import(join(HERE, "tests", f))).default;
    for (const test of tests) {
      if (only && !only.includes(test.page)) continue;
      const t0 = Date.now();
      let error = null, consoleErrors = [], external = [], uploads = [];
      const mark = hits.length;
      resetMock();
      await withPage(async (page) => {
        const ctx = makeCtx(page, test.page);
        try {
          await ctx.go(test.path);
          await test.run(ctx);
        } catch (e) {
          error = e.message.split("\n").slice(0, 4).join("\n");
          try { await page.screenshot(join(OUT, "shots", `FAIL--${test.page}--${test.name.replace(/\W+/g, "-")}.png`)); } catch (_) { /* ignore */ }
        }
        consoleErrors = page.errors.filter((m) => !(test.allowConsole && test.allowConsole.test(m)));
        external = offOrigin(page, test.page);
      });
      uploads = uploadsFrom(test.page, mark);
      const ok = !error && !consoleErrors.length && !external.length && !uploads.length;
      results.push({ kind: "test", page: test.page, name: test.name, ok, ms: Date.now() - t0, error, consoleErrors, external });
      console.log(`${ok ? "PASS" : "FAIL"}  ${test.page} :: ${test.name} (${Date.now() - t0} ms)`);
      if (error) console.log("      " + error.replace(/\n/g, "\n      "));
      for (const m of consoleErrors) console.log("      console: " + m);
      for (const u of external) console.log("      external request: " + u);
      for (const u of uploads) console.log("      upload: " + JSON.stringify(u));
    }
  }
}

/* ------------------------------------------------------------------ screenshots, overflow, load errors */

if (doShots) {
  // Screenshots show first-visit state: drop preferences the tests left in localStorage.
  await withPage(async (page) => { await page.goto(origin + "/tools/"); await page.eval("localStorage.clear(), true"); });
  const pages = ["", ...readdirSync(join(SITE, "tools")).filter((d) => existsSync(join(SITE, "tools", d, "index.html")) && statSync(join(SITE, "tools", d)).isDirectory())];
  for (const slug of pages) {
    if (only && !only.includes(slug || "index")) continue;
    const name = slug || "index";
    for (const [w, dark] of [[375, false], [1280, false], [375, true], [1280, true]]) {
      let problems = [];
      const mark = hits.length;
      resetMock();
      await withPage(async (page) => {
        await page.viewport(w, 900, { dark });
        await page.goto(`${origin}/tools/${slug ? slug + "/" : ""}`);
        if (SERVER_TOOLS.includes(slug)) await page.waitFor(`!!window.turnstile && /free server jobs left/.test(document.querySelector("#quota").textContent)`, { timeout: 8000 });
        await new Promise((r) => setTimeout(r, 150));
        const ov = await page.eval(`(() => {
          const W = document.documentElement.clientWidth;
          const bad = [];
          for (const e of document.querySelectorAll("body *")) {
            const r = e.getBoundingClientRect();
            if (r.width && (r.right > W + 1) && getComputedStyle(e).position !== "fixed" && !e.closest(".catnav, .sprite, .visually-hidden, .skip")) bad.push(e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + "." + (e.className && e.className.baseVal === undefined ? String(e.className).split(" ")[0] : ""));
          }
          return { scroll: document.documentElement.scrollWidth > W, bad: bad.slice(0, 5) };
        })()`);
        if (ov.scroll) problems.push("horizontal overflow: " + ov.bad.join(", "));
        const h1 = await page.eval(`document.querySelectorAll("h1").length`);
        if (h1 !== 1) problems.push(`${h1} h1 elements`);
        await page.screenshot(join(OUT, "shots", `${name}-${w}${dark ? "-dark" : ""}.png`));
        await page.screenshot(join(OUT, "shots", `fold--${name}-${w}${dark ? "-dark" : ""}.png`), { full: false });
        problems.push(...page.errors.map((e) => "console: " + e));
        problems.push(...offOrigin(page, slug).map((u) => "external request: " + u));
        if (SERVER_TOOLS.includes(slug) && page.turnstileLoads !== 1) problems.push(`Turnstile loaded ${page.turnstileLoads} times`);
        if (!SERVER_TOOLS.includes(slug) && page.turnstileLoads) problems.push("a browser-only page loaded Turnstile");
      });
      problems.push(...uploadsFrom(slug || "index", mark).map((u) => "upload: " + JSON.stringify(u)));
      const ok = !problems.length;
      results.push({ kind: "page", page: name, name: `${w}px${dark ? " dark" : ""}`, ok, error: problems.join("; ") });
      if (!ok) console.log(`FAIL  page ${name} ${w}${dark ? " dark" : ""}: ${problems.join("; ")}`);
    }
  }
}

/* uploads would show up as non-GET requests or request bodies on the local server; server tool pages may only
   reach /web/v1/ (checked per test and per page above) */
const uploads = hits.filter((h) => (h.method !== "GET" && h.method !== "HEAD" || h.bytes > 0) && !h.web);
if (uploads.length) {
  console.log("FAIL  requests with bodies reached the server: " + JSON.stringify(uploads.slice(0, 5)));
  results.push({ kind: "net", page: "*", name: "no uploads", ok: false });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots: ${join(OUT, "shots")}`);
await browser.close();
server.close();
process.exit(failed.length ? 1 : 0);
