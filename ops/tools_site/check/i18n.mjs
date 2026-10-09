// Tanod Tools localized-page check: serves site/ with the production CSP and drives headless Chromium over CDP.
//   1. functional tests per category in each language (i18n-tests/*.mjs): actions work, strings render,
//      numbers are formatted for the locale
//   2. a sweep of every page in each language at 375 and 1280 px: no console errors or CSP violations, no
//      off-origin requests or uploads, no horizontal overflow, one h1, Turnstile only on server pages
//   3. on every test and page: no string-table lookups that missed (window.__ttMissing) and no English UI text
//      from the page's string table left in the rendered DOM (text nodes and placeholder/aria-label/title/alt)
//   4. screenshots of the index and three tools per language at 375 and 1280 for review
//
// Usage: node ops/tools_site/check/i18n.mjs [--langs es,pt-BR,fr,de,id,it,tr,vi,ru,pl,hi] [--only slug,...] [--no-tests]
//        [--no-sweep] [--sweep-shots-only] [--out DIR] [--port N]
import { mkdirSync, readdirSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launch, trackDownloads, waitDownload } from "./cdp.mjs";
import { serve, mock, resetMock, SERVER_TOOLS, SLUGS, toolPath, LANG_PREFIX } from "./server.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const SITE = fileURLToPath(new URL("../../../site/", import.meta.url));
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const LANGS = (opt("--langs") || "es,pt-BR,fr,de,id,it,tr,vi,ru,pl,hi").split(",");
const only = opt("--only") ? opt("--only").split(",") : null;
const OUT = opt("--out") || join(tmpdir(), "tt-i18n");
const port = Number(opt("--port") || 9334);
const SHOT_PAGES = ["index", "merge-pdf", "word-counter", "percentage-calculator"];

rmSync(OUT, { recursive: true, force: true });
for (const d of ["fixtures", "downloads", "shots"]) mkdirSync(join(OUT, d), { recursive: true });

const { server, origin, hits } = await serve(SITE.replace(/\/$/, ""));
const TURNSTILE = readFileSync(join(HERE, "fake-turnstile.js"), "utf8");
const browser = await launch({ port });
const results = [];
let dlCount = 0;

/* ------------------------------------------------------------------ string tables */

const tables = new Map();
async function table(lang, page) {
  const k = lang + "/" + page;
  if (!tables.has(k)) {
    const f = join(SITE, "tools/js/i18n", lang, page + ".js");
    tables.set(k, existsSync(f) ? (await import(pathToFileURL(f).href + "?" + Date.now())).default : {});
  }
  return tables.get(k);
}

/* English text to look for in the DOM: for each key whose translation differs, the literal runs between
   placeholders that have at least two English words (looked for as substrings), and one-word keys (looked for as
   whole text nodes). Brand, format and code words that the translation keeps are skipped. */
