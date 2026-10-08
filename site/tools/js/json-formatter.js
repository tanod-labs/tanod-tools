import { $, $$, debounce, dropzone, copyText, textBlob, setStatus, fmtBytes, fmtNum, announce, tx } from "./core.js?v=5";

const MAX_BYTES = 10 * 1024 * 1024;
const SHOW_LIMIT = 2_000_000;

class JsonError extends Error {
  constructor(msg, pos) { super(msg); this.pos = pos; }
}

/* Strict JSON parser that keeps number and string source text, so formatting never changes values.
   Returns a tree: {t:"o", e:[[rawKey, node]...]} | {t:"a", i:[node...]} | {t:"v", raw}. */
export function parseJson(src) {
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

/* Position (0-based offset) to 1-based line and column. */
export function lineCol(text, pos) {
  let line = 1, last = -1;
  for (let i = text.indexOf("\n"); i !== -1 && i < pos; i = text.indexOf("\n", i + 1)) { line++; last = i; }
  return { line, col: pos - last };
}

/* Native JSON.parse position, for the rare input my parser accepts but the browser rejects. */
function nativeError(text) {
  try { JSON.parse(text); return null; } catch (e) {
    const m = String(e.message);
    let pos = null;
    const a = /position (\d+)/.exec(m);
    const b = /line (\d+) column (\d+)/.exec(m);
    if (a) pos = Number(a[1]);
    else if (b) {
      const lines = text.split("\n");
      pos = lines.slice(0, Number(b[1]) - 1).reduce((s, l) => s + l.length + 1, 0) + Number(b[2]) - 1;
    }
    return new JsonError(m.replace(/ \(line.*\)$/, ""), pos === null ? text.length : pos);
  }
}

function sortTree(node) {
  if (node.t === "o") {
    const keyOf = (raw) => JSON.parse(raw);
    node.e.forEach(([, v]) => sortTree(v));
    node.e.sort((x, y) => { const a = keyOf(x[0]), b = keyOf(y[0]); return a < b ? -1 : a > b ? 1 : 0; });
  } else if (node.t === "a") node.i.forEach(sortTree);
}

/* Serialise the tree. indent: "" for minified, else the unit string. Iterative would be safer for extreme
   nesting; recursion depth is guarded by the caller's try/catch. */
function print(node, unit) {
  const min = unit === "";
  const parts = [];
  (function walk(nd, level) {
    if (nd.t === "v") { parts.push(nd.raw); return; }
    const pad = min ? "" : "\n" + unit.repeat(level + 1);
    const end = min ? "" : "\n" + unit.repeat(level);
    if (nd.t === "o") {
      if (!nd.e.length) { parts.push("{}"); return; }
      parts.push("{");
      nd.e.forEach(([k, v], idx) => {
        parts.push((idx ? "," : "") + pad + k + (min ? ":" : ": "));
        walk(v, level + 1);
      });
      parts.push(end + "}");
    } else {
      if (!nd.i.length) { parts.push("[]"); return; }
      parts.push("[");
      nd.i.forEach((v, idx) => { parts.push((idx ? "," : "") + pad); walk(v, level + 1); });
      parts.push(end + "]");
    }
  })(node, 0);
  return parts.join("");
}

function stats(node) {
  let keys = 0, depth = 0;
  (function walk(nd, d) {
    if (nd.t === "v") return;
    if (d > depth) depth = d;
    if (nd.t === "o") { keys += nd.e.length; nd.e.forEach(([, v]) => walk(v, d + 1)); }
    else nd.i.forEach((v) => walk(v, d + 1));
  })(node, 1);
  return { keys, depth };
}

export function formatJson(text, { indent = "  ", sort = false } = {}) {
  const tree = parseJson(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  if (sort) sortTree(tree);
  return { out: print(tree, indent), ...stats(tree) };
}

/* ------------------------------------------------------------------ UI */

const input = $("#j-in");
const status = $("#status");
const errBox = $("#j-err");
const resultBox = $("#j-result");
let output = "";

function unitFor() {
  const v = $('input[name="layout"]:checked').value;
  return v === "2" ? "  " : v === "4" ? "    " : v === "tab" ? "\t" : "";
}

function excerpt(text, pos) {
  const { line, col } = lineCol(text, pos);
  const lines = text.split("\n");
  const raw = (lines[line - 1] || "").replace(/\r$/, "");
  let shown = raw, c = col;
  if (raw.length > 100) {
    const start = Math.max(0, Math.min(col - 40, raw.length - 100));
    shown = (start ? "…" : "") + raw.slice(start, start + 100) + (start + 100 < raw.length ? "…" : "");
    c = col - start + (start ? 1 : 0);
  }
  const label = String(line).padStart(String(line).length) + " | ";
  const prefix = shown.slice(0, c - 1).replace(/[^\t]/g, " ");
  return { line, col, text: label + shown + "\n" + " ".repeat(label.length) + prefix + "^" };
}

function run() {
  const text = input.value;
  if (!text.trim()) {
    output = "";
    setStatus(status, "idle"); errBox.hidden = true; resultBox.hidden = true;
    return;
  }
  if (new Blob([text]).size > MAX_BYTES) {
    output = ""; errBox.hidden = true; resultBox.hidden = true;
    setStatus(status, "error", tx("That is more than {limit}, which is over the limit. Split it into smaller pieces.", { limit: fmtBytes(MAX_BYTES) }));
    return;
  }
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  try {
    const r = formatJson(src, { indent: unitFor(), sort: $("#j-sort").checked });
    const nat = nativeError(src);
    if (nat) throw nat;
    output = r.out;
    errBox.hidden = true;
    resultBox.hidden = false;
    const shown = output.length > SHOW_LIMIT ? output.slice(0, SHOW_LIMIT) : output;
    $("#j-out").textContent = shown;
    const tr = $("#j-trunc");
    tr.hidden = shown.length === output.length;
    tr.textContent = tx("Showing the first {shown} of {total} characters. Copy and Download include everything.", { shown: fmtNum(SHOW_LIMIT), total: fmtNum(output.length) });
    $("#j-s-in").textContent = fmtBytes(new Blob([text]).size);
    $("#j-s-out").textContent = fmtBytes(new Blob([output]).size);
    $("#j-s-keys").textContent = fmtNum(r.keys);
    $("#j-s-depth").textContent = fmtNum(r.depth);
    setStatus(status, "done", tx("Valid JSON."));
  } catch (err) {
    output = "";
    resultBox.hidden = true;
    if (err instanceof JsonError) {
      const ex = excerpt(src, err.pos);
      setStatus(status, "error", tx("Invalid JSON at line {line}, column {col}: {message}.", { line: ex.line, col: ex.col, message: err.message }));
      errBox.hidden = false;
      errBox.textContent = ex.text;
      errBox.dataset.line = String(ex.line);
      errBox.dataset.col = String(ex.col);
    } else if (err instanceof RangeError) {
      errBox.hidden = true;
      setStatus(status, "error", tx("This JSON is nested too deeply to process here."));
    } else {
      console.warn(err);
      errBox.hidden = true;
      setStatus(status, "error", tx("Something went wrong reading this JSON. Nothing was uploaded."));
    }
  }
}

const runSoon = debounce(run, 250);
input.addEventListener("input", runSoon);
$$('input[name="layout"]').forEach((r) => r.addEventListener("change", run));
$("#j-sort").addEventListener("change", run);
$("#j-copy").addEventListener("click", (e) => copyText(output, e.currentTarget));
$("#j-dl").addEventListener("click", () => {
  const url = URL.createObjectURL(textBlob(output, "application/json"));
  const a = document.createElement("a");
  a.href = url; a.download = "formatted.json";
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
});
$("#j-clear").addEventListener("click", () => { input.value = ""; run(); input.focus(); });

dropzone($("#drop"), {
  maxFileBytes: MAX_BYTES,
  typeLabel: "JSON",
  accept: ["application/json", ".json", "text/plain", ".txt"],
  onError: (m) => setStatus(status, "error", m),
  onFiles: async (files) => {
    try {
      input.value = await files[0].text();
      run();
      announce(tx("Opened {name}.", { name: files[0].name }));
    } catch (_) { setStatus(status, "error", tx("That file couldn't be read.")); }
  },
});
