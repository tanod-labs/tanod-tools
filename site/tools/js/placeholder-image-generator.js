import { $, $$, fmtBytes, setStatus, runJob, copyText, announce, debounce, UserError, tx, EN, fmtNum } from "./core.js?v=11";
import { newCanvas, ctx2d, release, encodeCanvas, MIME, EXT, MAX_PIXELS, dims } from "./imgcore.js?v=11";
import { sizeProblem } from "./imgcore3.js?v=11";

const MAX_SIDE_PX = 8000;
const FONT = "system-ui, Arial, Helvetica, sans-serif"; // same stack in the canvas and in the SVG
const DATA_URI_WARN = 32 * 1024;
const DATA_URI_MAX = 1024 * 1024;

const wIn = $("#w"), hIn = $("#h"), preview = $("#preview"), info = $("#info"), problemEl = $("#problem"), status = $("#status");
const dlBtn = $("#download"), copyBtn = $("#copy");
const fmtOf = () => $('input[name="fmt"]:checked').value;
const LABELS = { png: "PNG", jpeg: "JPEG", webp: "WebP", svg: "SVG" };

/* Read and check the size fields. Returns {w, h} or {error, bad: [inputs]}. */
function readSize() {
  const ok = (i) => /^\d+$/.test(i.value.trim()) && Number(i.value) >= 1 && Number(i.value) <= MAX_SIDE_PX;
  const bad = [wIn, hIn].filter((i) => !ok(i));
  if (bad.length) return { bad, error: tx("Width and height must be whole numbers from 1 to {max} pixels.", { max: fmtNum(MAX_SIDE_PX, { useGrouping: false }) }) };
  const w = Number(wIn.value), h = Number(hIn.value);
  const p = w * h > MAX_PIXELS ? sizeProblem(w, h) : null;
  if (p) return { bad: [wIn, hIn], error: p };
  return { w, h };
}

const label = (w, h) => $("#text").value.trim().replace(/\s+/g, " ") || `${w} × ${h}`;

/* Font size: as large as fits one line within 80% of the width and 40% of the height (measured at 100 px, then scaled). */
function fitSize(text, w, h) {
  const ctx = document.createElement("canvas").getContext("2d");
  ctx.font = `700 100px ${FONT}`;
  const tw = ctx.measureText(text).width || 1;
  return Math.max(1, Math.min((0.8 * w * 100) / tw, 0.4 * h));
}

function draw(canvas, w, h, k) {
  const text = label(w, h);
  const size = fitSize(text, w, h) * k;
  canvas.width = Math.max(1, Math.round(w * k)); canvas.height = Math.max(1, Math.round(h * k));
  const ctx = ctx2d(canvas);
  ctx.fillStyle = $("#bg").value;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = $("#fg").value;
  ctx.font = `700 ${size}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
}

const xmlEsc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function svgText(w, h) {
  const text = label(w, h);
  const size = Math.round(fitSize(text, w, h) * 100) / 100;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
    + `<rect width="${w}" height="${h}" fill="${xmlEsc($("#bg").value)}"/>`
    + `<text x="${w / 2}" y="${h / 2}" text-anchor="middle" dominant-baseline="central" font-family="${FONT}" font-weight="700" font-size="${size}" fill="${xmlEsc($("#fg").value)}">${xmlEsc(text)}</text></svg>`;
}

async function makeBlob(w, h, fmt) {
  if (fmt === "svg") return new Blob([svgText(w, h)], { type: "image/svg+xml" });
  const canvas = newCanvas(w, h);
  try {
    draw(canvas, w, h, 1);
    return await encodeCanvas(canvas, fmt, 0.92, $("#bg").value);
  } finally {
    release(canvas);
  }
}

/* ------------------------------------------------------------------ live preview */

