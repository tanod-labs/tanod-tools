import { $, el, fmtBytes, setStatus, runJob, showResults, clearNode, copyText, textBlob, debounce, announce, tx } from "./core.js?v=5";
import { singleImage, decode, newCanvas, ctx2d, scaleTo, release, canvasToBlob, concatBytes, MIME, dims } from "./imgcore.js?v=5";

const radio = (name) => document.querySelector(`input[name="${name}"]:checked`).value;
const drop = $("#drop"), status = $("#status"), result = $("#result"), go = $("#go");
const paneImg = $("#pane-image"), paneTxt = $("#pane-text"), previews = $("#fav-previews"), padOpts = $("#pad-opts");
let src = null; // { bmp, w, h, name }

/* Draw the icon at size x size onto a fresh canvas. */
function render(size) {
  const c = newCanvas(size, size);
  const ctx = ctx2d(c);
  if (radio("source") === "text") {
    const bg = $("#t-bg").value, fg = $("#t-fg").value;
    const text = ($("#t-text").value || "").trim().slice(0, 2) || "A";
    ctx.fillStyle = bg;
    if (radio("shape") === "round") { ctx.beginPath(); ctx.roundRect(0, 0, size, size, size * 0.22); ctx.fill(); }
    else ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = fg;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    let fs = size * (text.length > 1 ? 0.52 : 0.68);
    const font = (n) => `800 ${n}px Archivo, system-ui, sans-serif`;
    ctx.font = font(fs);
    const wide = ctx.measureText(text).width;
    if (wide > size * 0.82) { fs *= (size * 0.82) / wide; ctx.font = font(fs); }
    const m = ctx.measureText(text);
    const asc = m.actualBoundingBoxAscent || fs * 0.72, desc = m.actualBoundingBoxDescent || 0;
    ctx.fillText(text, size / 2, size / 2 + (asc - desc) / 2);
    return c;
  }
  if (!src) return c;
  if (radio("fit") === "cover") {
    const side = Math.min(src.w, src.h);
    const tmp = newCanvas(side, side);
    ctx2d(tmp).drawImage(src.bmp, (src.w - side) / 2, (src.h - side) / 2, side, side, 0, 0, side, side);
    scaleTo(tmp, side, side, size, size, c);
    release(tmp);
  } else {
    const pad = Math.round(size * 0.08);
    const inner = size - pad * 2;
    const k = Math.min(inner / src.w, inner / src.h);
    const tw = Math.max(1, Math.round(src.w * k)), th = Math.max(1, Math.round(src.h * k));
    if (!$("#transparent").checked) { ctx.fillStyle = $("#bg").value; ctx.fillRect(0, 0, size, size); }
    const scaled = scaleTo(src.bmp, src.w, src.h, tw, th);
    ctx.drawImage(scaled, Math.round((size - tw) / 2), Math.round((size - th) / 2));
    release(scaled);
  }
  return c;
}

const ready = () => radio("source") === "text" ? ($("#t-text").value || "").trim().length > 0 : !!src;

function drawPreviews() {
  go.disabled = !ready();
  previews.replaceChildren();
  if (!ready()) { previews.hidden = true; return; }
  previews.hidden = false;
  for (const size of [16, 32, 48, 180]) {
    const c = render(size);
    c.setAttribute("aria-label", tx("{size} by {size} preview", { size }));
    c.setAttribute("role", "img");
    previews.append(el("figure", { class: "fav__item" }, el("div", { class: "preview fav__well" }, c), el("figcaption", { class: "num" }, `${size}×${size}`)));
  }
}
const redraw = debounce(drawPreviews, 80);

function syncMode() {
  const text = radio("source") === "text";
  paneImg.hidden = text;
  paneTxt.hidden = !text;
  padOpts.hidden = radio("fit") !== "pad";
  drawPreviews();
}
document.querySelectorAll("input[name=source], input[name=fit], input[name=shape]").forEach((r) => r.addEventListener("change", syncMode));
for (const id of ["#t-text", "#t-fg", "#t-bg", "#bg", "#transparent"]) $(id).addEventListener("input", redraw);

