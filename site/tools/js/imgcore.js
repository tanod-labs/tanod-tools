// Tanod Tools image core: decoding, canvas helpers, safe encoding, limits and the shared batch UI.
// Everything runs in the browser; files are never sent anywhere.
import { el, icon, fmtBytes, dropzone, setStatus, runJob, showResults, clearNode, UserError, friendlyError, announce, tick, baseName, tx, txn, fmtNum, EN } from "./core.js?v=11";

export { UserError };

export const MAX_BYTES = 50 * 1024 * 1024;
export const MAX_PIXELS = 100 * 1000 * 1000;
export const MAX_FILES = 50;
export const ACCEPT = [
  "image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp", "image/avif",
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif",
];

export const MIME = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };
export const EXT = { png: "png", jpeg: "jpg", webp: "webp", gif: "gif", bmp: "bmp", avif: "avif" };
export const LABEL = { png: "PNG", jpeg: "JPEG", webp: "WebP", gif: "GIF", bmp: "BMP", avif: "AVIF" };
const LABEL_BY_MIME = { "image/png": "PNG", "image/jpeg": "JPEG", "image/webp": "WebP" };

/* ------------------------------------------------------------------ bytes */

let CRC_TABLE;
export function crc32(bytes, start = 0, end = bytes.length, seed = 0xffffffff) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = seed;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function concatBytes(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

const ascii = (b, s, e) => { let r = ""; for (let i = s; i < e && i < b.length; i++) r += String.fromCharCode(b[i]); return r; };
export { ascii };

/* ------------------------------------------------------------------ sniffing */

export function sniffType(b) {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "webp";
  if (b.length >= 6 && ascii(b, 0, 3) === "GIF") return "gif";
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) return "bmp";
  if (b.length >= 12 && ascii(b, 4, 8) === "ftyp" && /avif|avis/.test(ascii(b, 8, Math.min(b.length, 40)))) return "avif";
  return null;
}

function jpegSize(b) {
  let p = 2;
  while (p + 4 <= b.length) {
    if (b[p] !== 0xff) { p++; continue; }
    const m = b[p + 1];
    if (m === 0xff) { p++; continue; }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0) { p += 2; continue; }
    if (m === 0xda || m === 0xd9) return null;
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { height: (b[p + 5] << 8) | b[p + 6], width: (b[p + 7] << 8) | b[p + 8] };
    }
    p += 2 + ((b[p + 2] << 8) | b[p + 3]);
  }
  return null;
}

function sizeFromHead(type, b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (type === "png" && b.length >= 24) return { width: dv.getUint32(16), height: dv.getUint32(20) };
  if (type === "gif" && b.length >= 10) return { width: dv.getUint16(6, true), height: dv.getUint16(8, true) };
  if (type === "bmp" && b.length >= 26) return { width: Math.abs(dv.getInt32(18, true)), height: Math.abs(dv.getInt32(22, true)) };
  if (type === "jpeg") return jpegSize(b);
  if (type === "webp" && b.length >= 30) {
    const kind = ascii(b, 12, 16);
    if (kind === "VP8X") return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    if (kind === "VP8L") { const v = dv.getUint32(21, true); return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 }; }
    if (kind === "VP8 ") return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
  }
  if (type === "avif") {
    for (let i = 0; i + 16 <= b.length; i++) {
      if (b[i] === 0x69 && b[i + 1] === 0x73 && b[i + 2] === 0x70 && b[i + 3] === 0x65) return { width: dv.getUint32(i + 8), height: dv.getUint32(i + 12) };
    }
  }
  return null;
}

/* Read just enough of a file to know its real type and, where the header says, its size in pixels. */
export async function probe(file) {
  const head = new Uint8Array(await file.slice(0, 1 << 20).arrayBuffer());
  const type = sniffType(head);
  let size = null;
  try { size = type ? sizeFromHead(type, head) : null; } catch (_) { size = null; }
  return { type, width: size ? size.width : null, height: size ? size.height : null };
}

export const megapixels = (w, h) => {
  const d = w * h >= 1e7 ? 0 : 1;
  return EN ? (w * h / 1e6).toFixed(d) : fmtNum(w * h / 1e6, { minimumFractionDigits: d, maximumFractionDigits: d });
};

