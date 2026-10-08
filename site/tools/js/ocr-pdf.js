import { $, el, fmtBytes, dropzone, setStatus, showResults, clearNode, baseName, announce, UserError, copyText, textBlob, blobLink, tx, txn } from "./core.js?v=5";
import { loadPdfLib, parseRanges } from "./pdfcore.js?v=5";
import { serverInit, runServerJob, serverJob, fileToBase64, blobFromBase64, checkSize, available } from "./servercore.js?v=5";

const MAX_PAGES = 10;
const drop = $("#drop"), work = $("#work"), status = $("#status"), result = $("#result"), go = $("#go");
const range = $("#range"), redo = $("#redo");
let file = null, pageCount = 0, rangeHelp = "";

dropzone(drop, {
  accept: ["application/pdf", ".pdf"], typeLabel: "PDF",
  onError: (m) => setStatus(status, "error", m),
  onFiles: async ([f]) => {
    clearNode(result); result.hidden = true;
    try { checkSize(f); } catch (e) { setStatus(status, "error", e.message); return; }
    setStatus(status, "working", tx("Counting pages…"));
    try {
      const { PDFDocument } = await loadPdfLib();
      const doc = await PDFDocument.load(new Uint8Array(await f.arrayBuffer()), { ignoreEncryption: true, updateMetadata: false });
      if (doc.isEncrypted) throw new UserError(tx("\"{name}\" is password-protected. Remove the password first with Unlock PDF, then make it searchable.", { name: f.name }));
      pageCount = doc.getPageCount();
      if (!pageCount) throw new UserError(tx("This PDF has no pages."));
    } catch (e) {
      setStatus(status, "error", e instanceof UserError ? e.message : tx("\"{name}\" couldn't be read as a PDF. It may be damaged or not a PDF.", { name: f.name }));
      return;
    }
    file = f;
    $("#fname").textContent = f.name;
    $("#finfo").textContent = fmtBytes(f.size) + " · " + txn(pageCount, "{n} page", "{n} pages");
    range.value = pageCount <= MAX_PAGES ? (pageCount === 1 ? "1" : `1-${pageCount}`) : `1-${MAX_PAGES}`;
    rangeHelp = pageCount <= MAX_PAGES
      ? txn(pageCount, "All {n} page will be read. Up to {max} pages per job.", "All {n} pages will be read. Up to {max} pages per job.", { max: MAX_PAGES })
      : tx("This PDF has {n} pages; each job reads up to {max}. Run it again for the next pages (for example 11-20) on the file you download.", { n: pageCount, max: MAX_PAGES });
    work.hidden = false;
    drop.classList.add("is-compact");
    $("[data-pick-label]", drop).textContent = tx("Choose another PDF");
    setStatus(status, "idle");
    update();
    announce(tx("{name} loaded, {pages}.", { name: f.name, pages: txn(pageCount, "{n} page", "{n} pages") }));
  },
});

function selection() {
  const parts = parseRanges(range.value, pageCount);            // throws UserError on bad input
  const pages = [...new Set(parts.flat())];
  if (!pages.length) throw new UserError(tx("Choose at least one page."));
  if (pages.length > MAX_PAGES) throw new UserError(tx("Choose at most {max} pages per job (you chose {n}).", { max: MAX_PAGES, n: pages.length }));
  pages.sort((a, b) => a - b);
  // Closed parts only (the server's rule): collapse to N or N-M runs.
  const runs = [];
  for (const p of pages) {
    const last = runs[runs.length - 1];
    if (last && p === last[1] + 1) last[1] = p; else runs.push([p, p]);
  }
  return runs.map(([a, b]) => (a === b ? String(a) : `${a}-${b}`)).join(",");
}

function update() {
  let ok = !!file && available();
  range.removeAttribute("aria-invalid");
  $("#range-help").textContent = rangeHelp;
  if (file) {
    try { selection(); } catch (e) {
      ok = false;
      range.setAttribute("aria-invalid", "true");
      $("#range-help").textContent = e.message;
    }
  }
  go.disabled = !ok;
}
range.addEventListener("input", update);

go.addEventListener("click", () => serverJob({
  status, button: go,
  done: (r) => r && r.msg,
  job: async (phase) => {
    if (!file) throw new UserError(tx("Choose a PDF first."));
    const pages = selection();
    phase(tx("Reading the file…"));
    const b64 = await fileToBase64(file);
    const j = await runServerJob("/pdf/ocr", { pdf_base64: b64, pages, skip_text: !redo.checked }, { onPhase: phase });
    const blob = blobFromBase64(j.file.data_base64, "application/pdf");
    const read = (j.ocr_pages || []).length, skipped = (j.skipped_has_text || []).length;
    const text = j.text || "";
    const extra = [];
    if (text.trim()) {
      const copy = el("button", { class: "btn btn--sm", type: "button" }, tx("Copy text"));
      copy.addEventListener("click", () => copyText(text, copy));
      extra.push(copy, blobLink(textBlob(text), baseName(file.name) + ".txt", tx("Text (.txt)"), "btn btn--sm"));
    }
    showResults(result, [{ blob, name: baseName(file.name) + "-searchable.pdf" }], {
      title: read ? txn(read, "Text layer added to {n} page", "Text layer added to {n} pages") : tx("No pages needed reading"),
      extra,
      note: [
        skipped ? txn(skipped, "{n} page already had text and was left as is.", "{n} pages already had text and were left as is.") : "",
        j.text_truncated ? tx("The text preview is shortened; the PDF has all of it.") : "",
        tx("The pages look the same; the recognised text sits invisibly on top, so you can search, select and copy it."),
      ].filter(Boolean).join(" "),
    });
    if (text.trim()) {
      const pre = el("pre", { class: "out ocr-text", tabindex: "0", "aria-label": tx("Recognised text") });
      pre.textContent = text;
      result.querySelector(".result").append(el("details", { class: "ocr-more" }, el("summary", {}, tx("Show the recognised text")), pre));
    }
    return { msg: read
      ? (skipped ? txn(read, "Done. Read {n} page; {skipped} already searchable.", "Done. Read {n} pages; {skipped} already searchable.", { skipped })
        : txn(read, "Done. Read {n} page.", "Done. Read {n} pages."))
      : tx("Done. Every chosen page already had text; tick \"Read pages that already have text\" to redo them.") };
  },
}));

$("#clear").addEventListener("click", () => {
  file = null; pageCount = 0;
  work.hidden = true; clearNode(result); result.hidden = true;
  setStatus(status, "idle");
  drop.classList.remove("is-compact");
  $("[data-pick-label]", drop).textContent = tx("Choose a PDF");
  drop.querySelector("input").focus();
});

serverInit().then(update);
