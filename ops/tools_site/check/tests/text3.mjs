import { save } from "../fixtures.mjs";

const val = (sel) => `document.querySelector(${JSON.stringify(sel)}).value`;
const txt = (sel) => `document.querySelector(${JSON.stringify(sel)}).textContent.trim()`;
const DROP = "#drop input[type=file]";
const J = JSON.stringify;

/* ------------------------------------------------------------------ fixtures */

const CSV_SEMI = "﻿name;note;n\r\n\"Smith; J\";\"He said \"\"hi\"\"\r\nthen left\";007\r\n\r\nLee;;3\r\n";
const CSV_SEMI_ROWS = [
  { name: "Smith; J", note: "He said \"hi\"\nthen left", n: "007" },
  { name: "Lee", note: "", n: "3" },
];

const JSON_IN = [
  { name: "Ana, M", age: 34, address: { city: "Lyon", zip: "69001" }, tags: ["a", "b"] },
  { name: "Ben \"B\"", id: "__BIG__", age: null },
];
const JSON_TEXT = J(JSON_IN, null, 2).replace('"__BIG__"', "12345678901234567890");
const CSV_FLAT = 'name,age,address.city,address.zip,tags,id\n"Ana, M",34,Lyon,69001,"[""a"",""b""]",\n"Ben ""B""",,,,,12345678901234567890\n';

const MD = "# Title\n\nSome **bold** text.\n\n| a | b |\n|---|:-:|\n| 1 | 2 |\n\n- [x] done\n- [ ] todo\n\n```js\nlet x = 1;\n```\n\n~~old~~\n";
const XSS = "<img src=x onerror=alert(1)><script>alert(1)</script>[x](javascript:alert(1))\n\n<a href=\"#\" onclick=\"alert(1)\">c</a>\n\n<style>body{display:none}</style>\n";
const PNG_1PX = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const HTML_IN = '<h1>Title</h1><h2>Sub</h2><p>Some <strong>bold</strong> and <em>it</em> <a href="https://example.com/a">link</a>. <del>gone</del></p>' +
  '<ul><li>one</li><li>two</li></ul><ol><li>first</li></ol><pre><code class="language-js">let x = 1;\n</code></pre>' +
  '<table><thead><tr><th>A</th><th align="right">B</th></tr></thead><tbody><tr><td>1</td><td>x|y</td></tr></tbody></table>' +
  '<p><img src="https://example.com/i.png" alt="pic"></p><script>alert(1)</script><style>p{color:red}</style>';

