import { $, el, icon, fmtBytes, dropzone, readBytes, runJob, setStatus, showResults, clearNode, baseName, UserError, announce, tx, txn } from "./core.js?v=11";
import { loadPdfLib, saveDoc } from "./pdfcore.js?v=11";

const MAX_FILES = 200;
const MAX_BYTES = 50 * 1024 * 1024;
const MAX_FIT_SIDE = 14400;
const SIZES = { a4: [595.28, 841.89], letter: [612, 792] };

const drop = $("#drop"), list = $("#files"), work = $("#work"), go = $("#go");
const status = $("#status"), result = $("#result"), summary = $("#summary");
const pagesize = $("#pagesize"), orient = $("#orient"), margin = $("#margin");
const pickLabel = $("[data-pick-label]", drop);
const pickFirst = pickLabel.textContent; // variant pages name their source format ("Choose PNG files")

let items = [];
let nextId = 1;

dropzone(drop, {
  accept: ["image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp", ".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"],
  multiple: true, maxFileBytes: MAX_BYTES, typeLabel: "image",
  onError: (m) => setStatus(status, "error", m),
  onFiles: (files) => {
    const room = MAX_FILES - items.length;
    if (room <= 0) return setStatus(status, "error", tx("You can add up to {max} images.", { max: MAX_FILES }));
    if (files.length > room) setStatus(status, "error", txn(room, "Only {n} more image fits; the rest were skipped.", "Only {n} more images fit; the rest were skipped."));
    else setStatus(status, "idle");
    for (const file of files.slice(0, room)) items.push({ id: nextId++, file, thumb: null });
    clearNode(result); result.hidden = true;
    render();
    queueThumbs();
    announce(txn(items.length, "{n} image ready.", "{n} images ready."));
  },
});

let thumbBusy = false;
async function queueThumbs() {
  if (thumbBusy) return;
  thumbBusy = true;
  try {
    for (const it of items.slice()) {
      if (it.thumb !== null) continue;
      it.thumb = false;
      try {
        const bmp = await createImageBitmap(it.file, { imageOrientation: "from-image" });
        const r = Math.min(1, 88 / Math.max(bmp.width, bmp.height));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(bmp.width * r)); c.height = Math.max(1, Math.round(bmp.height * r));
        c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
        bmp.close && bmp.close();
        it.thumb = c;
      } catch (_) { it.thumb = false; }
      render();
    }
  } finally { thumbBusy = false; }
}

function move(id, d) {
  const i = items.findIndex((x) => x.id === id), j = i + d;
  if (j < 0 || j >= items.length) return;
  [items[i], items[j]] = [items[j], items[i]];
  render();
  const b = list.querySelector(`[data-id="${id}"] [data-move="${d}"]`);
  (b && !b.disabled ? b : list.querySelector(`[data-id="${id}"] [data-move]:not(:disabled)`))?.focus();
}
function remove(id) {
  items = items.filter((x) => x.id !== id);
  render();
  announce(tx("Image removed."));
  if (!items.length) drop.querySelector("input").focus();
}

function render() {
  list.replaceChildren(...items.map((it, i) => el("li", { "data-id": String(it.id) },
    el("span", { class: "files__idx" }, String(i + 1)),
    el("span", { class: "files__thumb" }, it.thumb || null),
    el("span", { class: "files__name" }, it.file.name, el("span", { class: "files__meta" }, fmtBytes(it.file.size))),
    el("span", { class: "files__btns" },
      el("button", { type: "button", class: "btn btn--sm btn--icon btn--quiet", "data-move": "-1", disabled: i === 0, "aria-label": tx("Move {name} up", { name: it.file.name }), onclick: () => move(it.id, -1) }, icon("i-arrow-up")),
      el("button", { type: "button", class: "btn btn--sm btn--icon btn--quiet", "data-move": "1", disabled: i === items.length - 1, "aria-label": tx("Move {name} down", { name: it.file.name }), onclick: () => move(it.id, 1) }, icon("i-arrow-down")),
      el("button", { type: "button", class: "btn btn--sm btn--icon btn--quiet", "aria-label": tx("Remove {name}", { name: it.file.name }), onclick: () => remove(it.id) }, icon("i-x"))))));
  const has = items.length > 0;
  list.hidden = !has; work.hidden = !has;
  drop.classList.toggle("is-compact", has);
  pickLabel.textContent = has ? tx("Add more images") : pickFirst;
  go.disabled = !has;
  summary.textContent = has ? txn(items.length, "{n} image", "{n} images") + " · " + txn(items.length, "{n} page", "{n} pages") : "";
  const fit = pagesize.value === "fit";
  orient.disabled = fit;
  $("#orient-help").textContent = fit ? tx("Not used with Fit to image: each page takes its image's shape.") : "";
}
pagesize.addEventListener("change", render);

