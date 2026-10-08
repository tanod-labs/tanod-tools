// Code formatters: SQL, XML, HTML, CSS minifier, YAML to JSON, JSON to YAML.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;

/* Put text in the input and wait for the debounce, the lazy library load and the result. */
async function feed(t, text) {
  await t.page.setValue("#f-in", text);
  await sleep(450);
  await t.page.waitFor(`${q("#status")}.dataset.state !== "working"`);
  return state(t);
}
/* Change an option (click a radio or checkbox, or set a select) and wait for the re-run. */
async function pick(t, sel, value) {
  if (value === undefined) await t.page.click(sel);
  else await t.page.setValue(sel, value);
  await sleep(150);
  await t.page.waitFor(`${q("#status")}.dataset.state !== "working"`);
}
const out = (t) => t.page.eval(`${q("#f-out")}.textContent`);
const state = (t) => t.page.eval(`${q("#status")}.dataset.state`);
const statusText = (t) => t.page.eval(`${q("#status")}.textContent`);
const errBox = (t) => t.page.eval(`(() => { const e = ${q("#f-err")}; return e.hidden ? null : {text: e.textContent, line: e.dataset.line, col: e.dataset.col}; })()`);
const noteText = (t) => t.page.eval(`(() => { const e = ${q("#f-note")}; return e.hidden ? null : e.textContent; })()`);
const collapse = (s) => s.replace(/\s+/g, " ").trim();
const stat = (t, id) => t.page.eval(`${q(id)}.textContent`);

async function shots(t, text) {
  await t.page.click("#f-sample");
  await sleep(450);
  await t.page.waitFor(`${q("#status")}.dataset.state === "done"`);
  await t.shot("done", 375);
  await t.shot("done", 1280);
}

/* --------------------------------------------------------------------- XML canonical tree, computed in the page
   with DOMParser (not with the page's own formatter code): whitespace-only text nodes are ignored. */
const CANON = `(() => {
  const canon = (xml) => {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) return "PARSE ERROR";
    const kids = (n) => Array.from(n.childNodes, walk).join("");
    const walk = (n) => {
      switch (n.nodeType) {
        case 1: return "<" + n.nodeName + " " + Array.from(n.attributes, (a) => a.name + "=" + JSON.stringify(a.value)).sort().join(" ") + ">" + kids(n) + "</>";
        case 3: return /^[ \\t\\r\\n]*$/.test(n.data) ? "" : "T:" + JSON.stringify(n.data);
        case 4: return "C:" + JSON.stringify(n.data);
        case 7: return "?" + n.target + " " + n.data + ";";
        case 8: return "!" + JSON.stringify(n.data) + ";";
        case 10: return "D:" + n.name + ";";
        default: return kids(n);
      }
    };
    return walk(doc);
  };
  return canon;
})()`;
const canonOf = (t, xml) => t.page.eval(`(${CANON})(${JSON.stringify(xml)})`);

/* --------------------------------------------------------------------- CSS: the browser's own reading of a stylesheet */
/* Chrome keeps some values verbatim (var(), custom properties, @supports conditions), so for those compare with
   insignificant whitespace removed outside strings, and compare every selector exactly. */
const sheetLoose = (t, css) => t.page.eval(`(() => {
  const s = new CSSStyleSheet(); s.replaceSync(${JSON.stringify(css)});
  const loose = (x) => x.split(/("(?:[^"\\\\]|\\\\.)*"|'[^']*')/).map((p, i) => (i % 2 ? p : p.replace(/\\s+/g, " ").replace(/ ?([,;:(){}]) ?/g, "$1"))).join("");
  const sels = [];
  const walk = (rules) => { for (const r of rules) { if (r.selectorText !== undefined) sels.push(r.selectorText); if (r.cssRules) walk(r.cssRules); } };
  walk(s.cssRules);
  return { text: loose(Array.from(s.cssRules, (r) => r.cssText).join("\\n")), sels };
})()`);
const sheetOf = (t, css) => t.page.eval(`(() => { const s = new CSSStyleSheet(); s.replaceSync(${JSON.stringify(css)}); return Array.from(s.cssRules, (r) => r.cssText).join("\\n"); })()`);

const XML_DOC = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE note [<!ENTITY co "Acme > Co"><!-- c > -->]><!-- top --><?xml-stylesheet href="a.xsl"?><root xmlns="urn:a" xmlns:x="urn:x"><a b="1>2" c='say "hi"'><x:k/><k2></k2></a><p>Hello <b>big</b> &amp; world</p><pre xml:space="preserve">
  keep   <i>this</i>
</pre><d><![CDATA[a < b]]></d><e>  </e><f>&co;</f></root>`;

const XML_PRETTY = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE note [<!ENTITY co "Acme > Co"><!-- c > -->]>
<!-- top -->
<?xml-stylesheet href="a.xsl"?>
<root xmlns="urn:a" xmlns:x="urn:x">
  <a b="1>2" c='say "hi"'>
    <x:k/>
    <k2></k2>
  </a>
  <p>Hello <b>big</b> &amp; world</p>
  <pre xml:space="preserve">
  keep   <i>this</i>
</pre>
  <d><![CDATA[a < b]]></d>
  <e>  </e>
  <f>&co;</f>
</root>`;

