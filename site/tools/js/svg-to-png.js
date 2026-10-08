// SVG to PNG: the SVG is loaded as an image (from a data: URL, never inserted into the page), so scripts in it
// don't run and nothing it links to is fetched. It is drawn on a canvas at the output size and saved as PNG.
import { $, fmtBytes, dropzone, setStatus, runJob, showResults, clearNode, announce, friendlyError, UserError, baseName, tx, EN, fmtNum } from "./core.js?v=5";
import { newCanvas, ctx2d, release, canvasToBlob, previewInto, dims, MAX_PIXELS } from "./imgcore.js?v=5";

const MAX_BYTES = 10 * 1024 * 1024;
const UNIT = { "": 1, px: 1, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, pt: 4 / 3, pc: 16, q: 96 / 101.6 };

const drop = $("#drop"), editor = $("#editor"), goRow = $("#go-row"), go = $("#go"), summary = $("#summary");
const status = $("#status"), result = $("#result"), cv = $("#cv"), meta = $("#file-meta"), note = $("#size-note");
const wField = $("#w-field"), width = $("#width"), transparent = $("#transparent"), bgWrap = $("#bg-wrap"), bg = $("#bg");
const pick = drop.querySelector("[data-pick-label]");

let svg = null; // { file, doc (parsed, inert), w, h, guessed }

/* A length attribute in CSS pixels, or null for missing, percentages and font-relative units. */
function length(v) {
  const m = /^\s*([+]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(px|in|cm|mm|pt|pc|q)?\s*$/i.exec(v || "");
  if (!m) return null;
  const n = parseFloat(m[1]) * UNIT[(m[2] || "").toLowerCase()];
  return n > 0 && Number.isFinite(n) ? n : null;
}

function viewBox(root) {
  const p = (root.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
  return p.length === 4 && p.every(Number.isFinite) && p[2] > 0 && p[3] > 0 ? p : null;
}

/* Parse the text as XML (an inert document: nothing loads or runs) and work out the drawing's own size. */
export function inspect(text) {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const root = doc.documentElement;
  if (!root || doc.getElementsByTagName("parsererror").length || root.localName !== "svg") {
    throw new UserError(tx("This file isn't a readable SVG. It must be an XML file whose top element is <svg>."));
  }
  if (root.namespaceURI !== "http://www.w3.org/2000/svg") root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const vb = viewBox(root);
  let w = length(root.getAttribute("width")), h = length(root.getAttribute("height"));
  let guessed = false;
  if (w && !h) h = vb ? w * vb[3] / vb[2] : 150;
  else if (h && !w) w = vb ? h * vb[2] / vb[3] : 300;
  else if (!w && !h) {
    if (vb) { w = vb[2]; h = vb[3]; } else { w = 300; h = 150; guessed = true; }
  }
  if (!vb) root.setAttribute("viewBox", `0 0 ${w} ${h}`);
  return { doc, w, h, guessed };
}

/* Load the SVG as an image at exactly w x h pixels (the viewBox scales the drawing, so it stays sharp). */
function load(doc, w, h) {
  const root = doc.documentElement;
  root.setAttribute("width", String(w));
  root.setAttribute("height", String(h));
  root.setAttribute("preserveAspectRatio", root.getAttribute("preserveAspectRatio") || "xMidYMid meet");
  const text = new XMLSerializer().serializeToString(doc);
  const img = new Image();
  img.decoding = "async";
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(text);
  return img.decode().then(() => img, () => {
    throw new UserError(tx("Your browser couldn't draw this SVG. It may use features that don't work when an SVG is shown as an image, or be damaged."));
  });
}

async function render(w, h, background) {
  const img = await load(svg.doc, w, h);
  const c = newCanvas(w, h);
  const ctx = ctx2d(c);
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, w, h); }
  ctx.drawImage(img, 0, 0, w, h);
  return c;
}

function target() {
  const mode = document.querySelector('input[name="scale"]:checked').value;
  const ratio = svg.h / svg.w;
  let w, h;
  if (mode === "custom") {
    w = Math.round(Number(width.value));
    if (!(w >= 1)) return null;
    h = Math.max(1, Math.round(w * ratio));
  } else {
    w = Math.max(1, Math.round(svg.w * Number(mode)));
    h = Math.max(1, Math.round(svg.h * Number(mode)));
  }
  return { w, h };
}

