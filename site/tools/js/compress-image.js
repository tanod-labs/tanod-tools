import { $, el, fmtBytes, UserError, tx, txn, fmtNum } from "./core.js?v=5";
import {
  batchTool, decode, newCanvas, ctx2d, release, encodeCanvas, keepType, outName, crc32, concatBytes, LABEL, pctSaved, dims,
} from "./imgcore.js?v=5";

const radio = (name) => document.querySelector(`input[name="${name}"]:checked`).value;
const qInput = $("#quality");
const qOut = $("#quality-out");
const compare = $("#compare");

qInput.addEventListener("input", () => { qOut.textContent = qInput.value; });

/* ------------------------------------------------------------------ indexed PNG writer */

async function zlibDeflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function pngChunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

/* PNG filtering for 1 byte per pixel: try all five filter types per row and keep the one with the smallest
   sum of absolute (signed) values, the usual heuristic. */
function filterRows(idx, w, h) {
  const raw = new Uint8Array((w + 1) * h);
  const best = new Uint8Array(w);
  const tmp = new Uint8Array(w);
  const zero = new Uint8Array(w);
  for (let y = 0; y < h; y++) {
    const cur = idx.subarray(y * w, y * w + w);
    const prev = y ? idx.subarray((y - 1) * w, y * w) : zero;
    let bestScore = Infinity, bestType = 0;
    for (let t = 0; t < 5; t++) {
      let score = 0;
      for (let x = 0; x < w; x++) {
        const a = x ? cur[x - 1] : 0, b = prev[x], c = x ? prev[x - 1] : 0;
        let v;
        if (t === 0) v = cur[x];
        else if (t === 1) v = cur[x] - a;
        else if (t === 2) v = cur[x] - b;
        else if (t === 3) v = cur[x] - ((a + b) >> 1);
        else {
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = cur[x] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
        }
        v &= 255;
        tmp[x] = v;
        score += v < 128 ? v : 256 - v;
        if (score >= bestScore) break;
      }
      if (score < bestScore) { bestScore = score; bestType = t; best.set(tmp); }
    }
    raw[y * (w + 1)] = bestType;
    raw.set(best, y * (w + 1) + 1);
  }
  return raw;
}

