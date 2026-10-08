import { $, baseName, runJob, showResults, tx, txn } from "./core.js?v=5";
import { pagesToNewDoc, saveDoc } from "./pdfcore.js?v=5";
import { pagePicker } from "./pickpages.js?v=5";

const go = $("#go");
const each = $("#each");
const summary = $("#summary");
const status = $("#status");
const result = $("#result");
let state = null;

const picker = pagePicker({
  verb: "extract",
  update: (s) => {
    state = s;
    const n = s.pages.length;
    go.disabled = n === 0;
    go.textContent = n ? txn(n, "Extract {n} page", "Extract {n} pages") : tx("Extract pages");
    summary.textContent = n ? tx("{n} of {total} pages selected", { n, total: s.pageCount }) : tx("Select at least one page.");
  },
});

go.addEventListener("click", () => picker.flush() && !go.disabled && runJob({
  status, button: go,
  working: tx("Extracting…"),
  done: (n) => n && txn(state.pages.length, "Extracted {n} page.", "Extracted {n} pages."),
  job: async (progress) => {
    const base = baseName(state.file.name);
    const outputs = [];
    if (each.checked) {
      for (let i = 0; i < state.pages.length; i++) {
        const p = state.pages[i];
        progress(tx("Writing page {p} ({i} of {n})…", { p, i: i + 1, n: state.pages.length }), i / state.pages.length);
        outputs.push({ blob: await saveDoc(await pagesToNewDoc(state.doc, [p - 1])), name: `${base}-page-${p}.pdf` });
      }
    } else {
      const doc = await pagesToNewDoc(state.doc, state.pages.map((p) => p - 1));
      outputs.push({ blob: await saveDoc(doc), name: `${base}-extracted.pdf`, note: txn(state.pages.length, "{n} page", "{n} pages") });
    }
    showResults(result, outputs, { zipName: `${base}-pages.zip` });
    return outputs.length;
  },
}));
