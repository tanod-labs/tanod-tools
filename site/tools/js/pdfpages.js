// Shared intake for single-PDF page tools (split, extract, remove, rotate, reorder).
import { $, dropzone, UserError, readBytes, setStatus, clearNode, fmtBytes, announce, tick, tx, txn } from "./core.js?v=11";
import { openForEdit, openForView, closeView, renderPage, pageGrid } from "./pdfcore.js?v=11";

export const MAX_BYTES = 200 * 1024 * 1024;

/* Wire the drop slot for one PDF. Calls onLoad({file, bytes, doc, pageCount}) after pdf-lib has
   opened it; the caller decides what to show. Returns { reset() }. */
export function singlePdf({ onLoad, onReset }) {
  const drop = $("#drop");
  const status = $("#status");
  const result = $("#result");
  const fileBar = $("#filebar");
  const pick = $("[data-pick-label]", drop);
  let token = 0;

  function reset() {
    token++;
    drop.classList.remove("is-compact");
    pick.textContent = tx("Choose a PDF file");
    fileBar.hidden = true;
    clearNode(result); result.hidden = true;
    setStatus(status, "idle");
    onReset && onReset();
  }

  dropzone(drop, {
    accept: ["application/pdf", ".pdf"],
    multiple: false,
    maxFileBytes: MAX_BYTES,
    typeLabel: "PDF",
    onError: (msg) => setStatus(status, "error", msg),
    onFiles: async ([file]) => {
      const my = ++token;
      clearNode(result); result.hidden = true;
      setStatus(status, "working", tx("Opening {name}…", { name: file.name }), null);
      await tick();
      try {
        const bytes = await readBytes(file);
        const doc = await openForEdit(bytes, file.name);
        if (my !== token) return;
        const pageCount = doc.getPageCount();
        if (!pageCount) throw new Error("no pages");
        drop.classList.add("is-compact");
        pick.textContent = tx("Choose another PDF");
        fileBar.hidden = false;
        fileBar.replaceChildren();
        fileBar.append(
          Object.assign(document.createElement("span"), { className: "filebar__name", textContent: file.name }),
          Object.assign(document.createElement("span"), { className: "filebar__meta", textContent: fmtBytes(file.size) + " · " + txn(pageCount, "{n} page", "{n} pages") }));
        setStatus(status, "idle");
        await onLoad({ file, bytes, doc, pageCount, isCurrent: () => my === token });
        announce(tx("{name} opened, {pages}.", { name: file.name, pages: txn(pageCount, "{n} page", "{n} pages") }));
      } catch (err) {
        if (my !== token) return;
        reset();
        setStatus(status, "error", err instanceof UserError ? err.message : tx("\"{name}\" couldn't be opened as a PDF.", { name: file.name }));
      }
    },
  });
  return { reset };
}

/* Thumbnails rendered lazily as they scroll into view, one at a time. */
export async function lazyThumbs(bytes, name, grid, { maxPx = 150, isCurrent = () => true } = {}) {
  let view;
  try {
    view = await openForView(bytes, name);
  } catch (err) {
    console.warn("preview unavailable", err);
    return null;
  }
  const queue = [];
  let busy = false;
  const done = new Set();
  async function pump() {
    if (busy) return;
    busy = true;
    while (queue.length && isCurrent()) {
      const i = queue.shift();
      if (done.has(i)) continue;
      done.add(i);
      try {
        const c = await renderPage(view, i + 1, { maxPx });
        c.setAttribute("aria-hidden", "true");
        if (isCurrent()) grid.setThumb(i, c);
      } catch (err) {
        console.warn("thumbnail", i + 1, err);
      }
    }
    busy = false;
    if (!isCurrent()) closeView(view);
  }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const i = Number(e.target.dataset.index);
      io.unobserve(e.target);
      if (!done.has(i)) queue.push(i);
    }
    queue.sort((a, b) => a - b);
    pump();
  }, { rootMargin: "400px 0px" });
  grid.items.forEach((li) => io.observe(li));
  return view;
}

/* Turn a sorted list of 1-based page numbers into "1-3, 5, 8-9". */
export function compactRanges(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < s.length; i++) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    out.push(i === j ? String(s[i]) : `${s[i]}-${s[j]}`);
    i = j;
  }
  return out.join(", ");
}

export { pageGrid, renderPage };
