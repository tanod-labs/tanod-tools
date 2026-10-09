// Sign PDF: draw or type a signature, place it on a page of a PDF, optionally add the date, and save the PDF.
// The placement maths is in signcore.js (no DOM). The page preview is drawn by pdf.js; the signature is added with
// pdf-lib as a transparent PNG image on top of the page. Nothing is uploaded.
import { $, fmtBytes, dropzone, readBytes, runJob, setStatus, showResults, clearNode, baseName, UserError, announce, tick, tx, txn, fmtNum } from "./core.js?v=11";
import { dateFormat } from "./i18n.js?v=11";
import { loadPdfLib, openForEdit, openForView, closeView, renderPage, saveDoc } from "./pdfcore.js?v=11";
import { placeStamp, targetPages, alphaBounds, growBounds, stampLayout, fitFontSize, clamp } from "./signcore.js?v=11";

const MAX_BYTES = 200 * 1024 * 1024;
const MAX_PAGES = 500;
const PAD_W = 900, PAD_H = 300;           // the drawing surface in its own pixels; CSS scales it
const INK = { black: "#16140f", blue: "#1636a3" };
const DATE_FONT = 'Archivo, system-ui, "Segoe UI", sans-serif';
const FONTS = {
  script: (s) => `italic ${s}px "Segoe Script", "Snell Roundhand", "Apple Chancery", "URW Chancery L", "Z003", "Lucida Handwriting", cursive`,
  hand: (s) => `${s}px "Bradley Hand", "Segoe Print", "Chalkduster", "Ink Free", "Comic Sans MS", cursive`,
  serif: (s) => `italic ${s}px Georgia, "Times New Roman", "Liberation Serif", serif`,
};

const drop = $("#drop"), work = $("#work"), status = $("#status"), result = $("#result"), go = $("#go");
const pad = $("#sg-pad"), typed = $("#sg-typed"), nameIn = $("#sg-text"), fontSel = $("#sg-font");
const dateOn = $("#sg-date-on"), dateIn = $("#sg-date");
const stage = $("#sg-stage"), stampEl = $("#sg-stamp"), pageIn = $("#sg-page");
const sx = $("#sg-x"), sy = $("#sg-y"), sw = $("#sg-w");

let file = null, bytes = null, view = null;
let geoms = [];                          // per page: { x, y, width, height, rotation } as pdf-lib reports them
let pageNo = 1;
let place = { fx: 0.85, fy: 0.85, wFrac: 0.3 };
let stamp = null;                        // canvas with the signature (and date), transparent background
let strokes = [];                        // drawn strokes: arrays of [x, y] in pad pixels
let active = null;                       // the stroke being drawn
let renderToken = 0, loadToken = 0;

const radio = (name) => document.querySelector(`input[name="${name}"]:checked`).value;
const ink = () => INK[radio("sg-ink")] || INK.black;
const mode = () => radio("sg-mode");
const pct = (v) => fmtNum(v / 100, { style: "percent", maximumFractionDigits: 0 });

/* ------------------------------------------------------------------ drawing pad */

const padCtx = pad.getContext("2d");
function styleCtx(ctx) { ctx.lineWidth = 6; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = ink(); ctx.fillStyle = ink(); }
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/* Draw the newest part of a stroke: a dot for one point, a line for two, then smooth curves through the midpoints. */
function drawAt(ctx, pts, i) {
  if (i === 0) {
    ctx.beginPath();
    ctx.arc(pts[0][0], pts[0][1], ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  if (i === 1) {
    ctx.moveTo(pts[0][0], pts[0][1]);
    ctx.lineTo(...mid(pts[0], pts[1]));
  } else {
    ctx.moveTo(...mid(pts[i - 2], pts[i - 1]));
    ctx.quadraticCurveTo(pts[i - 1][0], pts[i - 1][1], ...mid(pts[i - 1], pts[i]));
  }
  ctx.stroke();
}

/* The last half segment of a stroke (the curves above stop at the midpoint before the final point). */
function finishStroke(ctx, pts) {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(...mid(pts[pts.length - 2], pts[pts.length - 1]));
  ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
  ctx.stroke();
}

function redrawPad() {
  padCtx.clearRect(0, 0, PAD_W, PAD_H);
  styleCtx(padCtx);
  for (const s of strokes) { for (let i = 0; i < s.length; i++) drawAt(padCtx, s, i); finishStroke(padCtx, s); }
  $("#sg-undo").disabled = $("#sg-clear").disabled = !strokes.length;
}

function padPoint(e) {
  const r = pad.getBoundingClientRect();
  return [((e.clientX - r.left) * PAD_W) / r.width, ((e.clientY - r.top) * PAD_H) / r.height];
}

pad.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  e.preventDefault();
  pad.setPointerCapture(e.pointerId);
  active = [padPoint(e)];
  strokes.push(active);
  styleCtx(padCtx);
  drawAt(padCtx, active, 0);
  $("#sg-undo").disabled = $("#sg-clear").disabled = false;
});
pad.addEventListener("pointermove", (e) => {
  if (!active) return;
  for (const ev of e.getCoalescedEvents ? e.getCoalescedEvents() : [e]) {
    const p = padPoint(ev), last = active[active.length - 1];
    if (Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) < 1) continue;
    active.push(p);
    drawAt(padCtx, active, active.length - 1);
  }
});
const endStroke = () => { if (!active) return; finishStroke(padCtx, active); active = null; changed(); };
pad.addEventListener("pointerup", endStroke);
pad.addEventListener("pointercancel", endStroke);
pad.addEventListener("lostpointercapture", endStroke);

