// CSV reading and writing shared by CSV to JSON and JSON to CSV. Everything runs in the browser.
import { textBlob, tx } from "./core.js?v=11";

/* Save text as a download (the blob URL is revoked shortly after). */
export function saveText(text, name, type = "text/plain") {
  const url = URL.createObjectURL(text instanceof Blob ? text : textBlob(text, type));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export const DELIMS = { ",": tx("comma"), ";": tx("semicolon"), "\t": tx("tab"), "|": tx("pipe") };

/* Parse CSV text (RFC 4180, plus common variations).
   - Fields may be quoted with "; a quote inside a quoted field is written "".
   - Quoted fields may contain the delimiter and line breaks.
   - Records end at CRLF, LF or CR. A leading byte-order mark is dropped.
   - A quote inside an unquoted field is kept as a literal character.
   - Blank lines are skipped and counted.
   Returns { rows: string[][], lines: number[] (1-based starting line of each row), blank }.
   Throws an Error with .line when a quoted field is never closed. */
export function parseCsv(text, delim = ",") {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [], lines = [];
  const n = text.length;
  const d = delim.charCodeAt(0);
  let p = 0, line = 1, blank = 0;
  while (p < n) {
    const startLine = line;
    const row = [];
    let lineOnlyEmpty = true;
    for (;;) {
      let field = "";
      if (text.charCodeAt(p) === 34) {
        lineOnlyEmpty = false;
        const open = line;
        p++;
        let start = p;
        for (;;) {
          const q = text.indexOf('"', p);
          if (q === -1) {
            const err = new Error(tx("A quoted field that starts on line {line} is never closed (missing closing \").", { line: open }));
            err.line = open;
            throw err;
          }
          for (let i = p; i < q; i++) { const c = text.charCodeAt(i); if (c === 10 || (c === 13 && text.charCodeAt(i + 1) !== 10)) line++; }
          if (text.charCodeAt(q + 1) === 34) { field += text.slice(start, q + 1); p = q + 2; start = p; continue; }
          field += text.slice(start, q);
          p = q + 1;
          break;
        }
        // Anything between the closing quote and the next delimiter is kept (lenient).
        while (p < n) {
          const c = text.charCodeAt(p);
          if (c === d || c === 10 || c === 13) break;
          field += text[p++];
        }
      } else {
        const start = p;
        while (p < n) {
          const c = text.charCodeAt(p);
          if (c === d || c === 10 || c === 13) break;
          p++;
        }
        field = text.slice(start, p);
        if (field) lineOnlyEmpty = false;
      }
      row.push(field);
      if (p >= n) break;
      const c = text.charCodeAt(p);
      if (c === d) { p++; lineOnlyEmpty = false; if (p >= n) { row.push(""); break; } continue; }
      // line break
      p += c === 13 && text.charCodeAt(p + 1) === 10 ? 2 : 1;
      line++;
      break;
    }
    if (row.length === 1 && lineOnlyEmpty) { blank++; continue; }
    rows.push(row);
    lines.push(startLine);
  }
  return { rows, lines, blank };
}

/* Guess the delimiter from the first lines: the candidate that splits most lines into the same
   number of fields (more than one) wins; ties go to the one with more fields, then to comma. */
export function detectDelimiter(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const sample = text.slice(0, 64 * 1024);
  let best = ",", bestScore = -1;
  for (const cand of [",", ";", "\t", "|"]) {
    let rows;
    try { rows = parseCsv(sample, cand).rows.slice(0, 20); } catch (_) { continue; }
    if (rows.length > 1 && sample.length === 64 * 1024) rows = rows.slice(0, -1); // last row may be cut off
    if (!rows.length) continue;
    const counts = new Map();
    for (const r of rows) counts.set(r.length, (counts.get(r.length) || 0) + 1);
    let mode = 1, modeN = 0;
    for (const [len, k] of counts) if (len > 1 && (k > modeN || (k === modeN && len > mode))) { mode = len; modeN = k; }
    if (mode < 2) continue;
    const score = (modeN / rows.length) * 1000 + Math.min(mode, 999);
    if (score > bestScore) { bestScore = score; best = cand; }
  }
  return best;
}

/* Quote a field when it holds the delimiter, a quote, a line break, or leading/trailing spaces. */
export function csvField(s, delim) {
  s = String(s);
  if (s.includes(delim) || s.includes('"') || s.includes("\n") || s.includes("\r") || /^\s|\s$/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function toCsv(rows, delim = ",", eol = "\r\n") {
  return rows.map((r) => r.map((f) => csvField(f, delim)).join(delim)).join(eol) + (rows.length ? eol : "");
}

/* 1-based line and column for a 0-based offset. */
export function lineCol(text, pos) {
  let line = 1, last = -1;
  for (let i = text.indexOf("\n"); i !== -1 && i < pos; i = text.indexOf("\n", i + 1)) { line++; last = i; }
  return { line, col: pos - last };
}

/* JSON.parse with a plain-English error that names the line and column. Numbers keep their exact
   source text where the browser supports it (so 12345678901234567890 is not rounded). */
export class RawNumber {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

export function parseJsonText(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  try {
    return JSON.parse(text, function (key, value, ctx) {
      if (typeof value === "number" && ctx && typeof ctx.source === "string") return new RawNumber(ctx.source);
      return value;
    });
  } catch (e) {
    const m = String(e.message || e);
    let pos = null;
    const b = /line (\d+) column (\d+)/.exec(m);
    const a = /position (\d+)/.exec(m);
    let line, col;
    if (b) { line = Number(b[1]); col = Number(b[2]); }
    else if (a) { pos = Number(a[1]); ({ line, col } = lineCol(text, pos)); }
    else if (/Unexpected end/.test(m)) { ({ line, col } = lineCol(text, text.length)); }
    const msg = m.replace(/ in JSON at position \d+.*$/, "").replace(/ \(line \d+ column \d+\)$/, "").replace(/^JSON\.parse: /, "");
    const err = new Error(line ? tx("Invalid JSON at line {line}, column {col}: {msg}.", { line, col, msg }) : tx("Invalid JSON: {msg}.", { msg }));
    err.line = line; err.col = col;
    throw err;
  }
}
