import { $, fmtBytes, dropzone, readBytes, runJob, setStatus, showResults, clearNode, baseName, UserError, announce, tx, txn } from "./core.js?v=11";
import { loadPdfLib, openForEdit, parseRanges, saveDoc } from "./pdfcore.js?v=11";

const MAX_BYTES = 200 * 1024 * 1024;
const drop = $("#drop"), work = $("#work"), status = $("#status"), result = $("#result"), go = $("#go");
const pos = $("#pos"), fmt = $("#fmt"), start = $("#start"), size = $("#size"), margin = $("#margin");
const range = $("#range"), skip = $("#skip"), sample = $("#sample");

let file = null, bytes = null, pageCount = 0;

dropzone(drop, {
  accept: ["application/pdf", ".pdf"], maxFileBytes: MAX_BYTES, typeLabel: "PDF",
  onError: (m) => setStatus(status, "error", m),
  onFiles: async ([f]) => {
    setStatus(status, "working", tx("Reading the PDF…"));
    clearNode(result); result.hidden = true;
    try {
      const b = await readBytes(f);
      const doc = await openForEdit(b, f.name);
      file = f; bytes = b; pageCount = doc.getPageCount();
      if (!pageCount) throw new UserError(tx("This PDF has no pages."));
      $("#fname").textContent = f.name;
      $("#finfo").textContent = fmtBytes(f.size) + " · " + txn(pageCount, "{n} page", "{n} pages");
      work.hidden = false;
      drop.classList.add("is-compact");
      $("[data-pick-label]", drop).textContent = tx("Choose another PDF");
      setStatus(status, "idle");
      update();
      announce(tx("{name} loaded, {pages}.", { name: f.name, pages: txn(pageCount, "{n} page", "{n} pages") }));
    } catch (err) {
      setStatus(status, "error", err instanceof UserError ? err.message : tx("This file couldn't be read as a PDF."));
    }
  },
});

const scope = () => document.querySelector('input[name="scope"]:checked').value;

function label(n, total) {
  switch (fmt.value) {
    case "page": return tx("Page {n}", { n });
    case "of": return tx("Page {n} of {total}", { n, total });
    case "slash": return `${n} / ${total}`;
    default: return String(n);
  }
}

/* Returns the sorted set of 0-based page indices to number. */
function selection() {
  let pages = [];
  if (scope() === "all") pages = Array.from({ length: pageCount }, (_, i) => i + 1);
  else pages = [...new Set(parseRanges(range.value, pageCount).flat())].sort((a, b) => a - b);
  if (skip.checked) pages = pages.filter((p) => p !== 1);
  if (!pages.length) throw new UserError(tx("No pages are left to number. Check the page range and the skip option."));
  return pages.map((p) => p - 1);
}

function update() {
  $("#range-field").hidden = scope() !== "range";
  let msg = "", ok = true;
  try {
    const sel = selection();
    const s = intVal(start, 0, 99999, "start");
    const last = s + sel.length - 1;
    msg = txn(pageCount, "Example: \"{label}\" on {sel} of {n} page.", "Example: \"{label}\" on {sel} of {n} pages.", { label: label(s, last), sel: sel.length });
    intVal(size, 6, 48, "size"); intVal(margin, 0, 200, "margin");
  } catch (e) { ok = false; msg = e.message; }
  sample.textContent = msg;
  go.disabled = !ok || !bytes;
}
function intVal(input, min, max, kind) {
  const v = Number(input.value);
  if (input.value.trim() === "" || !Number.isInteger(v) || v < min || v > max) throw new UserError(kind === "start" ? tx("Start number must be a whole number from {min} to {max}.", { min, max })
      : kind === "size" ? tx("Font size must be a whole number from {min} to {max}.", { min, max })
      : tx("Margin must be a whole number from {min} to {max}.", { min, max }));
  return v;
}
for (const e of [pos, fmt, start, size, margin, range, skip, ...document.querySelectorAll('input[name="scope"]')]) {
  e.addEventListener("input", update); e.addEventListener("change", update);
}

/* Map a point in the visual page (origin bottom-left, as the page appears) to the unrotated page. */
function mapper(box, rot) {
  const { x: cx, y: cy, width: w, height: h } = box;
  switch (rot) {
    case 90: return { vw: h, vh: w, pt: (vx, vy) => [cx + w - vy, cy + vx] };
    case 180: return { vw: w, vh: h, pt: (vx, vy) => [cx + w - vx, cy + h - vy] };
    case 270: return { vw: h, vh: w, pt: (vx, vy) => [cx + vy, cy + h - vx] };
    default: return { vw: w, vh: h, pt: (vx, vy) => [cx + vx, cy + vy] };
  }
}

go.addEventListener("click", () => runJob({
  status, button: go, working: tx("Adding page numbers…"),
  done: (r) => r && txn(r.n, "Numbered {n} page.", "Numbered {n} pages."),
  job: async (progress) => {
    const sel = selection();
    const s = intVal(start, 0, 99999, "start");
    const fs = intVal(size, 6, 48, "size");
    const mg = intVal(margin, 0, 200, "margin");
    const last = s + sel.length - 1;
    const { StandardFonts, rgb, degrees } = await loadPdfLib();
    const doc = await openForEdit(bytes, file.name);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const pages = doc.getPages();
    const [v, h] = [pos.value[0], pos.value[1]];
    sel.forEach((idx, k) => {
      const page = pages[idx];
      const box = typeof page.getCropBox === "function" ? page.getCropBox() : page.getMediaBox();
      const rot = (((page.getRotation().angle % 360) + 360) % 360);
      const m = mapper(box, rot);
      const text = label(s + k, last);
      const tw = font.widthOfTextAtSize(text, fs);
      const vx = h === "l" ? mg : h === "r" ? m.vw - mg - tw : (m.vw - tw) / 2;
      const vy = v === "b" ? mg : m.vh - mg - fs * 0.72;
      const [x, y] = m.pt(vx, vy);
      page.drawText(text, { x, y, size: fs, font, color: rgb(0.1, 0.1, 0.1), rotate: degrees(rot) });
      if (k % 20 === 0) progress(tx("Numbering page {n}…", { n: idx + 1 }), k / sel.length);
    });
    progress(tx("Writing the file…"), 0.95);
    const blob = await saveDoc(doc);
    showResults(result, [{ blob, name: baseName(file.name) + "-numbered.pdf", note: txn(pageCount, "{n} page", "{n} pages") }]);
    return { n: sel.length };
  },
}));

$("#clear").addEventListener("click", () => {
  file = bytes = null; pageCount = 0;
  work.hidden = true; clearNode(result); result.hidden = true;
  setStatus(status, "idle");
  drop.classList.remove("is-compact");
  $("[data-pick-label]", drop).textContent = tx("Choose a PDF");
  drop.querySelector("input").focus();
});
