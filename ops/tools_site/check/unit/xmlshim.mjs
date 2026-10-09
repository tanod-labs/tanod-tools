// A small XML parser for the Node unit tests only. The site itself parses with the browser's DOMParser; Node has none, so the
// tests give the e-invoice readers this stand-in (same element API: localName, namespaceURI, children, textContent,
// getAttribute). check/tests/einvoice.mjs then runs the same fixtures through the real DOMParser in Chromium and compares.
// Namespaces, prefixes, attributes, CDATA, comments, processing instructions and the five named plus numeric entities are
// handled. A DOCTYPE is an error here (the readers refuse it first anyway).

class El {
  constructor(qname, ns) {
    this.nodeName = qname;
    this.localName = qname.includes(":") ? qname.slice(qname.indexOf(":") + 1) : qname;
    this.namespaceURI = ns || null;
    this.attrs = new Map();
    this.children = [];
    this.parts = [];
  }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  get textContent() {
    let s = "";
    for (const p of this.parts) s += typeof p === "string" ? p : p.textContent;
    return s;
  }
}

const ENT = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
const decode = (s, fail) => s.replace(/&(#x[0-9a-fA-F]+|#\d+|[A-Za-z]+);/g, (m, e) => {
  if (e[0] === "#") return String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  if (e in ENT) return ENT[e];
  return fail(`unknown entity &${e};`);
});

export function parseXmlShim(src) {
  let i = 0;
  const n = src.length;
  const fail = (m) => { throw new Error(`xml shim: ${m} (offset ${i})`); };
  const scopes = [{ xml: "http://www.w3.org/XML/1998/namespace" }];
  const stack = [];
  let root = null;
  while (i < n) {
    if (src[i] !== "<") {
      const j = src.indexOf("<", i);
      const end = j < 0 ? n : j;
      const raw = src.slice(i, end);
      if (stack.length) stack[stack.length - 1].parts.push(decode(raw, fail));
      else if (raw.trim()) fail("text outside the root element");
      i = end;
      continue;
    }
    if (src.startsWith("<!--", i)) { const j = src.indexOf("-->", i + 4); if (j < 0) fail("unterminated comment"); i = j + 3; continue; }
    if (src.startsWith("<![CDATA[", i)) {
      const j = src.indexOf("]]>", i + 9);
      if (j < 0) fail("unterminated CDATA");
      if (!stack.length) fail("CDATA outside the root element");
      stack[stack.length - 1].parts.push(src.slice(i + 9, j));
      i = j + 3;
      continue;
    }
    if (src.startsWith("<?", i)) { const j = src.indexOf("?>", i + 2); if (j < 0) fail("unterminated processing instruction"); i = j + 2; continue; }
    if (src.startsWith("<!", i)) fail("DOCTYPE or other declaration");
    if (src[i + 1] === "/") {
      const j = src.indexOf(">", i);
      if (j < 0) fail("unterminated end tag");
      const name = src.slice(i + 2, j).trim();
      const top = stack.pop();
      if (!top || top.nodeName !== name) fail(`end tag </${name}> does not match <${top ? top.nodeName : "nothing"}>`);
      scopes.pop();
      i = j + 1;
      continue;
    }
    // start tag
    let j = i + 1;
    while (j < n && !/[\s/>]/.test(src[j])) j++;
    const qname = src.slice(i + 1, j);
    if (!qname) fail("empty tag name");
    const attrs = [];
    for (;;) {
      while (j < n && /\s/.test(src[j])) j++;
      if (src[j] === ">" || src[j] === "/") break;
      const k = src.indexOf("=", j);
      if (k < 0) fail("attribute without value");
      const name = src.slice(j, k).trim();
      let q = k + 1;
      while (/\s/.test(src[q])) q++;
      const quote = src[q];
      if (quote !== '"' && quote !== "'") fail("unquoted attribute");
      const e = src.indexOf(quote, q + 1);
      if (e < 0) fail("unterminated attribute");
      attrs.push([name, decode(src.slice(q + 1, e), fail)]);
      j = e + 1;
    }
    const scope = Object.assign({}, scopes[scopes.length - 1]);
    for (const [k, v] of attrs) {
      if (k === "xmlns") scope[""] = v;
      else if (k.startsWith("xmlns:")) scope[k.slice(6)] = v;
    }
    const prefix = qname.includes(":") ? qname.slice(0, qname.indexOf(":")) : "";
    if (prefix && !(prefix in scope)) fail(`undeclared prefix ${prefix}`);
    const el = new El(qname, scope[prefix] || null);
    for (const [k, v] of attrs) el.attrs.set(k, v);
    if (stack.length) { const parent = stack[stack.length - 1]; parent.children.push(el); parent.parts.push(el); }
    else if (root) fail("more than one root element");
    else root = el;
    const selfClosing = src[j] === "/";
    j = src.indexOf(">", j);
    if (j < 0) fail("unterminated start tag");
    i = j + 1;
    if (!selfClosing) { stack.push(el); scopes.push(scope); }
  }
  if (stack.length) fail("unclosed element " + stack[stack.length - 1].nodeName);
  if (!root) fail("no root element");
  return root;
}
