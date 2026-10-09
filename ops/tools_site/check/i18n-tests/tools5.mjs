// Localized runs of the five newest tools (PDF to text, Sign PDF, Image to WebP, GIF maker, HEIC to JPG), in every language by i18n.mjs:
// the page's messages must come from the page's language table, numbers follow the locale, and the OCR link points at the
// localized OCR page. i18n.mjs adds the string-table and leftover-English checks to each.
import { PDFLib, makePdf, makePng, save } from "../fixtures.mjs";
import { deflateSync } from "node:zlib";
import { readFileSync } from "node:fs";

const SLUGS = JSON.parse(readFileSync(new URL("../../i18n/slugs.json", import.meta.url), "utf8"));
const PREFIX = { "es": "/es", "pt-BR": "/pt", "fr": "/fr", "de": "/de", "id": "/id", "it": "/it", "tr": "/tr", "vi": "/vi", "ru": "/ru", "pl": "/pl", "hi": "/hi" };
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
const plural = (t, v, n) => (typeof v === "object" ? v[new Intl.PluralRules(t.lang).select(n)] ?? v.other : v);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/* A regular expression for a translation with {placeholders}: each placeholder matches any text. */
const rx = (tpl) => new RegExp("^" + esc(tpl).replace(/\\\{\w+\\\}/g, ".+?") + "$");
const q = JSON.stringify;
const txt = (t, sel) => t.page.eval(`document.querySelector(${q(sel)}).textContent.trim()`);

function solidPng(w, h, [r, g, b]) {
  const CRC = (() => { const tb = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; tb[n] = c >>> 0; } return tb; })();
  const crc32 = (buf) => { let c = 0xffffffff; for (const x of buf) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * (w * 4 + 1) + 1 + x * 4; raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; raw[i + 3] = 255; }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

async function textPdf() {
  const { PDFDocument, StandardFonts } = PDFLib;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([400, 560]).drawText("Hello world", { x: 40, y: 500, size: 14, font });
  doc.addPage([400, 560]).drawImage(await doc.embedPng(makePng(60, 60)), { x: 40, y: 40, width: 200, height: 200 });
  doc.addPage([400, 560]).drawText("Last page", { x: 40, y: 500, size: 14, font });
  return doc.save();
}