/* Validate a file before it is accepted. Returns {type, width, height}; throws UserError with a plain message. */
export async function validateFile(file) {
  if (file.size > MAX_BYTES) throw new UserError(tx("\"{name}\" is {size}; the limit is {limit} per file.", { name: file.name, size: fmtBytes(file.size), limit: fmtBytes(MAX_BYTES) }));
  const info = await probe(file);
  if (!info.type) throw new UserError(tx("\"{name}\" doesn't look like a PNG, JPEG, WebP, GIF, BMP or AVIF image. It may be damaged or have the wrong extension.", { name: file.name }));
  if (info.width !== null && (info.width < 1 || info.height < 1)) throw new UserError(tx("\"{name}\" has no readable image size.", { name: file.name }));
  if (info.width && info.width * info.height > MAX_PIXELS) {
    throw new UserError(tx("\"{name}\" is {w} × {h} pixels ({mp} megapixels). The limit is {limit} megapixels.", { name: file.name, w: info.width, h: info.height, mp: megapixels(info.width, info.height), limit: fmtNum(MAX_PIXELS / 1e6) }));
  }
  return info;
}

/* ------------------------------------------------------------------ decode and canvas */

export async function decode(file) {
  let bmp;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch (err) {
    console.warn(err);
    throw new UserError(tx("\"{name}\" couldn't be opened. It may be damaged, or your browser can't read this kind of image.", { name: file.name }));
  }
  if (bmp.width * bmp.height > MAX_PIXELS) {
    const { width, height } = bmp;
    bmp.close();
    throw new UserError(tx("\"{name}\" is {w} × {h} pixels ({mp} megapixels). The limit is {limit} megapixels.", { name: file.name, w: width, h: height, mp: megapixels(width, height), limit: fmtNum(MAX_PIXELS / 1e6) }));
  }
  return bmp;
}

export function newCanvas(w, h) {
  w = Math.round(w); h = Math.round(h);
  if (!(w >= 1 && h >= 1)) throw new UserError(tx("The image would have no pixels. Check the size you chose."));
  if (w * h > MAX_PIXELS * 1.01 || w > 32767 || h > 32767) throw new UserError(tx("That size is {w} × {h} pixels, which is more than this tool handles ({limit} megapixels).", { w, h, limit: fmtNum(MAX_PIXELS / 1e6) }));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}

export function ctx2d(canvas, opts) {
  const ctx = canvas.getContext("2d", opts);
  if (!ctx) throw new UserError(tx("Your browser couldn't make a drawing surface this large. Try a smaller image."));
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return ctx;
}

export function release(canvas) { if (canvas && canvas.width) { canvas.width = 0; canvas.height = 0; } }

/* High-quality resample: step down by halves, then one final draw. src is a bitmap or canvas (sw x sh).
   Returns a canvas of tw x th (or draws into `target` when given). */
export function scaleTo(src, sw, sh, tw, th, target) {
  tw = Math.max(1, Math.round(tw)); th = Math.max(1, Math.round(th));
  let cur = src, cw = sw, ch = sh;
  while (cw >= 2 * tw || ch >= 2 * th) {
    const nw = cw >= 2 * tw ? Math.ceil(cw / 2) : cw;
    const nh = ch >= 2 * th ? Math.ceil(ch / 2) : ch;
    const c = newCanvas(nw, nh);
    ctx2d(c).drawImage(cur, 0, 0, cw, ch, 0, 0, nw, nh);
    if (cur !== src) release(cur);
    cur = c; cw = nw; ch = nh;
  }
  const out = target || newCanvas(tw, th);
  if (target) { target.width = tw; target.height = th; }
  const ctx = ctx2d(out);
  ctx.clearRect(0, 0, tw, th);
  ctx.drawImage(cur, 0, 0, cw, ch, 0, 0, tw, th);
  if (cur !== src) release(cur);
  return out;
}

/* Draw a source into an existing preview canvas, fitted inside maxW x maxH (never enlarged). */
export function previewInto(canvas, src, sw, sh, maxW, maxH) {
  const s = Math.min(1, maxW / sw, maxH / sh);
  scaleTo(src, sw, sh, Math.max(1, sw * s), Math.max(1, sh * s), canvas);
  return canvas;
}

export function flattened(canvas, color = "#ffffff") {
  const c = newCanvas(canvas.width, canvas.height);
  const ctx = ctx2d(c);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(canvas, 0, 0);
  return c;
}

