import { $, $$, el, fmtBytes, setStatus, runJob, showResults, clearNode, announce, debounce, friendlyError, tx } from "./core.js?v=5";
import { singleImage, decode, newCanvas, ctx2d, previewInto, release, encodeCanvas, keepType, outName, LABEL, dims } from "./imgcore.js?v=5";

const drop = $("#drop"), editor = $("#editor"), goRow = $("#go-row"), go = $("#go"), summary = $("#summary");
const status = $("#status"), result = $("#result"), stage = $("#stage"), cv = $("#cv"), box = $("#box");
const inX = $("#crop-x"), inY = $("#crop-y"), inW = $("#crop-w"), inH = $("#crop-h");
const inputs = { x: inX, y: inY, w: inW, h: inH };

let img = null;            // { file, info, bmp, W, H }
let rect = { x: 0, y: 0, w: 1, h: 1 };
let ratio = null;          // width / height, or null for free
let s = 1;                 // display pixels per image pixel
let drag = null;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* ------------------------------------------------------------------ layout and drawing */

function layout() {
  if (!img) return;
  const avail = Math.max(120, stage.clientWidth - 2);
  const maxH = Math.max(220, window.innerHeight * 0.62);
  s = Math.min(avail / img.W, maxH / img.H, 8);
  const dw = Math.max(1, Math.round(img.W * s)), dh = Math.max(1, Math.round(img.H * s));
  s = dw / img.W;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  previewInto(cv, img.bmp, img.W, img.H, dw * dpr, dh * dpr);
  cv.style.width = dw + "px";
  cv.style.height = dh + "px";
  paint();
}

function paint(skipField) {
  box.style.left = rect.x * s + "px";
  box.style.top = rect.y * s + "px";
  box.style.width = rect.w * s + "px";
  box.style.height = rect.h * s + "px";
  for (const k of ["x", "y", "w", "h"]) if (inputs[k] !== skipField) inputs[k].value = rect[k];
  box.setAttribute("aria-label", tx("Crop area. Left {x}, top {y}, {w} by {h} pixels. Arrow keys move it; shift plus arrow keys resize it.", { x: rect.x, y: rect.y, w: rect.w, h: rect.h }));
  summary.textContent = tx("{size} px from {original}", { size: dims(rect.w, rect.h), original: dims(img.W, img.H) });
}

/* ------------------------------------------------------------------ geometry */

function fitRect(r) {
  r.w = clamp(Math.round(r.w), 1, img.W);
  r.h = clamp(Math.round(r.h), 1, img.H);
  r.x = clamp(Math.round(r.x), 0, img.W - r.w);
  r.y = clamp(Math.round(r.y), 0, img.H - r.h);
  return r;
}

/* Resize towards a point while an opposite corner stays put. */
function fromAnchor(ax, ay, px, py, sx0, sy0) {
  const sx = px === ax ? sx0 : px > ax ? 1 : -1;
  const sy = py === ay ? sy0 : py > ay ? 1 : -1;
  let w = Math.abs(px - ax), h = Math.abs(py - ay);
  const maxW = sx > 0 ? img.W - ax : ax, maxH = sy > 0 ? img.H - ay : ay;
  if (ratio) {
    let nw = Math.max(w, h * ratio), nh = nw / ratio;
    if (nw > maxW) { nw = maxW; nh = nw / ratio; }
    if (nh > maxH) { nh = maxH; nw = nh * ratio; }
    w = nw; h = nh;
  }
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  return fitRect({ x: sx > 0 ? ax : ax - w, y: sy > 0 ? ay : ay - h, w, h });
}

function applyRatioToRect() {
  if (!ratio) return;
  const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
  let w = Math.sqrt(rect.w * rect.h * ratio), h = w / ratio;
  const k = Math.min(1, img.W / w, img.H / h);
  w *= k; h *= k;
  rect = fitRect({ x: cx - w / 2, y: cy - h / 2, w, h });
}

/* ------------------------------------------------------------------ pointer interaction */

box.addEventListener("pointerdown", (e) => {
  if (e.button !== undefined && e.button > 0) return;
  e.preventDefault();
  const handle = e.target.closest("[data-h]");
  box.focus({ preventScroll: true });
  try { e.target.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  drag = { id: e.pointerId, mode: handle ? handle.dataset.h : "move", x0: e.clientX, y0: e.clientY, r0: { ...rect } };
});
box.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = (e.clientX - drag.x0) / s, dy = (e.clientY - drag.y0) / s;
  const r0 = drag.r0;
  if (drag.mode === "move") {
    rect = fitRect({ x: r0.x + dx, y: r0.y + dy, w: r0.w, h: r0.h });
  } else {
    const west = drag.mode.includes("w"), north = drag.mode.includes("n");
    const ax = west ? r0.x + r0.w : r0.x, ay = north ? r0.y + r0.h : r0.y;
    const cx = clamp((west ? r0.x : r0.x + r0.w) + dx, 0, img.W), cy = clamp((north ? r0.y : r0.y + r0.h) + dy, 0, img.H);
    rect = fromAnchor(ax, ay, cx, cy, west ? -1 : 1, north ? -1 : 1);
  }
  paint();
});
const endDrag = (e) => { if (drag && e.pointerId === drag.id) { drag = null; announce(tx("Crop {w} by {h} pixels.", { w: rect.w, h: rect.h })); } };
box.addEventListener("pointerup", endDrag);
box.addEventListener("pointercancel", endDrag);

