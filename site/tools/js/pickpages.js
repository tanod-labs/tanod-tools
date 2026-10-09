// Page picking shared by Extract pages and Remove pages: thumbnails and a ranges box kept in sync.
import { $, setStatus, debounce, clearNode } from "./core.js?v=11";
import { parseRanges } from "./pdfcore.js?v=11";
import { singlePdf, lazyThumbs, compactRanges, pageGrid } from "./pdfpages.js?v=11";

/* verb: "extract" | "remove". update(state) is called with
   { file, doc, pageCount, pages: [1-based page numbers in output order], selectedCount }. */
export function pagePicker({ verb, update }) {
  const picker = $("#picker");
  const gridBox = $("#grid");
  const rangesIn = $("#ranges");
  const status = $("#status");
  const result = $("#result");
  const goRow = $("#go-row");
  let cur = null;
  let grid = null;
  let typedOrder = null;
  let fromTyping = false;

  function emit() {
    if (!cur) return;
    const sel = [...grid.state.selected].map((i) => i + 1).sort((a, b) => a - b);
    const pages = typedOrder && typedOrder.length === sel.length && typedOrder.every((p) => grid.state.selected.has(p - 1)) ? typedOrder : sel;
    update({ ...cur, pages, selectedCount: sel.length });
  }

  function fromGrid() {
    if (fromTyping || !grid) return;
    pending = false;
    typedOrder = null;
    rangesIn.value = compactRanges([...grid.state.selected].map((i) => i + 1));
    rangesIn.removeAttribute("aria-invalid");
    if (status.dataset.state === "error") setStatus(status, "idle");
    clearNode(result); result.hidden = true;
    emit();
  }

  let pending = false;
  function applyTyped() {
    pending = false;
    if (!cur) return;
    clearNode(result); result.hidden = true;
    const text = rangesIn.value.trim();
    let flat = [];
    if (text) {
      try {
        flat = parseRanges(text, cur.pageCount).flat();
        rangesIn.removeAttribute("aria-invalid");
        if (status.dataset.state === "error") setStatus(status, "idle");
      } catch (err) {
        rangesIn.setAttribute("aria-invalid", "true");
        setStatus(status, "error", err.message);
        return;
      }
    } else if (status.dataset.state === "error") setStatus(status, "idle");
    const seen = new Set();
    typedOrder = flat.filter((p) => (seen.has(p) ? false : (seen.add(p), true)));
    fromTyping = true;
    grid.state.selected = new Set(typedOrder.map((p) => p - 1));
    grid.refresh();
    fromTyping = false;
    emit();
  }
  const typed = debounce(applyTyped, 200);
  rangesIn.addEventListener("input", () => { pending = true; typed(); });

  $("#all").addEventListener("click", () => grid && grid.selectAll(true));
  $("#none").addEventListener("click", () => grid && grid.selectAll(false));

  singlePdf({
    onLoad: async ({ file, bytes, doc, pageCount, isCurrent }) => {
      cur = { file, doc, pageCount };
      typedOrder = null;
      rangesIn.value = "";
      grid = null;
      grid = pageGrid(gridBox, {
        count: pageCount,
        mode: "select",
        selectKind: verb,
        onChange: fromGrid,
      });
      if (verb === "remove") gridBox.classList.add("is-remove");
      picker.hidden = false;
      goRow.hidden = false;
      emit();
      lazyThumbs(bytes, file.name, grid, { isCurrent });
    },
    onReset: () => { cur = null; picker.hidden = true; goRow.hidden = true; gridBox.replaceChildren(); },
  });

  /* Apply a range still waiting on the debounce (e.g. the user typed and pressed the button at once). */
  return { current: () => cur, flush: () => { if (pending) applyTyped(); return !rangesIn.hasAttribute("aria-invalid"); } };
}
