// PDF helpers: pdf-lib (MIT) for editing, pdf.js (Apache-2.0) for rendering. Both run locally.
import { el, icon, UserError, tx } from "./core.js?v=5";

const V = "/tools/vendor/";
let libP, jsP;

export function loadPdfLib() {
  if (!libP) libP = import(V + "pdf-lib/pdf-lib.esm.min.js");
  return libP;
}

export function loadPdfJs() {
  if (!jsP) {
    jsP = import(V + "pdfjs/pdf.min.mjs").then((m) => {
      m.GlobalWorkerOptions.workerSrc = V + "pdfjs/pdf.worker.min.mjs";
      return m;
    });
  }
  return jsP;
}

/* Open a PDF with pdf-lib for editing. Refuses encrypted files with a clear message. */
export async function openForEdit(bytes, name = tx("This file")) {
  const { PDFDocument } = await loadPdfLib();
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    const m = String(err && err.message);
    if (/encrypt/i.test(m)) throw new UserError(tx("\"{name}\" is password-protected or encrypted, so it can't be edited here. Remove the protection first.", { name }));
    throw new UserError(tx("\"{name}\" couldn't be read as a PDF. It may be damaged or not a PDF.", { name }));
  }
}

/* Open a PDF with pdf.js for rendering. Keeps the caller's bytes intact (pdf.js transfers its copy). */
export async function openForView(bytes, name = tx("This file")) {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({
    data: bytes.slice(0),
    isEvalSupported: false,
    useWasm: false,
    wasmUrl: V + "pdfjs/wasm/",
    enableXfa: false,
    verbosity: 0,
  });
  try {
    return await task.promise;
  } catch (err) {
    if (err && err.name === "PasswordException") throw new UserError(tx("\"{name}\" needs a password to open, so it can't be used here.", { name }));
    throw new UserError(tx("\"{name}\" couldn't be read as a PDF. It may be damaged or not a PDF.", { name }));
  }
}

/* Render one page into a canvas whose longest side is about maxPx CSS pixels (or at a given scale). */
export async function renderPage(doc, pageNo, { maxPx = 160, scale = null, rotation = 0, background = "#ffffff" } = {}) {
  const page = await doc.getPage(pageNo);
  const base = page.getViewport({ scale: 1, rotation: (page.rotate + rotation) % 360 });
  const s = scale || Math.min(maxPx / Math.max(base.width, base.height), 4) * Math.min(window.devicePixelRatio || 1, 2);
  const vp = page.getViewport({ scale: s, rotation: (page.rotate + rotation) % 360 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(vp.width));
  canvas.height = Math.max(1, Math.floor(vp.height));
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, canvas, viewport: vp }).promise;
  page.cleanup();
  if (!scale) {
    canvas.style.width = Math.round(vp.width / Math.min(window.devicePixelRatio || 1, 2)) + "px";
  }
  return canvas;
}

/* Parse "1-3, 5, 8-" style page ranges into arrays of 1-based page numbers.
   Returns [[1,2,3],[5],[8,9,10]]. Throws UserError with a readable message. */
export function parseRanges(text, pageCount) {
  const src = String(text || "").trim();
  if (!src) throw new UserError(tx("Enter at least one page or range, for example 1-3, 5."));
  const out = [];
  for (const raw of src.split(/[,;\s]+/).filter(Boolean)) {
    const m = raw.match(/^(\d*)\s*(?:[-–](\d*))?$/);
    if (!m || (m[1] === "" && (m[2] === undefined || m[2] === ""))) throw new UserError(tx("\"{raw}\" isn't a page or range. Use numbers like 3 or 2-5.", { raw }));
    let a = m[1] === "" ? 1 : parseInt(m[1], 10);
    let b = m[2] === undefined ? a : m[2] === "" ? pageCount : parseInt(m[2], 10);
    if (a < 1 || b < 1) throw new UserError(tx("Page numbers start at 1."));
    if (a > pageCount || b > pageCount) throw new UserError(tx("\"{raw}\" goes past the last page ({last}).", { raw, last: pageCount }));
    const step = a <= b ? 1 : -1;
    const r = [];
    for (let p = a; step > 0 ? p <= b : p >= b; p += step) r.push(p);
    out.push(r);
  }
  return out;
}

