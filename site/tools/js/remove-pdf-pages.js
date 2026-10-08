import { $, baseName, runJob, showResults, UserError, tx, txn } from "./core.js?v=5";
import { pagesToNewDoc, saveDoc } from "./pdfcore.js?v=5";
import { pagePicker } from "./pickpages.js?v=5";

const go = $("#go");
const summary = $("#summary");
const status = $("#status");
const result = $("#result");
let state = null;

const picker = pagePicker({
  verb: "remove",
  update: (s) => {
    state = s;
    const n = s.selectedCount;
    const all = n >= s.pageCount;
    go.disabled = n === 0 || all;
    go.textContent = n && !all ? txn(n, "Remove {n} page", "Remove {n} pages") : tx("Remove pages");
    summary.textContent = !n ? tx("Select the pages to delete.") : all ? tx("At least one page has to stay.") : txn(s.pageCount - n, "{n} page will remain", "{n} pages will remain");
  },
});

go.addEventListener("click", () => picker.flush() && !go.disabled && runJob({
  status, button: go,
  working: tx("Removing pages…"),
  done: (left) => left && tx("Removed {removed}; {left} remain.", { removed: txn(state.selectedCount, "{n} page", "{n} pages"), left }),
  job: async () => {
    const drop = new Set(state.pages);
    const keep = [];
    for (let p = 1; p <= state.pageCount; p++) if (!drop.has(p)) keep.push(p - 1);
    if (!keep.length) throw new UserError(tx("At least one page has to stay."));
    const doc = await pagesToNewDoc(state.doc, keep);
    showResults(result, [{ blob: await saveDoc(doc), name: `${baseName(state.file.name)}-edited.pdf`, note: txn(keep.length, "{n} page", "{n} pages") }]);
    return keep.length;
  },
}));
