import { $, el, icon, fmtBytes, dropzone, readBytes, runJob, setStatus, showResults, clearNode, UserError, announce, tx, txn } from "./core.js?v=11";
import { loadPdfLib, openForEdit, saveDoc } from "./pdfcore.js?v=11";

const MAX_FILES = 50;
const MAX_BYTES = 200 * 1024 * 1024;

const drop = $("#drop");
const list = $("#files");
const goRow = $("#go-row");
const go = $("#go");
const summary = $("#summary");
const status = $("#status");
const result = $("#result");
const pickLabel = $("[data-pick-label]", drop);

let items = []; // {id, file, pages: number|null|"error"}
let nextId = 1;

dropzone(drop, {
  accept: ["application/pdf", ".pdf"],
  multiple: true,
  maxFileBytes: MAX_BYTES,
  typeLabel: "PDF",
  onError: (msg) => setStatus(status, "error", msg),
  onFiles: (files) => {
    const room = MAX_FILES - items.length;
    if (room <= 0) return setStatus(status, "error", tx("You can merge up to {max} files at once.", { max: MAX_FILES }));
    if (files.length > room) setStatus(status, "error", txn(room, "Only {n} more file fits; the rest were skipped.", "Only {n} more files fit; the rest were skipped."));
    else setStatus(status, "idle");
    for (const file of files.slice(0, room)) {
      const item = { id: nextId++, file, pages: null };
      items.push(item);
      countPages(item);
    }
    clearNode(result); result.hidden = true;
    render();
    announce(txn(items.length, "{n} file ready to merge.", "{n} files ready to merge."));
  },
});

async function countPages(item) {
  try {
    const { PDFDocument } = await loadPdfLib();
    const doc = await PDFDocument.load(await readBytes(item.file), { updateMetadata: false });
    item.pages = doc.getPageCount();
  } catch (_) {
    item.pages = "error";
  }
  render();
}

function move(id, delta) {
  const i = items.findIndex((x) => x.id === id);
  const j = i + delta;
  if (j < 0 || j >= items.length) return;
  [items[i], items[j]] = [items[j], items[i]];
  render();
  const btn = list.querySelector(`[data-id="${id}"] [data-move="${delta}"]`);
  (btn && !btn.disabled ? btn : list.querySelector(`[data-id="${id}"] [data-move]:not(:disabled)`))?.focus();
}

function remove(id) {
  items = items.filter((x) => x.id !== id);
  render();
  announce(tx("File removed."));
  if (!items.length) drop.querySelector("input").focus();
}

function render() {
  list.replaceChildren(...items.map((it, i) => {
    const meta = it.pages === null ? tx("counting pages…")
      : it.pages === "error" ? tx("can't be read: encrypted or damaged")
      : txn(it.pages, "{n} page", "{n} pages");
    return el("li", { "data-id": String(it.id) },
      el("span", { class: "files__idx" }, String(i + 1)),
      el("span", { class: "files__name" }, it.file.name,
        el("span", { class: "files__meta" }, `${fmtBytes(it.file.size)} · ${meta}`)),
      el("span", { class: "files__btns" },
        el("button", { type: "button", class: "btn btn--sm btn--icon btn--quiet", "data-move": "-1", disabled: i === 0,
          "aria-label": tx("Move {name} up", { name: it.file.name }), onclick: () => move(it.id, -1) }, icon("i-arrow-up")),
        el("button", { type: "button", class: "btn btn--sm btn--icon btn--quiet", "data-move": "1", disabled: i === items.length - 1,
          "aria-label": tx("Move {name} down", { name: it.file.name }), onclick: () => move(it.id, 1) }, icon("i-arrow-down")),
        el("button", { type: "button", class: "btn btn--sm btn--icon btn--quiet",
          "aria-label": tx("Remove {name}", { name: it.file.name }), onclick: () => remove(it.id) }, icon("i-x"))));
  }));
  const has = items.length > 0;
  list.hidden = !has;
  goRow.hidden = !has;
  drop.classList.toggle("is-compact", has);
  pickLabel.textContent = has ? tx("Add more PDFs") : tx("Choose PDF files");
  const total = items.reduce((s, x) => s + (typeof x.pages === "number" ? x.pages : 0), 0);
  go.disabled = items.length < 2;
  summary.textContent = items.length < 2 ? tx("Add at least two files.") : txn(items.length, "{n} file", "{n} files") + " · " + txn(total, "{n} page", "{n} pages");
}

go.addEventListener("click", () => runJob({
  status, button: go,
  working: tx("Merging…"),
  done: (out) => out && tx("Merged {files} into one PDF with {pages}.", { files: txn(out.files, "{n} file", "{n} files"), pages: txn(out.pages, "{n} page", "{n} pages") }),
  job: async (progress) => {
    const { PDFDocument } = await loadPdfLib();
    const out = await PDFDocument.create();
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      progress(tx("Adding {name} ({i} of {n})…", { name: it.file.name, i: i + 1, n: items.length }), i / items.length);
      const src = await openForEdit(await readBytes(it.file), it.file.name);
      const pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach((p) => out.addPage(p));
    }
    if (!out.getPageCount()) throw new UserError(tx("The files have no pages to merge."));
    progress(tx("Writing the merged file…"), 0.97);
    const blob = await saveDoc(out);
    showResults(result, [{ blob, name: "merged.pdf", note: txn(out.getPageCount(), "{n} page", "{n} pages") }]);
    return { files: items.length, pages: out.getPageCount() };
  },
}));

$("#clear").addEventListener("click", () => {
  items = [];
  clearNode(result); result.hidden = true;
  setStatus(status, "idle");
  render();
  drop.querySelector("input").focus();
});
