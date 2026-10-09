import { initFormatter, FmtError, $, $$ } from "./fmtcore.js?v=11";
import { fmtNum, tx, txn } from "./core.js?v=11";

const MAX_ALIASES = 10000;
const MAX_OUT = 20 * 1024 * 1024;
const MAX_DEPTH = 500;

let Y = null, schema = null;
const ready = () => (Y ? Promise.resolve() : import("/tools/vendor/js-yaml/js-yaml.esm.min.mjs").then((m) => {
  /* YAML 1.2 core schema plus merge keys (<<). Integers too large for a double are kept exact as BigInt, so
     they are written to the JSON digit for digit instead of being rounded. */
  const bigInt = m.defineScalarTag("tag:yaml.org,2002:int", {
    implicit: true,
    implicitFirstChars: m.intCoreTag.implicitFirstChars,
    resolve(source, explicit, tagName) {
      const r = m.intCoreTag.resolve(source, explicit, tagName);
      if (typeof r === "number" && !Number.isSafeInteger(r)) {
        const p = /^([-+]?)(0x[0-9a-fA-F]+|0o[0-7]+|[0-9]+)$/.exec(source);
        if (p) { const v = BigInt(p[2]); return p[1] === "-" ? -v : v; }
      }
      return r;
    },
    identify: (d) => m.intCoreTag.identify(d),
  });
  schema = m.CORE_SCHEMA.withTags(m.mergeTag, bigInt);
  Y = m;
}, (e) => { throw Object.assign(e, { userMessage: tx("The YAML library couldn't be loaded. Check your connection and try again.") }); }));

class Bomb extends Error {}
class Circular extends Error {}

/* JSON text writer with a hard size cap, so an alias bomb stops early instead of freezing the tab. */
export function toJson(value, unit) {
  const parts = [];
  let size = 0;
  const ancestors = new Set();
  let nonFinite = 0;
  const add = (s) => { parts.push(s); size += s.length; if (size > MAX_OUT) throw new Bomb(); };
  const min = unit === "";
  (function walk(v, level) {
    if (v === null || v === undefined) return add("null");
    const t = typeof v;
    if (t === "number" && !Number.isFinite(v)) nonFinite++;
    if (t === "string" || t === "boolean" || t === "number") return add(JSON.stringify(v));
    if (t === "bigint") return add(v.toString());
    if (t !== "object") return add("null");
    if (ancestors.has(v)) throw new Circular();
    ancestors.add(v);
    const pad = min ? "" : "\n" + unit.repeat(level + 1);
    const end = min ? "" : "\n" + unit.repeat(level);
    if (Array.isArray(v)) {
      if (!v.length) add("[]");
      else {
        add("[");
        v.forEach((x, i) => { add((i ? "," : "") + pad); walk(x, level + 1); });
        add(end + "]");
      }
    } else {
      const keys = Object.keys(v);
      if (!keys.length) add("{}");
      else {
        add("{");
        keys.forEach((k, i) => { add((i ? "," : "") + pad + JSON.stringify(k) + (min ? ":" : ": ")); walk(v[k], level + 1); });
        add(end + "}");
      }
    }
    ancestors.delete(v);
  })(value, 0);
  return { text: parts.join(""), nonFinite };
}

function describe(e) {
  const reason = String(e.reason || e.message || e).replace(/\s*\(\d+:\d+\)$/, "");
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  if (/maxAliases/.test(reason)) return new FmtError(tx("This file uses more than {n} aliases (*name). That is far beyond normal use and typical of an alias bomb, so it was not expanded.", { n: fmtNum(MAX_ALIASES) }), { plain: true });
  if (/duplicated mapping key/i.test(reason)) return new FmtError(tx("A key appears twice in the same mapping. Rename or delete one of them."), { line: e.mark && e.mark.line + 1, col: e.mark && e.mark.column + 1 });
  if (/tab characters/i.test(reason)) return new FmtError(tx("A tab is used for indentation. YAML only allows spaces there; replace the tab with spaces."), { line: e.mark && e.mark.line + 1, col: e.mark && e.mark.column + 1 });
  if (/maxDepth|depth/i.test(reason)) return new FmtError(tx("The data is nested more than {n} levels deep, which is over the limit.", { n: MAX_DEPTH }), { plain: true });
  return new FmtError(cap(reason) + ".", e.mark ? { line: e.mark.line + 1, col: e.mark.column + 1 } : { plain: true });
}

if (document.querySelector("#f-in")) {
  const SAMPLE = `# Service settings
defaults: &defaults
  retries: 3
  timeout: 2.5
  tags: [web, "edge"]
service:
  <<: *defaults
  name: api
  enabled: yes
  started: 2024-05-01
  banner: |
    Line one
    Line two
  summary: >
    folded text that
    joins lines
  id: 12345678901234567890
`;
  initFormatter({
    label: "YAML",
    ready,
    loaded: () => !!Y,
    triggers: $$("input[name='indent']"),
    sample: SAMPLE,
    filename: "converted.json",
    mime: "application/json",
    done: (r) => (r.docs > 1 ? txn(r.docs, "Converted {n} document to a JSON array.", "Converted {n} documents to a JSON array.") : tx("Converted.")),
    format(text) {
      let docs;
      try {
        docs = Y.loadAll(text, { schema, maxAliases: MAX_ALIASES, maxDepth: MAX_DEPTH });
      } catch (e) {
        if (e instanceof RangeError) throw e;
        throw describe(e);
      }
      if (!docs.length) throw new FmtError(tx("The input has no YAML document in it, only comments or blank lines."), { plain: true });
      const v = $("input[name='indent']:checked").value;
      const unit = v === "2" ? "  " : v === "4" ? "    " : v === "tab" ? "\t" : "";
      let out, nonFinite;
      try {
        ({ text: out, nonFinite } = toJson(docs.length > 1 ? docs : docs[0], unit));
      } catch (e) {
        if (e instanceof Bomb) throw new FmtError(tx("The JSON would be larger than 20 MB once the aliases are expanded. This looks like an alias bomb (aliases that expand into aliases), so conversion stopped."), { plain: true });
        if (e instanceof Circular) throw new FmtError(tx("An alias refers back to a structure that contains it. JSON cannot represent a loop like that."), { plain: true });
        throw e;
      }
      const notes = [];
      if (docs.length > 1) notes.push(tx("The input holds {n} YAML documents (separated by ---), so the result is a JSON array with one item per document.", { n: fmtNum(docs.length) }));
      if (nonFinite) notes.push(txn(nonFinite, "A value of .inf or .nan became null, because JSON has no way to write them.", "{n} values of .inf or .nan became null, because JSON has no way to write them."));
      return { out, docs: docs.length, note: notes.join(" ") };
    },
  });
}