function update() {
  const fmt = fmtOf();
  dlBtn.textContent = tx("Download {format}", { format: LABELS[fmt] });
  $("#text").placeholder = `${wIn.value || tx("W")} × ${hIn.value || tx("H")}`;
  const s = readSize();
  wIn.removeAttribute("aria-invalid"); hIn.removeAttribute("aria-invalid");
  if (s.error) {
    s.bad.forEach((i) => i.setAttribute("aria-invalid", "true"));
    problemEl.textContent = s.error;
    dlBtn.disabled = true; copyBtn.disabled = true;
    info.textContent = "";
    return;
  }
  problemEl.textContent = "";
  dlBtn.disabled = false; copyBtn.disabled = false;
  const k = Math.min(1, 560 / s.w, 420 / s.h);
  draw(preview, s.w, s.h, k);
  preview.setAttribute("aria-label", tx("Preview of a {w} by {h} pixel placeholder image reading \"{text}\"", { w: s.w, h: s.h, text: label(s.w, s.h) }));
  if (fmt === "svg") info.textContent = tx("{size} px · vector, a few hundred bytes", { size: dims(s.w, s.h) });
  else {
    const d = s.w * s.h < 1e5 ? 3 : 1;
    const mp = EN ? (s.w * s.h / 1e6).toFixed(d) : fmtNum(s.w * s.h / 1e6, { minimumFractionDigits: d, maximumFractionDigits: d });
    info.textContent = tx("{size} px · {mp} MP", { size: dims(s.w, s.h), mp });
  }
}
const updateSoon = debounce(update, 40);
$$("input").forEach((i) => i.addEventListener("input", updateSoon));
$$("input[type=radio]").forEach((i) => i.addEventListener("change", update));

$$("#presets button").forEach((b) => b.addEventListener("click", () => {
  wIn.value = b.dataset.w; hIn.value = b.dataset.h;
  update();
  announce(tx("Size set to {w} by {h}.", { w: b.dataset.w, h: b.dataset.h }));
}));

/* ------------------------------------------------------------------ download and copy */

dlBtn.addEventListener("click", () => runJob({
  status, button: dlBtn, working: tx("Making the image…"),
  done: (r) => r && tx("Downloaded {name} ({size}).", { name: r.name, size: fmtBytes(r.size) }),
  job: async () => {
    const s = readSize();
    if (s.error) throw new UserError(s.error);
    const fmt = fmtOf();
    const blob = await makeBlob(s.w, s.h, fmt);
    const name = `placeholder-${s.w}x${s.h}.${fmt === "svg" ? "svg" : EXT[fmt]}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.hidden = true;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return { name, size: blob.size };
  },
}));

const toDataUri = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(new UserError(tx("Your browser couldn't turn the image into a data URI.")));
  r.readAsDataURL(blob);
});

copyBtn.addEventListener("click", () => runJob({
  status, button: copyBtn, working: tx("Making the data URI…"),
  done: (r) => r && r.message,
  job: async () => {
    const s = readSize();
    if (s.error) throw new UserError(s.error);
    const fmt = fmtOf();
    let uri;
    if (fmt === "svg") uri = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgText(s.w, s.h));
    else {
      // estimate first so a huge raster is not encoded just to be refused
      if (s.w * s.h > 4e6) throw new UserError(tx("A {w} × {h} {format} would be far too large as a data URI. Download the file instead, or choose SVG or a smaller size.", { w: s.w, h: s.h, format: LABELS[fmt] }));
      uri = await toDataUri(await makeBlob(s.w, s.h, fmt));
    }
    if (uri.length > DATA_URI_MAX) throw new UserError(tx("The data URI would be {size}, which is too large to copy. Download the file instead, choose SVG, or use a smaller size.", { size: fmtBytes(uri.length) }));
    const ok = await copyText(uri, null);
    const size = fmtBytes(uri.length);
    let message = ok ? tx("Copied a data URI of {size}.", { size }) : tx("Couldn't use the clipboard. The data URI is {size}; download the file instead.", { size });
    if (ok && uri.length > DATA_URI_WARN) message += " " + tx("That is large for embedding in HTML or CSS: every visitor downloads it with the page. A file or SVG is usually better.");
    return { message };
  },
}));

update();
