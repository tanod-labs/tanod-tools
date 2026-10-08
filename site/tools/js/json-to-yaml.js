import { initFormatter, FmtError, lineCol, $, $$ } from "./fmtcore.js?v=5";
import { tx } from "./core.js?v=5";

let Y = null, dumpSchema = null, loadSchema = null;
const ready = () => (Y ? Promise.resolve() : import("/tools/vendor/js-yaml/js-yaml.esm.min.mjs").then((m) => {
  /* Integers beyond 2^53 arrive as BigInt (see the reviver below) and are written digit for digit. The tag wraps
     the library's own integer tag, so its quoting rules (0b11, 1_000, 12:30 and the like) stay in force. */
  const wrap = (base) => m.defineScalarTag("tag:yaml.org,2002:int", {
    implicit: true,
    implicitFirstChars: base.implicitFirstChars,
    resolve(source, explicit, tagName) {
      const r = base.resolve(source, explicit, tagName);
      if (typeof r === "number" && !Number.isSafeInteger(r) && /^[-+]?[0-9]+$/.test(source)) return BigInt(source);
      return r;
    },
    identify: (d) => typeof d === "bigint" || base.identify(d),
    represent: (d) => (typeof d === "bigint" ? String(d) : base.represent(d)),
  });
  const intOf = (schema) => schema.tags.find((t) => t.tagName === "tag:yaml.org,2002:int");
  dumpSchema = m.DUMP_SCHEMA.withTags(wrap(intOf(m.DUMP_SCHEMA)));
  loadSchema = m.CORE_SCHEMA.withTags(wrap(m.intCoreTag));
  Y = m;
}, (e) => { throw Object.assign(e, { userMessage: tx("The YAML library couldn't be loaded. Check your connection and try again.") }); }));

/* Strict JSON reader used only to find and word a syntax error (the same one the JSON formatter uses). */
class JsonError extends Error {
  constructor(msg, pos) { super(msg); this.pos = pos; }
}

/* Strict JSON parser that keeps number and string source text, so formatting never changes values.
   Returns a tree: {t:"o", e:[[rawKey, node]...]} | {t:"a", i:[node...]} | {t:"v", raw}. */
function validateJson(src) {
  let p = 0;
  const n = src.length;
  const ws = () => { while (p < n) { const c = src.charCodeAt(p); if (c === 32 || c === 10 || c === 13 || c === 9) p++; else break; } };
  const show = (c) => (c === undefined ? tx("end of input") : `"${c}"`);

  function string() {
    const start = p;
    p++; // opening quote
    for (;;) {
      if (p >= n) throw new JsonError(tx("The string is never closed (missing closing double quote)"), start);
      const c = src.charCodeAt(p);
      if (c === 34) { p++; return src.slice(start, p); }
      if (c < 32) throw new JsonError(tx("A line break or control character inside a string is not allowed; write it as \\n or \\uXXXX"), p);
      if (c === 92) {
        const e = src[p + 1];
        if (e === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(src.slice(p + 2, p + 6))) throw new JsonError(tx("Invalid \\u escape; it needs 4 hex digits"), p);
          p += 6;
        } else if (e !== undefined && '"\\/bfnrt'.includes(e)) p += 2;
        else throw new JsonError(tx("Invalid escape \"\\{esc}\" in string", { esc: e === undefined ? "" : e }), p);
      } else p++;
    }
  }

  function number() {
    const start = p;
    if (src[p] === "-") p++;
    if (src[p] === "0") p++;
    else if (src[p] >= "1" && src[p] <= "9") { while (src[p] >= "0" && src[p] <= "9") p++; }
    else throw new JsonError(tx("Invalid number: expected a digit"), p);
    if (src[p] === ".") {
      p++;
      if (!(src[p] >= "0" && src[p] <= "9")) throw new JsonError(tx("Invalid number: expected a digit after the decimal point"), p);
      while (src[p] >= "0" && src[p] <= "9") p++;
    }
    if (src[p] === "e" || src[p] === "E") {
      p++;
      if (src[p] === "+" || src[p] === "-") p++;
      if (!(src[p] >= "0" && src[p] <= "9")) throw new JsonError(tx("Invalid number: expected a digit in the exponent"), p);
      while (src[p] >= "0" && src[p] <= "9") p++;
    }
    return src.slice(start, p);
  }

  function value() {
    ws();
    if (p >= n) throw new JsonError(tx("Unexpected end of input: the JSON is incomplete"), n);
    const c = src[p];
    if (c === "{") {
      const open = p;
      p++;
      const e = [];
      ws();
      if (src[p] === "}") { p++; return { t: "o", e }; }
      for (;;) {
        ws();
        if (p >= n) throw new JsonError(tx("Unexpected end of input: the object starting here is never closed"), open);
        if (src[p] === "'") throw new JsonError(tx("Keys must use double quotes, not single quotes"), p);
        if (src[p] !== '"') throw new JsonError(src[p] === "}" ? tx("Expected a property name in double quotes, found {found} (trailing comma?)", { found: show(src[p]) }) : tx("Expected a property name in double quotes, found {found}", { found: show(src[p]) }), p);
        const key = string();
        ws();
        if (src[p] !== ":") throw new JsonError(tx("Expected \":\" after the property name, found {found}", { found: show(src[p]) }), Math.min(p, n));
        p++;
        e.push([key, value()]);
        ws();
        if (src[p] === ",") { p++; continue; }
        if (src[p] === "}") { p++; return { t: "o", e }; }
        throw new JsonError(p >= n ? tx("Unexpected end of input: the object starting at the opening brace is never closed") : tx("Expected \",\" or \"}\" after the value, found {found}", { found: show(src[p]) }), p >= n ? open : p);
      }
    }
    if (c === "[") {
      const open = p;
      p++;
      const i = [];
      ws();
      if (src[p] === "]") { p++; return { t: "a", i }; }
      for (;;) {
        if (p >= n) throw new JsonError(tx("Unexpected end of input: the array starting here is never closed"), open);
        ws();
        if (src[p] === "]") throw new JsonError(tx("Unexpected \"]\": there is a trailing comma before it"), p);
        i.push(value());
        ws();
        if (src[p] === ",") { p++; continue; }
        if (src[p] === "]") { p++; return { t: "a", i }; }
        throw new JsonError(p >= n ? tx("Unexpected end of input: the array starting at the opening bracket is never closed") : tx("Expected \",\" or \"]\" after the value, found {found}", { found: show(src[p]) }), p >= n ? open : p);
      }
    }
    if (c === '"') return { t: "v", raw: string() };
    if (c === "-" || (c >= "0" && c <= "9")) return { t: "v", raw: number() };
    for (const lit of ["true", "false", "null"]) {
      if (src.startsWith(lit, p)) { p += lit.length; return { t: "v", raw: lit }; }
    }
    if (c === "'") throw new JsonError(tx("Strings must use double quotes, not single quotes"), p);
    if (c === "/" ) throw new JsonError(tx("Comments are not allowed in JSON"), p);
    if (c === "}" || c === "]" || c === ",") throw new JsonError(tx("Unexpected {found}: a value is expected here", { found: show(c) }), p);
    throw new JsonError(tx("Unexpected {found}: expected a value (string, number, true, false, null, object or array)", { found: show(c) }), p);
  }

  ws();
  const root = value();
  ws();
  if (p < n) throw new JsonError(tx("Unexpected {found} after the end of the JSON value", { found: show(src[p]) }), p);
  return root;
}


