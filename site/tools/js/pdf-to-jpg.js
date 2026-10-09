import { $, el, fmtBytes, dropzone, readBytes, runJob, setStatus, showResults, clearNode, baseName, UserError, announce, tx, txn } from "./core.js?v=11";
import { openForView, renderPage, parseRanges } from "./pdfcore.js?v=11";

const MAX_BYTES = 200 * 1024 * 1024;
const MAX_PAGES = 200;
const MAX_SIDE = 10000;
const MAX_PIXELS = 100e6;
const drop = $("#drop"), work = $("#work"), status = $("#status"), result = $("#result"), go = $("#go");
const previews = $("#previews"), quality = $("#quality"), range = $("#range");

let file = null, bytes = null, pageCount = 0;

dropzone(drop, {
  accept: ["application/pdf", ".pdf"], maxFileBytes: MAX_BYTES, typeLabel: "PDF",
  onError: (m) => setStatus(status, "error", m),
  onFiles: async ([f]) => {
    setStatus(status, "working", tx("Reading the PDF…"));
    reset();
    try {
      const b = await readBytes(f);
      const doc = await openForView(b, f.name);
      pageCount = doc.numPages;
      doc.cleanup && doc.cleanup();
      if (!pageCount) throw new UserError(tx("This PDF has no pages."));
      file = f; bytes = b;
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

const radio = (n) => document.querySelector(`input[name="${n}"]:checked`).value;
function reset() { clearNode(result); result.hidden = true; previews.replaceChildren(); previews.hidden = true; }

function update() {
  $("#range-field").hidden = radio("scope") !== "range";
  $("#q-field").hidden = radio("fmt") !== "jpg";
  $("#quality-v").textContent = quality.value;
  go.disabled = !bytes;
}
for (const e of [quality, range, ...document.querySelectorAll("input[name]")]) { e.addEventListener("input", update); e.addEventListener("change", update); }

const toBlob = (canvas, type, q) => new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error(tx("The browser couldn't encode this image.")))), type, q));
const pad = (n, total) => String(n).padStart(Math.max(2, String(total).length), "0");

go.addEventListener("click", () => runJob({
  status, button: go, working: tx("Opening the PDF…"),
  done: (r) => r && txn(r.n, "Converted {n} page to {ext}.", "Converted {n} pages to {ext}.", { ext: r.ext.toUpperCase() }) + (r.reduced ? " " + txn(r.reduced, "{n} page was drawn at a lower resolution (lowest {dpi} dpi) to stay within browser limits.", "{n} pages were drawn at a lower resolution (lowest {dpi} dpi) to stay within browser limits.", { dpi: Math.round(r.minDpi) }) : ""),
  job: async (progress) => {
    let pages = Array.from({ length: pageCount }, (_, i) => i + 1);
    if (radio("scope") === "range") pages = [...new Set(parseRanges(range.value, pageCount).flat())].sort((a, b) => a - b);
    if (pages.length > MAX_PAGES) throw new UserError(tx("That is {n} pages; the limit is {max} per run. Choose a smaller range.", { n: pages.length, max: MAX_PAGES }));
    const png = radio("fmt") === "png";
    const ext = png ? "png" : "jpg";
    const dpi = Number(radio("dpi"));
    const q = Number(quality.value) / 100;
    reset();
    const doc = await openForView(bytes, file.name);
    const outs = [];
    let reduced = 0, minDpi = dpi;
    const prevItems = [];
    try {
      for (let k = 0; k < pages.length; k++) {
        const n = pages[k];
        progress(tx("Rendering page {p} ({i} of {n})…", { p: n, i: k + 1, n: pages.length }), k / pages.length);
        const page = await doc.getPage(n);
        const base = page.getViewport({ scale: 1 });
        page.cleanup();
        let scale = dpi / 72;
        const w = base.width * scale, h = base.height * scale;
        let f = 1;
        if (Math.max(w, h) > MAX_SIDE) f = Math.min(f, MAX_SIDE / Math.max(w, h));
        if (w * h > MAX_PIXELS) f = Math.min(f, Math.sqrt(MAX_PIXELS / (w * h)));
        if (f < 1) { scale *= f * 0.999; reduced++; minDpi = Math.min(minDpi, scale * 72); }
        const canvas = await renderPage(doc, n, { scale });
        const blob = await toBlob(canvas, png ? "image/png" : "image/jpeg", q);
        if (prevItems.length < 6) {
          const pc = document.createElement("canvas");
          const r = Math.min(1, 160 / Math.max(canvas.width, canvas.height));
          pc.width = Math.max(1, Math.round(canvas.width * r)); pc.height = Math.max(1, Math.round(canvas.height * r));
          pc.getContext("2d").drawImage(canvas, 0, 0, pc.width, pc.height);
          pc.setAttribute("role", "img");
          pc.setAttribute("aria-label", tx("Preview of page {n}", { n }));
          prevItems.push(el("li", { class: "thumb" }, el("div", { class: "thumb__img" }, pc), el("span", { class: "thumb__label" }, tx("Page {n}", { n }))));
        }
        canvas.width = canvas.height = 0;
        outs.push({ blob, name: `${baseName(file.name)}-page-${pad(n, pageCount)}.${ext}`, note: `${Math.round(base.width * scale)} x ${Math.round(base.height * scale)} px` });
      }
    } finally { doc.cleanup && doc.cleanup(); }
    progress(tx("Preparing the download…"), 0.98);
    showResults(result, outs, { title: outs.length === 1 ? outs[0].name : txn(outs.length, "{n} {ext} image is ready", "{n} {ext} images are ready", { ext: ext.toUpperCase() }), zipName: `${baseName(file.name)}-${ext}.zip` });
    if (prevItems.length) {
      previews.replaceChildren(
        el("p", { class: "label" }, outs.length > prevItems.length ? tx("Preview of the first {n} pages", { n: prevItems.length }) : tx("Preview")),
        el("ol", { class: "thumbs", "aria-label": tx("Previews") }, ...prevItems));
      previews.hidden = false;
    }
    return { n: outs.length, ext, reduced, minDpi };
  },
}));

$("#clear").addEventListener("click", () => {
  file = bytes = null; pageCount = 0;
  work.hidden = true; reset();
  setStatus(status, "idle");
  drop.classList.remove("is-compact");
  $("[data-pick-label]", drop).textContent = tx("Choose a PDF");
  drop.querySelector("input").focus();
});