box.addEventListener("keydown", (e) => {
  const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (!dir || e.altKey || e.ctrlKey || e.metaKey) return;
  e.preventDefault();
  const step = Math.max(1, Math.round(1 / s));
  if (e.shiftKey) {
    let { x, y, w, h } = rect;
    if (dir[0]) { w += dir[0] * step; if (ratio) h = Math.round(w / ratio); }
    else { h += dir[1] * step; if (ratio) w = Math.round(h * ratio); }
    if (ratio) {
      if (x + w > img.W) { w = img.W - x; h = Math.round(w / ratio); }
      if (y + h > img.H) { h = img.H - y; w = Math.round(h * ratio); }
    }
    rect = fitRect({ x, y, w: Math.max(1, w), h: Math.max(1, h) });
  } else {
    rect = fitRect({ x: rect.x + dir[0] * step, y: rect.y + dir[1] * step, w: rect.w, h: rect.h });
  }
  paint();
});

/* ------------------------------------------------------------------ numeric fields and presets */

function fromField(key) {
  const raw = inputs[key].value.trim();
  if (raw === "" || !/^-?\d+$/.test(raw)) return;
  let v = parseInt(raw, 10);
  let { x, y, w, h } = rect;
  if (key === "x") x = clamp(v, 0, img.W - w);
  else if (key === "y") y = clamp(v, 0, img.H - h);
  else if (key === "w") {
    w = clamp(v, 1, img.W - x);
    if (ratio) { h = Math.max(1, Math.round(w / ratio)); if (y + h > img.H) { h = img.H - y; w = Math.max(1, Math.round(h * ratio)); } }
  } else {
    h = clamp(v, 1, img.H - y);
    if (ratio) { w = Math.max(1, Math.round(h * ratio)); if (x + w > img.W) { w = img.W - x; h = Math.max(1, Math.round(w / ratio)); } }
  }
  rect = fitRect({ x, y, w, h });
  paint(inputs[key]);
}
for (const k of Object.keys(inputs)) {
  inputs[k].addEventListener("input", () => fromField(k));
  inputs[k].addEventListener("change", () => { fromField(k); paint(); });
}

$$('input[name="ratio"]').forEach((r) => r.addEventListener("change", () => {
  const v = $('input[name="ratio"]:checked').value;
  ratio = v === "free" ? null : Number(v.split(":")[0]) / Number(v.split(":")[1]);
  applyRatioToRect();
  paint();
}));

/* ------------------------------------------------------------------ load, crop, reset */

async function load(file, info) {
  setStatus(status, "working", tx("Opening the image…"));
  const bmp = await decode(file);
  if (img) img.bmp.close();
  img = { file, info, bmp, W: bmp.width, H: bmp.height };
  const w = Math.max(1, Math.round(img.W * 0.8)), h = Math.max(1, Math.round(img.H * 0.8));
  rect = fitRect({ x: (img.W - w) / 2, y: (img.H - h) / 2, w, h });
  ratio = null;
  $('input[name="ratio"][value="free"]').checked = true;
  clearNode(result); result.hidden = true;
  setStatus(status, "idle");
  editor.hidden = false; goRow.hidden = false;
  drop.classList.add("is-compact");
  $("[data-pick-label]", drop).textContent = tx("Choose another image");
  $("#file-meta").textContent = `${file.name} · ${fmtBytes(file.size)} · ${dims(img.W, img.H)} · ${LABEL[info.type]}`;
  for (const k of Object.keys(inputs)) { inputs[k].max = k === "x" || k === "w" ? img.W : img.H; }
  layout();
  announce(tx("Image ready. Adjust the crop box, then press Crop image."));
}

singleImage(drop, { onFile: load, onError: (msg) => setStatus(status, "error", msg) });

window.addEventListener("resize", debounce(layout, 120));

go.addEventListener("click", () => runJob({
  status, button: go, working: tx("Cropping…"),
  done: (r) => r && tx("Cropped to {w} × {h} pixels.", { w: r.w, h: r.h }),
  job: async () => {
    const { x, y, w, h } = rect;
    const type = keepType(img.info.type);
    const canvas = newCanvas(w, h);
    ctx2d(canvas).drawImage(img.bmp, x, y, w, h, 0, 0, w, h);
    try {
      const blob = await encodeCanvas(canvas, type, 0.92);
      const note = tx("{size} px", { size: dims(w, h) }) + (img.info.type !== type ? " · " + tx("saved as {format}", { format: LABEL[type] }) : "");
      showResults(result, [{ blob, name: outName(img.file.name, "-cropped", type), note }]);
    } finally {
      release(canvas);
    }
    return { w, h };
  },
}));

$("#clear").addEventListener("click", () => {
  if (img) img.bmp.close();
  img = null;
  editor.hidden = true; goRow.hidden = true;
  drop.classList.remove("is-compact");
  $("[data-pick-label]", drop).textContent = tx("Choose an image");
  clearNode(result); result.hidden = true;
  setStatus(status, "idle");
  drop.querySelector("input").focus();
});
