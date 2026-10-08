// Shared helpers for the text tools. Text is never stored or sent anywhere.
import { $, el, icon, debounce, dropzone, setStatus, textBlob, copyText, announce, fmtBytes, tick, tx, txn, EN, LOCALE, fmtNum } from "./core.js?v=5";

export const MAX_TEXT_BYTES = 5 * 1024 * 1024;
export const LARGE = 50000; // characters; above this, live updates are debounced

/* Run fn on every input of the given controls, immediately for small text and debounced for large text. */
export function live(source, controls, fn) {
  const slow = debounce(fn, 350);
  const run = () => ((source().length > LARGE) ? slow() : fn());
  for (const c of controls) {
    c.addEventListener("input", run);
    c.addEventListener("change", run);
  }
  return run;
}

/* Let people open a plain text file into a textarea. zone: the .drop element with a file input. */
export function openTextFile(zone, status, onText) {
  dropzone(zone, {
    accept: ["text/plain", ".txt", ".md", ".csv", "text/csv", "text/markdown"],
    typeLabel: "text",
    maxFileBytes: MAX_TEXT_BYTES,
    onError: (msg) => setStatus(status, "error", msg + " " + tx("Text files up to 5 MB can be opened.")),
    onFiles: async ([file]) => {
      try {
        const text = await file.text();
        setStatus(status, "idle");
        onText(text, file);
        announce(tx("Opened {name}, {size}.", { name: file.name, size: fmtBytes(file.size) }));
      } catch (_) {
        setStatus(status, "error", tx("That file couldn't be read as text."));
      }
    },
  });
}

export function normalizeNewlines(s) { return s.replace(/\r\n?/g, "\n"); }

/* A download button that builds its blob when pressed (nothing is kept around). */
export function downloadButton(label, getText, filename, cls = "btn") {
  const b = el("button", { type: "button", class: cls }, icon("i-download"), label);
  b.addEventListener("click", () => {
    const url = URL.createObjectURL(textBlob(getText()));
    const a = el("a", { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  });
  return b;
}

export function wireCopy(button, getText) {
  button.addEventListener("click", () => copyText(getText(), button));
}

/* An integer for display, grouped in the page's language (en-US on English pages). */
export const fmtInt = (n) => fmtNum(n);

/* A decimal number for display with a fixed number of decimals (toFixed on English pages). */
export const fmtDec = (n, d = 1) => (EN ? n.toFixed(d) : fmtNum(n, { minimumFractionDigits: d, maximumFractionDigits: d }));

/* A fraction (0.123) as a percentage with one decimal ("12.3%" on English pages). */
export const fmtPct = (f) => (EN ? (f * 100).toFixed(1) + "%" : fmtNum(f, { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 }));

export { $, el, icon, debounce, setStatus, announce, tick, tx, txn, EN, LOCALE, fmtNum };