export default [
  /* ===================================================================== SQL */
  {
    page: "sql-formatter",
    name: "library loads lazily; PostgreSQL casts and numbered parameters; keyword case",
    async run(t) {
      t.eq(await t.page.eval(`typeof window.sqlFormatter`), "undefined", "no library before input");
      t.eq(await t.page.eval(`performance.getEntriesByType("resource").some((r) => r.name.includes("vendor/sql-formatter"))`), false, "not requested yet");
      await t.page.setValue("#o-dialect", "postgresql");
      t.eq(await feed(t, "select a::int, b::text as t from x where y = $1 and z = $2 limit 5"), "done", "state");
      t.eq(await t.page.eval(`typeof window.sqlFormatter`), "object", "library after input");
      const o = await out(t);
      t.eq(collapse(o), "SELECT a::int, b::text AS t FROM x WHERE y = $1 AND z = $2 LIMIT 5", "tokens");
      const lines = o.split("\n");
      for (const kw of ["SELECT", "FROM", "WHERE", "LIMIT"]) t.assert(lines.includes(kw), kw + " alone on a line");
      t.assert(lines.includes("  a::int,"), "columns indented two spaces: " + JSON.stringify(lines));
      await t.page.setValue("#o-case", "lower");
      await pick(t, "#o-case", "lower");
      t.eq(collapse(await out(t)), "select a::int, b::text as t from x where y = $1 and z = $2 limit 5", "lower");
      await pick(t, "#o-case", "preserve");
      t.eq(collapse(await out(t)), "select a::int, b::text as t from x where y = $1 and z = $2 limit 5", "preserve (typed lower)");
      await feed(t, "Select a From T Where B = 1");
      t.eq(collapse(await out(t)), "Select a From T Where B = 1", "preserve keeps mixed case");
      await pick(t, "#o-case", "upper");
      t.eq(collapse(await out(t)), "SELECT a FROM T WHERE B = 1", "upper changes keywords, not names");
      t.eq(await stat(t, "#f-s-in"), "27 B", "input size");
    },
  },
  {
    page: "sql-formatter",
    name: "SQL Server brackets and TOP, MySQL backticks, strings keep their text",
    async run(t) {
      await t.page.setValue("#o-dialect", "transactsql");
      await feed(t, "select top 10 [first name], [t].[id] from [dbo].[Users] [t] where [t].[id] > @min and [t].[n] = 'select from'");
      t.eq(collapse(await out(t)), "SELECT TOP 10 [first name], [t].[id] FROM [dbo].[Users] [t] WHERE [t].[id] > @min AND [t].[n] = 'select from'", "tsql");
      await pick(t, "#o-dialect", "mysql");
      await pick(t, "#o-case", "lower");
      await feed(t, "SELECT `Order`.`id`, name FROM `Order` WHERE name = 'SELECT' AND x = ? ORDER BY `id` DESC");
      t.eq(collapse(await out(t)), "select `Order`.`id`, name from `Order` where name = 'SELECT' and x = ? order by `id` desc", "mysql backticks, string untouched");
    },
  },
  {
    page: "sql-formatter",
    name: "two statements, indent 4 and tab, every dialect option works, empty input",
    async run(t) {
      await feed(t, "select 1; select 2");
      const o = await out(t);
      t.eq(o.split("\n"), ["SELECT", "  1;", "", "SELECT", "  2"], "blank line between statements");
      await pick(t, "input[name=indent][value='4']");
      t.eq((await out(t)).split("\n")[1], "    1;", "4 spaces");
      await pick(t, "input[name=indent][value=tab]");
      t.eq((await out(t)).split("\n")[1], "\t1;", "tab");
      const values = await t.page.eval(`Array.from(document.querySelectorAll("#o-dialect option"), (o) => o.value)`);
      t.assert(values.length >= 15, "many dialects");
      for (const v of values) {
        await pick(t, "#o-dialect", v);
        const st = await state(t);
        t.eq(st, "done", "dialect " + v + ": " + (await statusText(t)));
      }
      await pick(t, "#o-dialect", "sqlite");
      await feed(t, "select :name, ?1 from t where a = :id");
      t.eq(collapse(await out(t)), "SELECT :name, ?1 FROM t WHERE a = :id", "named and numbered placeholders");
      await feed(t, "   ");
      t.eq(await state(t), "idle", "blank input is idle");
      t.eq(await t.page.eval(`${q("#f-result")}.hidden`), true, "no result for blank");
    },
  },
  {
    page: "sql-formatter",
    name: "invalid SQL gives a readable error with line and column, not a crash",
    async run(t) {
      await t.page.setValue("#o-dialect", "sql");
      t.eq(await feed(t, "select a,\nb from t where x = ("), "error", "unclosed bracket");
      let s = await statusText(t);
      t.assert(/line 2, column \d+/.test(s), "position in status: " + s);
      t.assert(!/expecting|based on|→/.test(s), "no parser dump: " + s);
      t.assert(s.length < 220, "short message");
      t.eq((await errBox(t)).line, "2", "error line");
      t.assert((await errBox(t)).text.includes("^"), "caret excerpt");
      t.eq(await t.page.eval(`${q("#f-in")}.getAttribute("aria-invalid")`), "true", "aria-invalid");
      t.eq(await t.page.eval(`${q("#f-result")}.hidden`), true, "result hidden");
      t.eq(await feed(t, "select * from t where a = 'unterminated"), "error", "unterminated string");
      s = await statusText(t);
      t.assert(/line 1, column 27/.test(s), "string error position: " + s);
      await feed(t, "select 1");
      t.eq(await state(t), "done", "recovers");
      t.eq(await t.page.eval(`${q("#f-in")}.hasAttribute("aria-invalid")`), false, "aria-invalid cleared");
    },
  },
  {
    page: "sql-formatter",
    name: "sample, copy, download",
    async run(t) {
      await t.shot("empty", 1280);
      await t.page.setValue("#o-dialect", "postgresql");
      await shots(t);
      const o = await out(t);
      t.assert(o.startsWith("SELECT\n"), "sample formatted");
      const dl = await t.dl("#f-dl");
      t.eq(dl.name, "formatted.sql", "file name");
      t.eq(dl.bytes.toString("utf8"), o, "download equals output");
      await t.page.click("#f-clear");
      await sleep(400);
      t.eq(await t.page.eval(`${q("#f-in")}.value`), "", "cleared");
      t.eq(await state(t), "idle", "idle after clear");
    },
  },

  /* ===================================================================== XML */
  {
    page: "xml-formatter",
    name: "pretty prints every construct exactly; minify; all outputs match the input's canonical tree",
    async run(t) {
      t.eq(await feed(t, XML_DOC), "done", await statusText(t));
      t.eq(await out(t), XML_PRETTY, "2-space output");
      const want = await canonOf(t, XML_DOC);
      t.assert(want !== "PARSE ERROR", "input parses");
      t.eq(await canonOf(t, XML_PRETTY), want, "pretty tree equals input tree");
      t.assert(/left exactly as written/.test(await noteText(t)), "note about untouched elements: " + (await noteText(t)));
      // idempotent: formatting the output again changes nothing
      await feed(t, XML_PRETTY);
      t.eq(await out(t), XML_PRETTY, "idempotent");
      await feed(t, XML_DOC);
      await pick(t, "input[name=indent][value='4']");
      const four = await out(t);
      t.assert(four.includes('\n    <a b="1>2" c=\'say "hi"\'>\n        <x:k/>\n'), "4 spaces: " + four.slice(0, 200));
      t.eq(await canonOf(t, four), want, "4-space tree");
      await pick(t, "input[name=indent][value=tab]");
      const tab = await out(t);
      t.assert(tab.includes('\n\t<a b="1>2"') && tab.includes("\n\t\t<x:k/>\n"), "tab indent");
      t.eq(await canonOf(t, tab), want, "tab tree");
      await pick(t, "input[name=indent][value=min]");
      const min = await out(t);
      const expectMin = XML_DOC.replace('<?xml version="1.0" encoding="UTF-8"?>', '<?xml version="1.0" encoding="UTF-8"?>');
      t.eq(min, expectMin, "minify of an already compact document is unchanged");
      t.eq(await canonOf(t, min), want, "minified tree");
    },
  },
  {
    page: "xml-formatter",
    name: "minify removes only whitespace between tags; mixed content and preserve stay untouched",
    async run(t) {
      const src = `<?xml version="1.0"?>\n<list>\n  <item id="1">  one  </item>\n  <item id="2"/>\n  <!-- note -->\n  <para>Some <em>mixed</em>\n   content </para>\n  <code xml:space="preserve">\n   a   b\n   <x/>\n  </code>\n  <empty>\n  </empty>\n</list>\n`;
      await feed(t, src);
      await pick(t, "input[name=indent][value=min]");
      const min = await out(t);
      t.eq(min, `<?xml version="1.0"?><list><item id="1">  one  </item><item id="2"/><!-- note --><para>Some <em>mixed</em>\n   content </para><code xml:space="preserve">\n   a   b\n   <x/>\n  </code><empty>\n  </empty></list>`, "minified");
      t.eq(await canonOf(t, min), await canonOf(t, src), "same tree as the input");
      await pick(t, "input[name=indent][value='2']");
      const pretty = await out(t);
      t.eq(await canonOf(t, pretty), await canonOf(t, src), "pretty tree equals input");
      t.assert(pretty.includes("  <item id=\"1\">  one  </item>\n"), "text-only element kept inline and unchanged");
      t.assert(pretty.includes("  <para>Some <em>mixed</em>\n   content </para>\n"), "mixed content unchanged");
      t.assert(pretty.includes('  <code xml:space="preserve">\n   a   b\n   <x/>\n  </code>\n'), "preserve unchanged");
      t.assert(/2 elements were left exactly as written/.test(await noteText(t)), "note counts them: " + (await noteText(t)));
    },
  },
  {
    page: "xml-formatter",
    name: "attributes with > and quotes, namespaces, prefixes, self-closing, entities stay as written",
    async run(t) {
      const src = `<a:root xmlns:a="urn:a" xmlns:b='urn:b'><a:n t="x>y" u='"q"' v="it's" w="&lt;&#169;"/><b:m  p = "1"  q='2'>&#x41;&amp;&apos;</b:m></a:root>`;
      await feed(t, src);
      t.eq(await out(t), `<a:root xmlns:a="urn:a" xmlns:b='urn:b'>\n  <a:n t="x>y" u='"q"' v="it's" w="&lt;&#169;"/>\n  <b:m  p = "1"  q='2'>&#x41;&amp;&apos;</b:m>\n</a:root>`, "verbatim tags and entities");
      t.eq(await canonOf(t, await out(t)), await canonOf(t, src), "tree");
    },
  },
  {
    page: "xml-formatter",
    name: "errors report line and column from the XML parser",
    async run(t) {
      t.eq(await feed(t, "<a>\n  <b>\n</a>"), "error", "mismatched tag");
      let s = await statusText(t);
      t.assert(/line 3, column \d+/.test(s), "line 3: " + s);
      t.eq((await errBox(t)).line, "3", "error line stored");
      t.assert((await errBox(t)).text.startsWith("3 | </a>"), "excerpt shows the line: " + (await errBox(t)).text);
      t.assert(!/Below is a rendering/.test(s), "no parser boilerplate");
      t.eq(await feed(t, "<a><b></b>"), "error", "unclosed root");
      t.eq(await feed(t, "<a/><b/>"), "error", "two roots");
      t.eq((await errBox(t)).line, "1", "two roots on line 1");
      t.eq(await feed(t, "<a>\n<b x=1/>\n</a>"), "error", "unquoted attribute");
      t.eq((await errBox(t)).line, "2", "unquoted attribute line");
      t.eq(await feed(t, "<p>a&nbsp;b</p>"), "error", "undefined entity");
      t.assert(/nbsp/i.test(await statusText(t)), "names the entity: " + (await statusText(t)));
      t.eq(await feed(t, "just text"), "error", "not xml");
      t.eq(await t.page.eval(`${q("#f-result")}.hidden`), true, "no result after error");
      t.eq(await feed(t, "<a/>"), "done", "recovers");
      t.eq(await out(t), "<a/>", "self-closing root");
    },
  },
  {
    page: "xml-formatter",
    name: "sample, download",
    async run(t) {
      await shots(t);
      const o = await out(t);
      t.assert(o.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<!-- Order feed -->\n<orders xmlns='), "sample");
      t.eq(await canonOf(t, o), await canonOf(t, await t.page.eval(`${q("#f-in")}.value`)), "sample tree preserved");
      const dl = await t.dl("#f-dl");
      t.eq(dl.name, "formatted.xml", "file name");
      t.eq(dl.bytes.toString("utf8"), o, "download");
    },
  },

  /* ===================================================================== HTML */
  {
    page: "html-formatter",
    name: "pre and textarea unchanged, void elements, inline script and style",
    async run(t) {
      t.eq(typeof (await t.page.eval(`window.beautifier`)), "undefined", "lazy");
      const src = `<div><pre>  a\n   b   c</pre><textarea>  x\n  y</textarea><br><img src="a.png"><input name="n"><p>after</p></div>`;
      t.eq(await feed(t, src), "done", await statusText(t));
      const o = await out(t);
      t.assert(o.includes("<pre>  a\n   b   c</pre>"), "pre unchanged: " + JSON.stringify(o));
      t.assert(o.includes("<textarea>  x\n  y</textarea>"), "textarea unchanged");
      const lines = o.split("\n");
      t.eq(lines[0], "<div>", "first line");
      t.eq(lines[lines.length - 1], "</div>", "closing div at column 0");
      const p = lines.find((l) => l.includes("<p>after</p>"));
      t.eq(p, "    <p>after</p>".slice(2), "p at the same level as the br and img (void elements add no indent)");
      // script and style: formatted by default, untouched when the option is off
      const page = `<html><head><style>a{color:red;margin:0}</style></head><body><script>var a=1;if(a){b()}</script></body></html>`;
      await feed(t, page);
      const formatted = await out(t);
      t.assert(formatted.includes("if (a) {") && formatted.includes("color: red;"), "inline js and css formatted: " + formatted);
      await pick(t, "#o-assets");
      const raw = await out(t);
      t.assert(raw.includes("<style>a{color:red;margin:0}</style>") && raw.includes("<script>var a=1;if(a){b()}</script>"), "left alone: " + raw);
    },
  },
  {
    page: "html-formatter",
    name: "unclosed and stray tags do not crash; indent options; wrap",
    async run(t) {
      t.eq(await feed(t, "<div><p>one<p>two<ul><li>a<li>b</div></span><b>bold"), "done", "lenient");
      const o = await out(t);
      for (const w of ["one", "two", "bold"]) t.assert(o.includes(w), "keeps " + w);
      t.eq(await feed(t, "<ul><li>a</li></ul>"), "done", "ok");
      t.eq((await out(t)).split("\n")[1], "  <li>a</li>", "2 spaces");
      await pick(t, "input[name=indent][value='4']");
      t.eq((await out(t)).split("\n")[1], "    <li>a</li>", "4 spaces");
      await pick(t, "input[name=indent][value=tab]");
      t.eq((await out(t)).split("\n")[1], "\t<li>a</li>", "tab");
      const words = Array.from({ length: 60 }, (_, i) => "word" + i).join(" ");
      await feed(t, `<p>${words}</p>`);
      const long = (await out(t)).split("\n").length;
      await pick(t, "#o-wrap", "80");
      const wrapped = (await out(t)).split("\n");
      t.assert(wrapped.length > long, "wrapping adds lines");
      t.assert(wrapped.every((l) => l.length <= 90), "no line far past 80: " + Math.max(...wrapped.map((l) => l.length)));
      t.eq(collapse(wrapped.join(" ")), `<p>${words}</p>`, "same words");
    },
  },
  {
    page: "html-formatter",
    name: "sample, download",
    async run(t) {
      await shots(t);
      const o = await out(t);
      t.assert(o.includes("<pre>  preformatted\n      text stays</pre>"), "sample pre kept");
      t.assert(o.includes("<textarea name=\"t\">  keep\n   this   as typed</textarea>"), "sample textarea kept");
      const dl = await t.dl("#f-dl");
      t.eq(dl.name, "formatted.html", "file name");
      t.eq(dl.bytes.toString("utf8"), o, "download");
    },
  },

  /* ===================================================================== CSS */
  {
    page: "css-minifier",
    name: "minify: exact outputs for the tricky cases",
    async run(t) {
      const cases = [
        ["a { color : red ; margin : 0 auto ; }", "a{color:red;margin:0 auto}", "basics"],
        [".a{width:calc( 100% - 2*var(--g , 8px) );margin:calc(1px + 2px) calc(-1 * 3px);top:min( 1px + 2px , 3px );h:clamp(1rem , 2vw + 1rem , 3rem)}", ".a{width:calc(100% - 2*var(--g,8px));margin:calc(1px + 2px) calc(-1 * 3px);top:min(1px + 2px,3px);h:clamp(1rem,2vw + 1rem,3rem)}", "calc spaces kept"],
        ['a::before{content:"/* not a comment */ } {"}\nb[title=\'a  b }\']{x:y}', 'a::before{content:"/* not a comment */ } {"}b[title=\'a  b }\']{x:y}', "strings"],
        ["a { background : url( 'x y.png' ) no-repeat , url(  \"q.png\"  ) }", "a{background:url('x y.png') no-repeat,url(\"q.png\")}", "quoted url()"],
        ["a{background:url( http://x/*y*/z.png )}", "a{background:url(http://x/*y*/z.png)}", "unquoted url with comment-like text"],
        ["a > b + c ~ d e , f{}", "a>b+c~d e,f{}", "combinators and descendant"],
        ["@media screen and (min-width : 600px) and (max-width:900px){ a{b:c} }", "@media screen and (min-width:600px) and (max-width:900px){a{b:c}}", "media query"],
        ["a:is(.a , .b) > c , d:not( .e ){}", "a:is(.a,.b)>c,d:not(.e){}", ":is and :not"],
        ["@import url(\"a.css\") screen ; @import 'b.css';\na{b:c}", "@import url(\"a.css\") screen;@import 'b.css';a{b:c}", "@import"],
        ["/*! (c) 2024 */ /* drop */ a{/* x */b:c}", "/*! (c) 2024 */a{b:c}", "licence comment kept"],
        ["a{color:red !important;margin:0!important}", "a{color:red !important;margin:0!important}", "!important"],
        ["a :hover{x:y}\na:hover{x:y}\n.p{ .c :hover{x:y} &:focus{z:w} }", "a :hover{x:y}a:hover{x:y}.p{.c :hover{x:y}&:focus{z:w}}", "space before a pseudo-class is a combinator"],
        ["a{b:c;;d:e;}", "a{b:c;d:e}", "last and doubled semicolons"],
        [".\\31 23{x:y}\n.a\\ b{x:y}", ".\\31 23{x:y}.a\\ b{x:y}", "escapes"],
        [":root{--a: 1px  2px;--b:calc( 1px + 2px )}", ":root{--a:1px 2px;--b:calc(1px + 2px)}", "custom properties"],
        ["a[ href ^= \"x\" ]{} li:nth-child( 2n + 1 ){x:y}", "a[href ^= \"x\"]{}li:nth-child(2n + 1){x:y}", "attribute and nth"],
        ["@keyframes k { from { a : b } 50% { a : c } to{a:d} }", "@keyframes k{from{a:b}50%{a:c}to{a:d}}", "keyframes"],
        ["@supports (display : grid) and (not (display:inline-grid)){a{b:c}}", "@supports (display:grid) and (not (display:inline-grid)){a{b:c}}", "supports"],
        ["a{margin:-1px -2px;padding:1px +2px;font:12px/1.5 a , b}", "a{margin:-1px -2px;padding:1px +2px;font:12px/1.5 a,b}", "signs and slash untouched"],
        ["a{}", "a{}", "empty rule kept"],
        ["@charset \"utf-8\";a{b:c}", "@charset \"utf-8\";a{b:c}", "charset"],
        ["a{b:c} /* unterminated", "a{b:c}", "unterminated comment"],
      ];
      await feed(t, "x");
      for (const [src, want, label] of cases) {
        await feed(t, src);
        t.eq(await out(t), want, label);
      }
      // without licence comments
      await feed(t, "/*! (c) 2024 */ a{b:c}");
      await pick(t, "#o-licence");
      t.eq(await out(t), "a{b:c}", "licence comment dropped when the option is off");
    },
  },
  {
    page: "css-minifier",
    name: "browser CSSOM reads the original and the minified CSS identically; stats",
    async run(t) {
      const css = `/*! Licence */
@charset "utf-8";
:root { --gap : 8px ;  --list: a ,  b; }
html , body { margin : 0 ; padding:0 }
nav > ul li + li ~ li a:hover::after , nav a :focus-visible { content : "/* x */ } {" ; color : #336699 !important }
.card { width : calc( 100% - 2 * var( --gap , 8px ) ) ; height : clamp( 1rem , 2vw + 1rem , 3rem ) ; background : url( "img/a b.png" ) no-repeat , url( data:image/gif;base64,R0lGODlhAQABAAAAACw= ) }
.a:is( .b , .c ) :not( .d :hover ) , [ data-x = "1" ] , li:nth-child( 2n + 1 ) { margin : -1px +2px ; font : 12px/1.5 "A  B" , serif }
@media screen and ( min-width : 600px ) and ( max-width : 900px ) { .card { float : left } .x > .y { z-index : 1 } }
@supports ( display : grid ) and ( not ( display : inline-grid ) ) { .g { display : grid ; grid-template-columns : repeat( 2 , 1fr ) } }
@font-face { font-family : "A  B" ; src : url( a.woff2 ) format( "woff2" ) , url( a.woff ) format( "woff" ) }
@keyframes k { from { opacity : 0 } 50.5% { opacity : .5 } to { opacity : 1 } }
.p { color : red ; .c :hover { color : blue } &:focus { color : green } }
`;
      await feed(t, css);
      const min = await out(t);
      t.assert(min.length < css.length * 0.9, "meaningfully smaller");
      t.assert(!/\n/.test(min) && !/ [;{},>]|[;,>] [^"]/.test(min.replace(/"[^"]*"/g, '""')), "no line breaks or loose spaces around punctuation: " + min.slice(0, 120));
      const lo = await sheetLoose(t, css), lm = await sheetLoose(t, min);
      t.eq(lm.sels, lo.sels, "every selector is read identically");
      t.assert(lo.sels.length >= 10 && lo.text.length > 400, "the CSSOM check is not trivially empty");
      t.eq(lm.text, lo.text, "CSSOM of the output equals CSSOM of the input (whitespace in verbatim values aside)");
      t.eq(await t.page.eval(`${q("#f-note")}.hidden`), true, "no mismatch warning");
      // stats: bytes in, bytes out, percentage
      const a = Buffer.byteLength(css), b = Buffer.byteLength(min);
      const pct = Math.round(Math.abs(b - a) / a * 1000) / 10;
      t.eq(await stat(t, "#f-s-delta"), "-" + pct + "%", "percent saved");
      t.assert((await stat(t, "#f-s-in")).length > 0 && (await stat(t, "#f-s-out")).length > 0, "sizes shown");
      // beautify keeps the meaning as well, and minifying the beautified text gives the same minified text
      await pick(t, "input[name=mode][value=beautify]");
      const pretty = await out(t);
      t.assert(pretty.includes("\n    ") || pretty.includes("\n  "), "indented");
      const lp = await sheetLoose(t, pretty);
      t.eq(lp.sels, lo.sels, "beautified: selectors identical");
      t.eq(lp.text, lo.text, "CSSOM of beautified equals input");
      await t.page.setValue("#f-in", pretty);
      await pick(t, "input[name=mode][value=min]");
      const again = await out(t);
      t.assert(again.length <= min.length, "minify(beautify(x)) is no longer than minify(x)");
      const la = await sheetLoose(t, again);
      t.eq(la.text, lo.text, "minify(beautify(x)) reads the same as x");
      t.eq(la.sels, lo.sels, "and has the same selectors");
      t.eq(await t.page.eval(`${q("#o-indent-field")}.hidden`), true, "indent hidden in minify mode");
      // exact comparison where Chrome serialises everything itself
      const plain = css.replace(/[^\n]*(var\(|--|@supports)[^\n]*\n/g, "");
      t.assert(plain.length > 300 && !/var\(|--/.test(plain), "plain sample prepared");
      await feed(t, plain);
      t.eq(await sheetOf(t, await out(t)), await sheetOf(t, plain), "literal CSSOM equality on the var-free part");
    },
  },
  {
    page: "css-minifier",
    name: "beautify layout and indent options; download",
    async run(t) {
      await feed(t, "a{color:red;margin:0}b>c{x:y}");
      await pick(t, "input[name=mode][value=beautify]");
      t.eq(await t.page.eval(`${q("#o-licence")}.disabled`), true, "licence option disabled when beautifying");
      t.eq(await out(t), "a {\n  color: red;\n  margin: 0\n}\n\nb>c {\n  x: y\n}".replace("margin: 0\n", "margin: 0\n"), "2 spaces");
      await pick(t, "input[name=indent][value='4']");
      t.assert((await out(t)).includes("\n    color: red;"), "4 spaces");
      await pick(t, "input[name=indent][value=tab]");
      t.assert((await out(t)).includes("\n\tcolor: red;"), "tab");
    },
  },
  {
    page: "css-minifier",
    name: "sample, download",
    async run(t) {
      await shots(t);
      const o = await out(t);
      t.assert(o.startsWith("/*! Example v1.0 | MIT */.card>.title,.card~.note{margin:0 auto;"), "sample minified: " + o.slice(0, 80));
      t.assert(o.includes("@media screen and (min-width:600px){.card:is(.a,.b) a:hover{color:#336699 !important}}"), "media rule");
      t.assert(o.includes('width:calc(100% - 2 * var(--gap,8px))'), "calc");
      const dl = await t.dl("#f-dl");
      t.eq(dl.name, "styles.css", "file name");
      t.eq(dl.bytes.toString("utf8"), o, "download");
    },
  },

  /* ===================================================================== YAML to JSON */
  {
    page: "yaml-to-json",
    name: "anchors, aliases, merge keys, block scalars",
    async run(t) {
      t.eq(await t.page.eval(`performance.getEntriesByType("resource").some((r) => r.name.includes("vendor/js-yaml"))`), false, "library not loaded before input");
      const y = `base: &b {x: 1, y: 2}\nuse: *b\nm:\n  <<: *b\n  y: 3\nlist: &l [1, 2]\nl2: *l\nlit: |\n  a\n   b\n  c\nfold: >\n  d\n  e\n\n  f\nstrip: |-\n  g\nkeep: |+\n  h\n\n`;
      t.eq(await feed(t, y), "done", await statusText(t));
      t.eq(await t.page.eval(`performance.getEntriesByType("resource").some((r) => r.name.includes("vendor/js-yaml"))`), true, "library loaded on first use");
      const v = JSON.parse(await out(t));
      t.eq(v.base, { x: 1, y: 2 }, "anchor");
      t.eq(v.use, { x: 1, y: 2 }, "alias");
      t.eq(v.m, { x: 1, y: 3 }, "merge key, explicit key wins");
      t.eq(v.list, [1, 2], "anchored list");
      t.eq(v.l2, [1, 2], "aliased list");
      t.eq(v.lit, "a\n b\nc\n", "literal block keeps lines and indentation");
      t.eq(v.fold, "d e\nf\n", "folded block joins lines, blank line is a newline");
      t.eq(v.strip, "g", "strip chomping");
      t.eq(v.keep, "h\n\n", "keep chomping");
      t.eq((await out(t)).split("\n")[1], '  "base": {', "default layout is 2 spaces");
    },
  },
  {
    page: "yaml-to-json",
    name: "YAML 1.2 types: yes/no/on/off and dates stay strings; numbers; big integers stay exact",
    async run(t) {
      const y = `a: yes\nb: No\nc: on\nd: OFF\ne: y\nf: true\ng: ~\nh: null\ni: 2001-02-03\nj: 12:30:45\nk: 0x1F\nl: 0o17\nm: 010\nn: 1_000\no: 1.50\np: 1e3\nq: "yes"\nr: 2001-02-03T04:05:06Z`;
      await feed(t, y);
      t.eq(JSON.parse(await out(t)), { a: "yes", b: "No", c: "on", d: "OFF", e: "y", f: true, g: null, h: null, i: "2001-02-03", j: "12:30:45", k: 31, l: 15, m: 10, n: "1_000", o: 1.5, p: 1000, q: "yes", r: "2001-02-03T04:05:06Z" }, "types");
      await feed(t, "a: 12345678901234567890\nb: -9007199254740993\nc: 9007199254740991\nd: 0xFFFFFFFFFFFFFFFFF\ne: 1.5e30");
      const o = await out(t);
      t.assert(o.includes('"a": 12345678901234567890,'), "a exact");
      t.assert(o.includes('"b": -9007199254740993,'), "b exact");
      t.assert(o.includes('"c": 9007199254740991,'), "c exact");
      t.assert(o.includes('"d": ' + String(0xFFFFFFFFFFFFFFFFFn) + ","), "hex exact: " + o);
      t.assert(o.includes('"e": 1.5e+30'), "float as a JS number: " + o);
      await feed(t, "a: .inf\nb: .nan\nc: 1");
      t.eq(JSON.parse(await out(t)), { a: null, b: null, c: 1 }, "non-finite become null");
      t.assert(/2 values of \.inf or \.nan became null/.test(await noteText(t)), "says so: " + (await noteText(t)));
      await feed(t, 'u: "😀 é \\"q\\"\\n"');
      t.assert((await out(t)).includes('"😀 é \\"q\\"\\n"'), "unicode kept, quotes escaped");
    },
  },
  {
    page: "yaml-to-json",
    name: "errors: duplicate key, tab indentation, syntax, unknown tag, comments only",
    async run(t) {
      t.eq(await feed(t, "a: 1\nb: 2\na: 3"), "error", "duplicate key");
      let s = await statusText(t);
      t.assert(/line 3, column \d+/.test(s) && /twice/.test(s), "duplicate key message: " + s);
      t.eq((await errBox(t)).line, "3", "line stored");
      t.eq(await feed(t, "a:\n\tb: 1"), "error", "tab");
      s = await statusText(t);
      t.assert(/line 2/.test(s) && /tab/i.test(s) && /spaces/.test(s), "tab message: " + s);
      t.eq(await feed(t, "ok: 1\nlist: [1, 2\nnext: 3"), "error", "unclosed flow list");
      t.assert(/line \d+, column \d+/.test(await statusText(t)), "syntax error position: " + (await statusText(t)));
      t.eq(await feed(t, "a: !!js/function 'x'"), "error", "unknown tag refused");
      t.eq(await feed(t, "# only a comment\n"), "error", "comments only");
      t.assert(/no YAML document/.test(await statusText(t)), "says so: " + (await statusText(t)));
      t.eq(await t.page.eval(`${q("#f-result")}.hidden`), true, "no result");
      await feed(t, "");
      t.eq(await state(t), "idle", "empty input is idle");
      await feed(t, "  \n  ");
      t.eq(await state(t), "idle", "blank input is idle");
      t.eq(await feed(t, "a: 1"), "done", "recovers");
    },
  },
  {
    page: "yaml-to-json",
    name: "multi-document files become an array",
    async run(t) {
      await feed(t, "a: 1\n---\nb: [x, y]\n---\n- 1\n- 2\n");
      t.eq(JSON.parse(await out(t)), [{ a: 1 }, { b: ["x", "y"] }, [1, 2]], "array of documents");
      t.assert(/3 YAML documents/.test(await noteText(t)), "note: " + (await noteText(t)));
      await feed(t, "---\na: 1\n");
      t.eq(JSON.parse(await out(t)), { a: 1 }, "a leading --- is still one document");
      t.eq(await noteText(t), null, "no note for one document");
      await feed(t, "- a\n- b");
      await pick(t, "input[name=indent][value=min]");
      t.eq(await out(t), '["a","b"]', "minified");
      await pick(t, "input[name=indent][value='4']");
      t.eq(await out(t), '[\n    "a",\n    "b"\n]', "4 spaces");
      await pick(t, "input[name=indent][value=tab]");
      t.eq(await out(t), '[\n\t"a",\n\t"b"\n]', "tab");
    },
  },
  {
    page: "yaml-to-json",
    name: "alias bomb, too many aliases and circular aliases are refused quickly",
    async run(t) {
      // ten levels of ten references each: about 10^10 values if expanded, only 90 aliases
      let y = "l0: &l0 [x, x, x, x, x, x, x, x, x, x]\n";
      for (let i = 1; i <= 9; i++) y += `l${i}: &l${i} [${Array(10).fill("*l" + (i - 1)).join(", ")}]\n`;
      const t0 = Date.now();
      t.eq(await feed(t, y), "error", "bomb");
      t.assert(Date.now() - t0 < 15000, "stopped quickly");
      t.assert(/20 MB/.test(await statusText(t)) && /alias bomb/.test(await statusText(t)), "message: " + (await statusText(t)));
      t.eq(await t.page.eval(`${q("#f-result")}.hidden`), true, "no result");
      const many = "a: &a x\nl: [" + Array(10001).fill("*a").join(",") + "]";
      t.eq(await feed(t, many), "error", "10001 aliases");
      t.assert(/more than 10,000 aliases/.test(await statusText(t)), "alias cap message: " + (await statusText(t)));
      const ok = "a: &a x\nl: [" + Array(5000).fill("*a").join(",") + "]";
      t.eq(await feed(t, ok), "done", "5000 aliases are fine");
      t.eq(JSON.parse(await out(t)).l.length, 5000, "expanded");
      t.eq(await feed(t, "&a [*a]"), "error", "circular");
      t.assert(/refers back/.test(await statusText(t)), "circular message: " + (await statusText(t)));
    },
  },
  {
    page: "yaml-to-json",
    name: "sample, download",
    async run(t) {
      await shots(t);
      const o = await out(t);
      const v = JSON.parse(o);
      delete v.service.id;
      t.eq(v.service, { retries: 3, timeout: 2.5, tags: ["web", "edge"], name: "api", enabled: "yes", started: "2024-05-01", banner: "Line one\nLine two\n", summary: "folded text that joins lines\n" }, "sample content");
      t.assert(o.includes('"id": 12345678901234567890'), "sample id exact");
      const dl = await t.dl("#f-dl");
      t.eq(dl.name, "converted.json", "file name");
      t.eq(dl.bytes.toString("utf8"), o, "download");
    },
  },

  /* ===================================================================== JSON to YAML */
  {
    page: "json-to-yaml",
    name: "tricky strings are quoted so they round-trip (YAML 1.2 and 1.1 readers)",
    async run(t) {
      const tricky = ["yes", "no", "on", "off", "Yes", "NO", "y", "n", "null", "Null", "~", "true", "false", "1.0", "012", "0x1F", "0o7", "0b11", "1e3", "1_000", "+1", "-1", ".inf", "-.inf", ".nan", "2001-02-03", "2001-02-03T04:05:06Z", "12:30", "1:20:30", "", " ", "trailing ", "  lead", "tab\there",
        "- x", "-", "a: b", "key:", ":x", "#c", "a #c", "@at", "`bt", "%p", "*star", "&amp", "!bang", "? q", "| pipe", "> gt", "{brace", "}", "[brk", "]", "'sq", '"dq', "a, b", "<<", "=", "--- doc", "... end",
        "multi\nline", "multi\nline\n", "\n", "\n\nx", "é€😀", "back\\slash", "nul\u0000x", "x\r\ny", "\u00a0nb", "\u2028ls"];
      const obj = { values: tricky, map: Object.fromEntries(tricky.map((v, i) => [v, i])), nested: { deep: [tricky.slice(0, 5), { k: "yes" }] }, nums: [0, -0.5, 1e21, 1e-7, 3.14, 100], misc: [true, false, null, [], {}] };
      const json = JSON.stringify(obj);
      t.eq(await feed(t, json), "done", await statusText(t));
      const yaml = await out(t);
      t.eq(await t.page.eval(`${q("#f-note")}.hidden`), true, "the page's own read-back check passes");
      // independent read-back with the same library, in the page, under YAML 1.2 core and under YAML 1.1
      const loads = await t.page.eval(`(async () => {
        const Y = await import("/tools/vendor/js-yaml/js-yaml.esm.min.mjs");
        const y = ${q("#f-out")}.textContent;
        const key = (v) => JSON.stringify(v);
        return { core: key(Y.load(y, { schema: Y.CORE_SCHEMA })), y11: key(Y.load(y, { schema: Y.YAML11_SCHEMA })), json: key(JSON.parse(${JSON.stringify(json)})) };
      })()`);
      t.eq(JSON.parse(loads.core), JSON.parse(loads.json), "YAML 1.2 read-back equals the JSON");
      t.eq(JSON.parse(loads.y11), JSON.parse(loads.json), "YAML 1.1 read-back equals the JSON");
      for (const must of ["'yes'", "'no'", "'null'", "'1.0'", "'012'", "'0x1F'", "''"]) t.assert(yaml.includes(must), "quoted " + must);
      t.assert(yaml.includes("é€😀"), "unicode written as is, not escaped");
    },
  },
  {
    page: "json-to-yaml",
    name: "layout: multi-line strings, empty containers, nested arrays, top-level scalars",
    async run(t) {
      await feed(t, '{"a":"l1\\nl2\\nl3","b":"l1\\nl2\\n","o":{},"e":[],"m":[[1,2],[3,[4,5]],[]],"s":"plain text"}');
      t.eq(await out(t), "a: |-\n  l1\n  l2\n  l3\nb: |\n  l1\n  l2\no: {}\ne: []\nm:\n  - - 1\n    - 2\n  - - 3\n    - - 4\n      - 5\n  - []\ns: plain text\n", "layout");
      await feed(t, '"hello"');
      t.eq(await out(t), "hello\n", "string");
      await feed(t, "42");
      t.eq(await out(t), "42\n", "number");
      await feed(t, "null");
      t.eq(await out(t), "null\n", "null");
      await feed(t, '"null"');
      t.eq(await out(t), "'null'\n", "the string null is quoted");
      await feed(t, "[]");
      t.eq(await out(t), "[]\n", "empty array");
    },
  },
  {
    page: "json-to-yaml",
    name: "options: indent 4, sort keys (also __proto__), flat lists, wrap; big integers exact",
    async run(t) {
      await feed(t, '{"b":1,"a":{"d":1,"c":2},"arr":[{"z":1,"y":2}]}');
      t.eq(await out(t), "b: 1\na:\n  d: 1\n  c: 2\narr:\n  - z: 1\n    'y': 2\n", "unsorted");
      await pick(t, "#o-sort");
      t.eq(await out(t), "a:\n  c: 2\n  d: 1\narr:\n  - 'y': 2\n    z: 1\nb: 1\n", "sorted at every level, arrays keep order");
      await pick(t, "input[name=indent][value='4']");
      const four = await out(t);
      t.assert(four.split("\n").includes("    c: 2"), "4-space indent: " + JSON.stringify(four));
      await pick(t, "input[name=indent][value='2']");
      await feed(t, '{"__proto__":{"x":1},"a":2,"constructor":3}');
      t.eq(await out(t), "__proto__:\n  x: 1\na: 2\nconstructor: 3\n", "__proto__ is an ordinary key");
      await feed(t, '{"b":1,"2":2,"1":3,"x":0.12345678901234567890}');
      t.eq(await out(t), "'1': 3\n'2': 2\nb: 1\nx: 0.12345678901234568\n", "integer-like keys first; long decimals rounded to a double");
      await feed(t, '{"a":[1,2],"b":{"c":[3]}}');
      await pick(t, "#o-flat");
      t.eq(await out(t), "a:\n- 1\n- 2\nb:\n  c:\n  - 3\n", "list items not indented");
      await pick(t, "#o-flat");
      const longText = Array.from({ length: 40 }, (_, i) => "word" + i).join(" ");
      await feed(t, JSON.stringify({ k: longText }));
      t.eq((await out(t)).trim().split("\n").length, 1, "no wrapping by default");
      await pick(t, "#o-wrap");
      const wrapped = (await out(t)).trim().split("\n");
      t.assert(wrapped.length > 1 && wrapped.every((l) => l.length <= 82), "wrapped at 80: " + wrapped.map((l) => l.length));
      const back = await t.page.eval(`(async () => { const Y = await import("/tools/vendor/js-yaml/js-yaml.esm.min.mjs"); return Y.load(${q("#f-out")}.textContent).k; })()`);
      t.eq(back, longText, "wrapped text reads back identically");
      await feed(t, '{"id":12345678901234567890,"neg":-9007199254740993,"ok":9007199254740991,"f":0.5}');
      const o = await out(t);
      t.assert(o.includes("id: 12345678901234567890\n") && o.includes("neg: -9007199254740993\n") && o.includes("ok: 9007199254740991\n") && o.includes("f: 0.5\n"), "big integers exact: " + o);
    },
  },
  {
    page: "json-to-yaml",
    name: "invalid JSON reports line and column",
    async run(t) {
      t.eq(await feed(t, '{"a": 1,}'), "error", "trailing comma");
      let s = await statusText(t);
      t.assert(/line 1, column 9/.test(s) || /line 1, column 10/.test(s), "position of the closing brace: " + s);
      t.assert(/double quotes|trailing/i.test(s), "hint: " + s);
      t.eq(await feed(t, '{\n  "a": 1,\n  "b": }'), "error", "multi-line");
      t.eq((await errBox(t)).line, "3", "line 3");
      t.eq((await errBox(t)).col, "8", "column 8");
      t.assert((await errBox(t)).text.includes("3 |   \"b\": }"), "excerpt: " + (await errBox(t)).text);
      t.eq(await feed(t, "{'a': 1}"), "error", "single quotes");
      t.eq((await errBox(t)).line, "1", "line 1");
      t.eq((await errBox(t)).col, "2", "column 2");
      t.eq(await feed(t, '[1, 2'), "error", "unexpected end");
      t.assert(/line 1/.test(await statusText(t)), "end position: " + (await statusText(t)));
      t.eq(await feed(t, "// c\n{}"), "error", "comment");
      t.eq((await errBox(t)).line, "1", "comment line");
      t.eq(await t.page.eval(`${q("#f-result")}.hidden`), true, "no result");
      t.eq(await feed(t, "{}"), "done", "recovers");
      t.eq(await out(t), "{}\n", "empty object");
    },
  },
  {
    page: "json-to-yaml",
    name: "sample, download",
    async run(t) {
      await shots(t);
      const o = await out(t);
      t.assert(o.includes("version: '1.0'\nanswer: 'yes'\n") && o.includes("owner: null\n") && o.includes("notes: |-\n  first line\n  second line\n") && o.includes("id: 12345678901234567890\n"), "sample output: " + o);
      const dl = await t.dl("#f-dl");
      t.eq(dl.name, "converted.yaml", "file name");
      t.eq(dl.bytes.toString("utf8"), o, "download");
    },
  },
];
