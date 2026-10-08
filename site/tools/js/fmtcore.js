// Shared wiring for the code formatters (SQL, XML, HTML, CSS, YAML <-> JSON).
// A page supplies a format() function; this module handles the textarea, options, status line, error excerpt,
// size stats, copy, download, sample and clear, and drops results that arrive after newer input.
import { $, $$, debounce, copyText, textBlob, setStatus, fmtBytes, fmtNum, tx, EN } from "./core.js?v=5";

const SHOW_LIMIT = 2_000_000;

/* Thrown by a page's format(): message in plain English, optional 1-based line and column in the input. */
export class FmtError extends Error {
  constructor(message, where = {}) { super(message); this.line = where.line || null; this.col = where.col || null; this.plain = !!where.plain; }
}

/* 0-based offset to 1-based line and column. */
export function lineCol(text, pos) {
  let line = 1, last = -1;
  for (let i = text.indexOf("\n"); i !== -1 && i < pos; i = text.indexOf("\n", i + 1)) { line++; last = i; }
  return { line, col: pos - last };
}

/* The offending line with a caret under the column, clipped to about 100 characters. */
export function excerpt(text, line, col) {
  const raw = (text.split("\n")[line - 1] || "").replace(/\r$/, "");
  let shown = raw, c = Math.max(1, col || 1);
  if (raw.length > 100) {
    const start = Math.max(0, Math.min(c - 40, raw.length - 100));
    shown = (start ? "…" : "") + raw.slice(start, start + 100) + (start + 100 < raw.length ? "…" : "");
    c = c - start + (start ? 1 : 0);
  }
  const label = `${line} | `;
  const pad = shown.slice(0, c - 1).replace(/[^\t]/g, " ");
  return label + shown + "\n" + " ".repeat(label.length) + pad + "^";
}

export const byteLen = (s) => new TextEncoder().encode(s).length;

export function saveText(text, name, type) {
  const url = URL.createObjectURL(textBlob(text, type));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/* options:
     label       what the input is called in messages ("XML")
     format      (text) => {out, note?, kind?} | Promise; throw FmtError for bad input
     ready       optional () => Promise, awaited before formatting (lazy library load)
     loaded      optional () => boolean, false while ready() still has to fetch the library
     triggers    option elements that re-run on change
     sample      text for the Sample button
     filename, mime   for Download
     maxBytes    input size limit
     done        message for the status line after success (string or (result) => string)
     autoRun     run while typing (default true) */
export function initFormatter(o) {
  const input = $("#f-in");
  const status = $("#status");
  const errBox = $("#f-err");
  const resultBox = $("#f-result");
  const noteBox = $("#f-note");
  const maxBytes = o.maxBytes || 10 * 1024 * 1024;
  let output = "";
  let seq = 0;

  function clearResult() {
    output = "";
    resultBox.hidden = true;
    errBox.hidden = true;
    input.removeAttribute("aria-invalid");
    if (noteBox) noteBox.hidden = true;
  }

  async function run() {
    const my = ++seq;
    const text = input.value;
    if (!text.trim()) { clearResult(); setStatus(status, "idle"); return; }
    if (new Blob([text]).size > maxBytes) {
      clearResult();
      setStatus(status, "error", tx("That is more than {limit}, which is over the limit. Split it into smaller pieces.", { limit: fmtBytes(maxBytes) }));
      input.setAttribute("aria-invalid", "true");
      return;
    }
    try {
      if (o.ready) {
        if (o.loaded && !o.loaded()) setStatus(status, "working", tx("Loading the formatter…"));
        await o.ready();
        if (my !== seq) return;
      }
      const r = await o.format(text);
      if (my !== seq) return;
      output = r.out;
      input.removeAttribute("aria-invalid");
      errBox.hidden = true;
      resultBox.hidden = false;
      const shown = output.length > SHOW_LIMIT ? output.slice(0, SHOW_LIMIT) : output;
      $("#f-out").textContent = shown;
      const tr = $("#f-trunc");
      tr.hidden = shown.length === output.length;
      tr.textContent = tx("Showing the first {shown} of {total} characters. Copy and Download include everything.", { shown: fmtNum(SHOW_LIMIT), total: fmtNum(output.length) });
      const a = byteLen(text), b = byteLen(output);
      $("#f-s-in").textContent = fmtBytes(a);
      $("#f-s-out").textContent = fmtBytes(b);
      const d = $("#f-s-delta");
      if (d) {
        if (a === b) d.textContent = "0%";
        else {
          const pct = Math.round(Math.abs(b - a) / a * 1000) / 10;
          d.textContent = EN ? (b < a ? "-" : "+") + pct + "%" : (b < a ? "-" : "+") + fmtNum(pct / 100, { style: "percent", maximumFractionDigits: 1 });
        }
      }
      if (noteBox) {
        noteBox.hidden = !r.note;
        const t = noteBox.querySelector(".fmt-note__text");
        (t || noteBox).textContent = r.note || "";
        noteBox.classList.toggle("fmt-warn", !!r.warn);
      }
      const msg = typeof o.done === "function" ? o.done(r) : o.done;
      setStatus(status, "done", msg || tx("Done."));
    } catch (err) {
      if (my !== seq) return;
      clearResult();
      if (err instanceof FmtError) {
        input.setAttribute("aria-invalid", "true");
        const vars = { label: o.label, line: err.line, col: err.col, message: err.message };
        setStatus(status, "error", err.plain ? err.message
          : !err.line ? tx("Invalid {label}: {message}", vars)
          : err.col ? tx("Invalid {label} at line {line}, column {col}: {message}", vars)
          : tx("Invalid {label} at line {line}: {message}", vars));
        if (err.line) {
          errBox.hidden = false;
          errBox.textContent = excerpt(text, err.line, err.col);
          errBox.dataset.line = String(err.line);
          errBox.dataset.col = String(err.col || "");
        }
      } else if (err instanceof RangeError) {
        setStatus(status, "error", tx("This {label} is nested too deeply to process here.", { label: o.label }));
      } else {
        console.warn(err);
        setStatus(status, "error", err && err.userMessage ? err.userMessage : tx("Something went wrong. Nothing was uploaded; try again, or reload the page."));
      }
    }
  }

  const runSoon = debounce(run, 250);
  if (o.autoRun !== false) input.addEventListener("input", runSoon);
  (o.triggers || []).forEach((n) => n.addEventListener("change", run));
  const fmtBtn = $("#f-format");
  if (fmtBtn) fmtBtn.addEventListener("click", run);
  $("#f-copy").addEventListener("click", (e) => copyText(output, e.currentTarget));
  $("#f-dl").addEventListener("click", () => saveText(output, o.filename, o.mime || "text/plain"));
  $("#f-clear").addEventListener("click", () => { input.value = ""; run(); input.focus(); });
  $("#f-sample").addEventListener("click", () => { input.value = o.sample; run(); });
  run();
  return { run, get output() { return output; } };
}

export { $, $$ };

/* For a library that failed to load: show its own plain-English message. */
export const loadFailed = (e) => { throw Object.assign(e, { userMessage: e.message }); };