$("#sg-undo").addEventListener("click", () => { strokes.pop(); redrawPad(); changed(); });
$("#sg-clear").addEventListener("click", () => { strokes = []; redrawPad(); changed(); });

/* ------------------------------------------------------------------ typed signature */

function renderTyped() {
  const ctx = typed.getContext("2d");
  ctx.clearRect(0, 0, typed.width, typed.height);
  const text = nameIn.value.trim();
  if (!text) return;
  const font = FONTS[fontSel.value] || FONTS.script;
  ctx.font = font(100);
  const size = fitFontSize(ctx.measureText(text).width / 100, typed.width - 40, typed.height - 40, { max: 150 });
  ctx.font = font(Math.round(size));
  ctx.fillStyle = ink();
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillText(text, typed.width / 2, typed.height / 2, typed.width - 20);
}

/* ------------------------------------------------------------------ the stamp: signature and date */

/* The signature cut to the ink it holds (a little margin all round), or null when nothing is drawn or typed. */
function signatureCanvas() {
  const src = mode() === "draw" ? pad : typed;
  if (mode() === "draw" ? !strokes.length : !nameIn.value.trim()) return null;
  const b = alphaBounds(src.getContext("2d").getImageData(0, 0, src.width, src.height).data, src.width, src.height);
  if (!b) return null;
  const g = growBounds(b, 6, src.width, src.height);
  const c = document.createElement("canvas");
  c.width = g.w; c.height = g.h;
  c.getContext("2d").drawImage(src, g.x, g.y, g.w, g.h, 0, 0, g.w, g.h);
  return c;
}

function buildStamp() {
  const sig = signatureCanvas();
  if (!sig) return null;
  const text = dateOn.checked ? dateIn.value.trim() : "";
  let date = null;
  if (text) {
    // about half as wide as the signature (so it stays readable when the stamp is small), never taller than half of it
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.font = `100px ${DATE_FONT}`;
    const per = ctx.measureText(text).width / 100;
    const fs = clamp(Math.round((0.5 * sig.width) / per), 22, Math.max(22, Math.round(sig.height * 0.5)));
    ctx.font = `${fs}px ${DATE_FONT}`;
    date = { w: Math.ceil(ctx.measureText(text).width), h: Math.ceil(fs * 1.3), fs };
  }
  const L = stampLayout({ w: sig.width, h: sig.height }, date, { pad: 8, gap: 8 });
  const out = document.createElement("canvas");
  out.width = L.w; out.height = L.h;
  const ctx = out.getContext("2d");
  ctx.drawImage(sig, L.sig.x, L.sig.y);
  if (date) {
    ctx.font = `${date.fs}px ${DATE_FONT}`;
    ctx.fillStyle = ink();
    ctx.textBaseline = "top";
    ctx.fillText(text, L.date.x, L.date.y);
  }
  return out;
}

/* The signed copy shown below no longer matches the settings: take it down. */
function staleResult() {
  clearNode(result);
  result.hidden = true;
  if (status.dataset.state === "done") setStatus(status, "idle");
}

/* Something about the signature changed: rebuild the stamp and show it on the page. */
function changed() {
  if (mode() === "type") renderTyped();
  stamp = buildStamp();
  if (stamp) {
    stampEl.width = stamp.width; stampEl.height = stamp.height;
    const ctx = stampEl.getContext("2d");
    ctx.clearRect(0, 0, stamp.width, stamp.height);
    ctx.drawImage(stamp, 0, 0);
  }
  stampEl.hidden = !stamp;
  layoutStamp();
  staleResult();
  go.disabled = !stamp || !bytes;
  $("#sg-hint").hidden = !!stamp;
}

/* ------------------------------------------------------------------ placing it on the page */

