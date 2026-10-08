// Image color picker: reads exact pixel values from the full-resolution image (one pixel at a time from the decoded
// bitmap) and builds a median-cut palette from a small sample. Everything runs in the browser.
import { $, el, fmtBytes, setStatus, announce, copyText, tx } from "./core.js?v=5";
import { singleImage, decode, previewInto, dims, LABEL } from "./imgcore.js?v=5";

const drop = $("#drop"), work = $("#work"), status = $("#status"), cv = $("#cv"), target = $("#target");
const cross = $("#cross"), loupe = $("#loupe"), pick = drop.querySelector("[data-pick-label]");
const LOUPE_PX = 11;

let img = null;      // { bmp, W, H, name }
let pos = { x: 0, y: 0 };
let history = [];
const one = document.createElement("canvas");
one.width = one.height = 1;
const oneCtx = one.getContext("2d", { willReadFrequently: true });

/* ------------------------------------------------------------------ colour maths */

export const hex = ([r, g, b]) => "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
export function hsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [Math.round(h) % 360, Math.round(s * 100), Math.round(l * 100)];
}
const rgbText = (c) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
const hslText = (c) => { const [h, s, l] = hsl(c); return `hsl(${h}, ${s}%, ${l}%)`; };

/* Median cut over [r,g,b] samples: split the box with the widest channel range (weighted by size) at its median. */
export function medianCut(pixels, k = 8) {
  if (!pixels.length) return [];
  const box = (px) => {
    const lo = [255, 255, 255], hi = [0, 0, 0];
    for (const p of px) for (let c = 0; c < 3; c++) { if (p[c] < lo[c]) lo[c] = p[c]; if (p[c] > hi[c]) hi[c] = p[c]; }
    const ranges = [0, 1, 2].map((c) => hi[c] - lo[c]);
    const ch = ranges.indexOf(Math.max(...ranges));
    return { px, ch, range: ranges[ch] };
  };
  const boxes = [box(pixels)];
  while (boxes.length < k) {
    let best = -1, score = 0;
    boxes.forEach((b, i) => { const s = b.range * b.px.length; if (b.range > 0 && s > score) { score = s; best = i; } });
    if (best < 0) break;
    const b = boxes.splice(best, 1)[0];
    b.px.sort((p, q) => p[b.ch] - q[b.ch]);
    let mid = b.px.length >> 1;
    // keep equal values together so a single colour never straddles two boxes
    const v = b.px[mid][b.ch];
    let lo = mid; while (lo > 0 && b.px[lo - 1][b.ch] === v) lo--;
    let hi = mid; while (hi < b.px.length && b.px[hi][b.ch] === v) hi++;
    mid = lo > 0 ? lo : hi;
    boxes.push(box(b.px.slice(0, mid)), box(b.px.slice(mid)));
  }
  return boxes.map((b) => {
    const sum = [0, 0, 0];
    for (const p of b.px) { sum[0] += p[0]; sum[1] += p[1]; sum[2] += p[2]; }
    return { rgb: sum.map((s) => Math.round(s / b.px.length)), share: b.px.length / pixels.length };
  }).sort((a, b) => b.share - a.share);
}

/* ------------------------------------------------------------------ pixels */

function readPixel(x, y) {
  oneCtx.clearRect(0, 0, 1, 1);
  oneCtx.drawImage(img.bmp, x, y, 1, 1, 0, 0, 1, 1);
  const d = oneCtx.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2], d[3]];
}

function palette() {
  const k = Math.min(1, 160 / Math.max(img.W, img.H));
  const w = Math.max(1, Math.round(img.W * k)), h = Math.max(1, Math.round(img.H * k));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img.bmp, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  c.width = c.height = 0;
  const px = [];
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] >= 128) px.push([d[i], d[i + 1], d[i + 2]]);
  return medianCut(px, 8);
}

/* ------------------------------------------------------------------ view */

function layout() {
  if (!img) return;
  const avail = Math.max(120, target.parentElement.clientWidth);
  const maxH = Math.max(220, window.innerHeight * 0.6);
  const s = Math.min(avail / img.W, maxH / img.H, 4);
  const dw = Math.max(1, Math.round(img.W * s)), dh = Math.max(1, Math.round(img.H * s));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  previewInto(cv, img.bmp, img.W, img.H, dw * dpr, dh * dpr);
  cv.style.width = dw + "px";
  cv.style.height = dh + "px";
  aim(pos.x, pos.y);
}

function aim(x, y) {
  pos = { x: Math.min(img.W - 1, Math.max(0, x)), y: Math.min(img.H - 1, Math.max(0, y)) };
  cross.style.left = ((pos.x + 0.5) / img.W) * 100 + "%";
  cross.style.top = ((pos.y + 0.5) / img.H) * 100 + "%";
  const c = readPixel(pos.x, pos.y);
  $("#now-chip").style.background = rgbText(c);
  $("#now-hex").textContent = hex(c) + (c[3] < 255 ? " · " + tx("{pct}% opaque", { pct: Math.round(c[3] / 2.55) }) : "");
  $("#now-xy").textContent = `x ${pos.x}, y ${pos.y}`;
  const lc = loupe.getContext("2d");
  lc.imageSmoothingEnabled = false;
  lc.clearRect(0, 0, loupe.width, loupe.height);
  const half = (LOUPE_PX - 1) / 2, cell = loupe.width / LOUPE_PX;
  lc.drawImage(img.bmp, pos.x - half, pos.y - half, LOUPE_PX, LOUPE_PX, 0, 0, loupe.width, loupe.height);
  lc.lineWidth = 2;
  lc.strokeStyle = "#000"; lc.strokeRect(half * cell, half * cell, cell, cell);
  lc.strokeStyle = "#fff"; lc.strokeRect(half * cell - 2, half * cell - 2, cell + 4, cell + 4);
  return c;
}