export default [
  /* ------------------------------------------------------------ CSV to JSON */
  {
    page: "csv-to-json",
    name: "parser handles BOM, CRLF, quoted delimiters, \"\" escapes and embedded newlines",
    async run(t) {
      const r = await t.page.eval(`import("/tools/js/csvcore.js").then((m) => {
        const t = ${J(CSV_SEMI)};
        return { d: m.detectDelimiter(t), p: m.parseCsv(t, ";"), tab: m.detectDelimiter("a\\tb\\tc\\n1\\t2\\t3\\n"), pipe: m.detectDelimiter("a|b\\n1|2\\n"),
          comma: m.detectDelimiter("a,b;c\\n1,2;3\\n4,5;6\\n"), cr: m.parseCsv("a,b\\r1,2\\r", ","), trail: m.parseCsv("a,b,\\n1,2,", ",") };
      })`);
      t.eq(r.d, ";", "semicolon detected");
      t.eq(r.p.rows, [["name", "note", "n"], ["Smith; J", "He said \"hi\"\r\nthen left", "007"], ["Lee", "", "3"]], "rows");
      t.eq(r.p.lines, [1, 2, 5], "starting lines");
      t.eq(r.p.blank, 1, "blank lines skipped");
      t.eq([r.tab, r.pipe, r.comma], ["\t", "|", ","], "tab, pipe, comma detection");
      t.eq(r.cr.rows, [["a", "b"], ["1", "2"]], "old Mac CR line endings");
      t.eq(r.trail.rows, [["a", "b", ""], ["1", "2", ""]], "trailing empty field");
    },
  },
  {
    page: "csv-to-json",
    name: "semicolon file with header converts exactly; download named after the file",
    async run(t) {
      const src = save(t.fixtures, "people.csv", Buffer.from(CSV_SEMI, "utf8"));
      await t.page.setFiles(DROP, [src]);
      await t.page.waitFor(`${val("#out")} !== ""`);
      t.eq(await t.page.eval(val("#out")), J(CSV_SEMI_ROWS, null, 2), "json output");
      t.eq(await t.page.eval(txt("#report")), "2 rows, 3 columns, semicolon delimiter (detected), 1 blank line skipped", "report");
      const { name, bytes } = await t.dl("#dl");
      t.eq(name, "people.json", "download name");
      t.eq(JSON.parse(bytes.toString("utf8")), CSV_SEMI_ROWS, "download content");
      await t.page.setValue("#indent", "min");
      t.eq(await t.page.eval(val("#out")), J(CSV_SEMI_ROWS), "minified");
      await t.page.setValue("#indent", "2");
      await t.shot("done", 375);
      await t.shot("done", 1280);
    },
  },
  {
    page: "csv-to-json",
    name: "type conversion keeps leading zeros and long numbers; headers fixed; uneven rows reported",
    async run(t) {
      await t.page.click("#types");
      await t.page.setValue("#text", "id,zip,price,ok,big,none,neg\n1,02134,9.50,true,12345678901234567890,null,-1e3");
      t.eq(JSON.parse(await t.page.eval(val("#out"))), [{ id: 1, zip: "02134", price: 9.5, ok: true, big: "12345678901234567890", none: null, neg: -1000 }], "typed values");
      const w = await t.page.eval(txt("#warn"));
      t.assert(/leading zero/.test(w) && /15 digits/.test(w), "warnings: " + w);
      await t.page.click("#types");
      await t.page.setValue("#text", "a,a,\n1,2,3");
      t.eq(JSON.parse(await t.page.eval(val("#out"))), [{ a: "1", a_2: "2", column_3: "3" }], "duplicate and empty header names");
      await t.page.setValue("#text", "a,b\n1\n1,2,3");
      t.eq(JSON.parse(await t.page.eval(val("#out"))), [{ a: "1", b: "" }, { a: "1", b: "2", column_3: "3" }], "uneven rows");
      t.assert(/2 rows have a different number of fields than the first row \(2\): line 2 has 1, line 3 has 3/.test(await t.page.eval(txt("#warn"))), "mismatch reported");
      await t.page.click("#header");
      t.eq(JSON.parse(await t.page.eval(val("#out"))), [["a", "b"], ["1"], ["1", "2", "3"]], "arrays without header");
      await t.page.click("#header");
      await t.page.setValue("#text", 'a,b\n"x,1');
      const msg = await t.waitError();
      t.assert(/line 2 is never closed/.test(msg), "unclosed quote message: " + msg);
      t.eq(await t.page.eval(`document.querySelector("#dl").disabled`), true, "download disabled on error");
    },
  },

  /* ------------------------------------------------------------ JSON to CSV */
  {
    page: "json-to-csv",
    name: "array of objects: union of keys, flattening, quoting, exact big numbers",
    async run(t) {
      await t.page.setValue("#text", JSON_TEXT);
      t.eq(await t.page.eval(val("#out")), CSV_FLAT, "flattened csv");
      t.eq(await t.page.eval(txt("#report")), "2 rows from objects, 6 columns", "report");
      await t.page.setValue("#nested", "json");
      t.eq((await t.page.eval(val("#out"))).split("\n")[1], '"Ana, M",34,"{""city"":""Lyon"",""zip"":""69001""}","[""a"",""b""]",', "nested kept as JSON");
      await t.page.setValue("#nested", "flatten");
      await t.page.setValue("#delim", ";");
      t.eq((await t.page.eval(val("#out"))).split("\n")[1], 'Ana, M;34;Lyon;69001;"[""a"",""b""]";', "semicolon: comma needs no quotes");
      await t.page.setValue("#delim", ",");
      await t.page.click("#headrow");
      t.eq((await t.page.eval(val("#out"))).split("\n")[0], '"Ana, M",34,Lyon,69001,"[""a"",""b""]",', "no header row");
      await t.page.click("#headrow");
      await t.page.click("#bom");
      await t.page.click("#crlf");
      const { name, bytes } = await t.dl("#dl");
      t.eq(name, "data.csv", "download name");
      t.eq([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], "BOM");
      t.eq(bytes.subarray(3).toString("utf8"), CSV_FLAT.replace(/\n/g, "\r\n"), "CRLF download content");
      await t.shot("done", 375);
      await t.shot("done", 1280);
    },
  },
  {
    page: "json-to-csv",
    name: "arrays, single object, values; clear errors for invalid or wrong-shaped JSON",
    async run(t) {
      await t.page.setValue("#text", '[["a","b"],[1,"x\\ny"]]');
      t.eq(await t.page.eval(val("#out")), 'a,b\n1,"x\ny"\n', "array of arrays");
      await t.page.setValue("#text", '{"k": "v", "n": {"m": true}}');
      t.eq(await t.page.eval(val("#out")), "k,n.m\nv,true\n", "single object");
      await t.page.setValue("#text", '[1, "two", null]');
      t.eq(await t.page.eval(val("#out")), "value\n1\ntwo\n\n", "plain values");
      await t.page.setValue("#text", '{\n  "a": 1,\n}');
      let msg = await t.waitError();
      t.assert(/^Invalid JSON at line 3, column 1/.test(msg), "line/column: " + msg);
      await t.page.setValue("#text", "42");
      msg = await t.waitError();
      t.assert(/The JSON is a number/.test(msg), "top-level number: " + msg);
      await t.page.setValue("#text", '[{"a":1}, [2]]');
      msg = await t.waitError();
      t.assert(/item 2 is an array/.test(msg), "mixed: " + msg);
      await t.shot("error", 375);
    },
  },
  {
    page: "json-to-csv",
    name: "round trip: JSON to CSV and back through CSV to JSON",
    async run(t) {
      const data = [{ name: "Ana, M", note: "line1\nline2 \"q\"", city: "Lyon" }, { name: "  pad ", note: "", city: "Köln" }];
      await t.page.setValue("#text", J(data));
      const csv = await t.page.eval(val("#out"));
      await t.go("/tools/csv-to-json/");
      await t.page.setValue("#text", csv);
      t.eq(JSON.parse(await t.page.eval(val("#out"))), data, "round trip");
    },
  },

  /* ------------------------------------------------------------ Markdown to HTML */
  {
    page: "markdown-to-html",
    name: "GFM heading, table, task list, code and strikethrough; preview; full document download",
    async run(t) {
      await t.page.setValue("#md", MD);
      await t.page.waitFor(`${val("#out")}.includes("<h1>")`);
      const out = await t.page.eval(val("#out"));
      for (const frag of ["<h1>Title</h1>", "<p>Some <strong>bold</strong> text.</p>", "<table>", "<th>a</th>", '<th align="center">b</th>',
        '<td align="center">2</td>', '<input checked="" disabled="" type="checkbox"> done', '<input disabled="" type="checkbox"> todo',
        '<pre><code class="language-js">let x = 1;\n</code></pre>', "<del>old</del>"]) {
        t.assert(out.includes(frag), "missing " + frag + " in " + out);
      }
      t.assert(!/Removed/.test(await t.page.eval(txt("#report"))), "nothing removed from clean markdown");
      await t.page.mouseClick('input[name="view"][value="preview"]');
      await t.page.waitFor(`!document.querySelector("#preview").hidden && document.querySelector("#out").hidden`);
      t.eq(await t.page.eval(`document.querySelector("#preview h1").textContent`), "Title", "preview heading");
      t.eq(await t.page.eval(`document.querySelectorAll("#preview td").length`), 2, "preview table cells");
      t.eq(await t.page.eval(`[...document.querySelectorAll("#preview input")].map(i => i.checked + "/" + i.disabled)`), ["true/true", "false/true"], "task boxes");
      await t.shot("preview", 375);
      await t.shot("preview", 1280);
      await t.page.mouseClick('input[name="view"][value="code"]');
      await t.page.click("#full");
      await t.page.waitFor(`${val("#out")}.startsWith("<!doctype html>")`);
      const doc = await t.page.eval(val("#out"));
      t.assert(doc.includes("<title>Title</title>") && doc.includes('<meta charset="utf-8">') && doc.trim().endsWith("</html>"), "full document");
      const { name, bytes } = await t.dl("#dl");
      t.eq(name, "document.html", "download name");
      t.eq(bytes.toString("utf8"), doc, "download content");
      await t.page.click("#full");
      await t.page.click("#breaks");
      await t.page.setValue("#md", "a\nb");
      await t.page.waitFor(`${val("#out")}.trim() === "<p>a<br>b</p>"`);
    },
  },
  {
    page: "markdown-to-html",
    name: "script, handlers and javascript: links are removed from output and preview",
    async run(t) {
      await t.page.setValue("#md", XSS);
      await t.page.waitFor(`${txt("#report")}.includes("Removed for safety")`);
      const out = await t.page.eval(val("#out"));
      t.assert(!/onerror|onclick|<script|javascript:/i.test(out), "output is clean: " + out);
      t.assert(/script/.test(await t.page.eval(txt("#report"))) && /onerror/.test(await t.page.eval(txt("#report"))), "report names what was removed");
      await t.page.mouseClick('input[name="view"][value="preview"]');
      await t.page.waitFor(`!document.querySelector("#preview").hidden`);
      const p = await t.page.eval(`(() => { const p = document.querySelector("#preview");
        return { scripts: p.querySelectorAll("script, style").length, handlers: [...p.querySelectorAll("*")].filter(e => [...e.attributes].some(a => /^on/i.test(a.name))).length,
          js: [...p.querySelectorAll("a")].filter(a => /^javascript:/i.test(a.getAttribute("href") || "")).length, imgs: p.querySelectorAll("img").length,
          placeholders: p.querySelectorAll(".md-img").length, bodyShown: getComputedStyle(document.body).display !== "none" }; })()`);
      t.eq(p, { scripts: 0, handlers: 0, js: 0, imgs: 0, placeholders: 1, bodyShown: true }, "preview is inert");
      await t.page.mouseClick("#preview a");
      await new Promise((r) => setTimeout(r, 300));
      t.eq(await t.page.eval("typeof window.__pwned"), "undefined", "no script ran");
    },
  },
  {
    page: "markdown-to-html",
    name: "remote images become placeholders in the preview; data images show",
    async run(t) {
      await t.page.mouseClick('input[name="view"][value="preview"]');
      await t.page.setValue("#md", `![logo](https://example.com/logo.png)\n\n![dot](${PNG_1PX})\n\n<img src="https://example.org/a.png" srcset="https://example.org/b.png 2x" alt="raw">`);
      await t.page.waitFor(`document.querySelectorAll("#preview .md-img").length === 2`);
      const out = await t.page.eval(val("#out"));
      t.assert(out.includes('<img src="https://example.com/logo.png" alt="logo">'), "output keeps the img tag: " + out);
      t.eq(await t.page.eval(`[...document.querySelectorAll("#preview .md-img")].map(e => e.textContent)`), ["Image: logo (https://example.com/logo.png)", "Image: raw (https://example.org/a.png)"], "placeholders");
      t.eq(await t.page.eval(`[...document.querySelectorAll("#preview img")].map(i => i.getAttribute("src").slice(0, 15))`), ["data:image/png;"], "data image rendered");
      await new Promise((r) => setTimeout(r, 300));
      t.eq((t.page.requests || []).filter((r) => /example\.(com|org)/.test(r.url)).length, 0, "no request to the remote image hosts");
    },
  },

  /* ------------------------------------------------------------ HTML to Markdown */
  {
    page: "html-to-markdown",
    name: "headings, inline, lists, code, table and strikethrough convert; nothing loads or runs",
    async run(t) {
      await t.page.setValue("#html", HTML_IN);
      await t.page.waitFor(`${val("#out")} !== ""`);
      const md = await t.page.eval(val("#out"));
      const want = [
        "# Title", "## Sub", "Some **bold** and _it_ [link](https://example.com/a). ~~gone~~",
        "-   one\n-   two", "1.  first", "```js\nlet x = 1;\n```",
        "| A | B |\n| --- | ---: |\n| 1 | x\\|y |", "![pic](https://example.com/i.png)",
      ].join("\n\n");
      t.eq(md, want, "markdown");
      t.eq(await t.page.eval(txt("#report")), `${[...want].length} characters of Markdown, 1 table converted.`, "report");
      await t.page.setValue("#heading", "setext");
      await t.page.setValue("#bullet", "*");
      await t.page.setValue("#code", "indented");
      await t.page.setValue("#em", "*");
      const md2 = await t.page.eval(val("#out"));
      t.assert(md2.startsWith("Title\n=====\n\nSub\n---\n\nSome **bold** and *it*"), "setext + asterisk italics: " + md2.slice(0, 60));
      t.assert(md2.includes("*   one\n*   two") && md2.includes("\n    let x = 1;\n"), "asterisk bullets, indented code");
      await t.page.click("#tables");
      t.assert((await t.page.eval(val("#out"))).includes("<table>"), "tables kept as HTML when off");
      await t.page.click("#tables");
      await new Promise((r) => setTimeout(r, 300));
      t.eq((t.page.requests || []).filter((r) => /example\.com/.test(r.url)).length, 0, "image in the HTML was not fetched");
      t.eq(await t.page.eval("document.querySelectorAll('main img').length"), 0, "user HTML not rendered");
      await t.shot("done", 375);
      await t.shot("done", 1280);
    },
  },
  {
    page: "html-to-markdown",
    name: "merged-cell table kept as HTML; task list; file open and download",
    async run(t) {
      const html = '<ul><li><input type="checkbox" checked> done</li><li><input type="checkbox"> todo</li></ul>' +
        '<table><tr><td colspan="2">wide</td></tr><tr><td>1</td><td>2</td></tr></table>';
      const src = save(t.fixtures, "page.html", Buffer.from(html, "utf8"));
      await t.page.setFiles(DROP, [src]);
      await t.page.waitFor(`${val("#out")} !== ""`);
      const md = await t.page.eval(val("#out"));
      t.assert(md.startsWith("-   [x] done\n-   [ ] todo"), "task list: " + md);
      t.assert(md.includes('<td colspan="2">wide</td>'), "merged table kept as HTML");
      t.assert(/1 table with merged cells kept as HTML/.test(await t.page.eval(txt("#report"))), "report");
      const { name, bytes } = await t.dl("#dl");
      t.eq(name, "page.md", "download name");
      t.eq(bytes.toString("utf8"), md, "download content");
    },
  },
];
