import { $, baseName, runJob, showResults, clearNode, announce, tx, txn } from "./core.js?v=11";
import { pagesToNewDoc, saveDoc } from "./pdfcore.js?v=11";
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
  const moved = state.order.filter((idx, pos) => idx !== pos).length;
  go.disabled = moved === 0;
  summary.textContent = moved ? txn(moved, "{n} page moved", "{n} pages moved") : tx("Move at least one page.");
}

singlePdf({
  onLoad: ({ file, bytes, doc, pageCount, isCurrent }) => {
    cur = { file, doc, pageCount };
    grid = null;
    grid = pageGrid(gridBox, { count: pageCount, mode: "order", onChange: changed });
    picker.hidden = false;
    goRow.hidden = false;
    changed(grid.state);
    lazyThumbs(bytes, file.name, grid, { isCurrent });
  },
  onReset: () => { cur = null; picker.hidden = true; goRow.hidden = true; gridBox.replaceChildren(); },
});

$("#reverse").addEventListener("click", () => { if (grid) { grid.reverse(); announce(tx("Page order reversed.")); } });
$("#reset").addEventListener("click", () => {
  if (!grid) return;
  grid.state.order.sort((a, b) => a - b);
  grid.refresh();
  announce(tx("Original order restored."));
});

go.addEventListener("click", () => runJob({
  status, button: go,
  working: tx("Saving the new order…"),
  done: () => tx("Saved the pages in the new order."),
  job: async () => {
    const doc = await pagesToNewDoc(cur.doc, grid.state.order);
    showResults(result, [{ blob: await saveDoc(doc), name: `${baseName(cur.file.name)}-reordered.pdf`, note: txn(cur.pageCount, "{n} page", "{n} pages") }]);
    return true;
  },
}));