function needlesOf(tab) {
  const runs = new Set(), words = new Set();
  for (const [key, val] of Object.entries(tab)) {
    const forms = typeof val === "object" ? Object.values(val) : [val];
    const englishForms = key.includes("|") ? key.split("|") : [key];
    for (const en of englishForms) {
      if (forms.includes(en)) continue;
      const tr = forms.join(" ");
      for (const part of en.split(/\{\w+\}/)) {
        const p = part.trim().replace(/^[^A-Za-z]+|[^A-Za-z.…!?]+$/g, "");
        if ((p.match(/[A-Za-z]{2,}/g) || []).length >= 2 && p.length >= 8 && !tr.includes(p)) runs.add(p);
      }
      if (!/\{/.test(en) && /^[A-Z][a-z]{3,}[.…]?$/.test(en.trim()) && !tr.toLowerCase().includes(en.trim().toLowerCase())) words.add(en.trim());
    }
  }
  return { runs: [...runs], words: [...words] };
}

const SCAN = (needles) => `(() => {
  const N = ${JSON.stringify(needles)};
  const texts = [];
  const skip = (e) => e.closest("script,style,code,pre,textarea,svg,.sprite,[contenteditable],.wc__text,output.mono,.mono,[data-user]");
  // Script-made UI lives in the tool board and the live regions; the static page text (how-to, FAQ, article) is
  // checked against the English page by i18n_static.py.
  const roots = [...document.querySelectorAll("#tool, [aria-live]")].filter((e, i, all) => !all.some((o) => o !== e && o.contains(e)));
  const w = { i: 0, cur: null, walkers: roots.map((r) => document.createTreeWalker(r, NodeFilter.SHOW_TEXT)),
    nextNode() { while (this.i < this.walkers.length) { const n = this.walkers[this.i].nextNode(); if (n) return n; this.i++; } return null; } };
  for (let n; (n = w.nextNode());) {
    const p = n.parentElement;
    if (!p || skip(p)) continue;
    if (p.tagName === "OPTION" && p.value.includes("/")) continue; // IANA zone ids such as America/New_York stay as they are
    const t = n.textContent.replace(/\\s+/g, " ").trim();
    if (t) texts.push(t);
  }
  for (const e of document.querySelectorAll("[placeholder],[aria-label],[aria-roledescription],[title],[alt]")) {
    if (skip(e) || !roots.some((r) => r.contains(e))) continue;
    for (const a of ["placeholder", "aria-label", "aria-roledescription", "title", "alt"]) { const v = e.getAttribute(a); if (v) texts.push(v); }
  }
  const found = new Set();
  for (const t of texts) {
    for (const r of N.runs) {
      const at = t.indexOf(r);
      if (at >= 0 && !/[A-Za-z]/.test(t[at - 1] || "") && !/[A-Za-z]/.test(t[at + r.length] || "")) found.add(r + "  <-  " + t.slice(0, 80));
    }
    if (N.words.includes(t)) found.add(t);
  }
  return { found: [...found], missing: globalThis.__ttMissing || [] };
})()`;

async function i18nProblems(page, lang, pageSlug) {
  const tab = await table(lang, pageSlug);
  const needles = needlesOf(tab);
  // A one-word label that the translated page itself uses (German "Minimum", French "Image") is not leftover English.
  const htmlFile = join(SITE, pathOf(lang, pageSlug), "index.html");
  const html = existsSync(htmlFile) ? readFileSync(htmlFile, "utf8") : "";
  needles.words = needles.words.filter((w) => !html.includes(">" + w + "<"));
  const r = await page.eval(SCAN(needles));
  return [...r.missing.map((k) => "string missing from table: " + k), ...r.found.map((f) => "English left: " + f)];
}

/* ------------------------------------------------------------------ helpers shared with run.mjs */

function offOrigin(page, slug) {
  const turnstileOk = SERVER_TOOLS.includes(slug);
  return (page.requests || []).filter((r) => !r.url.startsWith(origin) && !/^(blob|data):/.test(r.url)
    && !(turnstileOk && r.url.startsWith("https://challenges.cloudflare.com/turnstile/v0/api.js"))).map((r) => r.url);
}
function uploadsFrom(slug, from) {
  return hits.slice(from).filter((h) => (h.method !== "GET" && h.method !== "HEAD") || h.bytes > 0)
    .filter((h) => !(SERVER_TOOLS.includes(slug) && h.web));
}
async function withPage(fn) {
  const page = await browser.newPage();
  await page.init();
  await page.fakeTurnstile(TURNSTILE);
  await page.viewport(1280);
  try { return await fn(page); } finally { await page.close(); }
}
const pathOf = (lang, slug) => (slug === "index" ? `${LANG_PREFIX[lang]}/tools/` : toolPath(lang, slug));

function makeCtx(page, lang, slug) {
  const nf = (opts) => new Intl.NumberFormat(lang, opts);
  const ctx = {
    page, origin, slug, lang, mock, resetMock, fixtures: join(OUT, "fixtures"),
    num: (n, opts) => nf(opts).format(n),
    async tx(key) { const v = (await table(lang, slug))[key]; if (v === undefined) throw new Error("no translation for " + key); return v; },
    async dl(selector = ".result__head a[download]", timeout = 60000) {
      const dir = join(OUT, "downloads", String(++dlCount));
      mkdirSync(dir, { recursive: true });
      await trackDownloads(browser, dir);
      const done = waitDownload(browser, timeout);
      await page.click(selector);
      const name = await done;
      const file = readdirSync(dir).find((f) => f === name) || readdirSync(dir)[0];
      return { name, bytes: readFileSync(join(dir, file)) };
    },
    assert(cond, msg) { if (!cond) throw new Error("assert: " + msg); },
    eq(a, b, msg) { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error(`expected ${msg || ""}: ${B}, got ${A}`); },
    async shot(name, width = 1280) { await page.viewport(width); await page.screenshot(join(OUT, "shots", `${lang}--${slug}--${name}-${width}.png`)); },
    async go(path = pathOf(lang, slug)) { await page.goto(origin + path); },
    text: (sel) => page.eval(`document.querySelector(${JSON.stringify(sel)}).textContent.trim()`),
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

/* ------------------------------------------------------------------ 1. functional tests */

if (!args.includes("--no-tests")) {
  const files = readdirSync(join(HERE, "i18n-tests")).filter((f) => f.endsWith(".mjs")).sort();
  for (const f of files) {
    const tests = (await import(join(HERE, "i18n-tests", f))).default;
    for (const lang of LANGS) {
      for (const test of tests) {
        if (only && !only.includes(test.page)) continue;
        const t0 = Date.now();
        let error = null, problems = [];
        const mark = hits.length;
        resetMock();
        await withPage(async (page) => {
          if (test.timezone) await page.timezone(test.timezone);
          const ctx = makeCtx(page, lang, test.page);
          try {
            await ctx.go();
            await test.run(ctx);
            problems.push(...await i18nProblems(page, lang, test.page));
          } catch (e) {
            error = e.message.split("\n").slice(0, 4).join("\n");
            try { await page.screenshot(join(OUT, "shots", `FAIL--${lang}--${test.page}--${test.name.replace(/\W+/g, "-")}.png`)); } catch (_) { /* ignore */ }
          }
          problems.push(...page.errors.map((m) => "console: " + m));
          problems.push(...offOrigin(page, test.page).map((u) => "external request: " + u));
        });
        problems.push(...uploadsFrom(test.page, mark).map((u) => "upload: " + JSON.stringify(u)));
        const ok = !error && !problems.length;
        results.push({ kind: "test", lang, page: test.page, name: test.name, ok });
        console.log(`${ok ? "PASS" : "FAIL"}  ${lang} ${test.page} :: ${test.name} (${Date.now() - t0} ms)`);
        if (error) console.log("      " + error.replace(/\n/g, "\n      "));
        for (const p of problems) console.log("      " + p);
      }
    }
  }
}

/* ------------------------------------------------------------------ 2-4. sweep every page */

if (!args.includes("--no-sweep")) {
  const all = ["index", ...Object.keys(SLUGS)];
  const sweep = args.includes("--sweep-shots-only") ? SHOT_PAGES : all;
  await withPage(async (page) => { await page.goto(origin + "/tools/"); await page.eval("localStorage.clear(), true"); });
  for (const lang of LANGS) {
    let n = 0, bad = 0;
    for (const slug of sweep) {
      if (only && !only.includes(slug)) continue;
      const path = pathOf(lang, slug);
      if (!existsSync(join(SITE, path, "index.html"))) {
        results.push({ kind: "page", lang, page: slug, ok: false });
        console.log(`FAIL  ${lang} ${slug}: page not built (${path})`);
        bad++;
        continue;
      }
      for (const w of [375, 1280]) {
        const problems = [];
        const mark = hits.length;
        resetMock();
        await withPage(async (page) => {
          await page.viewport(w, 900);
          await page.goto(origin + path);
          if (SERVER_TOOLS.includes(slug)) {
            await page.waitFor(`!!window.turnstile && /\\d/.test(document.querySelector("#quota").textContent)`, { timeout: 8000 }).catch((e) => problems.push("quota line: " + e.message.slice(0, 120)));
          }
          await new Promise((r) => setTimeout(r, 150));
          const ov = await page.eval(`(() => {
            const W = document.documentElement.clientWidth, bad = [];
            for (const e of document.querySelectorAll("body *")) {
              const r = e.getBoundingClientRect();
              if (r.width && r.right > W + 1 && getComputedStyle(e).position !== "fixed" && !e.closest(".catnav, .sprite, .visually-hidden, .skip")) bad.push(e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + "." + (e.className && e.className.baseVal === undefined ? String(e.className).split(" ")[0] : ""));
            }
            // text clipped inside buttons, tabs and segmented controls (long German labels)
            const clipped = [];
            for (const e of document.querySelectorAll(".btn, .seg label, .catnav a, .langs summary, [role=tab]")) {
              if (e.offsetParent && (e.scrollWidth > e.clientWidth + 1)) clipped.push((e.textContent || "").trim().slice(0, 40));
            }
            return { scroll: document.documentElement.scrollWidth > W, bad: bad.slice(0, 5), clipped: clipped.slice(0, 5) };
          })()`);
          if (ov.scroll) problems.push("horizontal overflow: " + ov.bad.join(", "));
          if (ov.clipped.length) problems.push("clipped control text: " + ov.clipped.join(" | "));
          const h1 = await page.eval(`document.querySelectorAll("h1").length`);
          if (h1 !== 1) problems.push(`${h1} h1 elements`);
          const htmlLang = await page.eval(`document.documentElement.lang`);
          if (htmlLang !== lang) problems.push(`html lang ${htmlLang}`);
          problems.push(...await i18nProblems(page, lang, slug));
          if (SHOT_PAGES.includes(slug)) {
            await page.screenshot(join(OUT, "shots", `${lang}--${slug}-${w}.png`));
            await page.screenshot(join(OUT, "shots", `fold--${lang}--${slug}-${w}.png`), { full: false });
          }
          problems.push(...page.errors.map((e) => "console: " + e));
          problems.push(...offOrigin(page, slug).map((u) => "external request: " + u));
          if (SERVER_TOOLS.includes(slug) && page.turnstileLoads !== 1) problems.push(`Turnstile loaded ${page.turnstileLoads} times`);
          if (!SERVER_TOOLS.includes(slug) && page.turnstileLoads) problems.push("a browser-only page loaded Turnstile");
        });
        problems.push(...uploadsFrom(slug, mark).map((u) => "upload: " + JSON.stringify(u)));
        const ok = !problems.length;
        n++;
        if (!ok) bad++;
        results.push({ kind: "page", lang, page: slug, name: `${w}px`, ok });
        if (!ok) console.log(`FAIL  ${lang} ${slug} ${w}: ${problems.join("; ")}`);
      }
    }
    console.log(`sweep ${lang}: ${n - bad}/${n} page loads clean`);
  }
}

const uploads = hits.filter((h) => (h.method !== "GET" && h.method !== "HEAD" || h.bytes > 0) && !h.web);
if (uploads.length) {
  console.log("FAIL  requests with bodies reached the server: " + JSON.stringify(uploads.slice(0, 5)));
  results.push({ kind: "net", page: "*", ok: false });
}
const failed = results.filter((r) => !r.ok);
writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 1));
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots: ${join(OUT, "shots")}`);
await browser.close();
server.close();
process.exit(failed.length ? 1 : 0);