/* Encode a canvas, and verify the browser really produced the requested type (Safari, for one, can't encode WebP and
   silently returns PNG). */
export async function canvasToBlob(canvas, mime, quality) {
  const blob = await new Promise((resolve) => {
    try { canvas.toBlob(resolve, mime, quality); } catch (_) { resolve(null); }
  });
  if (!blob) throw new UserError(tx("Your browser couldn't create the image. It may be too large for this browser; try a smaller one."));
  if (blob.type !== mime) {
    throw new UserError(tx("Your browser can't save {format} images (it produced {produced} instead). Choose another output format.", { format: LABEL_BY_MIME[mime] || mime, produced: blob.type || tx("a different format") }));
  }
  return blob;
}

/* Encode as the given format key ("png" | "jpeg" | "webp"); JPEG is flattened on `bg` since it has no transparency. */
export async function encodeCanvas(canvas, type, quality = 0.92, bg = "#ffffff") {
  if (type === "jpeg") {
    const flat = flattened(canvas, bg);
    try { return await canvasToBlob(flat, MIME.jpeg, quality); } finally { release(flat); }
  }
  return canvasToBlob(canvas, MIME[type], type === "png" ? undefined : quality);
}

/* The format an output keeps: png/jpeg/webp stay, anything else is saved as PNG. */
export const keepType = (type) => (type === "jpeg" || type === "webp" ? type : "png");

export function outName(name, suffix, type) {
  return baseName(name) + suffix + "." + EXT[type];
}

export const dims = (w, h) => `${w} × ${h}`;
export const pctSaved = (before, after) => Math.round((1 - after / before) * 100);

/* ------------------------------------------------------------------ file intake */

const ACCEPT_ATTR = ACCEPT.join(",");
export { ACCEPT_ATTR };

/* A single-image drop slot. onFile(file, info) is called with a validated file. */
export function singleImage(drop, { onFile, onError }) {
  let pending = null;
  return dropzone(drop, {
    accept: ACCEPT, multiple: false, maxFileBytes: MAX_BYTES, typeLabel: "supported image",
    onError: (msg) => { pending = msg; onError(msg); setTimeout(() => { pending = null; }, 0); },
    onFiles: async (files) => {
      try {
        const info = await validateFile(files[0]);
        await onFile(files[0], info);
      } catch (err) {
        console.warn(err);
        onError(friendlyError(err));
      }
    },
  });
}

/* ------------------------------------------------------------------ batch tool
   cfg: drop, list, goRow, go, summary, status, result, clear (buttons / nodes from the page)
        verb: "Compressing"; pickMore; pickFirst; zipName; minFiles
        accept (file types the drop slot takes, default ACCEPT), typeLabel, validate(file) -> Promise<info> (default validateFile)
          for tools whose input is not one of the formats above (HEIC to JPG)
        meta(item) -> string; detail(item) -> Node|null; summaryText(items) -> string; blocked(items) -> string|null
        analyse(item) -> Promise (optional, runs once per added file)
        process(item, i, n) -> Promise<{blob, name, note?}>
        doneText(outputs, failures) -> string; resultNote(outputs) -> string|null
        onChange(items) after each render. */