function sync() {
  if (!svg) return;
  const mode = document.querySelector('input[name="scale"]:checked').value;
  wField.hidden = mode !== "custom";
  bgWrap.hidden = transparent.checked;
  cv.style.background = transparent.checked ? "" : bg.value;
  const t = target();
  let why = null;
  if (!t) why = tx("Type a width in pixels.");
  else if (t.w > 32767 || t.h > 32767 || t.w * t.h > MAX_PIXELS) why = tx("{size} px is larger than this tool can make ({mp} megapixels, 32,767 px a side).", { size: dims(t.w, t.h), mp: fmtNum(MAX_PIXELS / 1e6) });
  go.disabled = !!why;
  summary.textContent = why || tx("PNG, {size} px", { size: dims(t.w, t.h) });
}

async function open(file) {
  clearNode(result); result.hidden = true;
  setStatus(status, "idle");
  try {
    if (file.size > MAX_BYTES) throw new UserError(tx("\"{name}\" is {size}; the limit is {limit}.", { name: file.name, size: fmtBytes(file.size), limit: fmtBytes(MAX_BYTES) }));
    const info = inspect(await file.text());
    svg = { file, ...info };
    meta.textContent = tx("{name} · {size} · drawn at {dims} px", { name: file.name, size: fmtBytes(file.size), dims: EN ? dims(+svg.w.toFixed(2), +svg.h.toFixed(2)) : `${fmtNum(svg.w, { maximumFractionDigits: 2 })} × ${fmtNum(svg.h, { maximumFractionDigits: 2 })}` });
    note.hidden = !svg.guessed;
    note.textContent = svg.guessed ? tx("This SVG has no width, height or viewBox, so it is drawn at the browser default of 300 × 150 px. Parts outside that area are cut off.") : "";
    if (!width.value) width.value = String(Math.round(svg.w * 2));
    const k = Math.min(640 / svg.w, 400 / svg.h, Math.max(1, 160 / Math.max(svg.w, svg.h)));
    const dw = Math.max(1, Math.round(svg.w * k)), dh = Math.max(1, Math.round(svg.h * k));
    const prev = await render(dw * 2, dh * 2, null);
    previewInto(cv, prev, dw * 2, dh * 2, dw * 2, dh * 2);
    cv.style.width = dw + "px";
    release(prev);
    editor.hidden = false; goRow.hidden = false;
    drop.classList.add("is-compact");
    pick.textContent = tx("Choose another SVG");
    sync();
    announce(tx("Opened {name}.", { name: file.name }));
  } catch (err) {
    console.warn(err);
    reset(false);
    setStatus(status, "error", friendlyError(err));
  }
}

function reset(focus = true) {
  svg = null;
  editor.hidden = true; goRow.hidden = true;
  drop.classList.remove("is-compact");
  pick.textContent = tx("Choose an SVG");
  width.value = "";
  clearNode(result); result.hidden = true;
  if (focus) drop.querySelector("input").focus();
}

dropzone(drop, {
  accept: ["image/svg+xml", ".svg"], multiple: false, typeLabel: "vector (SVG)",
  onError: (msg) => setStatus(status, "error", msg),
  onFiles: ([file]) => open(file),
});

document.querySelectorAll('input[name="scale"]').forEach((r) => r.addEventListener("change", sync));
width.addEventListener("input", sync);
transparent.addEventListener("change", sync);
bg.addEventListener("input", sync);

go.addEventListener("click", () => runJob({
  status, button: go, working: tx("Drawing the PNG…"),
  done: (r) => r && tx("Converted to a {size} px PNG.", { size: dims(r.w, r.h) }),
  job: async () => {
    const t = target();
    const c = await render(t.w, t.h, transparent.checked ? null : bg.value);
    try {
      try { c.getContext("2d").getImageData(0, 0, 1, 1); } catch (_) {
        throw new UserError(tx("This SVG contains content (such as embedded HTML in a foreignObject) that browsers won't let a page save as an image."));
      }
      const blob = await canvasToBlob(c, "image/png");
      showResults(result, [{ blob, name: baseName(svg.file.name) + ".png", note: tx("{size} px", { size: dims(t.w, t.h) }) }]);
      return t;
    } finally { release(c); }
  },
}));

$("#clear").addEventListener("click", () => { setStatus(status, "idle"); reset(); });
