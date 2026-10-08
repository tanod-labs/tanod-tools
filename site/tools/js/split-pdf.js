import { $, $$, el, baseName, runJob, showResults, setStatus, clearNode, debounce, UserError, tx, txn, txf } from "./core.js?v=5";
import { parseRanges, pagesToNewDoc, saveDoc } from "./pdfcore.js?v=5";
import { singlePdf } from "./pdfpages.js?v=5";

const opts = $("#opts");
const planWrap = $("#plan-wrap");
const plan = $("#plan");
const planTitle = $("#plan-title");
const goRow = $("#go-row");
const go = $("#go");
const status = $("#status");
const result = $("#result");
const rangesIn = $("#ranges");
const everyIn = $("#every");

let current = null; // { file, doc, pageCount }

const mode = () => $('input[name="mode"]:checked').value;

function groups() {
  const n = current.pageCount;
  if (mode() === "single") return Array.from({ length: n }, (_, i) => [i + 1]);
  if (mode() === "every") {
    const k = Math.floor(Number(everyIn.value));
    if (!Number.isFinite(k) || k < 1) throw new UserError(tx("Enter how many pages each file should have (1 or more)."));
    const out = [];
    for (let p = 1; p <= n; p += k) out.push(Array.from({ length: Math.min(k, n - p + 1) }, (_, i) => p + i));
    return out;
  }
  return parseRanges(rangesIn.value, n);
}

const label = (g) => (g.length === 1 ? tx("page {n}", { n: g[0] }) : tx("pages {from}-{to}", { from: g[0], to: g[g.length - 1] }));
const isRun = (g) => g.every((p, i) => i === 0 || Math.abs(p - g[i - 1]) === 1);
const nameFor = (g) => {
  const base = baseName(current.file.name);
  if (g.length === 1) return `${base}-page-${g[0]}.pdf`;
  if (isRun(g)) return `${base}-pages-${g[0]}-${g[g.length - 1]}.pdf`;
  return `${base}-pages-${g[0]}-etc.pdf`;
};

function updatePlan() {
  if (!current) return;
  $$("[data-for]").forEach((f) => { f.hidden = f.dataset.for !== mode(); });
  rangesIn.removeAttribute("aria-invalid");
  try {
    const gs = groups();
    const shown = gs.slice(0, 24).map((g, i) => el("li", {}, ...txf("File {n}: {what}", { n: i + 1, what: el("b", {}, isRun(g) ? label(g) : txn(g.length, "{n} page", "{n} pages")) })));
    if (gs.length > 24) shown.push(el("li", { class: "plan__more" }, tx("and {n} more", { n: gs.length - 24 })));
    plan.replaceChildren(...shown);
    planTitle.textContent = txn(gs.length, "{n} file to create", "{n} files to create");
    planWrap.hidden = false;
    go.disabled = false;
    go.textContent = gs.length === 1 ? tx("Split PDF") : txn(gs.length, "Split into {n} file", "Split into {n} files");
    if (status.dataset.state === "error") setStatus(status, "idle");
  } catch (err) {
    planWrap.hidden = true;
    go.disabled = true;
    if (mode() === "ranges" && !rangesIn.value.trim()) { setStatus(status, "idle"); return; }
    if (mode() === "ranges") rangesIn.setAttribute("aria-invalid", "true");
    setStatus(status, "error", err.message);
  }
}

singlePdf({
  onLoad: ({ file, doc, pageCount }) => {
    current = { file, doc, pageCount };
    if (!rangesIn.value.trim() || rangesIn.dataset.auto) {
      const half = Math.ceil(pageCount / 2);
      rangesIn.value = pageCount > 1 ? `1-${half}, ${half + 1}-` : "1";
      rangesIn.dataset.auto = "1";
    }
    opts.hidden = false;
    goRow.hidden = false;
    updatePlan();
  },
  onReset: () => { current = null; opts.hidden = true; planWrap.hidden = true; goRow.hidden = true; },
});

const later = debounce(updatePlan, 120);
rangesIn.addEventListener("input", () => { delete rangesIn.dataset.auto; clearNode(result); result.hidden = true; later(); });
everyIn.addEventListener("input", () => { clearNode(result); result.hidden = true; later(); });
$$('input[name="mode"]').forEach((r) => r.addEventListener("change", () => { clearNode(result); result.hidden = true; updatePlan(); }));

go.addEventListener("click", () => runJob({
  status, button: go,
  working: tx("Splitting…"),
  done: (n) => n && txn(n, "Split into {n} file.", "Split into {n} files."),
  job: async (progress) => {
    const gs = groups();
    const outputs = [];
    for (let i = 0; i < gs.length; i++) {
      progress(tx("Writing file {i} of {n}…", { i: i + 1, n: gs.length }), i / gs.length);
      const part = await pagesToNewDoc(current.doc, gs[i].map((p) => p - 1));
      outputs.push({ blob: await saveDoc(part), name: nameFor(gs[i]), note: txn(gs[i].length, "{n} page", "{n} pages") });
    }
    showResults(result, outputs, { zipName: `${baseName(current.file.name)}-split.zip` });
    return outputs.length;
  },
}));