export function batchTool(cfg) {
  const c = Object.assign({ verb: tx("Working on"), pickMore: tx("Add more images"), pickFirst: tx("Choose images"), zipName: "images.zip", minFiles: 1, accept: ACCEPT, typeLabel: "supported image", validate: validateFile }, cfg);
  const pick = c.drop.querySelector("[data-pick-label]");
  let items = [];
  let nextId = 1;
  let queue = Promise.resolve();
  let pendingError = null;

  function render() {
    c.list.replaceChildren(...items.map((it, i) => el("li", { "data-id": String(it.id) },
      el("span", { class: "files__idx" }, String(i + 1)),
      el("span", { class: "files__name" }, it.file.name,
        el("span", { class: "files__meta" }, c.meta(it)),
        c.detail ? c.detail(it) : null),
      el("span", { class: "files__btns" },
        el("button", { type: "button", class: "btn btn--sm btn--icon btn--quiet", "aria-label": tx("Remove {name}", { name: it.file.name }), onclick: () => remove(it.id) }, icon("i-x"))))));
    if (c.onChange) c.onChange(items);
    const has = items.length > 0;
    c.list.hidden = !has;
    c.goRow.hidden = !has;
    if (c.optsBox) c.optsBox.hidden = !has;
    c.drop.classList.toggle("is-compact", has);
    if (pick) pick.textContent = has ? c.pickMore : c.pickFirst;
    const why = has && c.blocked ? c.blocked(items) : null;
    c.go.disabled = items.length < c.minFiles || !!why;
    c.summary.textContent = !has ? "" : why || (c.summaryText ? c.summaryText(items) : txn(items.length, "{n} image", "{n} images"));
  }

  function remove(id) {
    items = items.filter((x) => x.id !== id);
    clearNode(c.result); c.result.hidden = true;
    render();
    announce(tx("Image removed."));
    if (!items.length) c.drop.querySelector("input").focus();
  }

  async function addFiles(files) {
    const room = MAX_FILES - items.length;
    const errors = [];
    if (room <= 0) { setStatus(c.status, "error", tx("You can add up to {max} images at once.", { max: fmtNum(MAX_FILES) })); return; }
    if (files.length > room) errors.push(txn(room, "Only {n} more image fit (the limit is {max}); the rest were skipped.", "Only {n} more images fit (the limit is {max}); the rest were skipped.", { max: fmtNum(MAX_FILES) }));
    if (!pendingError && !errors.length) setStatus(c.status, "idle");
    for (const file of files.slice(0, room)) {
      try {
        const info = await c.validate(file);
        const item = { id: nextId++, file, info };
        if (c.analyse) { try { await c.analyse(item); } catch (e) { console.warn(e); item.analyseError = true; } }
        items.push(item);
      } catch (err) {
        errors.push(friendlyError(err));
      }
    }
    if (errors.length) setStatus(c.status, "error", (pendingError ? pendingError + " " : "") + errors.join(" "));
    clearNode(c.result); c.result.hidden = true;
    render();
    announce(txn(items.length, "{n} image ready.", "{n} images ready."));
  }

  dropzone(c.drop, {
    accept: c.accept, multiple: true, maxFileBytes: MAX_BYTES, typeLabel: c.typeLabel,
    onError: (msg) => { pendingError = msg; setStatus(c.status, "error", msg); setTimeout(() => { pendingError = null; }, 0); },
    onFiles: (files) => { queue = queue.then(() => addFiles(files)); },
  });

  c.go.addEventListener("click", () => runJob({
    status: c.status, button: c.go, working: c.verb + "…",
    done: (r) => r && (c.doneText ? c.doneText(r.outputs, r.failures) : txn(r.outputs.length, "Done: {n} image ready.", "Done: {n} images ready.")) + (r.failures.length ? " " + txn(r.failures.length, "{n} could not be processed.", "{n} could not be processed.") : ""),
    job: async (progress) => {
      const outputs = [];
      const failures = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        progress(tx("{verb} {name} ({i} of {n})…", { verb: c.verb, name: it.file.name, i: fmtNum(i + 1), n: fmtNum(items.length) }), i / items.length);
        await tick();
        try {
          outputs.push(await c.process(it, i, items.length));
        } catch (err) {
          console.warn(err);
          failures.push({ name: it.file.name, msg: friendlyError(err) });
        }
      }
      if (!outputs.length) throw new UserError(failures[0].msg + (failures.length > 1 ? " " + txn(failures.length - 1, "({n} more failed too.)", "({n} more failed too.)") : ""));
      const notes = [];
      if (failures.length) notes.push(tx("Not processed: {list}", { list: failures.map((f) => `${f.name} (${f.msg})`).join(" ") }));
      const extra = c.resultNote ? c.resultNote(outputs) : null;
      if (extra) notes.unshift(extra);
      showResults(c.result, outputs, { zipName: c.zipName, note: notes.join(" "), title: c.resultTitle ? c.resultTitle(outputs) : undefined });
      return { outputs, failures };
    },
  }));

  c.clear.addEventListener("click", () => {
    items = [];
    clearNode(c.result); c.result.hidden = true;
    setStatus(c.status, "idle");
    render();
    c.drop.querySelector("input").focus();
  });

  return { render, get items() { return items; } };
}

/* A hidden-until-needed text readout helper used by several tools. */
export function setText(node, text) { node.textContent = text; }