function layoutStamp() {
  if (!stamp || !geoms[pageNo - 1]) return null;
  const r = placeStamp(geoms[pageNo - 1], stamp.height / stamp.width, place);
  const d = r.display;
  stampEl.style.left = d.left * 100 + "%";
  stampEl.style.top = d.top * 100 + "%";
  stampEl.style.width = d.width * 100 + "%";
  return d;
}

function syncSliders() {
  sx.value = Math.round(place.fx * 100);
  sy.value = Math.round(place.fy * 100);
  sw.value = Math.round(place.wFrac * 100);
  $("#sg-x-v").textContent = pct(sx.value);
  $("#sg-y-v").textContent = pct(sy.value);
  $("#sg-w-v").textContent = pct(sw.value);
}

function readSliders() {
  place = { fx: sx.value / 100, fy: sy.value / 100, wFrac: sw.value / 100 };
  syncSliders();
  layoutStamp();
}
for (const s of [sx, sy, sw]) s.addEventListener("input", () => { readSliders(); staleResult(); });

/* Drag the stamp; a tap elsewhere on the page moves it there (its centre under the finger). */
let grab = null;
function moveStampTo(px, py) {
  const d = layoutStamp();
  if (!d) return;
  const left = px - grab.dx, top = py - grab.dy;
  place.fx = d.width < 1 ? clamp(left / (1 - d.width), 0, 1) : 0.5;
  place.fy = d.height < 1 ? clamp(top / (1 - d.height), 0, 1) : 0.5;
  syncSliders();
  layoutStamp();
}
const fraction = (e) => {
  const r = stage.getBoundingClientRect();
  return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
};
stampEl.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  e.preventDefault();
  stampEl.setPointerCapture(e.pointerId);
  const d = layoutStamp(), [px, py] = fraction(e);
  grab = { dx: px - d.left, dy: py - d.top };
  stampEl.classList.add("is-dragging");
});
stampEl.addEventListener("pointermove", (e) => { if (grab) moveStampTo(...fraction(e)); });
const endDrag = () => { if (!grab) return; grab = null; stampEl.classList.remove("is-dragging"); staleResult(); };
stampEl.addEventListener("pointerup", endDrag);
stampEl.addEventListener("pointercancel", endDrag);
stage.addEventListener("click", (e) => {
  if (e.target === stampEl || !stamp) return;
  const d = layoutStamp();
  grab = { dx: d.width / 2, dy: d.height / 2 };
  moveStampTo(...fraction(e));
  grab = null;
  staleResult();
});

/* ------------------------------------------------------------------ pages */

async function showPage(n) {
  pageNo = clamp(n, 1, geoms.length);
  pageIn.value = String(pageNo);
  $("#sg-prev").disabled = pageNo <= 1;
  $("#sg-next").disabled = pageNo >= geoms.length;
  const my = ++renderToken;
  const old = $(".sg-view", stage);
  try {
    const canvas = await renderPage(view, pageNo, { maxPx: 760 });
    if (my !== renderToken) return;
    canvas.classList.add("sg-view");
    canvas.style.width = "";
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", tx("Preview of page {n}", { n: fmtNum(pageNo) }));
    if (old) old.replaceWith(canvas); else stage.prepend(canvas);
    $("#sg-view-error").hidden = true;
  } catch (err) {
    if (my !== renderToken) return;
    console.warn(err);
    $("#sg-view-error").textContent = tx("This page couldn't be shown here. You can still place the signature with the sliders.");
    $("#sg-view-error").hidden = false;
  }
  layoutStamp();
}

function setPage(n) {
  if (!geoms.length) return;
  showPage(n);
  announce(tx("Page {n} of {total}", { n: fmtNum(pageNo), total: fmtNum(geoms.length) }));
}
$("#sg-prev").addEventListener("click", () => setPage(pageNo - 1));
$("#sg-next").addEventListener("click", () => setPage(pageNo + 1));
pageIn.addEventListener("change", () => { const v = parseInt(pageIn.value, 10); setPage(Number.isFinite(v) ? v : pageNo); });

/* ------------------------------------------------------------------ the PDF */

function resetPdf() {
  loadToken++;
  renderToken++;
  closeView(view);
  view = null;
  file = bytes = null; geoms = [];
  work.hidden = true;
  const old = $(".sg-view", stage);
  if (old) old.remove();
  clearNode(result); result.hidden = true;
  drop.classList.remove("is-compact");
  $("[data-pick-label]", drop).textContent = tx("Choose a PDF");
}