export default [
  {
    page: "pdf-to-text",
    name: "reads a PDF with a scanned page: counts and notices in the page language, OCR link to the localized OCR page",
    async run(t) {
      await t.page.setFiles("#drop input[type=file]", [save(t.fixtures, "report.pdf", await textPdf())]);
      await t.page.waitFor(`!document.querySelector("#work").hidden`);
      const st = await t.waitDone();
      const pages3 = fill(plural(t, await t.tx("{n} page|{n} pages"), 3), { n: t.num(3) });
      const read = fill(plural(t, await t.tx("Read {n} page.|Read {n} pages."), 3), { n: t.num(3) });
      const none = fill(plural(t, await t.tx("{n} page has no text.|{n} pages have no text."), 1), { n: t.num(1) });
      t.eq(st.text.trim(), `${read} ${none}`, "status text");
      t.assert((await txt(t, "#finfo")).includes(pages3), "file info has the localized page count: " + await txt(t, "#finfo"));
      t.eq(await txt(t, "#pt-n-pages"), t.num(3), "page count");
      t.eq(await txt(t, "#pt-n-words"), t.num(4), "word count");
      const mark = `--- ${await t.tx("Page {n}").then((s) => fill(s, { n: 2 }))} ---`;
      t.assert((await t.page.eval(`document.querySelector("#pt-out").value`)).includes(mark), "page marks use the translated word for page: " + mark);
      const note = await txt(t, "#pt-ocr");
      const want = fill(plural(t, await t.tx("{n} page has no text of its own. It may be a scan; use OCR for it:|{n} pages have no text of their own. They may be scans; use OCR for them:"), 1), { n: t.num(1) });
      t.assert(note.startsWith(want), `OCR note in the page language: ${note} / ${want}`);
      const href = await t.page.eval(`document.querySelector("#pt-ocr a").getAttribute("href")`);
      t.eq(href, `${PREFIX[t.lang]}/tools/${SLUGS["ocr-pdf"][t.lang].slug}/`, "the OCR link opens the OCR page in this language");
      t.eq(await t.page.eval(`document.querySelector("#pt-rows button").getAttribute("aria-label")`), fill(await t.tx("Copy the text of page {n}"), { n: t.num(1) }), "copy button name");
      t.eq(await t.page.eval(`[...document.querySelectorAll("#pt-rows tr")].map((r) => r.children[3].textContent.trim())[1]`), await t.tx("No text"), "no-text cell");
      const dl = await t.dl("#pt-dl");
      t.eq(dl.name, "report.txt", "download name");
      await t.shot("done", 375);
    },
  },
  {
    page: "sign-pdf",
    name: "types a signature and signs: page counter, date and messages in the page language",
    async run(t) {
      await t.page.setFiles("#drop input[type=file]", [save(t.fixtures, "contract.pdf", await makePdf(3))]);
      await t.page.waitFor(`!document.querySelector("#work").hidden && !!document.querySelector("#sg-stage canvas.sg-view")`);
      t.eq(await txt(t, "#sg-of"), fill(await t.tx("of {n}"), { n: t.num(3) }), "page counter");
      t.eq(await t.page.eval(`document.querySelector("#sg-date").value`), new Intl.DateTimeFormat(t.lang, { dateStyle: "medium" }).format(new Date()), "the default date is written the way this language writes dates");
      t.eq(await txt(t, "#sg-w-v"), new Intl.NumberFormat(t.lang, { style: "percent", maximumFractionDigits: 0 }).format(0.3), "percentages follow the locale");
      await t.page.click('input[name=sg-mode][value=type]');
      await t.page.type("#sg-text", "Ada Lovelace");
      await t.page.waitFor(`!document.querySelector("#go").disabled`);
      await t.page.click("#sg-date-on");
      await t.page.click("#go");
      const st = await t.waitDone();
      t.eq(st.text.trim(), fill(plural(t, await t.tx("Signature added to {n} page.|Signature added to {n} pages."), 1), { n: t.num(1) }), "done message");
      const { name } = await t.dl();
      t.eq(name, "contract-signed.pdf", "file name");
      await t.page.click('input[name=sg-mode][value=draw]');
      await t.shot("done", 375);
    },
  },
  {
    page: "image-to-webp",
    name: "converts two images: summary, per-file comparison and total in the page language",
    async run(t) {
      const a = save(t.fixtures, "a.png", makePng(300, 200));
      const b = save(t.fixtures, "b.png", makePng(240, 160, { alpha: true }));
      await t.page.setFiles("#drop input[type=file]", [a, b]);
      await t.page.waitFor(`document.querySelectorAll("#files > li").length === 2 && !document.querySelector("#go").disabled`);
      const two = fill(plural(t, await t.tx("{n} image|{n} images"), 2), { n: t.num(2) });
      t.assert((await txt(t, "#summary")).startsWith(two), "summary has the localized count: " + await txt(t, "#summary"));
      await t.page.setValue("#quality", "70");
      t.eq(await txt(t, "#quality-out"), "70", "quality read-out");
      await t.page.click("#go");
      await t.waitDone();
      const keys = ["{before} → {after} · {pct}% smaller", "{before} → {after} · {pct}% larger", "{before} → {after} · same size"];
      const patterns = await Promise.all(keys.map(async (k) => rx(await t.tx(k))));
      const notes = await t.page.eval(`[...document.querySelectorAll("#result .dl li .dl__size")].map((e) => e.textContent.trim()).filter((s) => s.includes("→"))`);
      t.eq(notes.length, 2, "a comparison per file");
      for (const n of notes) t.assert(patterns.some((p) => p.test(n)), "per-file note comes from the language table: " + n);
      // the page ends the total line like a sentence when the translation does not (a full stop, or a danda in Hindi)
      const bare = (s) => s.replace(/[.。।]$/, "");
      const total = bare(await txt(t, "#result .result__note"));
      const totalPatterns = await Promise.all(keys.map(async (k) => rx(bare(fill(await t.tx("Total: {change}"), { change: await t.tx(k) })))));
      t.assert(totalPatterns.some((p) => p.test(total)), "total line in the page language: " + total);
      t.assert((await txt(t, "#status")).length > 0, "done message shown");
      await t.shot("done", 375);
    },
  },
  {
    page: "gif-maker",
    name: "makes a GIF: summary, preview button, progress and result in the page language",
    async run(t) {
      const files = [[200, 100, [255, 0, 0]], [100, 200, [0, 255, 0]], [200, 100, [0, 0, 255]]].map(([w, h, c], i) => save(t.fixtures, `${i + 1}.png`, solidPng(w, h, c)));
      await t.page.setFiles("#drop input[type=file]", files);
      await t.page.waitFor(`document.querySelectorAll("#files > li").length === 3`);
      const three = fill(plural(t, await t.tx("{n} image · {size} px|{n} images · {size} px"), 3), { n: t.num(3), size: "200 × 100" });
      t.eq((await txt(t, "#summary")).replace(/\s+/g, " "), three.replace(/\s+/g, " "), "summary");
      t.eq(await txt(t, "#gm-play"), await t.tx("Pause preview"), "pause button");
      await t.page.click("#gm-play");
      t.eq(await txt(t, "#gm-play"), await t.tx("Play preview"), "play button");
      t.eq(await t.page.eval(`document.querySelector("#files li:nth-child(2) [data-act=up]").getAttribute("aria-label")`), fill(await t.tx("Move {name} up"), { name: "2.png" }), "move button name");
      await t.page.setValue("#gm-delay", "100");
      await t.page.click("#go");
      const st = await t.waitDone();
      t.eq(st.text.trim(), fill(plural(t, await t.tx("Made a GIF from {n} frame.|Made a GIF from {n} frames."), 3), { n: t.num(3) }), "done message");
      const note = await txt(t, "#result .result__head");
      const want = fill(plural(t, await t.tx("{size} px · {n} frame · {seconds} s|{size} px · {n} frames · {seconds} s"), 3), { size: "200 × 100", n: t.num(3), seconds: t.num(0.3, { maximumFractionDigits: 1 }) });
      t.assert(note.replace(/\s+/g, " ").includes(want.replace(/\s+/g, " ")), `result note in the page language: ${note} / ${want}`);
      t.eq(await t.page.eval(`document.querySelector("#result img").getAttribute("alt")`), await t.tx("The finished animated GIF"), "alt text of the result");
      await t.shot("done", 375);
    },
  },
  {
    page: "heic-to-jpg",
    name: "converts a HEIC photo and reports a file it cannot read, in the page language",
    async run(t) {
      const heic = (name) => Buffer.from(readFileSync(new URL(`../heic-fixtures/${name}`, import.meta.url)));
      await t.page.setFiles("#drop input[type=file]", [save(t.fixtures, "photo.heic", heic("photo-q85.heic"))]);
      await t.page.waitFor(`document.querySelectorAll("#files > li").length === 1 && !document.querySelector("#go").disabled`);
      const one = fill(plural(t, await t.tx("{n} image|{n} images"), 1), { n: t.num(1) });
      t.assert((await txt(t, "#summary")).startsWith(one), "summary has the localized count: " + await txt(t, "#summary"));
      await t.page.click("#go");
      const st = await t.waitDone();
      t.eq(st.text.trim(), fill(plural(t, await t.tx("Converted {n} photo to JPG.|Converted {n} photos to JPG."), 1), { n: t.num(1) }), "done message");
      const head = await txt(t, "#result .result__head");
      t.assert(head.includes(fill(await t.tx("{size} px"), { size: "96 × 64" })), "size note in the page language: " + head);
      const { name } = await t.dl();
      t.eq(name, "photo.jpg", "file name");
      await t.page.click("#clear");
      await t.page.setFiles("#drop input[type=file]", [save(t.fixtures, "lossless.heic", heic("lossless.heic"))]);
      await t.page.waitFor(`document.querySelectorAll("#files > li").length === 1 && !document.querySelector("#go").disabled`);
      await t.page.click("#go");
      t.eq((await t.waitError()).trim(), fill(await t.tx("\"{name}\" couldn't be converted. It may be damaged, or use a kind of HEIC this tool can't read, such as 10-bit or lossless."), { name: "lossless.heic" }), "unreadable file message");
      await t.page.click("#clear");
      await t.page.setFiles("#drop input[type=file]", [save(t.fixtures, "notes.txt", Buffer.from("hello"))]);
      t.eq((await t.waitError()).trim(), fill(await t.tx("\"{name}\" doesn't look like a HEIC photo. HEIC files end in .heic or .heif and come from iPhones and some Android phones."), { name: "notes.txt" }), "not a HEIC photo message");
      await t.shot("done", 375);
    },
  },
];
