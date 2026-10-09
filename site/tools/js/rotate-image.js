import { $, fmtBytes, tx, txn } from "./core.js?v=11";
import { batchTool, decode, newCanvas, ctx2d, scaleTo, release, encodeCanvas, keepType, outName, LABEL, dims } from "./imgcore.js?v=11";

const prev = $("#preview");
const prevLabel = $("#preview-label");
let M = [1, 0, 0, 1]; // canvas transform without translation: x' = a*x + c*y, y' = b*x + d*y
let flipsOnly = true;
let prevSrc = null;   // downscaled copy of the first image
let prevId = null;
let tool;

/* operations are written in the same [a, b, c, d] layout and applied after the current transform */
const OPS = {
  right: [0, 1, -1, 0],
  left: [0, -1, 1, 0],
  half: [-1, 0, 0, -1],
  flipH: [-1, 0, 0, 1],
  flipV: [1, 0, 0, -1],
};

function apply(name) {
  const [oa, ob, oc, od] = OPS[name];
  const [a, b, c, d] = M;
  M = [oa * a + oc * b, ob * a + od * b, oa * c + oc * d, ob * c + od * d];
  if (name !== "flipH" && name !== "flipV") flipsOnly = false;
  refreshPreview();
  tool.render();
}

const isIdentity = () => M[0] === 1 && M[1] === 0 && M[2] === 0 && M[3] === 1;

/* Draw src (sw x sh) through the transform onto a canvas (new, or `target`). */
function transformed(src, sw, sh, target) {
  const [a, b, c, d] = M;
  const swap = a === 0;
  const ow = swap ? sh : sw, oh = swap ? sw : sh;
  const xs = [0, a * sw, c * sh, a * sw + c * sh], ys = [0, b * sw, d * sh, b * sw + d * sh];
  const e = -Math.min(...xs), f = -Math.min(...ys);
  const out = target || newCanvas(ow, oh);
  if (target) { target.width = ow; target.height = oh; }
  const ctx = ctx2d(out);
  ctx.setTransform(a, b, c, d, e, f);
  ctx.drawImage(src, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return out;
}

function refreshPreview() {
  if (!prevSrc) return;
  transformed(prevSrc, prevSrc.width, prevSrc.height, prev);
}

async function loadPreview(item) {
  prevSrc = null;
  if (!item) { prevId = null; return; }
  prevId = item.id;
  try {
    const bmp = await decode(item.file);
    const k = Math.min(1, 640 / bmp.width, 480 / bmp.height);
    const src = scaleTo(bmp, bmp.width, bmp.height, Math.max(1, bmp.width * k), Math.max(1, bmp.height * k));
    bmp.close();
    if (prevId !== item.id) return;
    prevSrc = src;
    prevLabel.textContent = tx("Preview of {name}", { name: item.file.name });
    refreshPreview();
  } catch (err) {
    console.warn(err);
    prevLabel.textContent = tx("Preview isn't available for this image, but the result will still be rotated.");
  }
}

document.querySelectorAll("[data-op]").forEach((b) => b.addEventListener("click", () => apply(b.dataset.op)));
$("#reset").addEventListener("click", () => { M = [1, 0, 0, 1]; flipsOnly = true; refreshPreview(); tool.render(); });

tool = batchTool({
  drop: $("#drop"), list: $("#files"), optsBox: $("#opts"), goRow: $("#go-row"), go: $("#go"),
  summary: $("#summary"), status: $("#status"), result: $("#result"), clear: $("#clear"),
  verb: tx("Rotating"), zipName: "rotated-images.zip", pickMore: tx("Add more images"),
  meta: (it) => `${fmtBytes(it.file.size)} · ${it.info.width ? dims(it.info.width, it.info.height) + " · " : ""}${LABEL[it.info.type]}`,
  blocked: () => (isIdentity() ? tx("Choose a rotation or a flip first.") : null),
  summaryText: (items) => txn(items.length, "{n} image", "{n} images"),
  onChange(items) {
    const first = items[0] || null;
    if ((first ? first.id : null) !== prevId) loadPreview(first);
  },
  async process(item) {
    const type = keepType(item.info.type);
    const bmp = await decode(item.file);
    const canvas = transformed(bmp, bmp.width, bmp.height);
    bmp.close();
    try {
      const blob = await encodeCanvas(canvas, type, 0.92);
      return { blob, name: outName(item.file.name, flipsOnly ? "-flipped" : "-rotated", type), note: tx("{size} px", { size: dims(canvas.width, canvas.height) }) };
    } finally {
      release(canvas);
    }
  },
  doneText: (outputs) => flipsOnly ? txn(outputs.length, "Done: {n} image flipped.", "Done: {n} images flipped.") : txn(outputs.length, "Done: {n} image rotated.", "Done: {n} images rotated."),
});
