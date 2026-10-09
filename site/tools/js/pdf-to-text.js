// PDF to text: reads the text layer of each page with pdf.js and shows it page by page. The text-assembly logic is in
// pdftextcore.js (no DOM). Nothing is uploaded; scanned PDFs have no text layer, and the page points to the OCR tool.
import { $, el, fmtBytes, dropzone, readBytes, setStatus, textBlob, copyText, announce, tick, UserError, tx, txn, fmtNum } from "./core.js?v=11";
import { openForView, closeView, parseRanges } from "./pdfcore.js?v=11";
import { pageText, joinPages, countWords, countChars, txtName } from "./pdftextcore.js?v=11";

const MAX_BYTES = 200 * 1024 * 1024;
const MAX_PAGES = 500;
const nextTurn = () => new Promise((resolve) => setTimeout(resolve, 0));   // unlike an animation frame, a timer still fires in a background tab
const drop = $("#drop"), work = $("#work"), status = $("#status");
const out = $("#pt-out"), range = $("#range"), marks = $("#pt-marks"), rows = $("#pt-rows"), ocr = $("#pt-ocr");
const dl = $("#pt-dl"), copyAll = $("#pt-copy");

let file = null;
let pages = [];       // { n, text, words, chars }
let token = 0;

const radio = (name) => document.querySelector(`input[name="${name}"]:checked`).value;

/* The OCR tool's link is already on the page, in the note under the tool (its address is translated per language). */
function ocrLink() {
  const a = document.querySelector(".limits a");
  return a ? a.cloneNode(true) : null;
}

function showOcr() {
  const empty = pages.filter((p) => !p.text).length;
  if (!empty) { ocr.hidden = true; ocr.replaceChildren(); return; }
  const msg = empty === pages.length
    ? tx("No text was found. This PDF is probably a scan, which is made of pictures of text. Use OCR instead:")
    : txn(empty, "{n} page has no text of its own. It may be a scan; use OCR for it:", "{n} pages have no text of their own. They may be scans; use OCR for them:");
  const link = ocrLink();
  ocr.replaceChildren(el("p", {}, msg, link ? " " : null, link));
  ocr.hidden = false;
}

/* The pages the options select, or null when the page range is not valid. */
function selection() {
  const help = $("#range-help");
  $("#range-field").hidden = radio("scope") !== "range";
  help.textContent = "";
  range.removeAttribute("aria-invalid");
  if (radio("scope") !== "range") return pages;
  try {
    const nums = [...new Set(parseRanges(range.value, pages.length).flat())].sort((a, b) => a - b);
    return nums.map((n) => pages[n - 1]);
  } catch (err) {
    if (range.value.trim()) { help.textContent = err.message; range.setAttribute("aria-invalid", "true"); }
    return null;
  }
}

function render() {
  if (!pages.length) return;
  const sel = selection();
  const text = sel ? joinPages(sel, { marks: marks.checked, label: (n) => "--- " + tx("Page {n}", { n }) + " ---" }) : "";
  out.value = text;
  const chosen = sel || [];
  $("#pt-n-pages").textContent = fmtNum(chosen.length);
  $("#pt-n-text").textContent = fmtNum(chosen.filter((p) => p.text).length);
  $("#pt-n-words").textContent = fmtNum(chosen.reduce((s, p) => s + p.words, 0));
  $("#pt-n-chars").textContent = fmtNum(chosen.reduce((s, p) => s + p.chars, 0));
  const none = !chosen.some((p) => p.text);
  dl.disabled = copyAll.disabled = none;
}

function buildRows() {
  rows.replaceChildren(...pages.map((p) => el("tr", {},
    el("th", { scope: "row" }, fmtNum(p.n)),
    el("td", {}, fmtNum(p.words)),
    el("td", {}, fmtNum(p.chars)),
    el("td", { class: "pt-act" }, p.text
      ? el("button", { type: "button", class: "btn btn--sm", "aria-label": tx("Copy the text of page {n}", { n: fmtNum(p.n) }), onclick: (e) => copyText(p.text, e.currentTarget) }, tx("Copy"))
      : el("span", { class: "help" }, tx("No text"))))));
}

function reset() {
  token++;
  file = null; pages = [];
  work.hidden = true;
  out.value = "";
  rows.replaceChildren();
  ocr.hidden = true; ocr.replaceChildren();
  drop.classList.remove("is-compact");
  $("[data-pick-label]", drop).textContent = tx("Choose a PDF");
}

dropzone(drop, {
  accept: ["application/pdf", ".pdf"], maxFileBytes: MAX_BYTES, typeLabel: "PDF",
  onError: (m) => setStatus(status, "error", m),
  onFiles: async ([f]) => {
    reset();
    const my = token;
    setStatus(status, "working", tx("Reading the PDF…"));
    await tick();
    let doc = null;
    try {
      const bytes = await readBytes(f);
      doc = await openForView(bytes, f.name);
      const count = doc.numPages;
      if (!count) throw new UserError(tx("This PDF has no pages."));
      if (count > MAX_PAGES) throw new UserError(tx("This PDF has {n} pages; up to {max} pages can be read at a time.", { n: fmtNum(count), max: fmtNum(MAX_PAGES) }));
      const found = [];
      for (let i = 1; i <= count; i++) {
        if (my !== token) return;
        let text = "";
        try {
          const page = await doc.getPage(i);
          text = pageText((await page.getTextContent()).items).text;
          page.cleanup();
        } catch (err) {
          console.warn("page", i, err);
        }
        found.push({ n: i, text, words: countWords(text), chars: countChars(text) });
        if (i % 4 === 0 || i === count) {
          setStatus(status, "working", tx("Reading page {i} of {n}…", { i: fmtNum(i), n: fmtNum(count) }), i / count);
          await nextTurn();
        }
      }
      if (my !== token) return;
      file = f; pages = found;
      $("#fname").textContent = f.name;
      $("#finfo").textContent = fmtBytes(f.size) + " · " + txn(count, "{n} page", "{n} pages");
      drop.classList.add("is-compact");
      $("[data-pick-label]", drop).textContent = tx("Choose another PDF");
      work.hidden = false;
      buildRows();
      render();
      showOcr();
      const empty = found.filter((p) => !p.text).length;
      setStatus(status, "done", txn(count, "Read {n} page.", "Read {n} pages.") + (empty ? " " + txn(empty, "{n} page has no text.", "{n} pages have no text.") : ""));
      announce(tx("{name} loaded, {pages}.", { name: f.name, pages: txn(count, "{n} page", "{n} pages") }));
    } catch (err) {
      if (my !== token) return;
      reset();
      setStatus(status, "error", err instanceof UserError ? err.message : tx("This file couldn't be read as a PDF."));
    } finally {
      closeView(doc);
    }
  },
});

for (const e of [range, marks, ...document.querySelectorAll('input[name="scope"]')]) {
  e.addEventListener("input", render);
  e.addEventListener("change", render);
}

copyAll.addEventListener("click", () => copyText(out.value, copyAll));
dl.addEventListener("click", () => {
  if (!file) return;
  const url = URL.createObjectURL(textBlob(out.value));
  const a = el("a", { href: url, download: txtName(file.name) });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
});

$("#clear").addEventListener("click", () => {
  reset();
  setStatus(status, "idle");
  drop.querySelector("input").focus();
});