/* JSON.parse, with integers that a double cannot hold kept exact (needs the "source text access" reviver
   argument; browsers without it round such numbers, as any JSON.parse does). */
function parseJson(text) {
  try {
    return JSON.parse(text, (k, v, ctx) => (typeof v === "number" && ctx && typeof ctx.source === "string" && /^-?\d+$/.test(ctx.source) && !Number.isSafeInteger(v) ? BigInt(ctx.source) : v));
  } catch (e) {
    let pos = text.length, why = String(e.message).replace(/\s+in JSON at position \d+.*$/, "").replace(/,? ".*" is not valid JSON$/s, "");
    try { validateJson(text); } catch (je) {
      if (je instanceof JsonError) { pos = je.pos; why = je.message; }
    }
    const { line, col } = lineCol(text, Math.min(pos, text.length));
    throw new FmtError(why.replace(/\.?$/, "."), { line, col });
  }
}

function sortDeep(v) {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v).sort((x, y) => (x < y ? -1 : x > y ? 1 : 0))) {
      Object.defineProperty(o, k, { value: sortDeep(v[k]), enumerable: true, writable: true, configurable: true });
    }
    return o;
  }
  return v;
}

function same(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && same(a[k], b[k]));
}

if (document.querySelector("#f-in")) {
  const SAMPLE = `{
  "name": "api",
  "enabled": true,
  "version": "1.0",
  "answer": "yes",
  "ports": [80, 443],
  "owner": null,
  "limits": {"retries": 3, "timeout": 2.5},
  "empty": {},
  "none": [],
  "notes": "first line\\nsecond line",
  "servers": [{"host": "a.example", "weight": 10}, {"host": "b.example", "weight": 5}],
  "id": 12345678901234567890
}`;
  initFormatter({
    label: "JSON",
    ready,
    loaded: () => !!Y,
    triggers: $$("input[name='indent'], #o-sort, #o-wrap, #o-flat"),
    sample: SAMPLE,
    filename: "converted.yaml",
    mime: "text/yaml",
    done: tx("Converted."),
    format(text) {
      let value = parseJson(text.replace(/^﻿/, ""));
      if ($("#o-sort").checked) value = sortDeep(value);
      const out = Y.dump(value, {
        schema: dumpSchema,
        indent: Number($("input[name='indent']:checked").value),
        lineWidth: $("#o-wrap").checked ? 80 : -1,
        seqNoIndent: $("#o-flat").checked,
        noRefs: true,
      });
      let ok = true;
      try { ok = same(Y.load(out, { schema: loadSchema }), value); } catch (_) { ok = false; }
      return { out, warn: !ok, note: ok ? "" : tx("Reading the YAML back did not give exactly the same data as your JSON. Check the result before relying on it.") };
    },
  });
}
