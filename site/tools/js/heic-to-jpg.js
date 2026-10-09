// HEIC to JPG: converts HEIC and HEIF photos (what iPhones and many Android phones save) to JPG. The pictures are decoded by
// the vendored ts-heic library, which is pure JavaScript, in a worker so the page stays usable; heiccore.js (no DOM) holds
// the checks around it. Nothing is uploaded.
import { $, fmtBytes, UserError, tx, txn, fmtNum, LANG } from "./core.js?v=11";
import { batchTool, newCanvas, ctx2d, release, encodeCanvas, outName, megapixels, dims } from "./imgcore.js?v=11";
import { heicKind, decodeChecked, HeicError, MAX_PIXELS } from "./heiccore.js?v=11";
import { sizeChange, totalSizes } from "./webpcore.js?v=11";   // size arithmetic shared with Image to WebP

const LIB_URL = "/tools/vendor/ts-heic/ts-heic.esm.js";
// the worker gets the same ?v= stamp as this module, so a new release never pairs it with an old cached copy
const WORKER_URL = (() => { const u = new URL("./heic-worker.js", import.meta.url); u.search = new URL(import.meta.url).search; return u; })();

const qInput = $("#quality"), qOut = $("#quality-out");
qInput.addEventListener("input", () => { qOut.textContent = qInput.value; });

/* ------------------------------------------------------------------ decoding */

class WorkerFailed extends Error {}
let worker = null;
let noWorker = typeof Worker === "undefined";
let nextId = 1;
const waiting = new Map();

function startWorker() {
  const w = new Worker(WORKER_URL, { type: "module" });
  w.onmessage = (e) => {
    const job = waiting.get(e.data.id);
    if (!job) return;
    waiting.delete(e.data.id);
    if (e.data.error) job.reject(new HeicError(e.data.error.code, e.data.error));
    else job.resolve(e.data);
  };
  w.onerror = (ev) => {
    if (ev && ev.preventDefault) ev.preventDefault();
    noWorker = true;
    w.terminate();
    worker = null;
    for (const job of waiting.values()) job.reject(new WorkerFailed());
    waiting.clear();
  };
  return w;
}

function decodeInWorker(buffer) {
  return new Promise((resolve, reject) => {
    try {
      if (!worker) worker = startWorker();
      const id = nextId++;
      waiting.set(id, { resolve, reject });
      worker.postMessage({ id, buffer }, [buffer]);
    } catch (_) {
      noWorker = true;
      reject(new WorkerFailed());
    }
  });
}

/* RGBA pixels of one file: in the worker when the browser has module workers, otherwise on this thread (the page then waits). */
async function decode(file) {
  const buffer = await file.arrayBuffer();
  if (!noWorker) {
    try {
      const r = await decodeInWorker(buffer.slice(0));
      return { width: r.width, height: r.height, data: new Uint8ClampedArray(r.buffer) };
    } catch (err) {
      if (!(err instanceof WorkerFailed)) throw err;
    }
  }
  let lib;
  try { lib = await import(LIB_URL); } catch (_) { throw new UserError(tx("The HEIC reader couldn't be started in this browser. Try the latest Chrome, Edge, Firefox or Safari.")); }
  const r = decodeChecked(lib, new Uint8Array(buffer));
  return { width: r.width, height: r.height, data: new Uint8ClampedArray(r.data.buffer, r.data.byteOffset, r.data.byteLength) };
}

function explain(err, name) {
  if (err.code === "too-big") {
    return new UserError(tx("\"{name}\" is {w} × {h} pixels ({mp} megapixels). The limit is {limit} megapixels.", { name, w: err.width, h: err.height, mp: megapixels(err.width, err.height), limit: fmtNum(MAX_PIXELS / 1e6) }));
  }
  if (err.code === "not-heic") return notHeic(name);
  return new UserError(tx("\"{name}\" couldn't be converted. It may be damaged, or use a kind of HEIC this tool can't read, such as 10-bit or lossless.", { name }));
}

const notHeic = (name) => new UserError(tx("\"{name}\" doesn't look like a HEIC photo. HEIC files end in .heic or .heif and come from iPhones and some Android phones.", { name }));

/* ------------------------------------------------------------------ the tool */

/* A note that ends like a sentence (the results block may follow it with another). */
const sentence = (s) => (/[.!?…।。]$/.test(s) ? s : s + (LANG === "hi" ? "।" : "."));

/* "12.3 MB → 3.4 MB · 72% smaller", "… · 12% larger" or "… · same size" */
function changeText(before, after) {
  const ch = sizeChange(before, after);
  const vars = { before: fmtBytes(before), after: fmtBytes(after), pct: fmtNum(ch.pct) };
  if (ch.dir === "smaller") return tx("{before} → {after} · {pct}% smaller", vars);
  if (ch.dir === "larger") return tx("{before} → {after} · {pct}% larger", vars);
  return tx("{before} → {after} · same size", vars);
}

let pairs = [];

batchTool({
  drop: $("#drop"), list: $("#files"), optsBox: $("#opts"), goRow: $("#go-row"), go: $("#go"),
  summary: $("#summary"), status: $("#status"), result: $("#result"), clear: $("#clear"),
  verb: tx("Converting"), zipName: "jpg-images.zip",
  pickFirst: $("#drop [data-pick-label]").textContent,
  accept: [], typeLabel: "HEIC",
  async validate(file) {
    // judged by what is inside, not by the name: phones and chat apps sometimes rename HEIC files
    const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
    if (heicKind(head) !== "heic") throw notHeic(file.name);
    return { type: "heic", width: null, height: null };
  },
  meta: (it) => `${fmtBytes(it.file.size)} · HEIC`,
  summaryText: (items) => tx("{images} · {size}", { images: txn(items.length, "{n} image", "{n} images"), size: fmtBytes(items.reduce((s, x) => s + x.file.size, 0)) }),
  async process(item, i) {
    if (i === 0) pairs = [];
    let pic;
    try { pic = await decode(item.file); } catch (err) { throw err instanceof HeicError ? explain(err, item.file.name) : err; }
    const canvas = newCanvas(pic.width, pic.height);
    try {
      ctx2d(canvas).putImageData(new ImageData(pic.data, pic.width, pic.height), 0, 0);
      pic = null;
      const blob = await encodeCanvas(canvas, "jpeg", Number(qInput.value) / 100, "#ffffff");
      pairs.push({ before: item.file.size, after: blob.size });
      return { blob, name: outName(item.file.name, "", "jpeg"), note: tx("{size} px", { size: dims(canvas.width, canvas.height) }) + " · " + changeText(item.file.size, blob.size) };
    } finally {
      release(canvas);
    }
  },
  doneText: (outputs) => txn(outputs.length, "Converted {n} photo to JPG.", "Converted {n} photos to JPG."),
  resultNote: (outputs) => (outputs.length > 1 ? sentence(tx("Total: {change}", { change: changeText(totalSizes(pairs).before, totalSizes(pairs).after) })) : null),
});
