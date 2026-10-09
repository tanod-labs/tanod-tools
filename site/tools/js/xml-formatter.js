import { initFormatter, FmtError, $, $$ } from "./fmtcore.js?v=11";
import { tx, txn } from "./core.js?v=11";

/* ---------------------------------------------------------------- tokenizer
   Splits the source into tokens that keep their exact text, so nothing (entities, quotes, attribute order,
   spacing inside tags) is ever re-serialised. The input is validated by the browser's XML parser first. */

const WS_ONLY = /^[ \t\r\n]*$/;

function tokenize(src) {
  const toks = [];
  const n = src.length;
  let i = 0;
  const push = (k, end, extra) => { toks.push({ k, s: src.slice(i, end), a: i, z: end, ...extra }); i = end; };
  while (i < n) {
    if (src[i] !== "<") { let j = src.indexOf("<", i); if (j < 0) j = n; push("text", j); continue; }
    if (src.startsWith("<!--", i)) { const j = src.indexOf("-->", i + 4); push("comment", j < 0 ? n : j + 3); continue; }
    if (src.startsWith("<![CDATA[", i)) { const j = src.indexOf("]]>", i + 9); push("cdata", j < 0 ? n : j + 3); continue; }
    if (src.startsWith("<?", i)) { const j = src.indexOf("?>", i + 2); push("pi", j < 0 ? n : j + 2); continue; }
    if (src.startsWith("<!", i)) {
      // DOCTYPE (or similar): quotes, comments and an [internal subset] may contain ">"
      let j = i + 2, depth = 0;
      while (j < n) {
        const c = src[j];
        if (c === '"' || c === "'") { const q = src.indexOf(c, j + 1); j = q < 0 ? n : q + 1; continue; }
        if (src.startsWith("<!--", j)) { const q = src.indexOf("-->", j + 4); j = q < 0 ? n : q + 3; continue; }
        if (c === "[") depth++;
        else if (c === "]") depth--;
        else if (c === ">" && depth <= 0) { j++; break; }
        j++;
      }
      push("doctype", Math.min(j, n));
      continue;
    }
    if (src.startsWith("</", i)) { const j = src.indexOf(">", i); push("end", j < 0 ? n : j + 1); continue; }
    // start tag or empty-element tag: a ">" inside a quoted attribute value does not end it
    let j = i + 1;
    while (j < n) {
      const c = src[j];
      if (c === '"' || c === "'") { const q = src.indexOf(c, j + 1); j = q < 0 ? n : q + 1; continue; }
      if (c === ">") break;
      j++;
    }
    const end = Math.min(j + 1, n);
    const raw = src.slice(i, end);
    const nm = /^<([^\s/>]+)/.exec(raw);
    const name = nm ? nm[1] : "";
    let preserve = false;
    const re = /([^\s=/>]+)\s*=\s*("[^"]*"|'[^']*')/g;
    re.lastIndex = name.length + 1;
    for (let m; (m = re.exec(raw)); ) if (m[1] === "xml:space" && m[2].slice(1, -1) === "preserve") preserve = true;
    push(raw.endsWith("/>") ? "empty" : "start", end, { name, preserve });
  }
  return toks;
}

/* Tokens to a tree. Elements remember where they start and end in the source, so untouched content can be
   copied out verbatim. */
function build(toks) {
  const root = { k: "root", children: [] };
  const stack = [root];
  for (const t of toks) {
    const top = stack[stack.length - 1];
    if (t.k === "start") {
      const el = { k: "el", name: t.name, preserve: t.preserve, a: t.a, z: t.z, open: t.s, close: "", children: [] };
      top.children.push(el);
      stack.push(el);
    } else if (t.k === "empty") {
      top.children.push({ k: "el", name: t.name, preserve: t.preserve, a: t.a, z: t.z, open: t.s, close: "", children: [], selfClosing: true });
    } else if (t.k === "end") {
      if (stack.length < 2) throw new Error("unbalanced tags");
      const el = stack.pop();
      el.close = t.s;
      el.z = t.z;
    } else top.children.push(t);
  }
  if (stack.length !== 1) throw new Error("unbalanced tags");
  return root;
}

