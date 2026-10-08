// One representative functional test per category, run in every language by i18n.mjs. Each checks that the
// action works on the localized page, that the strings it shows come from the page's language, and that numbers
// people read (and type) follow the locale. i18n.mjs adds the string-table and leftover-English checks.
import { readFileSync } from "node:fs";
import { makePdf, makePng, pdfInfo, imageInfo, save } from "../fixtures.mjs";

const GLOSSARY = JSON.parse(readFileSync(new URL("../../i18n/glossary.json", import.meta.url), "utf8")).privacy;
const P = (en, lang) => GLOSSARY[en][lang];
const body = (t) => t.page.eval(`document.body.innerText`);
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
const plural = (t, v, n) => (typeof v === "object" ? v[new Intl.PluralRules(t.lang).select(n)] ?? v.other : v);

export default [
  {
    page: "merge-pdf",
    name: "pdf: merges two PDFs; counts, status and errors in the page language",
    async run(t) {
      const txt = await body(t);
      t.assert(txt.includes(P("Your files never leave your device", t.lang)), "local promise");
      t.assert(txt.includes(P("Opened on this device. Nothing is uploaded.", t.lang)), "drop promise");
      const bad = save(t.fixtures, "notes.txt", Buffer.from("hello"));
      await t.page.setFiles("#drop input[type=file]", [bad]);
      const err = await t.waitError();
      t.eq(err.trim(), fill(await t.tx("\"{name}\" isn't a PDF file."), { name: "notes.txt" }), "non-PDF message");
      const a = save(t.fixtures, "a.pdf", await makePdf(2, { label: "A" }));
      const b = save(t.fixtures, "b.pdf", await makePdf(1200, { label: "B" }));
      await t.page.setFiles("#drop input[type=file]", [a, b]);
      const pages = fill(plural(t, await t.tx("{n} page|{n} pages"), 1202), { n: t.num(1202) });
      await t.page.waitFor(`!document.querySelector("#go").disabled && document.querySelector("#summary").textContent.includes(${JSON.stringify(pages)})`, { timeout: 60000 });
      await t.page.click("#go");
      const st = await t.waitDone(120000);
      t.assert(st.text.includes(t.num(1202)), "done message has the localized page count: " + st.text);
      const { name, bytes } = await t.dl();
      t.eq(name, "merged.pdf", "file name");
      t.eq((await pdfInfo(bytes)).pages, 1202, "page count");
      await t.shot("done", 375);
    },
  },
  {
    page: "compress-image",
    name: "image: compresses a PNG; sizes use the locale's decimal separator",
    async run(t) {
      const src = save(t.fixtures, "big.png", makePng(1200, 800));
      await t.page.setFiles("#drop input[type=file]", [src]);
      await t.page.waitFor(`document.querySelectorAll("#files > li").length === 1 && !document.querySelector("#go").disabled`);
      await t.page.setValue("#colours", "64");
      await t.page.click("#go");
      await t.waitDone();
      const { bytes } = await t.dl();
      t.eq(imageInfo(bytes).format, "png", "png out");
      const shown = await t.page.eval(`document.querySelector("#files").textContent + " " + document.querySelector("#result").textContent`);
      const dec = t.num(1.5).replace(/\d/g, "");
      const unit = t.lang === "fr" ? "Ko|Mo" : "KB|MB";
      t.assert(new RegExp(`\\d\\${dec}\\d+\\s(${unit})`).test(shown), `sizes like 1${dec}23 ${unit}: ${shown.slice(0, 200)}`);
      t.assert(!/\d\.\d+\s(KB|MB)/.test(shown), "no English decimal point in sizes");
      await t.shot("done", 1280);
    },
  },
  {
    page: "word-counter",
    name: "text: counts are grouped for the locale, keyword density in the page language",
    async run(t) {
      const words = Array.from({ length: 1234 }, (_, i) => (i % 3 ? "alpha" : "beta")).join(" ");
      await t.page.setValue("#text", words);
      await t.page.waitFor(`document.querySelector("#c-words").textContent.trim() === ${JSON.stringify(t.num(1234))}`);
      t.eq(await t.text("#bar-words"), t.num(1234), "sticky bar words");
      await t.page.waitFor(`!!document.querySelector("#dens-body th")`);
      const dens = await t.page.eval(`document.querySelector("#dens-body tr td:nth-child(3)").textContent`);
      const dec = t.num(1.5).replace(/\d/g, "");
      t.assert(dens.includes(dec), "density uses the decimal separator: " + dens);
    },
  },
  {
    page: "json-formatter",
    name: "dev: formats JSON byte-identically; syntax errors explained in the page language",
    async run(t) {
      await t.page.setValue("#j-in", '{"b":[1,2],"a":{"x":1.5}}');
      await t.page.waitFor(`!document.querySelector("#j-result").hidden`);
      const out = await t.page.eval(`(document.querySelector("#j-out") || document.querySelector("#j-result textarea, #j-result pre, #j-result code")).textContent || document.querySelector("#j-out").value`);
      t.assert(out.includes('"x": 1.5'), "code output keeps the JSON number format: " + out.slice(0, 80));
      await t.page.setValue("#j-in", '{"a": 1,}');
      const msg = await t.waitError();
      t.assert(!/line 1, column 9/.test(msg), "not the English message: " + msg);
      t.assert(/\b1\b/.test(msg) && /\b9\b/.test(msg), "line and column numbers: " + msg);
    },
  },
  {
    page: "percentage-calculator",
    name: "calc: decimal comma input, grouped output, localized formula",
    async run(t) {
      await t.page.setValue("#p1-a", "12,5");
      await t.page.setValue("#p1-b", "80");
      t.eq(await t.text("#p1-out .pc__val"), "10", "12,5 % of 80");
      await t.page.setValue("#p1-a", "15");
      await t.page.setValue("#p1-b", t.num(1000000));
      t.eq(await t.text("#p1-out .pc__val"), t.num(150000), "grouped input and output");
      await t.page.setValue("#p1-a", "2,5");
      await t.page.setValue("#p1-b", "3");
      t.eq(await t.text("#p1-out .pc__val"), t.num(0.075), "decimal output");
      t.assert((await t.text("#p1-out .pc__formula")).includes(t.num(2.5)), "formula uses the decimal comma");
      await t.page.setValue("#p2-a", "1");
      await t.page.setValue("#p2-b", "3");
      t.assert((await t.text("#p2-out .pc__val")).startsWith(t.num(33.3333, { maximumFractionDigits: 4 })), "1 of 3 as a percentage");
      await t.page.setValue("#p1-a", "abc");
      t.eq(await t.page.eval(`document.querySelector("#p1-a").getAttribute("aria-invalid")`), "true", "bad input flagged");
      await t.shot("filled", 375);
    },
  },
  {
    page: "password-generator",
    name: "util: generates passwords; strength and entropy text in the page language",
    async run(t) {
      await t.page.setValue("#pw-lennum", "32");
      await t.page.setValue("#pw-count", "5");
      await t.page.waitFor(`document.querySelectorAll("#pw-list [data-pw]").length === 5`);
      const pws = await t.page.eval(`[...document.querySelectorAll("#pw-list [data-pw]")].map(e => e.textContent)`);
      t.assert(pws.every((p) => p.length === 32), "length 32");
      t.assert(!/\bbits\b.*\bguesses\b/i.test(await t.text("#pw-bits")), "entropy line is translated");
    },
  },
  {
    page: "compress-pdf",
    name: "server: honest server wording, localized quota, job runs against the mock",
    async run(t) {
      await t.page.waitFor(`!!window.turnstile && /10/.test(document.querySelector("#quota").textContent)`);
      const txt = await body(t);
      t.assert(!txt.includes(P("Your files never leave your device", t.lang)), "no 'never leave your device' on a server page");
      t.assert(!txt.includes(P("Opened on this device. Nothing is uploaded.", t.lang)), "no 'nothing is uploaded' on a server page");
      t.assert(txt.includes(P("Processed on our server, then deleted", t.lang)), "server tag");
      t.assert(txt.includes(P("Sent to our server for this one job, then deleted. Never stored or logged.", t.lang)), "drop line");
      const q0 = await t.text("#quota");
      t.assert(!/free server jobs left/.test(q0), "quota line translated: " + q0);
      const f = save(t.fixtures, "report.pdf", Buffer.concat([Buffer.from(await makePdf(3, { label: "Big" })), Buffer.from("%" + "x".repeat(200000) + "\n")]));
      await t.page.setFiles("#drop input[type=file]", [f]);
      await t.page.waitFor(`!document.querySelector("#work").hidden && !document.querySelector("#go").disabled`);
      await t.page.click("#go");
      await t.waitDone();
      const { name, bytes } = await t.dl();
      t.eq(name, "report-compressed.pdf", "file name");
      t.eq((await pdfInfo(bytes)).pages, 1, "a PDF came back");
      t.assert(/\b9\b/.test(await t.text("#quota")), "quota went down to 9");
    },
  },
  {
    page: "index",
    name: "index: search matches localized and English words, count text in the page language",
    async run(t) {
      const name = await t.page.eval(`document.querySelector(".stops li a .stops__name").firstChild.textContent`);
      await t.page.type("#find", name.split(" ")[0].toLowerCase());
      await t.page.waitFor(`document.querySelector("#find-count").textContent.length > 0`);
      const shown = await t.page.eval(`document.querySelectorAll(".stops li:not([hidden])").length`);
      t.assert(shown >= 1, "localized word finds tools");
      t.assert(!/tools? match/.test(await t.text("#find-count")), "count text translated");
      await t.page.type("#find", "merge");
      await t.page.waitFor(`document.querySelectorAll(".stops li:not([hidden])").length >= 1`);
      await t.page.type("#find", "zzzzqqq");
      await t.page.waitFor(`document.querySelectorAll(".stops li:not([hidden])").length === 0`);
      t.assert(!/No tool matches/.test(await t.text("#find-count")), "empty text translated");
    },
  },
];