singleImage(drop, {
  onError: (msg) => setStatus(status, "error", msg),
  onFile: async (file) => {
    const bmp = await decode(file);
    if (src) src.bmp.close();
    src = { bmp, w: bmp.width, h: bmp.height, name: file.name };
    $("#img-meta").textContent = tx("{name} · {size} px", { name: file.name, size: dims(bmp.width, bmp.height) });
    $("[data-pick-label]", drop).textContent = tx("Choose another image");
    drop.classList.add("is-compact");
    $(`input[name=source][value=image]`).checked = true;
    clearNode(result); result.hidden = true;
    setStatus(status, "idle");
    syncMode();
    announce(tx("Image loaded. Previews updated."));
  },
});

/* ------------------------------------------------------------------ files */

function ico(entries) {
  const head = new Uint8Array(6 + entries.length * 16);
  const dv = new DataView(head.buffer);
  dv.setUint16(2, 1, true); dv.setUint16(4, entries.length, true);
  let off = head.length;
  entries.forEach((e, i) => {
    const o = 6 + i * 16;
    head[o] = e.size >= 256 ? 0 : e.size; head[o + 1] = e.size >= 256 ? 0 : e.size;
    dv.setUint16(o + 4, 1, true); dv.setUint16(o + 6, 32, true);
    dv.setUint32(o + 8, e.bytes.length, true); dv.setUint32(o + 12, off, true);
    off += e.bytes.length;
  });
  return concatBytes([head, ...entries.map((e) => e.bytes)]);
}

const SNIPPET = `<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">`;

async function png(size) {
  const c = render(size);
  try { return new Uint8Array(await (await canvasToBlob(c, MIME.png)).arrayBuffer()); } finally { release(c); }
}

go.addEventListener("click", () => runJob({
  status, button: go, working: tx("Creating the icon files…"),
  done: () => tx("Done: 7 files are ready, plus the HTML to paste into your page."),
  job: async (progress) => {
    const bytes = {};
    for (const s of [16, 32, 48, 180, 192, 512]) { progress(tx("Drawing {size}×{size}…", { size: s })); bytes[s] = await png(s); }
    const icoBytes = ico([16, 32, 48].map((s) => ({ size: s, bytes: bytes[s] })));
    const name = ($("#site-name").value || "").trim() || tx("My site");
    const theme = radio("source") === "text" ? $("#t-bg").value : ($("#transparent").checked ? "#ffffff" : $("#bg").value);
    const manifest = JSON.stringify({
      name, short_name: name.slice(0, 12), icons: [
        { src: "/android-chrome-192x192.png", sizes: "192x192", type: "image/png" },
        { src: "/android-chrome-512x512.png", sizes: "512x512", type: "image/png" },
      ], theme_color: theme, background_color: theme, display: "standalone",
    }, null, 2) + "\n";
    const mk = (u8, type) => new Blob([u8], { type });
    const outputs = [
      { name: "favicon.ico", blob: mk(icoBytes, "image/x-icon") },
      { name: "favicon-16x16.png", blob: mk(bytes[16], "image/png") },
      { name: "favicon-32x32.png", blob: mk(bytes[32], "image/png") },
      { name: "apple-touch-icon.png", blob: mk(bytes[180], "image/png") },
      { name: "android-chrome-192x192.png", blob: mk(bytes[192], "image/png") },
      { name: "android-chrome-512x512.png", blob: mk(bytes[512], "image/png") },
      { name: "site.webmanifest", blob: textBlob(manifest, "application/manifest+json") },
    ];
    showResults(result, outputs, { zipName: "favicons.zip", title: tx("7 favicon files are ready") });
    result.append(
      el("div", { class: "fav__snippet" },
        el("p", { class: "label" }, tx("Add this to the <head> of your pages, with the files at your site's root")),
        el("pre", { class: "out", id: "snippet" }, SNIPPET),
        el("button", { type: "button", class: "btn btn--sm", id: "copy", onclick: (e) => copyText(SNIPPET, e.currentTarget) }, tx("Copy HTML"))));
  },
}));

syncMode();
