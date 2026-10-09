import { $, baseName, runJob, showResults, clearNode, tx, txn } from "./core.js?v=11";
import { loadPdfLib, saveDoc, openForEdit } from "./pdfcore.js?v=11";
import { singlePdf, lazyThumbs, pageGrid } from "./pdfpages.js?v=11";

const picker = $("#picker");
const gridBox = $("#grid");
const goRow = $("#go-row");
const go = $("#go");
const summary = $("#summary");
const status = $("#status");
const result = $("#result");
let cur = null;
let grid = null;

function changed(state) {
  if (!cur) return;
  clearNode(result); result.hidden = true;
  const n = state.rotation.filter(Boolean).length;
  go.disabled = n === 0;
  summary.textContent = n ? txn(n, "{n} page will be rotated", "{n} pages will be rotated") : tx("Turn at least one page.");
}

singlePdf({
  onLoad: ({ file, bytes, doc, pageCount, isCurrent }) => {
    cur = { file, bytes, doc, pageCount };
    gridBox.classList.add("thumbs-wrap");
    grid = pageGrid(gridBox, { count: pageCount, mode: "rotate", onChange: changed });
    gridBox.firstChild.classList.add("thumbs--square");
    picker.hidden = false;
    goRow.hidden = false;
    changed(grid.state);
    lazyThumbs(bytes, file.name, grid, { isCurrent });
  },
  onReset: () => { cur = null; picker.hidden = true; goRow.hidden = true; gridBox.replaceChildren(); },
});

$("#all-left").addEventListener("click", () => grid && grid.rotateAll(270));
$("#all-right").addEventListener("click", () => grid && grid.rotateAll(90));
$("#reset").addEventListener("click", () => { if (grid) { grid.state.rotation.fill(0); grid.refresh(); } });

go.addEventListener("click", () => runJob({
  status, button: go,
  working: tx("Rotating…"),
  done: (n) => n && txn(n, "Rotated {n} page.", "Rotated {n} pages."),
  job: async () => {
    const { degrees } = await loadPdfLib();
    // Work on a fresh copy so repeated saves don't stack rotations.
    const doc = await openForEdit(cur.bytes, cur.file.name);
    let n = 0;
    doc.getPages().forEach((page, i) => {
      const delta = grid.state.rotation[i];
      if (!delta) return;
      n++;
      page.setRotation(degrees((((page.getRotation().angle + delta) % 360) + 360) % 360));
    });
    showResults(result, [{ blob: await saveDoc(doc), name: `${baseName(cur.file.name)}-rotated.pdf`, note: txn(cur.pageCount, "{n} page", "{n} pages") }]);
    return n;
  },
}));