/* Sniff the real format from the bytes; file extensions and MIME types can lie. */
function sniff(b) {
  if (b[0] === 0xff && b[1] === 0xd8) return "jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  return "other";
}

/* EXIF orientation (1..8) from a JPEG's APP1 segment, or 1. */
function exifOrientation(b) {
  let p = 2;
  while (p + 4 < b.length && b[p] === 0xff) {
    const m = b[p + 1];
    if (m === 0xda || m === 0xd9) break;
    if (m === 0xff) { p++; continue; }
    const len = (b[p + 2] << 8) | b[p + 3];
    if (m === 0xe1 && b[p + 4] === 0x45 && b[p + 5] === 0x78 && b[p + 6] === 0x69 && b[p + 7] === 0x66 && b[p + 8] === 0 && b[p + 9] === 0) {
      const t = p + 10;
      const le = b[t] === 0x49;
      const u16 = (o) => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
      const u32 = (o) => (le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0);
      if (u16(t + 2) !== 42) return 1;
      const ifd = t + u32(t + 4);
      if (ifd + 2 > b.length) return 1;
      const n = u16(ifd);
      for (let i = 0; i < n; i++) {
        const e = ifd + 2 + i * 12;
        if (e + 12 > b.length) break;
        if (u16(e) === 0x0112) { const v = u16(e + 8); return v >= 1 && v <= 8 ? v : 1; }
      }
      return 1;
    }
    p += 2 + len;
  }
  return 1;
}

const canvasBlob = (c, type, q) => new Promise((res, rej) => c.toBlob((x) => (x ? res(x) : rej(new Error(tx("The browser couldn't re-encode an image.")))), type, q));

async function viaCanvas(file, type, q) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const c = document.createElement("canvas");
  c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext("2d");
  if (type === "image/jpeg") { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); }
  ctx.drawImage(bmp, 0, 0);
  bmp.close && bmp.close();
  const blob = await canvasBlob(c, type, q);
  c.width = c.height = 0;
  return new Uint8Array(await blob.arrayBuffer());
}

async function embed(doc, file) {
  const raw = await readBytes(file);
  const kind = sniff(raw);
  try {
    if (kind === "jpeg") {
      if (exifOrientation(raw) === 1) return await doc.embedJpg(raw);
      return await doc.embedJpg(await viaCanvas(file, "image/jpeg", 0.92));
    }
    if (kind === "png") return await doc.embedPng(raw);
  } catch (err) {
    if (kind === "jpeg") return await doc.embedJpg(await viaCanvas(file, "image/jpeg", 0.92)).catch(() => { throw bad(file); });
    // PNG variants pdf-lib can't read: let the browser decode them
  }
  try { return await doc.embedPng(await viaCanvas(file, "image/png")); } catch (_) { throw bad(file); }
}
const bad = (file) => new UserError(tx("\"{name}\" couldn't be opened as an image. It may be damaged or in a format your browser doesn't support.", { name: file.name }));

go.addEventListener("click", () => runJob({
  status, button: go, working: tx("Creating the PDF…"),
  done: (r) => r && txn(r.pages, "Created a PDF with {n} page.", "Created a PDF with {n} pages."),
  job: async (progress) => {
    const { PDFDocument } = await loadPdfLib();
    const doc = await PDFDocument.create();
    const mg = Number(margin.value);
    for (let i = 0; i < items.length; i++) {
      const { file } = items[i];
      progress(tx("Adding {name} ({i} of {n})…", { name: file.name, i: i + 1, n: items.length }), i / items.length);
      const img = await embed(doc, file);
      let pw, ph;
      if (pagesize.value === "fit") {
        let s = 1;
        const big = Math.max(img.width, img.height) + 2 * mg;
        if (big > MAX_FIT_SIDE) s = (MAX_FIT_SIDE - 2 * mg) / Math.max(img.width, img.height);
        pw = img.width * s + 2 * mg; ph = img.height * s + 2 * mg;
      } else {
        [pw, ph] = SIZES[pagesize.value];
        const landscape = orient.value === "landscape" || (orient.value === "auto" && img.width > img.height);
        if (landscape) [pw, ph] = [ph, pw];
      }
      const page = doc.addPage([pw, ph]);
      const aw = pw - 2 * mg, ah = ph - 2 * mg;
      const s = Math.min(aw / img.width, ah / img.height);
      const w = img.width * s, h = img.height * s;
      page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
      await new Promise((r) => setTimeout(r, 0));
    }
    progress(tx("Writing the file…"), 0.97);
    const blob = await saveDoc(doc);
    const name = items.length === 1 ? baseName(items[0].file.name) + ".pdf" : "images.pdf";
    showResults(result, [{ blob, name, note: txn(items.length, "{n} page", "{n} pages") }]);
    return { pages: items.length };
  },
}));

$("#clear").addEventListener("click", () => {
  items = [];
  clearNode(result); result.hidden = true;
  setStatus(status, "idle");
  render();
  drop.querySelector("input").focus();
});
render();