/* Format or minify. Returns {out, kept}: kept counts elements left exactly as written (mixed content,
   xml:space="preserve", text-only elements are copied verbatim too but not counted). */
export function formatXml(src, { unit = "  ", minify = false } = {}) {
  const tree = build(tokenize(src));
  let kept = 0;
  const nl = minify ? "" : "\n";

  function lines(node, level, out) {
    const pad = minify ? "" : unit.repeat(level);
    if (node.k !== "el") { out.push(pad + node.s); return; }
    const kids = node.children;
    const hasText = kids.some((c) => c.k === "cdata" || (c.k === "text" && !WS_ONLY.test(c.s)));
    const hasMarkup = kids.some((c) => c.k === "el" || c.k === "comment" || c.k === "pi");
    if (node.preserve || kids.length === 0 || hasText || !hasMarkup) {
      if (node.preserve || (hasText && hasMarkup)) kept++;
      out.push(pad + src.slice(node.a, node.z));
      return;
    }
    // element-only content: whitespace-only text between the children is formatting, not data
    if (minify) {
      const inner = [];
      for (const c of kids) if (c.k !== "text") lines(c, level + 1, inner);
      out.push(node.open + inner.join("") + node.close);
      return;
    }
    out.push(pad + node.open);
    for (const c of kids) if (c.k !== "text") lines(c, level + 1, out);
    out.push(pad + node.close);
  }

  const out = [];
  for (const c of tree.children) if (!(c.k === "text" && WS_ONLY.test(c.s))) lines(c, 0, out);
  return { out: out.join(nl), kept };
}

/* ---------------------------------------------------------------- validation */

/* Reads the parser's error out of the <parsererror> element (Chromium/Safari and Firefox word it differently). */
export function xmlProblem(src) {
  const doc = new DOMParser().parseFromString(src, "application/xml");
  const pe = doc.getElementsByTagName("parsererror")[0];
  if (!pe) return null;
  const t = pe.textContent || "";
  let m = /error on line (\d+) at column (\d+):\s*([\s\S]*?)(?:Below is a rendering|$)/.exec(t);
  if (m) return { line: Number(m[1]), col: Number(m[2]), msg: m[3].trim() };
  m = /XML Parsing Error:\s*([^\n]*)/.exec(t);
  const p = /Line Number (\d+), Column (\d+)/.exec(t);
  return { line: p ? Number(p[1]) : 1, col: p ? Number(p[2]) : 1, msg: m ? m[1].trim() : tx("the document is not well-formed") };
}

/* ---------------------------------------------------------------- page */

if (document.querySelector("#f-in")) {
  const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Order feed -->
<orders xmlns="urn:example:orders" xmlns:x="urn:example:extra"><order id="1042" status="paid" note="amount &gt; 100"><customer><name>Ana Reyes</name><email>ana@example.com</email></customer>
<items><item sku="A-1" qty="2"/><item sku="B-7" qty="1"><x:gift>true</x:gift></item></items>
<comment>Please <b>ring</b> the bell &amp; wait.</comment><raw><![CDATA[1 < 2 && 3 > 2]]></raw></order></orders>`;
  initFormatter({
    label: "XML",
    triggers: $$("input[name='indent']"),
    sample: SAMPLE,
    filename: "formatted.xml",
    mime: "application/xml",
    done: (r) => (r.mode === "min" ? tx("Valid XML, minified.") : tx("Valid XML, formatted.")),
    format(text) {
      const bad = xmlProblem(text);
      if (bad) throw new FmtError(bad.msg.replace(/\s+/g, " ").replace(/\.?$/, "."), { line: bad.line, col: bad.col });
      const v = $("input[name='indent']:checked").value;
      const r = formatXml(text.replace(/^﻿/, ""), { unit: v === "tab" ? "\t" : v === "min" ? "" : " ".repeat(Number(v)), minify: v === "min" });
      return {
        out: r.out,
        mode: v === "min" ? "min" : "fmt",
        note: r.kept ? txn(r.kept, "{n} element was left exactly as written because it mixes text with tags or has xml:space=\"preserve\".", "{n} elements were left exactly as written because they mix text with tags or have xml:space=\"preserve\".") : "",
      };
    },
  });
}
