import { $, fmtBytes, dropzone, readBytes, runJob, setStatus, showResults, clearNode, baseName, UserError, announce, tx } from "./core.js?v=11";
import { loadPdfLib, openForEdit, saveDoc } from "./pdfcore.js?v=11";

const MAX_BYTES = 200 * 1024 * 1024;
const drop = $("#drop"), work = $("#work"), status = $("#status"), result = $("#result");
const go = $("#go"), wipe = $("#wipe");
const FIELDS = [["Title", "title", "getTitle"], ["Author", "author", "getAuthor"], ["Subject", "subject", "getSubject"],
  ["Keywords", "keywords", "getKeywords"], ["Creator", "creator", "getCreator"], ["Producer", "producer", "getProducer"]];
const keep = $("#keep-dates"), created = $("#m-created"), modified = $("#m-modified"), dropXmp = $("#drop-xmp");

let file = null, bytes = null, orig = null;

const pad = (n) => String(n).padStart(2, "0");
const toLocalInput = (d) => (d instanceof Date && !isNaN(d) ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` : "");

async function hasXmp(doc) {
  const { PDFName } = await loadPdfLib();
  return !!doc.catalog.get(PDFName.of("Metadata"));
}

dropzone(drop, {
  accept: ["application/pdf", ".pdf"], maxFileBytes: MAX_BYTES, typeLabel: "PDF",
  onError: (m) => setStatus(status, "error", m),
  onFiles: async ([f]) => {
    setStatus(status, "working", tx("Reading the PDF…"));
    clearNode(result); result.hidden = true;
    try {
      const b = await readBytes(f);
      const doc = await openForEdit(b, f.name);
      file = f; bytes = b;
      orig = { xmp: await hasXmp(doc) };
      for (const [, id, getter] of FIELDS) { orig[id] = doc[getter]() || ""; $("#m-" + id).value = orig[id]; }
      orig.created = toLocalInput(doc.getCreationDate()); orig.modified = toLocalInput(doc.getModificationDate());
      created.value = orig.created; modified.value = orig.modified;
      keep.checked = true; syncDates();
      dropXmp.checked = orig.xmp;
      $("#xmp-help").textContent = orig.xmp ? tx("This file has an XMP stream, which can still show the old values in some viewers.") : tx("This file has no XMP stream.");
      dropXmp.disabled = !orig.xmp;
      const head = new TextDecoder("latin1").decode(b.subarray(0, 16));
      const ver = (head.match(/%PDF-(\d\.\d)/) || [])[1];
      $("#s-pages").textContent = String(doc.getPageCount());
      $("#s-ver").textContent = ver || tx("unknown");
      $("#s-xmp").textContent = orig.xmp ? tx("present") : tx("none");
      $("#fname").textContent = f.name;
      $("#finfo").textContent = fmtBytes(f.size);
      work.hidden = false;
      drop.classList.add("is-compact");
      $("[data-pick-label]", drop).textContent = tx("Choose another PDF");
      setStatus(status, "idle");
      announce(tx("{name} loaded.", { name: f.name }));
    } catch (err) {
      setStatus(status, "error", err instanceof UserError ? err.message : tx("This file couldn't be read as a PDF."));
    }
  },
});

function syncDates() { created.disabled = modified.disabled = keep.checked; }
keep.addEventListener("change", syncDates);

function parseLocal(v, kind) {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d)) throw new UserError(kind === "created" ? tx("The created date isn't a valid date and time.") : tx("The modified date isn't a valid date and time."));
  return d;
}

async function save(removeAll) {
  const { PDFName, PDFHexString, PDFRef } = await loadPdfLib();
  const doc = await openForEdit(bytes, file.name);
  const info = doc.getInfoDict();
  const key = (n) => PDFName.of(n);
  // pdf-lib writes every object it holds, so unlink AND delete the XMP stream object.
  const dropMetadata = () => {
    const m = doc.catalog.get(key("Metadata"));
    doc.catalog.delete(key("Metadata"));
    if (m instanceof PDFRef) doc.context.delete(m);
  };
  if (removeAll) {
    for (const k of [...info.keys()]) info.delete(k);
    dropMetadata();
  } else {
    for (const [name, id] of FIELDS) {
      const v = $("#m-" + id).value;
      if (v === orig[id]) continue;
      if (v.trim() === "") info.delete(key(name));
      else info.set(key(name), PDFHexString.fromText(v));
    }
    if (!keep.checked) {
      if (created.value !== orig.created) { const d = parseLocal(created.value, "created"); d ? doc.setCreationDate(d) : info.delete(key("CreationDate")); }
      if (modified.value !== orig.modified) { const d = parseLocal(modified.value, "modified"); d ? doc.setModificationDate(d) : info.delete(key("ModDate")); }
    }
    if (dropXmp.checked) dropMetadata();
  }
  return saveDoc(doc);
}

for (const [btn, all] of [[go, false], [wipe, true]]) {
  btn.addEventListener("click", async () => {
    const other = all ? go : wipe;
    other.disabled = true;
    await runJob({
      status, button: btn, working: all ? tx("Removing metadata…") : tx("Saving changes…"),
      done: all ? tx("All metadata removed.") : tx("Changes saved."),
      job: async () => {
        const blob = await save(all);
        showResults(result, [{ blob, name: baseName(file.name) + ".pdf", note: all ? tx("metadata removed") : tx("properties updated") }],
          { note: tx("The file keeps its original name. Make sure you open the new download, not the original.") });
        if (all) {
          for (const [, id] of FIELDS) $("#m-" + id).value = "";
          created.value = modified.value = "";
        }
      },
    });
    other.disabled = false;
  });
}

$("#clear").addEventListener("click", () => {
  file = bytes = orig = null;
  work.hidden = true; clearNode(result); result.hidden = true;
  setStatus(status, "idle");
  drop.classList.remove("is-compact");
  $("[data-pick-label]", drop).textContent = tx("Choose a PDF");
  drop.querySelector("input").focus();
});
