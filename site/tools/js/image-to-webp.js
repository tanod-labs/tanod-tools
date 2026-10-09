// Image to WebP: converts PNG, JPEG and other images to WebP with the browser's own encoder, with a quality slider, a size
// comparison per file and in total, and a check that the browser can really save WebP. The size and format logic is in
// webpcore.js (no DOM). Nothing is uploaded.
import { $, el, fmtBytes, tx, txn, fmtNum, LANG } from "./core.js?v=11";
import { batchTool, decode, newCanvas, ctx2d, release, encodeCanvas, outName, LABEL, dims } from "./imgcore.js?v=11";
import { webpInfo, sizeChange, qualityValue, totalSizes } from "./webpcore.js?v=11";

const qInput = $("#quality"), qOut = $("#quality-out"), note = $("#webp-note"), compare = $("#compare");
let supported = true;
let pairs = [];

qInput.addEventListener("input", () => { qOut.textContent = qInput.value; });

/* Some browsers can open WebP but not save it: toBlob then quietly hands back a PNG. Ask for a 1 x 1 picture to find out. */
async function detect() {
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  const blob = await new Promise((resolve) => {
    try { c.toBlob(resolve, "image/webp", 0.8); } catch (_) { resolve(null); }
  });
  supported = !!blob && blob.type === "image/webp";
  note.textContent = supported ? "" : tx("This browser can't save WebP files. Try Chrome, Edge or Firefox.");
  note.hidden = supported;
  tool.render();
}

/* A note that ends like a sentence, so that two of them can follow each other. */
const sentence = (s) => (/[.!?…।。]$/.test(s) ? s : s + (LANG === "hi" ? "।" : "."));

/* "123 KB → 45 KB · 63% smaller", "… · 12% larger" or "… · same size" */
function changeText(before, after) {
  const ch = sizeChange(before, after);
  const vars = { before: fmtBytes(before), after: fmtBytes(after), pct: fmtNum(ch.pct) };
  if (ch.dir === "smaller") return tx("{before} → {after} · {pct}% smaller", vars);
  if (ch.dir === "larger") return tx("{before} → {after} · {pct}% larger", vars);
  return tx("{before} → {after} · same size", vars);
}

function cropCanvas(src, w0, h0) {
  const w = Math.min(w0, 360), h = Math.min(h0, 270);
  const c = newCanvas(w, h);
  ctx2d(c).drawImage(src, Math.floor((w0 - w) / 2), Math.floor((h0 - h) / 2), w, h, 0, 0, w, h);
  return c;
}

/* One image: the middle of the original and of the WebP side by side at 100%, so the quality can be judged. */
async function showCompare(canvas, before, afterBlob) {
  const after = await createImageBitmap(afterBlob);
  const a = cropCanvas(canvas, canvas.width, canvas.height);
  const b = cropCanvas(after, after.width, after.height);
  after.close();
  compare.replaceChildren(
    el("p", { class: "label" }, tx("Centre of the image at 100%")),
    el("div", { class: "compare__grid" },
      el("figure", {}, el("div", { class: "preview" }, a), el("figcaption", {}, tx("Before · {size}", { size: fmtBytes(before.size) }))),
      el("figure", {}, el("div", { class: "preview" }, b), el("figcaption", {}, tx("After ({format}) · {size}", { format: LABEL.webp, size: fmtBytes(afterBlob.size) })))));
  compare.hidden = false;
}

const tool = batchTool({
  drop: $("#drop"), list: $("#files"), optsBox: $("#opts"), goRow: $("#go-row"), go: $("#go"),
  summary: $("#summary"), status: $("#status"), result: $("#result"), clear: $("#clear"),
  verb: tx("Converting"), zipName: "webp-images.zip",
  meta: (it) => `${fmtBytes(it.file.size)} · ${it.info.width ? dims(it.info.width, it.info.height) + " · " : ""}${LABEL[it.info.type]}`,
  summaryText: (items) => tx("{images} · {size}", { images: txn(items.length, "{n} image", "{n} images"), size: fmtBytes(items.reduce((s, x) => s + x.file.size, 0)) }),
  blocked: () => (supported ? null : tx("This browser can't save WebP files. Try Chrome, Edge or Firefox.")),
  onChange: () => { compare.hidden = true; compare.replaceChildren(); },
  async process(item, i, n) {
    if (i === 0) pairs = [];
    const bmp = await decode(item.file);
    const canvas = newCanvas(bmp.width, bmp.height);
    ctx2d(canvas).drawImage(bmp, 0, 0);
    bmp.close();
    try {
      const blob = await encodeCanvas(canvas, "webp", qualityValue(qInput.value));
      const info = webpInfo(new Uint8Array(await blob.arrayBuffer()));
      pairs.push({ before: item.file.size, after: blob.size });
      if (n === 1) await showCompare(canvas, item.file, blob);
      return {
        blob, name: outName(item.file.name, item.info.type === "webp" ? "-recompressed" : "", "webp"),
        note: changeText(item.file.size, blob.size) + (info && info.kind === "lossless" ? " · " + tx("lossless") : ""),
      };
    } finally {
      release(canvas);
    }
  },
  doneText: (outputs) => {
    const t = totalSizes(pairs);
    return t.after < t.before
      ? txn(outputs.length, "Saved {size} ({pct}%) across {n} image.", "Saved {size} ({pct}%) across {n} images.", { size: fmtBytes(t.before - t.after), pct: fmtNum(sizeChange(t.before, t.after).pct) })
      : txn(outputs.length, "Converted {n} image to WebP, but it is not smaller than the original.", "Converted {n} images to WebP, but they are not smaller than the originals.");
  },
  resultNote: (outputs) => {
    const larger = pairs.filter((p) => p.after > p.before).length;
    const parts = [];
    if (outputs.length > 1) parts.push(tx("Total: {change}", { change: changeText(totalSizes(pairs).before, totalSizes(pairs).after) }));
    if (larger) parts.push(txn(larger, "{n} file came out larger than the original; keep the original for that one.", "{n} files came out larger than the originals; keep the originals for those."));
    return parts.length ? parts.map(sentence).join(" ") : null;
  },
});

detect();