export async function saveDoc(doc) {
  const bytes = await doc.save({ useObjectStreams: true });
  return new Blob([bytes], { type: "application/pdf" });
}

/* Copy the given 0-based page indices from src into a new document. */
export async function pagesToNewDoc(src, indices) {
  const { PDFDocument } = await loadPdfLib();
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, indices);
  pages.forEach((p) => out.addPage(p));
  return out;
}

/* ------------------------------------------------------------------ page grid
   A thumbnail grid shared by remove / extract / rotate / reorder.
   mode: "select" (toggle selection), "rotate" (per-page rotate buttons), "order" (drag + move buttons).
   Returns an object with the current state. */
export function pageGrid(container, { count, mode, onChange, selectKind = "select" }) {
  const state = {
    order: Array.from({ length: count }, (_, i) => i),
    selected: new Set(),
    rotation: new Array(count).fill(0),
  };
  const items = [];
  const list = el("ol", { class: "thumbs", "aria-label": tx("Pages") });
  container.replaceChildren(list);

  function label(i) { return tx("Page {n}", { n: i + 1 }); }

  function refresh() {
    items.forEach((li, i) => {
      const sel = state.selected.has(i);
      li.classList.toggle("is-selected", sel);
      const hit = li.querySelector(".thumb__hit");
      if (hit) hit.setAttribute("aria-pressed", String(sel));
      const c = li.querySelector("canvas");
      if (c) c.style.transform = state.rotation[i] ? `rotate(${state.rotation[i]}deg)` : "";
      const badge = li.querySelector(".thumb__badge");
      if (badge) {
        badge.hidden = !(mode === "rotate" ? state.rotation[i] : false);
        badge.textContent = state.rotation[i] + "°";
      }
    });
    if (mode === "order") {
      state.order.forEach((idx, pos) => {
        const li = items[idx];
        list.append(li);
        const lbl = li.querySelector(".thumb__label");
        lbl.textContent = pos + 1 === idx + 1 ? label(idx) : tx("{pos} · was {was}", { pos: pos + 1, was: idx + 1 });
        li.querySelector('[data-move="-1"]').disabled = pos === 0;
        li.querySelector('[data-move="1"]').disabled = pos === state.order.length - 1;
      });
    }
    onChange && onChange(state);
  }

  function move(idx, delta) {
    const pos = state.order.indexOf(idx);
    const to = pos + delta;
    if (to < 0 || to >= state.order.length) return;
    state.order.splice(pos, 1);
    state.order.splice(to, 0, idx);
    refresh();
  }

  let dragIdx = null;
  for (let i = 0; i < count; i++) {
    const img = el("div", { class: "thumb__img" });
    const li = el("li", { class: "thumb", dataset: { index: String(i) } }, img);
    if (mode === "select") {
      li.prepend(el("button", { type: "button", class: "thumb__hit", "aria-pressed": "false", "aria-label": selectKind === "remove" ? tx("Remove page {n}", { n: i + 1 }) : selectKind === "extract" ? tx("Extract page {n}", { n: i + 1 }) : tx("Select page {n}", { n: i + 1 }),
        onclick: () => { state.selected.has(i) ? state.selected.delete(i) : state.selected.add(i); refresh(); } }));
      li.append(el("span", { class: "thumb__label" }, label(i)));
    } else if (mode === "rotate") {
      li.append(el("span", { class: "thumb__badge", hidden: true }));
      li.append(el("span", { class: "thumb__label" }, label(i)));
      li.append(el("div", { class: "thumb__tools" },
        el("button", { type: "button", class: "btn btn--sm btn--icon btn--quiet", "aria-label": tx("Rotate page {n} left", { n: i + 1 }),
          onclick: () => { state.rotation[i] = (state.rotation[i] + 270) % 360; refresh(); } }, icon("i-rot-left")),
        el("button", { type: "button", class: "btn btn--sm btn--icon btn--quiet", "aria-label": tx("Rotate page {n} right", { n: i + 1 }),
          onclick: () => { state.rotation[i] = (state.rotation[i] + 90) % 360; refresh(); } }, icon("i-rot-right"))));
    } else if (mode === "order") {
      li.draggable = true;
      li.append(el("span", { class: "thumb__label" }, label(i)));
      li.append(el("div", { class: "thumb__tools" },
        el("button", { type: "button", class: "btn btn--sm btn--icon btn--quiet", "data-move": "-1", "aria-label": tx("Move page {n} earlier", { n: i + 1 }),
          onclick: (e) => { move(i, -1); focusAfter(e.currentTarget, i, "-1"); } }, icon("i-arrow-left")),
        el("button", { type: "button", class: "btn btn--sm btn--icon btn--quiet", "data-move": "1", "aria-label": tx("Move page {n} later", { n: i + 1 }),
          onclick: (e) => { move(i, 1); focusAfter(e.currentTarget, i, "1"); } }, icon("i-arrow-right"))));
      li.addEventListener("dragstart", (e) => {
        dragIdx = i;
        li.classList.add("is-dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(i));
      });
      li.addEventListener("dragend", () => {
        dragIdx = null;
        li.classList.remove("is-dragging");
        items.forEach((x) => x.classList.remove("is-drop-target"));
      });
      li.addEventListener("dragover", (e) => {
        if (dragIdx === null || dragIdx === i) return;
        e.preventDefault();
        e.stopPropagation();
        li.classList.add("is-drop-target");
      });
      li.addEventListener("dragleave", () => li.classList.remove("is-drop-target"));
      li.addEventListener("drop", (e) => {
        if (dragIdx === null) return;
        e.preventDefault();
        e.stopPropagation();
        li.classList.remove("is-drop-target");
        const from = state.order.indexOf(dragIdx);
        state.order.splice(from, 1);
        const to = state.order.indexOf(i);
        const rect = li.getBoundingClientRect();
        const after = e.clientX > rect.left + rect.width / 2;
        state.order.splice(after ? to + 1 : to, 0, dragIdx);
        refresh();
      });
    }
    items.push(li);
    list.append(li);
  }

  function focusAfter(btn, i, dir) {
    const b = items[i].querySelector(`[data-move="${dir}"]`);
    (b && !b.disabled ? b : items[i].querySelector("[data-move]:not(:disabled)"))?.focus();
  }

  refresh();
  return {
    state,
    refresh,
    items,
    /* A thumbnail arriving is not a user change: apply its rotation without notifying onChange. */
    setThumb(i, canvas) {
      items[i].querySelector(".thumb__img").replaceChildren(canvas);
      if (state.rotation[i]) canvas.style.transform = `rotate(${state.rotation[i]}deg)`;
    },
    selectAll(on) { state.selected = new Set(on ? state.order : []); refresh(); },
    rotateAll(delta) { state.rotation = state.rotation.map((r) => (r + delta + 360) % 360); refresh(); },
    reverse() { state.order.reverse(); refresh(); },
  };
}

/* Render thumbnails progressively without blocking the page. */
export async function fillThumbs(doc, grid, { maxPx = 150, onProgress } = {}) {
  for (let i = 0; i < doc.numPages; i++) {
    try {
      const c = await renderPage(doc, i + 1, { maxPx });
      c.setAttribute("aria-hidden", "true");
      grid.setThumb(i, c);
    } catch (err) {
      console.warn("thumbnail", i + 1, err);
    }
    onProgress && onProgress(i + 1, doc.numPages);
  }
}