function choose(c) {
  const rgb = c.slice(0, 3);
  $("#picked").hidden = false;
  $("#big-chip").style.background = rgbText(rgb);
  $("#v-hex").textContent = hex(rgb);
  $("#v-rgb").textContent = rgbText(rgb);
  $("#v-hsl").textContent = hslText(rgb);
  const h = hex(rgb);
  history = [h, ...history.filter((x) => x !== h)].slice(0, 12);
  renderHistory();
  announce(tx("Picked {hex}, {rgb}.", { hex: h, rgb: rgbText(rgb) }));
}

function swatch(h, label, extra) {
  return el("li", {}, el("button", {
    type: "button", class: "cp__sw", "aria-label": label ? tx("Copy {hex}, {label}", { hex: h, label }) : tx("Copy {hex}", { hex: h }), "data-hex": h,
    onclick: (e) => copyText(h, null).then(() => flash(e.currentTarget)),
  }, el("span", { class: "cp__chip", style: `background:${h}` }), el("span", { class: "num" }, h), extra ? el("span", { class: "cp__share num" }, extra) : null));
}
function flash(b) {
  b.classList.add("is-copied");
  setTimeout(() => b.classList.remove("is-copied"), 1200);
}

function renderHistory() {
  $("#history-box").hidden = !history.length;
  $("#history").replaceChildren(...history.map((h) => swatch(h)));
}

function renderPalette() {
  const pal = palette();
  $("#palette").replaceChildren(...pal.filter((p) => p.share >= 0.005).map((p) => {
    const pct = p.share >= 0.995 ? "100%" : (p.share * 100 < 1 ? "<1%" : Math.round(p.share * 100) + "%");
    return swatch(hex(p.rgb), tx("{pct} of the image", { pct }), pct);
  }));
}

function pointToPixel(e) {
  const r = cv.getBoundingClientRect();
  return { x: Math.floor(((e.clientX - r.left) / r.width) * img.W), y: Math.floor(((e.clientY - r.top) / r.height) * img.H) };
}

target.addEventListener("pointermove", (e) => { if (img) { const p = pointToPixel(e); aim(p.x, p.y); } });
target.addEventListener("click", (e) => { if (img) { const p = pointToPixel(e); choose(aim(p.x, p.y)); target.focus({ preventScroll: true }); } });
target.addEventListener("keydown", (e) => {
  if (!img) return;
  const step = Math.max(1, Math.round(img.W / cv.getBoundingClientRect().width)) * (e.shiftKey ? 10 : 1);
  const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
  if (d) { e.preventDefault(); aim(pos.x + d[0], pos.y + d[1]); }
  else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(aim(pos.x, pos.y)); }
});

document.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", () => copyText($("#" + b.dataset.copy).textContent, b)));

let resizeT;
window.addEventListener("resize", () => { clearTimeout(resizeT); resizeT = setTimeout(layout, 120); });

function reset() {
  if (img) img.bmp.close();
  img = null; history = [];
  work.hidden = true;
  $("#picked").hidden = true;
  renderHistory();
  drop.classList.remove("is-compact");
  pick.textContent = tx("Choose an image");
}

singleImage(drop, {
  onError: (msg) => setStatus(status, "error", msg),
  onFile: async (file, info) => {
    setStatus(status, "working", tx("Opening the image…"));
    const bmp = await decode(file);
    reset();
    img = { bmp, W: bmp.width, H: bmp.height, name: file.name };
    pos = { x: Math.floor(img.W / 2), y: Math.floor(img.H / 2) };
    work.hidden = false;
    drop.classList.add("is-compact");
    pick.textContent = tx("Choose another image");
    $("#file-meta").textContent = `${file.name} · ${fmtBytes(file.size)} · ${dims(img.W, img.H)} · ${LABEL[info.type]}`;
    layout();
    renderPalette();
    setStatus(status, "idle");
    announce(tx("Opened {name}. Click the image or use the arrow keys and Enter to pick a colour.", { name: file.name }));
  },
});
document.addEventListener("paste", (e) => {
  const t = e.target;
  if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT")) return;
  const f = Array.from((e.clipboardData && e.clipboardData.files) || []).filter((x) => x.type.startsWith("image/"));
  if (f.length) { e.preventDefault(); const dt = new DataTransfer(); dt.items.add(f[0]); const inp = drop.querySelector("input"); inp.files = dt.files; inp.dispatchEvent(new Event("change")); }
});

$("#clear").addEventListener("click", () => { reset(); setStatus(status, "idle"); drop.querySelector("input").focus(); });