dropzone(drop, {
  accept: ["application/pdf", ".pdf"], maxFileBytes: MAX_BYTES, typeLabel: "PDF",
  onError: (m) => setStatus(status, "error", m),
  onFiles: async ([f]) => {
    resetPdf();
    const my = loadToken;
    setStatus(status, "working", tx("Reading the PDF…"));
    await tick();
    try {
      const b = await readBytes(f);
      const doc = await openForEdit(b, f.name);
      const count = doc.getPageCount();
      if (!count) throw new UserError(tx("This PDF has no pages."));
      if (count > MAX_PAGES) throw new UserError(tx("This PDF has {n} pages; up to {max} pages can be signed at a time.", { n: fmtNum(count), max: fmtNum(MAX_PAGES) }));
      const g = doc.getPages().map((p) => {
        const box = typeof p.getCropBox === "function" ? p.getCropBox() : p.getMediaBox();
        if (!(box.width > 0 && box.height > 0)) throw new Error("page without a size");
        return { x: box.x, y: box.y, width: box.width, height: box.height, rotation: p.getRotation().angle };
      });
      const v = await openForView(b, f.name);
      if (my !== loadToken) { closeView(v); return; }
      file = f; bytes = b; geoms = g; view = v;
      $("#fname").textContent = f.name;
      $("#finfo").textContent = fmtBytes(f.size) + " · " + txn(count, "{n} page", "{n} pages");
      pageIn.max = String(count);
      $("#sg-of").textContent = tx("of {n}", { n: fmtNum(count) });
      drop.classList.add("is-compact");
      $("[data-pick-label]", drop).textContent = tx("Choose another PDF");
      work.hidden = false;
      setStatus(status, "idle");
      syncSliders();
      await showPage(1);
      changed();
      announce(tx("{name} loaded, {pages}.", { name: f.name, pages: txn(count, "{n} page", "{n} pages") }));
    } catch (err) {
      if (my !== loadToken) return;
      resetPdf();
      setStatus(status, "error", err instanceof UserError ? err.message : tx("This file couldn't be read as a PDF."));
    }
  },
});

/* ------------------------------------------------------------------ controls */

function syncMode() {
  const draw = mode() === "draw";
  $("#sg-draw").hidden = !draw;
  $("#sg-type").hidden = draw;
  changed();
}
for (const r of document.querySelectorAll('input[name="sg-mode"]')) r.addEventListener("change", syncMode);
for (const r of document.querySelectorAll('input[name="sg-ink"]')) r.addEventListener("change", () => { redrawPad(); changed(); });
nameIn.addEventListener("input", changed);
fontSel.addEventListener("change", changed);
dateOn.addEventListener("change", () => { $("#sg-date-field").hidden = !dateOn.checked; changed(); });
dateIn.addEventListener("input", changed);
for (const r of document.querySelectorAll('input[name="sg-scope"]')) r.addEventListener("change", staleResult);

dateIn.value = dateFormat({ dateStyle: "medium" }).format(new Date());

/* ------------------------------------------------------------------ save */

go.addEventListener("click", () => runJob({
  status, button: go, working: tx("Adding the signature…"),
  done: (r) => r && txn(r.n, "Signature added to {n} page.", "Signature added to {n} pages."),
  job: async (progress) => {
    const s = buildStamp();
    if (!s) throw new UserError(tx("Draw or type a signature first."));
    const png = new Uint8Array(await (await new Promise((res) => s.toBlob(res, "image/png"))).arrayBuffer());
    const { degrees } = await loadPdfLib();
    const doc = await openForEdit(bytes, file.name);
    const image = await doc.embedPng(png);
    const pages = doc.getPages();
    const targets = targetPages(radio("sg-scope"), pageNo - 1, pages.length);
    targets.forEach((idx, k) => {
      const page = pages[idx];
      const box = typeof page.getCropBox === "function" ? page.getCropBox() : page.getMediaBox();
      const r = placeStamp({ x: box.x, y: box.y, width: box.width, height: box.height, rotation: page.getRotation().angle }, s.height / s.width, place);
      page.drawImage(image, { x: r.x, y: r.y, width: r.width, height: r.height, rotate: degrees(r.angle) });
      if (k % 20 === 0) progress(tx("Signing page {n}…", { n: fmtNum(idx + 1) }), k / targets.length);
    });
    progress(tx("Writing the file…"), 0.95);
    const blob = await saveDoc(doc);
    showResults(result, [{ blob, name: baseName(file.name) + "-signed.pdf", note: txn(pages.length, "{n} page", "{n} pages") }]);
    return { n: targets.length };
  },
}));

$("#clear").addEventListener("click", () => {
  resetPdf();
  setStatus(status, "idle");
  drop.querySelector("input").focus();
});

redrawPad();
syncSliders();
renderTyped();