/* Quantise with UPNG.js, then write the indexed PNG ourselves (colour type 3, PLTE, tRNS when needed, zlib IDAT). */
async function indexedPng(canvas, colours) {
  if (typeof CompressionStream === "undefined" || !window.UPNG) {
    throw new UserError(tx("Your browser can't reduce colours. Set \"Reduce colours\" to Off to continue."));
  }
  const w = canvas.width, h = canvas.height;
  const rgba = ctx2d(canvas, { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const q = window.UPNG.quantize([rgba.buffer.slice(0)], colours, false);
  const q32 = new Uint32Array(q.bufs[0]);
  const map = new Map();
  const palette = [];
  for (const leaf of q.plte) {
    const c = leaf.est.rgba;
    if (!map.has(c)) { map.set(c, palette.length); palette.push(c); }
  }
  const idx = new Uint8Array(w * h);
  let lastC = -1, lastI = 0;
  for (let i = 0; i < idx.length; i++) {
    const c = q32[i];
    if (c !== lastC) {
      let k = map.get(c);
      if (k === undefined) { k = palette.length; if (k > 255) k = 0; else { map.set(c, k); palette.push(c); } }
      lastC = c; lastI = k;
    }
    idx[i] = lastI;
  }
  const plte = new Uint8Array(palette.length * 3);
  const trns = new Uint8Array(palette.length);
  let anyAlpha = false;
  palette.forEach((c, i) => {
    plte[i * 3] = c & 255; plte[i * 3 + 1] = (c >>> 8) & 255; plte[i * 3 + 2] = (c >>> 16) & 255;
    trns[i] = (c >>> 24) & 255;
    if (trns[i] !== 255) anyAlpha = true;
  });
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h);
  ihdr[8] = 8; ihdr[9] = 3;
  const idat = await zlibDeflate(filterRows(idx, w, h));
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", ihdr), pngChunk("PLTE", plte)];
  if (anyAlpha) parts.push(pngChunk("tRNS", trns));
  parts.push(pngChunk("IDAT", idat), pngChunk("IEND", new Uint8Array(0)));
  return new Blob([concatBytes(parts)], { type: "image/png" });
}

/* ------------------------------------------------------------------ before / after (1:1 crop of the centre) */

function cropCanvas(src, sw, sh) {
  const w = Math.min(sw, 360), h = Math.min(sh, 270);
  const c = newCanvas(w, h);
  ctx2d(c).drawImage(src, Math.floor((sw - w) / 2), Math.floor((sh - h) / 2), w, h, 0, 0, w, h);
  return c;
}

async function showCompare(canvas, beforeBlob, afterBlob, typeLabel) {
  const after = await createImageBitmap(afterBlob);
  const a = cropCanvas(canvas, canvas.width, canvas.height);
  const b = cropCanvas(after, after.width, after.height);
  after.close();
  compare.replaceChildren(
    el("p", { class: "label" }, tx("Centre of the image at 100%")),
    el("div", { class: "compare__grid" },
      el("figure", {}, el("div", { class: "preview" }, a), el("figcaption", {}, tx("Before · {size}", { size: fmtBytes(beforeBlob.size) }))),
      el("figure", {}, el("div", { class: "preview" }, b), el("figcaption", {}, tx("After ({format}) · {size}", { format: typeLabel, size: fmtBytes(afterBlob.size) })))));
  compare.hidden = false;
}

/* ------------------------------------------------------------------ tool */

let totals = { before: 0, after: 0 };

batchTool({
  drop: $("#drop"), list: $("#files"), optsBox: $("#opts"), goRow: $("#go-row"), go: $("#go"),
  summary: $("#summary"), status: $("#status"), result: $("#result"), clear: $("#clear"),
  verb: tx("Compressing"), zipName: "compressed-images.zip",
  meta: (it) => `${fmtBytes(it.file.size)} · ${it.info.width ? dims(it.info.width, it.info.height) + " · " : ""}${LABEL[it.info.type]}`,
  summaryText: (items) => tx("{images} · {size}", { images: txn(items.length, "{n} image", "{n} images"), size: fmtBytes(items.reduce((s, x) => s + x.file.size, 0)) }),
  onChange: () => { compare.hidden = true; compare.replaceChildren(); totals = { before: 0, after: 0 }; },
  async process(item, i, n) {
    if (i === 0) totals = { before: 0, after: 0 };
    const fmt = radio("fmt");
    const type = fmt === "keep" ? keepType(item.info.type) : fmt;
    const quality = Number(qInput.value) / 100;
    const colours = Number($("#colours").value);
    const bmp = await decode(item.file);
    const canvas = newCanvas(bmp.width, bmp.height);
    ctx2d(canvas).drawImage(bmp, 0, 0);
    bmp.close();
    try {
      const blob = type === "png" && colours ? await indexedPng(canvas, colours) : await encodeCanvas(canvas, type, quality);
      const before = item.file.size;
      if (blob.size >= before) {
        totals.before += before; totals.after += before;
        return { blob: item.file, name: item.file.name, note: tx("{size} · already optimised, original kept", { size: fmtBytes(before) }) };
      }
      totals.before += before; totals.after += blob.size;
      if (n === 1) await showCompare(canvas, item.file, blob, LABEL[type]);
      return {
        blob, name: outName(item.file.name, "-compressed", type),
        note: tx("{before} → {after} · {pct}% smaller", { before: fmtBytes(before), after: fmtBytes(blob.size), pct: fmtNum(pctSaved(before, blob.size)) }),
      };
    } finally {
      release(canvas);
    }
  },
  doneText: (outputs) => {
    const saved = totals.before - totals.after;
    return saved > 0
      ? txn(outputs.length, "Saved {size} ({pct}%) across {n} image.", "Saved {size} ({pct}%) across {n} images.", { size: fmtBytes(saved), pct: fmtNum(pctSaved(totals.before, totals.after)) })
      : tx("These images are already as small as this tool can make them, so the originals were kept.");
  },
});
